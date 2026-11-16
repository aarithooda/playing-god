"""Production collision/merger layer for the REBOUND simulation (SI units throughout).

Spec: context/PHYSICS_SPIKE.md ("Decision: GO WITH CUSTOM COLLISION LAYER"). REBOUND (`collision = "line"`) only
*detects* an overlap and calls `MergeResolver.resolve`; the resolver performs a perfectly inelastic merger:

- the heavier body keeps its id (ties: REBOUND's first particle `p1`); the other id is absorbed;
- mass and linear momentum are conserved; the remnant sits at the centre of mass with the centre-of-mass velocity;
- the remnant radius conserves volume (sum of cubes);
- translational kinetic energy 0.5*mu*v_rel^2 is lost (booked in `heat_J`, no internal-energy model exists), and the
  orbital angular momentum mu*(r_rel x v_rel) is booked as remnant `spin` (a bookkeeping vector only: no rotation
  or tidal model is implemented). Total kinetic+potential energy is NOT conserved by a merger.
- IAS15 is re-selected after every merge because its predictor state is stale once a particle changed
  (observed momentum error 5e-9 relative without it, ~1e-13 with it). `select_ias15` is the only place that selects it.

The merger arithmetic itself lives in `backend.impact.models.perfect_merge.merge_pair`, shared with the deferred-resolution
engine (mode "outcome-v1", backend/impact/engine.py) so both paths are bit-identical for the same input. This class is the
`legacy-merge` mode: it resolves inside the REBOUND callback exactly as before.

Exceptions inside a ctypes callback are swallowed by REBOUND, so `resolve` catches them, records the traceback in
`errors` and returns 0 (keep both bodies). The caller must treat a non-empty `errors` list as a failed step.
"""
import math
import traceback
from typing import Callable

from backend.impact.models.perfect_merge import PairBody, merge_pair

Vec = list[float]


SATELLITE_MASS_FRACTION = 0.1  # a body is a satellite when its strongest attractor is lighter than this x the heaviest


DEBRIS_NAME_PREFIXES = ("frag-", "debris-")  # ids given by backend/impact/applier.py
# Spacecraft ids (backend/spaceflight/engine.py). A spacecraft orbits a body on a timescale far shorter than the system's, exactly the
# two-timescale structure of a moon; with GLOBAL the step collapses (measured: Earth + Moon + a 300 km parking orbit, 1 day = 1,019,955
# steps of ~0.01 s with GLOBAL against 1,725 steps for THREE days with PRS23), so a universe with a spacecraft uses PRS23.
SPACECRAFT_NAME_PREFIX = "craft-"


def has_satellites(sim) -> bool:
    """True when some body is dominated by an attractor that is not the system's main mass: a moon bound to its planet
    rather than to the star. Such a system has two very different dynamical timescales."""
    if any((q.name or "").startswith(SPACECRAFT_NAME_PREFIX) for q in sim.particles):
        return True  # also for a single body and its spacecraft: one rule for every universe that holds one
    ps = [(q.m, q.x, q.y, q.z) for q in sim.particles]
    if len(ps) < 3:
        return False
    # Collision debris (Stage 5/7: fragments `frag-*` and parcels `debris-*`) orbits or leaves its remnant on a timescale far shorter than
    # the system's: the same two-timescale structure as a moon. With GLOBAL the step collapsed erratically on such systems (3 of 10 runs
    # of the same scenario took 10-44 s instead of 1.5 s, seeded differently); PRS23 took 1.1-1.7 s in all 12 (D-051).
    if any((q.name or "").startswith(DEBRIS_NAME_PREFIXES) for q in sim.particles):
        return True
    heaviest = max(m for m, *_ in ps)
    for i, (mi, xi, yi, zi) in enumerate(ps):
        best_a, best_m = 0.0, 0.0
        for j, (mj, xj, yj, zj) in enumerate(ps):
            if i == j:
                continue
            r2 = (xj - xi) ** 2 + (yj - yi) ** 2 + (zj - zi) ** 2
            if r2 > 0.0 and mj / r2 > best_a:
                best_a, best_m = mj / r2, mj
        if best_m and best_m < SATELLITE_MASS_FRACTION * heaviest and mi < best_m:
            return True
    return False


def select_ias15(sim) -> None:
    """(Re-)select IAS15 with the step-size criterion suited to the system.

    Re-selecting resets IAS15's predictor state, which is what a structural change needs.

    Default: the GLOBAL criterion (Rein & Spiegel 2015). REBOUND 5.2.2's default (PRS23) stalls forever when a body's
    net force cancels by symmetry (three equal masses at rest on a line: the middle body's acceleration is round-off
    noise ~1e-29, the step size collapses to ~1e-18 s and `integrate` never returns). GLOBAL scales the step by the
    largest acceleration of the whole system and completes the same scenarios in ~10 steps.
    Evidence: context/WORKLOG.md (2026-10-24 stabilization) and tests/test_step_guard.py.

    Exception: a system with satellites (see `has_satellites`) uses PRS23. GLOBAL's single scale makes the step collapse
    erratically in the Sun + planets + moons preset (a 215-day run reached steps of ~1 s and stopped making progress,
    while PRS23 covers 300 days with a minimum step of ~4,000 s); there every body has a well-defined acceleration, so
    PRS23's cancellation stall cannot occur. Evidence: context/DECISIONS.md D-030, tests/validation/test_preset_moons.py."""
    sim.integrator = "ias15"
    sim.integrator.adaptive_mode = "prs23" if has_satellites(sim) else "global"


# ---------- PRS23 step collapse (D-071) ----------
# PRS23 (Pham, Rein & Spiegel 2023; REBOUND src/integrator_ias15.c) takes, for every particle, the timescale
#     tau^2 = 2 |a|^2 / (|j|^2 + |a| |s|)        (a acceleration, j jerk, s snap, at the end of the step)
# and steps with the smallest one. tau is "how long until the acceleration has changed by its own size", which is a sound
# measure of orbital curvature EXCEPT where a particle's acceleration vector passes through zero while its jerk does not: there
# tau = sqrt(2) |a| / |j| is simply the time left until the zero, so every step covers a fixed fraction (about a quarter) of the
# remaining time and the zero is never reached. The step shrinks geometrically without bound (measured: to 1e-25 s, far below
# the resolution of the time variable) and `integrate` never returns. The acceleration of a body passes exactly through zero only
# when the pulls on it cancel as vectors, i.e. on exactly collinear configurations: two bodies closing head-on along the line
# through a third (the pull of the near small body grows past the planet's), or three masses on a line.
# The GLOBAL criterion (the error estimate of the whole system over its largest acceleration) has no such singularity and walks
# through these points in a handful of steps; it is unusable as the standing criterion next to a low orbit (see has_satellites).
# So: when PRS23 has driven the step below any physically meaningful time (`collapse_threshold`), the next few steps are chosen
# by GLOBAL, then PRS23 resumes. Every step taken is one a valid IAS15 error criterion asked for, so accuracy is not traded:
# only the choice between two valid criteria changes, and only where one of them is singular. Above the threshold nothing changes.
COLLAPSE_SAFETY = 1.0e-3  # the step counts as collapsed below this fraction of the fastest possible contact-crossing time
COLLAPSE_TIME_ULPS = 64.0  # ... or below this many units of resolution of the time variable
GLOBAL_STEPS_AFTER_COLLAPSE = 32  # steps chosen by GLOBAL before PRS23 resumes (the step can recover by 4x per step)
G_FALLBACK = 6.67430e-11


def collapse_threshold(sim) -> float:
    """A step length [s] no healthy step of this system can be below.

    The shortest physical timescale of point masses with radii is a contact: tau ~ |a| / |j| ~ d / v for two bodies a contact
    distance d apart closing at v, and PRS23 then steps about tau / 4. `d` is bounded below by the two smallest radii; `v` is
    bounded above by twice the largest present speed (about the system's centre of mass) plus the speed gained falling to the
    deepest reachable point of the potential, sqrt(2 G M_total / r_min). The threshold is COLLAPSE_SAFETY times that crossing time
    (250 times below a step PRS23 could legitimately ask for), and never less than a few units of resolution of `sim.t`."""
    ps = list(sim.particles)
    resolution = COLLAPSE_TIME_ULPS * math.ulp(max(abs(sim.t), 1.0))
    if len(ps) < 2:
        return resolution
    total = sum(p.m for p in ps)
    radii = sorted(p.r for p in ps)
    if not (total > 0.0 and radii[0] > 0.0):
        return resolution
    cx, cy, cz = (sum(p.m * getattr(p, k) for p in ps) / total for k in ("vx", "vy", "vz"))
    fastest = max(math.sqrt((p.vx - cx) ** 2 + (p.vy - cy) ** 2 + (p.vz - cz) ** 2) for p in ps)
    bound = 2.0 * fastest + math.sqrt(2.0 * (sim.G or G_FALLBACK) * total / radii[0])
    return max(COLLAPSE_SAFETY * (radii[0] + radii[1]) / bound, resolution)


class StepCollapseGuard:
    """Watches the internal steps of one `integrate` call (from the heartbeat) and hands a collapsed PRS23 step to GLOBAL.

    `arm` before the integration, `beat` after every internal step, `release` after it (PRS23 is always restored). Does nothing
    for a simulation whose criterion is not PRS23."""

    def __init__(self) -> None:
        self.fallbacks = 0  # how often a collapse was handed over (diagnostics and tests)
        self._threshold = 0.0
        self._left = 0
        self._armed = False

    def arm(self, sim) -> None:
        self._armed = str(sim.integrator.adaptive_mode).upper() == "PRS23"
        self._left = 0
        if self._armed:
            self._threshold = collapse_threshold(sim)

    def beat(self, sim) -> None:
        if not self._armed:
            return
        if self._left > 0:
            self._left -= 1
            if self._left == 0:
                sim.integrator.adaptive_mode = "prs23"
            return
        if 0.0 < abs(sim.dt_last_done) < self._threshold:
            sim.integrator.adaptive_mode = "global"
            self._left = GLOBAL_STEPS_AFTER_COLLAPSE
            self.fallbacks += 1

    def release(self, sim) -> None:
        if self._armed and self._left > 0:
            sim.integrator.adaptive_mode = "prs23"
        self._left = 0
        self._armed = False


def add_named_particle(sim, name: str, **fields) -> None:
    """Add a particle and give it its name through the particle's name SETTER (the name memory is then owned by the simulation).

    Never pass `name=` to `Simulation.add`: in REBOUND 5.2.2 that path leaves a dangling name string, and after enough interleaved
    `remove()` / `add()` calls particle names turn into `None` or garbage bytes (found in Stage 4a: plain REBOUND, first corruption after
    203-754 operations in 5 of 5 seeds; none in 20,000 operations with the setter, tests/impact/test_rebound_names.py). Identity is the
    particle name, so every place that adds a particle must use this function."""
    sim.add(**fields)
    sim.particles[sim.N - 1].name = name


def _sub(a: Vec, b: Vec) -> Vec:
    return [x - y for x, y in zip(a, b)]


def _add(a: Vec, b: Vec) -> Vec:
    return [x + y for x, y in zip(a, b)]


def _scale(a: Vec, s: float) -> Vec:
    return [x * s for x in a]


def _dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b))


def _cross(a: Vec, b: Vec) -> Vec:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


def _pos(p) -> Vec:
    return [p.x, p.y, p.z]


def _vel(p) -> Vec:
    return [p.vx, p.vy, p.vz]


def contact_time_estimate(t_end: float, dt_last: float, r_rel: Vec, u_rel: Vec, contact_dist: float) -> float | None:
    """Estimated time of first contact, from the state at the END of the last internal step.

    REBOUND reports a collision only at a step end. Assuming straight-line relative motion over that step, solve
    |r - u*tau| = R for tau >= 0 seconds before the end. Exact for gravity-free motion, otherwise accurate to the
    path curvature (~ a_rel*dt^2/8 in position). Returns None if there is no root inside the last step."""
    uu = _dot(u_rel, u_rel)
    if uu == 0.0:
        return None
    ru = _dot(r_rel, u_rel)
    disc = ru * ru - uu * (_dot(r_rel, r_rel) - contact_dist * contact_dist)
    if disc < 0.0:
        return None
    tau = (ru + math.sqrt(disc)) / uu
    if tau < -1e-12 or tau > dt_last * (1 + 1e-9):
        return None
    return t_end - tau


class MergeResolver:
    """REBOUND `collision_resolve` callback. Particle `name` is the public body id (never the array index)."""

    def __init__(self, on_merge: Callable[[dict], None]):
        self._on_merge = on_merge
        self.errors: list[str] = []
        self.stale = 0  # callbacks whose indices no longer exist after an earlier merge in the same step
        self.heat_J = 0.0
        self.spin: dict[str, Vec] = {}  # body id -> remnant spin [kg m^2/s]

    def resolve(self, sim_ptr, col) -> int:
        try:
            rc = self._resolve(sim_ptr.contents, col)
            if rc != 0:
                select_ias15(sim_ptr.contents)  # reset stale predictor state (see module docstring)
            return rc
        except Exception:  # noqa: BLE001 - ctypes would swallow it; surface via `errors`
            self.errors.append(traceback.format_exc())
            return 0

    def _resolve(self, sim, col) -> int:
        if col.p1 >= sim.N or col.p2 >= sim.N or col.p1 == col.p2:
            self.stale += 1
            return 0
        pa, pb = sim.particles[col.p1], sim.particles[col.p2]
        merged = merge_pair(PairBody(pa.name, pa.m, pa.r, tuple(_pos(pa)), tuple(_vel(pa))),
                            PairBody(pb.name, pb.m, pb.r, tuple(_pos(pb)), tuple(_vel(pb))),
                            sim.t, sim.dt_last_done, contact_time_estimate)
        surv = pa if merged.remove_code == 2 else pb
        gone_id = merged.absorbed_id
        for axis, value in zip(("x", "y", "z"), merged.position):
            setattr(surv, axis, value)
        for axis, value in zip(("vx", "vy", "vz"), merged.velocity):
            setattr(surv, axis, value)
        surv.m = merged.mass
        surv.r = merged.radius
        self.heat_J += merged.kinetic_energy_lost_j
        spin = _add(self.spin.pop(merged.survivor_id, [0.0] * 3), self.spin.pop(gone_id, [0.0] * 3))
        self.spin[merged.survivor_id] = _add(spin, merged.orbital_angular_momentum)
        self._on_merge(merged.event)
        return merged.remove_code
