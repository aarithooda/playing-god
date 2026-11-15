"""Transfer design: from a parking orbit about a body to one of that body's satellites (Earth -> Moon is the reference case).

Method (what is computed, and with which model)
1. PATCHED-CONIC ESTIMATE (two-body, analytic): a tangential burn at the parking radius r0 onto an ellipse about the origin body whose
   apoapsis is the destination's distance (a Hohmann half-ellipse), or, if a transfer time is requested, onto the faster ellipse that
   reaches that distance in that time. This gives the departure delta-v and a transfer time; the departure PHASE follows from "the
   craft must leave from the point opposite to where the destination will be at arrival". The estimate is reported as such.
   Its assumptions (destination massless during the coast, instantaneous burns, coplanar circular orbits) do not hold exactly,
   so it is only the starting point.
2. N-BODY SHOOTING: the candidate departure is flown on a private COPY of the universe's own REBOUND simulation (same bodies, same
   G, same IAS15 integrator, the same burn code as the live engine, collisions off), and the departure time is adjusted until the
   closest approach to the destination has the requested periapsis radius on the requested side (one-dimensional root finding on
   the signed periapsis radius: a scan to bracket, then Illinois regula falsi). The destination is a real gravitating body
   throughout: there is no sphere-of-influence switch in the propagation.
3. INSERTION: at the predicted periapsis a retrograde burn sized by vis-viva for the requested capture orbit, then the whole plan is
   flown once more on the copy to predict the resulting orbit and to sample the planned trajectory.

The plan is a PREDICTION. The live simulation is never touched here; whether the mission succeeds is decided later from the
actual state (missions.py). Supported: origin body = the body the craft orbits, destination = a satellite of that body, near-circular
parking orbit well inside the destination's orbit. Everything else is reported as unsupported with the reason, never approximated
silently. Large universes: bracketing uses a reduced copy (craft, origin, destination and the origin's ancestors); the final
root-finding iterations and the final flight use the full copy.
"""
import math
import time
import warnings
from dataclasses import dataclass
from typing import Optional

from backend.collisions import select_ias15
from backend.spaceflight import orbits
from backend.spaceflight.craft import Spacecraft
from backend.spaceflight.dynamics import (ActiveBurn, ThrustForce, build_hierarchy, burn_window, gravitators, particle_index, plan_impulse,
                                          relative_state)
from backend.spaceflight.propulsion import exhaust_velocity

MAX_PARKING_ECCENTRICITY = 0.02
MAX_PARKING_RADIUS_FRACTION = 0.5  # parking radius / distance to the destination
REDUCED_MODEL_ABOVE = 6  # particles; larger universes are bracketed on a reduced copy
SCAN_HALF_WIDTH_RAD = math.radians(40.0)
SCAN_STEP_RAD = math.radians(2.0)
PERIAPSIS_TOL_M = 1.0
MAX_ROOT_ITERATIONS = 60
DEFAULT_TIME_BUDGET_S = 25.0
TRAJECTORY_POINTS_COAST = 240
TRAJECTORY_POINTS_PER_REV = 48
VERIFY_REVOLUTIONS = 2.0


class PlannerTimeout(Exception):
    pass


@dataclass(frozen=True)
class TransferRequest:
    destination_id: str
    periapsis_altitude_m: float
    capture: str = "circular"  # "circular" | "elliptical" | "none" (flyby)
    apoapsis_altitude_m: Optional[float] = None  # elliptical capture
    direction: str = "prograde"  # sense of the orbit about the destination relative to the destination's own orbital motion
    transfer_time_s: Optional[float] = None
    burn_mode: str = "impulsive"  # "impulsive" | "finite"
    earliest_departure_s: Optional[float] = None


@dataclass(frozen=True)
class PlanResult:
    status: str  # "ok" | "unsupported" | "no_solution"
    reasons: tuple
    plan: Optional[dict] = None
    trajectory: tuple = ()
    nodes: tuple = ()  # dicts describing the manoeuvre nodes to schedule


@dataclass
class _Flight:
    """What one trial flight found at the destination."""

    periapsis_radius: float
    periapsis_time: float
    signed: float  # +radius for a prograde pass, -radius for a retrograde one
    speed: float  # relative to the destination at periapsis
    state: tuple  # (r, v) relative to the destination at periapsis
    reached: bool  # a genuine periapsis was located (False: only the coarse minimum distance of a miss)
    departure_state: tuple  # (r, v) relative to the origin just before the departure burn
    mass_after_departure: float
    propellant_after_departure: float
    departure_window: tuple  # (ignition, cutoff)
    departure_delivered: float


def _copy(sim):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        c = sim.copy()
    c.collision = "none"  # the planner decides about an impact from the periapsis radius; nothing may bounce or merge here
    return c


def _reduced(sim, keep: set):
    c = _copy(sim)
    for k in range(c.N - 1, -1, -1):
        if c.particles[k].name not in keep:
            c.remove(k)
    select_ias15(c)
    return c


class _Flyer:
    """Flies burns on a simulation copy with exactly the engine's burn arithmetic."""

    def __init__(self, craft_id: str, craft: Spacecraft):
        self.craft_id = craft_id
        self.dry = craft.dry_mass_kg
        self.thrust = craft.thrust_n
        self.isp = craft.isp_s

    def burn(self, sim, propellant: float, node_s: float, mode: str, reference_id: str, prograde: float) -> tuple:
        """Fly a prograde (negative: retrograde) burn of |prograde| m/s about `reference_id` at `node_s`. Returns
        (propellant left, pre-burn relative state, (ignition, cutoff), delivered delta-v)."""
        i = particle_index(sim, self.craft_id)
        mass = self.dry + propellant
        sign = 1.0 if prograde >= 0.0 else -1.0
        dv = abs(prograde)
        if mode == "impulsive":
            sim.integrate(node_s)
            p, q = sim.particles[i], sim.particles[particle_index(sim, reference_id)]
            r, v = relative_state(p, q)
            res = plan_impulse(orbits.vnb_to_inertial(r, v, prograde, 0.0, 0.0), mass, propellant, self.isp)
            p.vx += res.delta_v[0]
            p.vy += res.delta_v[1]
            p.vz += res.delta_v[2]
            p.m = mass - res.propellant_used_kg
            select_ias15(sim)
            return propellant - res.propellant_used_kg, (r, v), (node_s, node_s), res.delivered
        window = burn_window(dv, node_s, True, mass, propellant, self.thrust, self.isp)
        sim.integrate(window.start_s)
        p, q = sim.particles[i], sim.particles[particle_index(sim, reference_id)]
        pre = relative_state(p, q)
        if window.end_s > window.start_s:
            force = ThrustForce()
            select_ias15(sim)
            force.bind(sim, [ActiveBurn(self.craft_id, reference_id, (sign, 0.0, 0.0), self.thrust, self.thrust / exhaust_velocity(self.isp),
                                        mass, window.start_s)])
            sim.integrate(window.end_s)
            force.release(sim)
            if force.errors:
                raise RuntimeError("thrust force failed in the planner:\n" + force.errors[-1])
            sim.particles[i].m = mass - window.propellant_kg
            select_ias15(sim)
        return propellant - window.propellant_kg, pre, (window.start_s, window.end_s), window.delivered


def _unsupported(*reasons: str) -> PlanResult:
    return PlanResult("unsupported", tuple(reasons))


def _transfer_semi_major_axis(mu: float, r0: float, d: float, tof: float) -> Optional[float]:
    """Semi-major axis of the ellipse with periapsis r0 that reaches radius d after `tof` (None when no ellipse does: too short)."""
    def time_to(a: float) -> float:
        e = 1.0 - r0 / a
        cos_nu = (a * (1.0 - e * e) / d - 1.0) / e
        nu = math.acos(max(-1.0, min(1.0, cos_nu)))
        return orbits.time_since_periapsis(orbits.Elements(a, e, 0.0, 0.0, 0.0, nu), mu)

    lo = 0.5 * (r0 + d)  # the Hohmann ellipse: the slowest
    if tof >= time_to(lo):
        return lo
    hi = lo
    for _ in range(80):
        hi *= 2.0
        if time_to(hi) < tof:
            break
    else:
        return None
    if 1.0 - r0 / hi > 0.999:  # an essentially parabolic departure: outside what this planner offers
        return None
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if time_to(mid) > tof:
            lo = mid
        else:
            hi = mid
        if hi - lo <= 1.0e-12 * hi:
            break
    return 0.5 * (lo + hi)


def design_transfer(sim, craft_id: str, craft: Spacecraft, craft_ids: set, request: TransferRequest, *, pending_nodes: int = 0,
                    time_budget_s: float = DEFAULT_TIME_BUDGET_S, clock=time.monotonic) -> PlanResult:
    """Design the transfer on copies of `sim` (which is not modified). `craft_ids`: every spacecraft of the universe (they are not
    gravitating reference bodies)."""
    started = clock()
    g = sim.G
    t0 = sim.t
    hierarchy = build_hierarchy(gravitators(sim, craft_ids))
    try:
        ci = particle_index(sim, craft_id)
    except KeyError:
        return _unsupported("the spacecraft no longer exists")
    cp = sim.particles[ci]
    origin = hierarchy.reference_for((cp.x, cp.y, cp.z))
    dest = hierarchy.by_id(request.destination_id)
    if dest is None:
        return _unsupported("the destination body no longer exists")
    if origin is None:
        return _unsupported("the spacecraft is not near any body")
    if dest.id == origin.id:
        return _unsupported(f"the spacecraft already orbits {dest.id}: use manoeuvre nodes to change its orbit there")
    if hierarchy.parent.get(dest.id) != origin.id:
        parent = hierarchy.parent.get(dest.id)
        return _unsupported(
            "only transfers from a parking orbit about a body to one of that body's satellites are implemented "
            f"(the spacecraft orbits {origin.id}; the destination {dest.id} orbits {parent or 'nothing'}). "
            "Interplanetary transfers (escape, heliocentric cruise, arrival) are not implemented.")
    if pending_nodes:
        return _unsupported("the spacecraft has pending manoeuvre nodes: remove them (or let them execute) before designing a transfer")
    if not craft.has_engine or craft.propellant_kg <= 0.0:
        return _unsupported("the spacecraft has no usable propulsion (specific impulse and propellant are needed)")
    if request.burn_mode == "finite" and not craft.thrust_n > 0.0:
        return _unsupported("finite burns need a thrust above zero")
    mu = g * (origin.mass_kg + cp.m)
    mu_dest = g * (dest.mass_kg + cp.m)
    r_c, v_c = orbits.sub((cp.x, cp.y, cp.z), origin.position), orbits.sub((cp.vx, cp.vy, cp.vz), origin.velocity)
    try:
        parking = orbits.state_to_elements(r_c, v_c, mu)
    except orbits.OrbitError as exc:
        return _unsupported(f"the spacecraft's orbit about {origin.id} is degenerate: {exc}")
    if not parking.e < MAX_PARKING_ECCENTRICITY:
        return _unsupported(f"a near-circular parking orbit is needed (eccentricity {parking.e:.4f} >= {MAX_PARKING_ECCENTRICITY}); "
                            "circularise first")
    r0 = orbits.norm(r_c)
    r_d, v_d = orbits.sub(dest.position, origin.position), orbits.sub(dest.velocity, origin.velocity)
    distance = orbits.norm(r_d)
    if r0 > MAX_PARKING_RADIUS_FRACTION * distance:
        return _unsupported("the parking orbit must lie well inside the destination's orbit "
                            f"(radius {r0:.4g} m > {MAX_PARKING_RADIUS_FRACTION} x {distance:.4g} m)")
    rp_target = dest.radius_m + request.periapsis_altitude_m
    soi = hierarchy.soi[dest.id]
    if not rp_target < 0.5 * soi:
        return _unsupported(f"the requested periapsis ({rp_target:.4g} m) is not well inside the destination's sphere of influence ({soi:.4g} m)")
    if request.capture == "elliptical":
        if request.apoapsis_altitude_m is None or request.apoapsis_altitude_m < request.periapsis_altitude_m:
            return _unsupported("an elliptical capture needs an apoapsis altitude at or above the periapsis altitude")
        ra_target = dest.radius_m + request.apoapsis_altitude_m
        if not ra_target < soi:
            return _unsupported("the requested apoapsis lies outside the destination's sphere of influence")
    else:
        ra_target = rp_target
    h_park, h_dest = orbits.cross(r_c, v_c), orbits.cross(r_d, v_d)
    plane_mismatch = orbits.plane_angle(h_park, h_dest)
    if plane_mismatch > 0.5 * math.pi:
        return _unsupported("the parking orbit is retrograde with respect to the destination's orbit; a prograde parking orbit is needed")

    flyer = _Flyer(craft_id, craft)
    v_circ = orbits.circular_speed(mu, r0)
    period_park = orbits.orbital_period(mu, parking.a)
    n_park = orbits.TWO_PI / period_park
    hohmann = orbits.hohmann(mu, r0, distance)
    if request.transfer_time_s is not None and request.transfer_time_s > hohmann.transfer_time * 1.0001:
        return _unsupported(f"the requested transfer time is longer than the minimum-energy transfer ({hohmann.transfer_time:.0f} s); "
                            "leave it empty for the minimum-energy transfer")

    def check_budget() -> None:
        if clock() - started > time_budget_s:
            raise PlannerTimeout()

    def aim(arrival_distance: float) -> tuple:
        """Patched-conic departure for a destination at `arrival_distance`: (delta-v, time to reach that distance, apoapsis radius).

        Minimum energy: the apoapsis is put 2 b beyond the destination's distance, b being the impact parameter of the requested
        periapsis for the estimated approach speed. With the apoapsis exactly AT the destination's distance the craft is nearly at rest
        there and the destination sweeps past it on one fixed side, so only one pass direction (and, for an eccentric destination orbit,
        possibly none) would be reachable by timing alone; 2 b of margin (a few m/s) makes both directions reachable."""
        if request.transfer_time_s is None:
            a_h = 0.5 * (r0 + arrival_distance)
            v_inf = max(abs(orbits.norm(v_d) - orbits.vis_viva_speed(mu, arrival_distance, a_h)), 1.0)
            b = rp_target * math.sqrt(1.0 + 2.0 * mu_dest / (rp_target * v_inf * v_inf))
            apo = arrival_distance + 2.0 * b
            a = 0.5 * (r0 + apo)
        else:
            a = _transfer_semi_major_axis(mu, r0, arrival_distance, request.transfer_time_s)
            if a is None:
                raise ValueError("transfer time too short")
            apo = 2.0 * a - r0
        e = 1.0 - r0 / a
        nu = math.acos(max(-1.0, min(1.0, (a * (1.0 - e * e) / arrival_distance - 1.0) / e)))
        reach = orbits.time_since_periapsis(orbits.Elements(a, e, 0.0, 0.0, 0.0, nu), mu)
        return orbits.vis_viva_speed(mu, r0, a) - v_circ, reach, apo

    try:
        dv_dep, tof, apoapsis = aim(distance)
    except ValueError:
        return _unsupported("the requested transfer time is shorter than any elliptical transfer from this parking orbit allows")

    keep = {craft_id, origin.id, dest.id}
    ancestor = hierarchy.parent.get(origin.id)
    while ancestor is not None:
        keep.add(ancestor)
        ancestor = hierarchy.parent.get(ancestor)
    full = _copy(sim)
    screen = _reduced(sim, keep) if sim.N > REDUCED_MODEL_ABOVE else full
    reduced_model = screen is not full

    # A finite departure burn loses to gravity and turns the apse line: find the delta-v that still reaches the aimed apoapsis and
    # the angle by which the periapsis of the resulting orbit trails the node (both from flying the burn alone on the copy).
    apse_shift = 0.0
    lead = 120.0
    if request.burn_mode == "finite":
        duration = burn_window(dv_dep, 0.0, False, craft.mass_kg, craft.propellant_kg, craft.thrust_n, craft.isp_s).end_s
        if duration > 0.25 * period_park:
            return _unsupported(f"the thrust is too low for a single departure burn: it would last {duration:.0f} s, more than a quarter of the "
                                f"{period_park:.0f} s parking orbit (large gravity losses). Use more thrust or impulsive burns")
        node = t0 + lead + duration

        def after_burn(dv: float) -> tuple:
            c = _copy(screen)
            flyer.burn(c, craft.propellant_kg, node, "finite", origin.id, dv)
            r, v = relative_state(c.particles[particle_index(c, craft_id)], c.particles[particle_index(c, origin.id)])
            el = orbits.state_to_elements(r, v, g * (origin.mass_kg + c.particles[particle_index(c, craft_id)].m))
            return el, r, c.t

        def calibrate(apo: float) -> tuple:
            lo, hi = dv_dep, dv_dep
            for _ in range(40):
                el, _, _ = after_burn(hi)
                if not el.e < 1.0 or el.apoapsis >= apo:
                    break
                hi *= 1.02
            else:
                raise ValueError("apoapsis not reachable")
            for _ in range(60):
                mid = 0.5 * (lo + hi)
                el, _, _ = after_burn(mid)
                if el.e < 1.0 and el.apoapsis < apo:
                    lo = mid
                else:
                    hi = mid
                if hi - lo < 1.0e-6:
                    break
            el, r, t_end = after_burn(hi)
            # angle of the node point (where an impulse would have been) to the periapsis of the orbit actually reached
            node_angle = n_park * (node - t0)
            x_hat_, w_hat_ = orbits.unit(r_c), orbits.unit(h_park)
            y_hat_ = orbits.cross(w_hat_, x_hat_)
            now_angle = math.atan2(orbits.dot(r, y_hat_), orbits.dot(r, x_hat_))
            shift = (now_angle - el.nu) - node_angle
            return hi, math.atan2(math.sin(shift), math.cos(shift))

    t_min = max(t0 + lead + (0.5 * duration if request.burn_mode == "finite" else 0.0),
                request.earliest_departure_s if request.earliest_departure_s is not None else -math.inf)

    # Where the destination will be: one flight of a copy, sampled (positions relative to the origin).
    w_hat = orbits.unit(h_park)
    x_hat = orbits.unit(r_c)
    y_hat = orbits.cross(w_hat, x_hat)

    def angle_in_parking_plane(vec) -> float:
        return math.atan2(orbits.dot(vec, y_hat), orbits.dot(vec, x_hat))

    span = (t_min - t0) + 2.25 * period_park + 1.15 * orbits.hohmann(mu, r0, 1.1 * distance).transfer_time
    samples = 400
    eph_sim = _copy(screen)
    oi, di = particle_index(eph_sim, origin.id), particle_index(eph_sim, dest.id)
    eph = []
    for k in range(samples + 1):
        eph_sim.integrate(t0 + span * k / samples)
        eph.append(orbits.sub((eph_sim.particles[di].x, eph_sim.particles[di].y, eph_sim.particles[di].z),
                              (eph_sim.particles[oi].x, eph_sim.particles[oi].y, eph_sim.particles[oi].z)))

    def dest_direction(t: float):
        x = min(max((t - t0) / span, 0.0), 1.0) * samples
        k = min(int(x), samples - 1)
        f = x - k
        return orbits.add(orbits.scale(eph[k], 1.0 - f), orbits.scale(eph[k + 1], f))

    def phase_error(t_d: float) -> float:
        """Angle from the transfer orbit's apoapsis direction to the destination at arrival (zero when they line up), in (-pi, pi]."""
        craft_angle = n_park * (t_d - t0)  # the craft is at angle 0 at t0 and moves towards +y
        d = angle_in_parking_plane(dest_direction(t_d + tof)) - (craft_angle + apse_shift + math.pi)
        return math.atan2(math.sin(d), math.cos(d))

    # the phase error decreases at (n_park - n_dest) rad/s: step to its first zero after t_min; the destination's distance at
    # arrival (eccentric orbit) and the estimate are iterated together
    n_dest = orbits.norm(h_dest) / (distance * distance)
    rate = max(n_park - n_dest, 1.0e-12)
    t_guess = t_min
    try:
        for _ in range(3):
            if request.burn_mode == "finite":
                dv_dep, apse_shift = calibrate(apoapsis)
            t_guess = t_min + (phase_error(t_min) % orbits.TWO_PI) / rate
            for _ in range(4):
                t_guess += phase_error(t_guess) / rate
            dv_dep_impulsive, tof, apoapsis = aim(orbits.norm(dest_direction(t_guess + tof)))
            if request.burn_mode != "finite":
                dv_dep = dv_dep_impulsive
        if request.burn_mode == "finite":
            dv_dep, apse_shift = calibrate(apoapsis)
    except (ValueError, orbits.OrbitError):
        return _unsupported("no elliptical transfer from this parking orbit reaches the destination with the requested settings")
    a_transfer = 0.5 * (r0 + apoapsis)

    evaluations = {"screen": 0, "full": 0}

    def fly(model, t_d: float, dv: float, tof_hint: float) -> _Flight:
        check_budget()
        evaluations["full" if model is full else "screen"] += 1
        s = _copy(model)
        propellant, dep_state, window, delivered = flyer.burn(s, craft.propellant_kg, t_d, request.burn_mode, origin.id, dv)
        ci_, di_ = particle_index(s, craft_id), particle_index(s, dest.id)

        def rel() -> tuple:
            return relative_state(s.particles[ci_], s.particles[di_])

        def result(r, v, reached: bool) -> _Flight:
            rn = orbits.norm(r)
            sense = 1.0 if orbits.dot(orbits.cross(r, v), h_dest) >= 0.0 else -1.0
            return _Flight(rn, s.t, sense * rn, orbits.norm(v), (r, v), reached, dep_state, flyer.dry + propellant, propellant, window, delivered)

        # coast: coarse steps until the range to the destination stops decreasing near it, then solve for the periapsis
        end = window[1] + 1.6 * tof_hint
        coarse = tof_hint / 80.0
        best = (math.inf, None)
        prev_range = orbits.norm(rel()[0])
        t = s.t
        while t < end:
            near = prev_range < 4.0 * soi
            t = min(end, t + (coarse / 12.0 if near else coarse))
            s.integrate(t)
            r, v = rel()
            rng = orbits.norm(r)
            if rng < best[0]:
                best = (rng, (r, v, s.t))
            if near and orbits.dot(r, v) > 0.0 and rng < 4.0 * soi:
                # past the closest approach: iterate on the osculating periapsis time about the destination
                for _ in range(8):
                    try:
                        el = orbits.state_to_elements(r, v, mu_dest)
                    except orbits.OrbitError:
                        break
                    tau = orbits.time_since_periapsis(el, mu_dest)
                    if el.e < 1.0:  # a temporarily bound pass: take the nearer periapsis
                        period = orbits.orbital_period(mu_dest, el.a)
                        tau = tau if tau <= 0.5 * period else tau - period
                    if abs(tau) < 1.0e-6:
                        break
                    s.integrate(s.t - tau)
                    r, v = rel()
                return result(r, v, True)
            prev_range = rng
        r, v, t_best = best[1]
        s.integrate(t_best)
        return result(*rel(), False)

    want = 1.0 if request.direction != "retrograde" else -1.0
    target_signed = want * rp_target

    def solve(dv: float, tof_hint: float, centre: float) -> tuple:
        """Departure time whose signed periapsis radius equals the target: (t_d, flight, iterations) or (None, closest flight, n)."""
        dt_scan = SCAN_STEP_RAD / n_park
        steps = int(round(SCAN_HALF_WIDTH_RAD / SCAN_STEP_RAD))
        flights: dict = {}
        target_bracket = [None, None]  # [both ends on the wanted side, the pass sweeps through the body between the ends]

        def look(k: int) -> None:
            if k not in flights or k + 1 not in flights:
                return
            (ta, fa), (tb, fb) = flights[k], flights[k + 1]
            if not (fa.reached and fb.reached):
                return
            ga, gb = fa.signed - target_signed, fb.signed - target_signed
            if ga * gb > 0.0:
                return
            if fa.signed * want > 0.0 and fb.signed * want > 0.0:
                target_bracket[0] = target_bracket[0] or (ta, ga, tb, gb)  # the function is smooth here: preferred
            elif fa.signed * fb.signed < 0.0:
                target_bracket[1] = target_bracket[1] or (ta, ga, tb, gb)

        # outwards from the estimate, so a good estimate needs only a handful of trial flights
        for k in sorted(range(-steps, steps + 1), key=lambda j: (abs(j), j)):
            t_d = centre + k * dt_scan
            if t_d < t_min:
                continue
            flights[k] = (t_d, fly(screen, t_d, dv, tof_hint))
            look(k - 1)
            look(k)
            if target_bracket[0] is not None:
                break
        bracket = target_bracket[0] or target_bracket[1]
        closest = min((f for _, f in flights.values()), key=lambda f: f.periapsis_radius, default=None)
        if bracket is None:
            return None, closest, 0
        ta, ga, tb, gb = bracket
        model = screen
        flight, iterations, t_d = None, 0, ta
        side = 0
        while iterations < MAX_ROOT_ITERATIONS:
            iterations += 1
            t_d = (ta * gb - tb * ga) / (gb - ga) if gb != ga else 0.5 * (ta + tb)
            if not min(ta, tb) < t_d < max(ta, tb):
                t_d = 0.5 * (ta + tb)
            flight = fly(model, t_d, dv, tof_hint)
            gm = flight.signed - target_signed
            if abs(gm) <= PERIAPSIS_TOL_M:
                if model is full:
                    break
                # converged on the reduced model: repeat the last iterations on the full universe (a small correction)
                model = full
                width = max(abs(tb - ta), 16.0 * dt_scan * 1.0e-3)
                fa_, fb_ = fly(full, t_d - 0.5 * width, dv, tof_hint), fly(full, t_d + 0.5 * width, dv, tof_hint)
                ta, ga, tb, gb = t_d - 0.5 * width, fa_.signed - target_signed, t_d + 0.5 * width, fb_.signed - target_signed
                grow = 0
                while ga * gb > 0.0 and grow < 12:  # widen until the full model's root is inside
                    width *= 2.0
                    grow += 1
                    fa_, fb_ = fly(full, t_d - 0.5 * width, dv, tof_hint), fly(full, t_d + 0.5 * width, dv, tof_hint)
                    ta, ga, tb, gb = t_d - 0.5 * width, fa_.signed - target_signed, t_d + 0.5 * width, fb_.signed - target_signed
                if ga * gb > 0.0:
                    return None, flight, iterations
                side = 0
                continue
            if gm * ga > 0.0:
                ta, ga = t_d, gm
                if side == -1:
                    gb *= 0.5  # Illinois: avoid a stuck end point
                side = -1
            else:
                tb, gb = t_d, gm
                if side == 1:
                    ga *= 0.5
                side = 1
            if abs(tb - ta) <= 4.0 * math.ulp(max(abs(ta), abs(tb), 1.0)):
                break
        if flight is None or abs(flight.signed - target_signed) > max(PERIAPSIS_TOL_M, 1.0e-6 * rp_target) or flight.signed * want <= 0.0:
            return None, flight or closest, iterations
        return t_d, flight, iterations

    try:
        t_dep, flight, iterations = solve(dv_dep, tof, t_guess)
    except PlannerTimeout:
        return PlanResult("no_solution", (f"planning exceeded its {time_budget_s:g} s time budget before converging "
                                          f"({evaluations['screen'] + evaluations['full']} trial flights)",))
    if t_dep is None:
        miss = "no trial flight came near the destination" if flight is None else (
            f"the closest pass found has a periapsis radius of {flight.periapsis_radius / 1e3:.0f} km "
            f"(target {rp_target / 1e3:.0f} km, body radius {dest.radius_m / 1e3:.0f} km)")
        why = (f" The parking orbit's plane is tilted {math.degrees(plane_mismatch):.2f} deg to the destination's orbit, and a "
               "tangential departure cannot leave that plane: align the planes (create the orbit with 'match the plane of' the "
               "destination) or wait for the destination to cross the parking-orbit plane.") if plane_mismatch > math.radians(0.05) else ""
        return PlanResult("no_solution", (f"no departure time in the search window reaches the requested periapsis: {miss}.{why}",))

    # ---- insertion and the final flight on the full universe ----
    r_p, v_p = flight.state
    nodes = [{"role": "departure", "label": f"Departure burn to {dest.id}", "epochS": t_dep, "mode": request.burn_mode, "referenceBodyId": origin.id,
              "progradeMPerS": dv_dep, "predictedState": flight.departure_state}]
    insertion = None
    if request.capture != "none":
        a_capture = 0.5 * (rp_target + ra_target)
        v_capture = orbits.vis_viva_speed(mu_dest, flight.periapsis_radius, a_capture)
        dv_ins = flight.speed - v_capture
        insertion = {"role": "insertion", "label": f"Orbit insertion at {dest.id}", "epochS": flight.periapsis_time, "mode": request.burn_mode,
                     "referenceBodyId": dest.id, "progradeMPerS": -dv_ins, "predictedState": (r_p, v_p)}
        nodes.append(insertion)
    else:
        nodes.append({"role": "observation", "label": f"Closest approach to {dest.id}", "epochS": flight.periapsis_time, "mode": "impulsive",
                      "referenceBodyId": dest.id, "progradeMPerS": 0.0, "predictedState": (r_p, v_p)})

    try:
        final = _final_flight(full, flyer, craft, craft_id, origin.id, dest.id, nodes, t0, tof, mu_dest, check_budget)
    except PlannerTimeout:
        return PlanResult("no_solution", (f"planning exceeded its {time_budget_s:g} s time budget during the final flight",))

    total_dv = dv_dep + (abs(insertion["progradeMPerS"]) if insertion else 0.0)
    propellant_needed = craft.propellant_kg - final["propellantLeftKg"]
    feasible = all(final["feasible"])
    reasons = []
    if not feasible:
        reasons.append("the propellant on board does not cover the planned burns: the plan can be flown, but the burns will fall short")
    if final["orbit"] is not None and not final["orbit"]["bound"]:
        reasons.append("the predicted orbit after insertion is not bound to the destination (finite-burn losses); "
                       "use more thrust or an impulsive insertion")
    inclination_at_dest = math.degrees(orbits.plane_angle(orbits.cross(r_p, v_p), h_dest))
    plan = {
        "model": {
            "method": "patched-conic estimate refined by N-body shooting on a copy of this universe (REBOUND IAS15)",
            "bodiesInFinalFlight": full.N - 1,
            "reducedModelForBracketing": reduced_model,
            "burnModel": request.burn_mode,
            "trialFlights": evaluations["screen"] + evaluations["full"],
            "rootIterations": iterations,
            "periapsisResidualM": abs(flight.periapsis_radius - rp_target),
            "planningWallTimeS": clock() - started,
        },
        "originBodyId": origin.id,
        "destinationBodyId": dest.id,
        "designedAtS": t0,
        "parkingOrbit": {"radiusM": r0, "eccentricity": parking.e, "periodS": period_park, "speedMPerS": v_circ,
                         "planeMismatchDeg": math.degrees(plane_mismatch)},
        "patchedConic": {
            "note": "two-body estimate (destination massless during the coast, impulsive tangential burns, coplanar circular orbits)",
            "departureDeltaVMPerS": dv_dep_impulsive,
            "transferTimeS": tof,
            "transferApoapsisRadiusM": apoapsis,
            "hohmannDepartureDeltaVMPerS": hohmann.dv1,
            "hohmannTransferTimeS": hohmann.transfer_time,
            "arrivalSpeedAtApoapsisMPerS": orbits.vis_viva_speed(mu, min(distance, 2.0 * a_transfer - r0), a_transfer),
            "destinationOrbitalSpeedMPerS": orbits.norm(v_d),
        },
        "departure": {"epochS": t_dep, "ignitionS": flight.departure_window[0], "cutoffS": flight.departure_window[1],
                      "deltaVMPerS": dv_dep, "deliveredDeltaVMPerS": flight.departure_delivered, "mode": request.burn_mode,
                      "referenceBodyId": origin.id, "propellantKg": craft.propellant_kg - flight.propellant_after_departure},
        "arrival": {"epochS": flight.periapsis_time, "transferTimeS": flight.periapsis_time - t_dep,
                    "periapsisRadiusM": flight.periapsis_radius, "periapsisAltitudeM": flight.periapsis_radius - dest.radius_m,
                    "periapsisSpeedMPerS": flight.speed, "direction": "prograde" if flight.signed > 0.0 else "retrograde",
                    "inclinationToDestinationOrbitDeg": inclination_at_dest,
                    "hyperbolicExcessSpeedMPerS": math.sqrt(max(flight.speed ** 2 - 2.0 * mu_dest / flight.periapsis_radius, 0.0)),
                    "sphereOfInfluenceM": soi},
        "insertion": None if insertion is None else {
            "epochS": insertion["epochS"], "deltaVMPerS": abs(insertion["progradeMPerS"]), "mode": request.burn_mode,
            "referenceBodyId": dest.id, "ignitionS": final["windows"][-1][0], "cutoffS": final["windows"][-1][1],
            "propellantKg": final["propellantUsedKg"][-1]},
        "targetOrbit": None if insertion is None else {"periapsisRadiusM": rp_target, "apoapsisRadiusM": ra_target,
                                                        "periapsisAltitudeM": request.periapsis_altitude_m,
                                                        "apoapsisAltitudeM": ra_target - dest.radius_m},
        "predictedOrbit": final["orbit"],
        "totals": {"deltaVMPerS": total_dv, "propellantRequiredKg": propellant_needed, "propellantAvailableKg": craft.propellant_kg,
                   "deltaVAvailableMPerS": exhaust_velocity(craft.isp_s) * math.log(craft.mass_kg / craft.dry_mass_kg),
                   "feasible": feasible},
        "trajectoryEndS": final["endS"],
        "warnings": reasons,
    }
    scheduled = tuple({**n, "predictedState": s} for n, s in zip(nodes, final["preStates"]))
    return PlanResult("ok", tuple(reasons), plan, tuple(final["trajectory"]), scheduled)


def _final_flight(full, flyer: _Flyer, craft: Spacecraft, craft_id: str, origin_id: str, dest_id: str, nodes: list, t0: float, tof: float,
                  mu_dest: float, check_budget) -> dict:
    """Fly the whole plan once on the full copy: the state just before every node, the predicted orbit after the last burn and the
    sampled planned trajectory (t, craft, origin, destination positions; inertial frame of the universe)."""
    s = _copy(full)
    ci, oi, di = particle_index(s, craft_id), particle_index(s, origin_id), particle_index(s, dest_id)
    trajectory = []

    def sample() -> None:
        c, o, d = s.particles[ci], s.particles[oi], s.particles[di]
        trajectory.append((s.t, (c.x, c.y, c.z), (o.x, o.y, o.z), (d.x, d.y, d.z)))

    def coast(until: float, points: int) -> None:
        start = s.t
        for k in range(1, points + 1):
            check_budget()
            s.integrate(start + (until - start) * k / points)
            sample()

    propellant = craft.propellant_kg
    pre_states, windows, used, feasible = [], [], [], []
    sample()
    for node in nodes:
        ref = node["referenceBodyId"]
        dv = node["progradeMPerS"]
        mass = flyer.dry + propellant
        if dv == 0.0:  # observation
            lead_points = TRAJECTORY_POINTS_COAST
            coast(node["epochS"], lead_points)
            pre_states.append(relative_state(s.particles[ci], s.particles[particle_index(s, ref)]))
            windows.append((node["epochS"], node["epochS"]))
            used.append(0.0)
            feasible.append(True)
            continue
        window = (burn_window(abs(dv), node["epochS"], True, mass, propellant, flyer.thrust, flyer.isp) if node["mode"] == "finite"
                  else None)
        ignition = node["epochS"] if window is None else window.start_s
        if ignition > s.t:
            # the wait in the parking orbit is sampled per revolution, the long coast evenly
            span = ignition - s.t
            r, v = relative_state(s.particles[ci], s.particles[oi])
            try:
                period = orbits.orbital_period(s.G * s.particles[oi].m, orbits.state_to_elements(r, v, s.G * s.particles[oi].m).a)
            except orbits.OrbitError:
                period = span
            points = TRAJECTORY_POINTS_COAST if span > 3.0 * period else max(8, int(TRAJECTORY_POINTS_PER_REV * span / period))
            coast(ignition, min(points, 600))
        before = propellant
        propellant, pre, win, delivered = flyer.burn(s, propellant, node["epochS"], node["mode"], ref, dv)
        pre_states.append(pre)
        windows.append(win)
        used.append(before - propellant)
        feasible.append(delivered >= abs(dv) * (1.0 - 1.0e-9))
        sample()
    orbit = None
    last = nodes[-1]
    if last["role"] == "insertion":
        r, v = relative_state(s.particles[ci], s.particles[di])
        try:
            el = orbits.state_to_elements(r, v, mu_dest)
            bound = el.e < 1.0
            period = orbits.orbital_period(mu_dest, el.a) if bound else None
        except orbits.OrbitError:
            el, bound, period = None, False, None
        r_min = r_max = orbits.norm(r)
        if bound and period is not None:
            start = s.t
            points = int(TRAJECTORY_POINTS_PER_REV * VERIFY_REVOLUTIONS)
            for k in range(1, points + 1):
                check_budget()
                s.integrate(start + VERIFY_REVOLUTIONS * period * k / points)
                sample()
                rng = orbits.norm(relative_state(s.particles[ci], s.particles[di])[0])
                r_min, r_max = min(r_min, rng), max(r_max, rng)
        radius = s.particles[di].r
        orbit = {"bound": bound, "semiMajorAxisM": None if el is None else el.a, "eccentricity": None if el is None else el.e,
                 "periapsisRadiusM": None if el is None else el.periapsis, "apoapsisRadiusM": None if (el is None or not bound) else el.apoapsis,
                 "periodS": period, "minRadiusM": r_min, "maxRadiusM": r_max, "minAltitudeM": r_min - radius, "maxAltitudeM": r_max - radius,
                 "verifiedRevolutions": VERIFY_REVOLUTIONS if bound else 0.0,
                 "note": "osculating elements about the destination right after the insertion burn; min/max radius over the following "
                         "revolutions flown on the N-body copy"}
    else:
        coast(s.t + 0.15 * tof, 40)
    return {"trajectory": trajectory, "preStates": pre_states, "windows": windows, "propellantUsedKg": used, "feasible": feasible,
            "propellantLeftKg": propellant, "orbit": orbit, "endS": s.t}
