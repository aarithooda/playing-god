"""Burns on a REBOUND simulation, and who a spacecraft is orbiting. Shared by the engine (live universe) and the planner (a private
copy of it), so a planned burn and an executed burn are the same arithmetic.

Impulsive burn: the velocity of the craft's particle changes by the commanded vector at one instant; the propellant of the rocket
equation is removed from its mass.

Finite burn: a constant-thrust force is added to the simulation's force evaluation (REBOUND `additional_forces`). IAS15 evaluates
forces at its sub-step times, where `sim.t` is that sub-step time, so the thrust acceleration F / m(t) with the analytic mass
m(t) = m0 - mdot (t - t0) is integrated to the integrator's own precision: there is no separate mass integration and no fixed
sub-stepping. The direction either follows the craft's VNB frame about a reference body (recomputed at every force evaluation: the
force is then velocity dependent, which IAS15 is told) or is a fixed inertial unit vector. The particle's gravitational mass is
brought up to date whenever the integrator returns (its own gravity is negligible, but the state must say what is on board).
Thrust is an external force: the exhaust is not simulated, so the system's total momentum changes by the impulse delivered.
"""
import math
import traceback
from dataclasses import dataclass
from typing import Optional

from backend.spaceflight import orbits
from backend.spaceflight.propulsion import exhaust_velocity

Vec = tuple[float, float, float]


@dataclass(frozen=True)
class ActiveBurn:
    """What the force callback needs of one burning engine."""

    craft_id: str
    reference_id: Optional[str]  # VNB frame reference; None for an inertial burn
    components: Vec  # unit direction: (prograde, normal, radial-out) for VNB, (x, y, z) for inertial
    thrust_n: float
    mass_flow: float
    ignition_mass_kg: float
    ignition_time_s: float

    def mass_at(self, t: float) -> float:
        return self.ignition_mass_kg - self.mass_flow * (t - self.ignition_time_s)


def particle_index(sim, name: str) -> int:
    """Index of the particle called `name` (a scan: REBOUND's name hash table is stale after removals, see SimulationService._particle)."""
    for k, p in enumerate(sim.particles):
        if p.name == name:
            return k
    raise KeyError(name)


def relative_state(p, q) -> tuple[Vec, Vec]:
    """(r, v) of particle p relative to particle q."""
    return (p.x - q.x, p.y - q.y, p.z - q.z), (p.vx - q.vx, p.vy - q.vy, p.vz - q.vz)


def burn_vector(frame: str, components: Vec, r: Optional[Vec], v: Optional[Vec]) -> Vec:
    """The inertial vector of `components` given in `frame` ("vnb" needs the relative state r, v)."""
    if frame == "inertial":
        return components
    if r is None or v is None:
        raise orbits.OrbitError("a VNB manoeuvre needs a reference body")
    return orbits.vnb_to_inertial(r, v, components[0], components[1], components[2])


class ThrustForce:
    """The `additional_forces` callback while one or more engines burn. `bind` before every `integrate`, `release` after it (particle
    indices can change between integrations). Exceptions inside a ctypes callback are swallowed by REBOUND, so they are recorded in
    `errors` and stop the integration; the caller must treat a non-empty `errors` as a failed step."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self._burns: list[tuple] = []
        self._count = 0  # particle count the indices were resolved for
        self._lost: dict = {}  # craft id -> time its burn lost the craft or the reference body inside an integration

    @property
    def active(self) -> bool:
        return bool(self._burns)

    def _resolve(self, sim, burns: list[ActiveBurn], t: float) -> None:
        """Particle indices of every burn. A burn whose craft or reference body is not in the simulation stops pushing (`_lost`)."""
        index = {p.name: k for k, p in enumerate(sim.particles)}
        rows = []
        for b in burns:
            i = index.get(b.craft_id)
            j = -1 if b.reference_id is None else index.get(b.reference_id)
            if i is None or j is None:
                self._lost.setdefault(b.craft_id, t)
                continue
            rows.append((i, j, b))
        self._burns = rows
        self._count = sim.N

    def bind(self, sim, burns: list[ActiveBurn]) -> None:
        self._lost = {}
        self._resolve(sim, burns, sim.t)
        sim.additional_forces = self._force
        sim.force_is_velocity_dependent = 1 if any(j >= 0 for _, j, _ in self._burns) else 0

    def release(self, sim) -> dict:
        """Remove the force. Returns {craft id: time} for burns that stopped pushing during the integration because a particle
        they need was removed inside it (a merge in the collision callback)."""
        lost, self._lost = self._lost, {}
        self._burns = []
        sim.additional_forces = 0  # NULL: no additional force
        sim.force_is_velocity_dependent = 0
        return lost

    def _force(self, sim_ptr) -> None:
        try:
            sim = sim_ptr.contents
            t = sim.t
            if sim.N != self._count:  # a particle was removed inside this integration (a merge in the collision callback): the
                self._resolve(sim, [b for _, _, b in self._burns], t)  # indices moved; never push a bystander
            ps = sim.particles
            for i, j, b in self._burns:
                p = ps[i]
                a = b.thrust_n / b.mass_at(t)
                if j >= 0:
                    q = ps[j]
                    ux, uy, uz = orbits.vnb_to_inertial((p.x - q.x, p.y - q.y, p.z - q.z), (p.vx - q.vx, p.vy - q.vy, p.vz - q.vz),
                                                        b.components[0], b.components[1], b.components[2])
                else:
                    ux, uy, uz = b.components
                p.ax += a * ux
                p.ay += a * uy
                p.az += a * uz
        except Exception:  # noqa: BLE001 - surfaced through `errors`
            self.errors.append(traceback.format_exc())
            try:
                sim_ptr.contents.stop()
            except Exception:  # noqa: BLE001
                pass


# ---------- who is the craft orbiting ----------
@dataclass(frozen=True)
class Gravitator:
    id: str
    mass_kg: float
    radius_m: float
    position: Vec
    velocity: Vec


@dataclass(frozen=True)
class Hierarchy:
    """Parent and sphere of influence of every massive body, from the present positions (no orbit averaging)."""

    bodies: tuple
    parent: dict  # body id -> parent id or None (the heaviest body, and any body with no heavier one, is top level)
    soi: dict  # body id -> Laplace sphere of influence about its parent [m]; inf for a top-level body

    def by_id(self, body_id: str) -> Optional[Gravitator]:
        return next((b for b in self.bodies if b.id == body_id), None)

    def reference_for(self, position: Vec) -> Optional[Gravitator]:
        """The body whose sphere of influence contains `position`, innermost first; None in an empty universe."""
        best, best_soi = None, math.inf
        for b in self.bodies:
            soi = self.soi[b.id]
            if math.dist(position, b.position) < soi and (best is None or soi < best_soi):
                best, best_soi = b, soi
        if best is None and self.bodies:  # cannot happen while a top-level body exists (its sphere is infinite)
            best = max(self.bodies, key=lambda b: b.mass_kg)
        return best


def build_hierarchy(bodies: list[Gravitator]) -> Hierarchy:
    """Parent of a body: the nearest HEAVIER body whose Hill sphere contains it (a moon is inside its planet's Hill sphere although
    the star pulls harder on it); failing that, the heavier body that attracts it most strongly (a planet's star). The sphere of
    influence is Laplace's r = d (m / M)^(2/5) with d the present distance to the parent (not the semi-major axis: an approximation
    that is exact for a circular orbit). Equal masses and the heaviest body have no parent: their sphere is unbounded."""
    def strongest(b: Gravitator) -> Optional[Gravitator]:
        best, pull = None, 0.0
        for k in bodies:
            if k is b or not k.mass_kg > b.mass_kg:
                continue
            d = math.dist(b.position, k.position)
            if d > 0.0 and k.mass_kg / (d * d) > pull:
                best, pull = k, k.mass_kg / (d * d)
        return best

    hill = {}
    for b in bodies:
        k = strongest(b)
        if k is not None:
            hill[b.id] = orbits.hill_radius(math.dist(b.position, k.position), b.mass_kg, k.mass_kg)
    parent, soi = {}, {}
    for b in bodies:
        best, best_d = None, math.inf
        for k in bodies:
            if k is b or not k.mass_kg > b.mass_kg or k.id not in hill:
                continue
            d = math.dist(b.position, k.position)
            if d < hill[k.id] and d < best_d:
                best, best_d = k, d
        best = best or strongest(b)
        parent[b.id] = None if best is None else best.id
        soi[b.id] = math.inf if best is None else orbits.sphere_of_influence(math.dist(b.position, best.position), b.mass_kg, best.mass_kg)
    return Hierarchy(tuple(bodies), parent, soi)


def gravitators(sim, exclude: set) -> list[Gravitator]:
    return [Gravitator(p.name, p.m, p.r, (p.x, p.y, p.z), (p.vx, p.vy, p.vz)) for p in sim.particles if p.name not in exclude]


# ---------- the burn arithmetic ----------
@dataclass(frozen=True)
class ImpulseResult:
    delta_v: Vec  # applied inertial vector
    delivered: float  # its magnitude
    propellant_used_kg: float
    shortfall: float  # commanded - delivered (> 0 only when the propellant ran out)


def plan_impulse(commanded: Vec, mass_kg: float, propellant_kg: float, isp_s: float) -> ImpulseResult:
    """The impulse a craft can actually deliver: the commanded vector, shortened if the propellant on board gives less delta-v."""
    magnitude = orbits.norm(commanded)
    if magnitude == 0.0:
        return ImpulseResult((0.0, 0.0, 0.0), 0.0, 0.0, 0.0)
    ve = exhaust_velocity(isp_s)
    dry = mass_kg - propellant_kg
    available = ve * math.log(mass_kg / dry) if (ve > 0.0 and propellant_kg > 0.0 and dry > 0.0) else 0.0
    delivered = min(magnitude, available)
    used = mass_kg * (1.0 - math.exp(-delivered / ve)) if delivered > 0.0 else 0.0
    used = min(used, propellant_kg)
    return ImpulseResult(orbits.scale(commanded, delivered / magnitude), delivered, used, magnitude - delivered)


@dataclass(frozen=True)
class BurnWindow:
    start_s: float
    end_s: float
    propellant_kg: float
    feasible: bool  # the propellant covers the commanded delta-v
    delivered: float  # delta-v the window delivers [m/s]


def burn_window(dv: float, epoch_s: float, centered: bool, mass_kg: float, propellant_kg: float, thrust_n: float, isp_s: float) -> BurnWindow:
    """Ignition and cutoff of a constant-thrust burn of `dv` for a craft of `mass_kg` (of which `propellant_kg` is propellant) at
    ignition. The burn ends when the delta-v is delivered or the propellant is gone, whichever comes first. Centred: half the burn
    lies before the node (the usual way to approximate an impulse at the node)."""
    ve = exhaust_velocity(isp_s)
    flow = thrust_n / ve if (thrust_n > 0.0 and ve > 0.0) else 0.0
    if flow <= 0.0 or dv <= 0.0:
        return BurnWindow(epoch_s, epoch_s, 0.0, dv <= 0.0, 0.0)
    wanted = mass_kg * (1.0 - math.exp(-dv / ve))
    used = min(wanted, propellant_kg)
    duration = used / flow
    delivered = dv if used >= wanted else (ve * math.log(mass_kg / (mass_kg - used)) if used < mass_kg else math.inf)
    start = epoch_s - 0.5 * duration if centered else epoch_s
    return BurnWindow(start, start + duration, used, used >= wanted * (1.0 - 1.0e-12), delivered)
