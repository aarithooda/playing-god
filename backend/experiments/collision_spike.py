"""M0 REBOUND feasibility experiments, part 2: collision detection, custom merger layer, stable ids,
detection sweeps, collision after checkpoint restore. SI units throughout (see rebound_spike.py).
Throwaway evidence code, not application code.

Run everything and print the tables:  python -m backend.experiments.collision_spike
"""
import math
import os
import random
import tempfile
import traceback
import warnings

import rebound

from .rebound_spike import (AU, G_SI, M_EARTH, M_SUN, add, cross, dot, new_sim, norm, pos, scale, sub,
                            totals, vel)

# Test spheres (SI): "A" 2000 kg radius 1.0 m, "B" 1000 kg radius 0.8 m. Their mutual gravity is tiny:
# G*m/r^2 ~ 7e-12 m/s^2 at 100 m, i.e. a relative velocity change ~1e-9 over a 100 s approach at 2 m/s.
# That bound justifies a 1e-6 relative tolerance wherever an expectation is computed from the initial conditions.
SPH_A = {"name": "A", "m": 2.0e3, "r": 1.0}
SPH_B = {"name": "B", "m": 1.0e3, "r": 0.8}
R_SUM = SPH_A["r"] + SPH_B["r"]  # 1.8 m
DRIFT = [0.3, -0.2, 0.1]  # common drift velocity [m/s] so the centre of mass is not at rest


def contact_time_estimate(t_end, dt_last, r_rel, u_rel, R):
    """REBOUND reports a collision only at the END of a step (the collision struct has p1, p2, gb, ri: no time).
    Entry time of contact assuming straight-line relative motion over the last step: |r - u tau| = R, tau >= 0
    seconds before the step end; tau = (r.u + sqrt(D)) / |u|^2, D = (r.u)^2 - |u|^2 (|r|^2 - R^2).
    Returns None if no real root or the root lies outside the last step. Exact for gravity-free motion; otherwise
    the error is the path curvature over one step (~ a_rel dt^2 / 8 in position)."""
    uu = dot(u_rel, u_rel)
    if uu == 0.0:
        return None
    ru = dot(r_rel, u_rel)
    disc = ru * ru - uu * (dot(r_rel, r_rel) - R * R)
    if disc < 0.0:
        return None
    tau = (ru + math.sqrt(disc)) / uu
    if tau < -1e-12 or tau > dt_last * (1 + 1e-9):
        return None
    return t_end - tau


# ======================================================================
# Custom collision/merger layer (what we would write ourselves)
# ======================================================================
class MergeLayer:
    """Perfectly inelastic merger with stable ids (REBOUND `name`) and a full ledger.

    Rules: the heavier body keeps its id (ties: p1). Mass and linear momentum are conserved exactly; the remnant is
    placed at the centre of mass with the centre-of-mass velocity; radius conserves volume. Translational kinetic
    energy lost, 0.5*mu*v_rel^2, is added to `heat_J` (no internal-energy variable exists in REBOUND), and the
    orbital angular momentum mu*(r_rel x v_rel) about the centre of mass is added to `spin[survivor]`
    (remnant spin; REBOUND point masses have none)."""

    def __init__(self, reset_ias15=True):
        self.reset_ias15 = reset_ias15
        self.errors = []  # tracebacks: ctypes silently swallows exceptions raised inside callbacks
        self.events = []
        self.calls = 0
        self.stale = 0  # callbacks whose particle indices no longer exist (ignored)
        self.absorbed = {}  # absorbed id -> survivor id
        self.spin = {}  # id -> remnant spin vector [kg m^2/s]
        self.heat_J = 0.0

    def resolve(self, sim_ptr, col):
        try:
            rc = self._resolve(sim_ptr, col)
            sim = sim_ptr.contents
            if rc != 0 and self.reset_ias15 and sim.integrator.name in (b"ias15", "ias15"):
                # OBSERVED: after a particle is removed/modified, IAS15's stale predictor coefficients inject
                # momentum error (|dp|/|p| ~ 5e-9 with a 1e11 kg neighbour; REBOUND's built-in merge has it too).
                # Re-selecting the integrator resets that state (dp drops to ~1e-13).
                sim.integrator = "ias15"
            return rc
        except Exception:  # noqa: BLE001
            self.errors.append(traceback.format_exc())
            return 0

    def _resolve(self, sim_ptr, col):
        sim = sim_ptr.contents
        self.calls += 1
        if col.p1 >= sim.N or col.p2 >= sim.N or col.p1 == col.p2:
            self.stale += 1
            return 0
        pa, pb = sim.particles[col.p1], sim.particles[col.p2]
        if pa.m >= pb.m:
            surv, gone, remove = pa, pb, 2
        else:
            surv, gone, remove = pb, pa, 1
        gone_index = col.p2 if remove == 2 else col.p1
        ms, mg = surv.m, gone.m
        M = ms + mg
        xs, xg, vs, vg = pos(surv), pos(gone), vel(surv), vel(gone)
        r_rel, v_rel = sub(xs, xg), sub(vs, vg)
        mu = ms * mg / M
        v_rel_mag = norm(v_rel)
        L_orb = scale(cross(r_rel, v_rel), mu)
        p_tot = add(scale(vs, ms), scale(vg, mg))
        v_com = scale(p_tot, 1.0 / M)
        x_com = scale(add(scale(xs, ms), scale(xg, mg)), 1.0 / M)
        E_before = totals(sim)
        ke_pair_before = 0.5 * ms * dot(vs, vs) + 0.5 * mg * dot(vg, vg)
        ev = {
            "t": sim.t, "survivor": surv.name, "absorbed": gone.name,
            "pre": {"m": (ms, mg), "r": (surv.r, gone.r), "x": (xs, xg), "v": (vs, vg)},
            "sep_at_callback": norm(r_rel), "v_rel": v_rel_mag,
            "contact_time_est": contact_time_estimate(sim.t, sim.dt_last_done, r_rel, v_rel, surv.r + gone.r),
            "b": norm(cross(r_rel, v_rel)) / v_rel_mag if v_rel_mag > 0 else 0.0,
            "ke_pair_before": ke_pair_before, "L_orb": L_orb, "p_pair": p_tot,
        }
        for i, a in enumerate(("x", "y", "z")):
            setattr(surv, a, x_com[i])
        for i, a in enumerate(("vx", "vy", "vz")):
            setattr(surv, a, v_com[i])
        surv.m = M
        surv.r = (surv.r ** 3 + gone.r ** 3) ** (1.0 / 3.0)
        ke_pair_after = 0.5 * M * dot(v_com, v_com)
        E_after = totals(sim, exclude=(gone_index,))
        ev["post"] = {"m": M, "r": surv.r, "x": x_com, "v": v_com}
        ev["ke_pair_after"] = ke_pair_after
        ev["ke_lost"] = ke_pair_before - ke_pair_after
        ev["dE_total"] = E_after["E"] - E_before["E"]  # whole-simulation total energy (KE+PE) change
        ev["dKE_total"] = E_after["KE"] - E_before["KE"]
        ev["dPE_total"] = E_after["PE"] - E_before["PE"]
        self.events.append(ev)
        self.heat_J += ev["ke_lost"]
        self.spin[surv.name] = add(add(self.spin.get(surv.name, [0.0] * 3), self.spin.get(gone.name, [0.0] * 3)),
                                   L_orb)
        self.absorbed[gone.name] = surv.name
        return remove


class Recorder:
    """Detection-only resolver: logs the callback, then removes the second body (returns 2) so the pair cannot
    interpenetrate. OBSERVED: returning 0 (keep both) lets overlapping point masses fall through r -> 0, where
    G m1 m2 / r^2 diverges, and IAS15 then stalls (the 200 m / 2 m/s spheres scenario did not finish within
    40 s of wall time). Any real resolver must therefore merge, bounce or remove overlapping bodies."""

    def __init__(self):
        self.calls = []
        self.contact_est = []  # estimated first-contact time per callback (see contact_time_estimate)
        self.stale = 0

    def resolve(self, sim_ptr, col):
        sim = sim_ptr.contents
        if col.p1 >= sim.N or col.p2 >= sim.N:
            self.stale += 1
            return 0
        pa, pb = sim.particles[col.p1], sim.particles[col.p2]
        self.calls.append((sim.t, pa.name, pb.name, norm(sub(pos(pa), pos(pb)))))
        self.contact_est.append(contact_time_estimate(sim.t, sim.dt_last_done, sub(pos(pa), pos(pb)),
                                                      sub(vel(pa), vel(pb)), pa.r + pb.r))
        return 2

    @property
    def first_time(self):
        return min((c[0] for c in self.calls), default=None)

    def unique_pairs(self):
        return {frozenset((c[1], c[2])) for c in self.calls}


# ======================================================================
# Helpers
# ======================================================================
def make_sim(integrator, step=None):
    """Fixed-step integrators get dt=step; IAS15 is adaptive (setting dt only gives a too-large first-step guess)."""
    return new_sim(integrator, dt=None if integrator == "ias15" else step)


def add_bodies(sim, bodies):
    for b in bodies:
        x, v = b["x"], b.get("v", [0.0, 0.0, 0.0])
        sim.add(m=b["m"], r=b.get("r", 0.0), x=x[0], y=x[1], z=x[2], vx=v[0], vy=v[1], vz=v[2], name=b["name"])


def run_to(sim, t_end, chunk=None):
    """Integrate to t_end. `chunk` caps the step: integrate in pieces of at most `chunk` seconds on an
    absolute grid k*chunk (the step-cap policy we would use between API frames)."""
    if chunk is None:
        sim.integrate(t_end, exact_finish_time=1)
        return
    n_end = math.ceil(t_end / chunk - 1e-12)
    for k in range(round(sim.t / chunk) + 1, n_end + 1):
        sim.integrate(min(k * chunk, t_end), exact_finish_time=1)


def _basis(direction):
    e1 = scale(direction, 1.0 / norm(direction))
    ref = [0.0, 0.0, 1.0] if abs(e1[2]) < 0.9 else [0.0, 1.0, 0.0]
    e2 = cross(ref, e1)
    e2 = scale(e2, 1.0 / norm(e2))
    return e1, e2


def two_spheres(sep, v_rel, b, a=SPH_A, bb=SPH_B, drift=DRIFT, direction=(1.0, 0.0, 0.0)):
    """Spheres A and B approaching along `direction` (default +x) with relative speed v_rel and impact parameter b
    (offset perpendicular to the approach, along y for the default direction). Velocities are set in the
    centre-of-mass frame plus a common drift. Returns the two body dicts."""
    e1, e2 = _basis(list(direction))
    M = a["m"] + bb["m"]
    va = scale(e1, v_rel * bb["m"] / M)
    vb = scale(e1, -v_rel * a["m"] / M)
    A = dict(a, x=add(scale(e1, -sep / 2), scale(e2, b / 2)), v=add(va, drift))
    B = dict(bb, x=add(scale(e1, sep / 2), scale(e2, -b / 2)), v=add(vb, drift))
    return [A, B]


# Separations below are deliberately NOT multiples of v_rel*dt, so contact does not coincide with a step end.
SEP_SLOW = 200.037
SEP_FAST = 20007.0


def analytic_contact_time(sep, v_rel, b):
    """First contact (centre distance = R_SUM), straight-line relative motion; None if b >= R_SUM."""
    if b >= R_SUM:
        return None
    return (sep - math.sqrt(R_SUM ** 2 - b ** 2)) / v_rel


# ======================================================================
# Detection scenarios (gravity negligible, analytic contact time known)
# ======================================================================
def detection_run(mode, dt, v_rel=2.0, sep=SEP_SLOW, b=0.0, integrator="leapfrog", direction=(1.0, 0.0, 0.0),
                  gravity=False):
    """Fixed-step run (leapfrog by default: exact drift when G=0; WHFast hangs with G=0) so dt is the step grid.
    Gravity is switched off by default: mutual gravity is negligible here, and with a missed collision the
    bodies would fall through r = 0 where G m1 m2 / r^2 diverges and WHFast/IAS15 can hang."""
    sim = make_sim(integrator, dt)
    if not gravity:
        sim.G = 0.0  # isolate detection geometry; also avoids the r -> 0 singularity if a collision is missed
    add_bodies(sim, two_spheres(sep, v_rel, b, direction=direction))
    rec = Recorder()
    sim.collision = mode
    sim.collision_resolve = rec.resolve
    t_c = analytic_contact_time(sep, v_rel, b)
    t_end = (t_c if t_c is not None else sep / v_rel) + 3 * dt + 2.0
    run_to(sim, t_end)
    return {"mode": mode, "dt": dt, "v_rel": v_rel, "b": b, "t_contact": t_c,
            "t_first": rec.first_time, "detected": bool(rec.calls), "n_calls": len(rec.calls),
            "pairs": len(rec.unique_pairs()), "stale": rec.stale,
            "contact_est": rec.contact_est[0] if rec.contact_est else None,
            "delay": None if (t_c is None or rec.first_time is None) else rec.first_time - t_c}


# ======================================================================
# Merger runs
# ======================================================================
def merge_run(bodies, mode="line", chunk=0.5, t_end=None, extra=None, integrator="ias15", layer=None,
              builtin=False, reset_ias15=True):
    sim = make_sim(integrator, chunk)
    add_bodies(sim, bodies + (extra or []))
    layer = layer or MergeLayer(reset_ias15=reset_ias15)
    sim.collision = mode
    sim.collision_resolve = "merge" if builtin else layer.resolve
    before = totals(sim)
    run_to(sim, t_end, chunk)
    return {"sim": sim, "layer": layer, "before": before, "after": totals(sim)}


def expected_merger(bodies):
    """Independent expectation from the INITIAL conditions only (no REBOUND data)."""
    A, B = bodies
    M = A["m"] + B["m"]
    mu = A["m"] * B["m"] / M
    v_com = scale(add(scale(A["v"], A["m"]), scale(B["v"], B["m"])), 1.0 / M)
    x_com0 = scale(add(scale(A["x"], A["m"]), scale(B["x"], B["m"])), 1.0 / M)
    v_rel = sub(A["v"], B["v"])
    r_rel = sub(A["x"], B["x"])
    return {"M": M, "mu": mu, "v_com": v_com, "x_com0": x_com0, "v_rel": norm(v_rel),
            "dKE": 0.5 * mu * dot(v_rel, v_rel), "L_orb": scale(cross(r_rel, v_rel), mu),
            "p": scale(v_com, M), "R": (A["r"] ** 3 + B["r"] ** 3) ** (1 / 3)}


# ======================================================================
# Multi-body merger scenarios
# ======================================================================
def merger_analytic(mode="line", chunk=0.5, b=0.5, integrator="ias15"):
    """Two spheres, expectations from the initial conditions only. Runs 40 s past contact so the remnant's free
    motion (centre-of-mass velocity) is also checked at the end."""
    bodies = two_spheres(SEP_SLOW, 2.0, b)
    t_c = analytic_contact_time(SEP_SLOW, 2.0, b)
    t_end = t_c + 40.0
    run = merge_run(bodies, mode, chunk, t_end, integrator=integrator)
    return {"bodies": bodies, "t_contact": t_c, "t_end": t_end, "expected": expected_merger(bodies), **run}


def whfast_radial_failure(integrator="whfast", sep=20007.0):
    """Exact axis-aligned head-on (b=0), real G, 20 m per step. OBSERVED: for some separations (20007, 20016 miss;
    20012 hangs) WHFast returns a corrupted state (|x| ~ 1e44 m) because its Kepler step passes through r = 0.
    Only sep=20007 is exercised here; 20012 hangs the process."""
    rec = Recorder()
    sim = make_sim(integrator, 0.01)
    add_bodies(sim, two_spheres(sep, 2000.0, 0.0))
    sim.collision = "line"
    sim.collision_resolve = rec.resolve
    run_to(sim, 10.03)
    return {"integrator": integrator, "sep": sep, "detected": bool(rec.calls),
            "max_abs_x": max(abs(c) for pp in sim.particles for c in pos(pp)), "N": sim.N}


def two_pairs_one_step(mode="line", dt=0.5):
    """Two independent head-on pairs (A,B) and (C,D) that touch in the same step. Fixed-step leapfrog."""
    pair1 = two_spheres(SEP_SLOW, 2.0, 0.5)
    pair2 = two_spheres(SEP_SLOW, 2.0, 0.3, a={"name": "C", "m": 3.0e3, "r": 1.2}, bb={"name": "D", "m": 1.0e3, "r": 0.9})
    for body in pair2:
        body["x"] = add(body["x"], [0.0, 1000.0, 50.0])
    bodies = pair1 + pair2
    t_end = 105.0
    run = merge_run(bodies, mode, dt, t_end, integrator="leapfrog")
    return {"bodies": bodies, **run}


def chain_collision(mode="line", dt=0.5):
    """A and C approach a resting B from opposite sides and overlap it in the same step (chain A-B-C)."""
    d = 101.037
    bodies = [dict(SPH_A, name="A", x=[-d, 0.0, 0.0], v=[2.0, 0.0, 0.0]),
              {"name": "B", "m": 1.0e3, "r": 0.8, "x": [0.0, 0.0, 0.0], "v": [0.0, 0.0, 0.0]},
              {"name": "C", "m": 1.5e3, "r": 0.9, "x": [d, 0.0, 0.0], "v": [-2.0, 0.0, 0.0]}]
    run = merge_run(bodies, mode, dt, 80.0, integrator="leapfrog")
    return {"bodies": bodies, **run}


def three_body_near_collision(mode="line", chunk=0.5, reset_ias15=True):
    """A and B collide head-on while a heavy body C (1e11 kg, 30 m off the path) pulls on both (~7e-3 m/s^2).
    No analytic result; checks conservation and consistency against the callback's own pre-collision state."""
    bodies = two_spheres(SEP_SLOW, 2.0, 0.0)
    extra = [{"name": "C", "m": 1.0e11, "r": 5.0, "x": [0.0, 30.0, 0.0], "v": [0.0, 0.0, 0.0]}]
    run = merge_run(bodies, mode, chunk, 160.0, extra=extra, integrator="ias15", reset_ias15=reset_ias15)
    return {"bodies": bodies, "extra": extra, **run}


def id_stability(first_is_lighter):
    """Particle order [X, p1, p2, Z]; the merger removes one of p1/p2, shifting Z's array index. Z is a distant
    free test body. Returns what the names/indices look like afterwards."""
    pa = dict(SPH_A, name="HEAVY")
    pb = dict(SPH_B, name="LIGHT")
    pair = two_spheres(SEP_SLOW, 2.0, 0.2, a=pb if first_is_lighter else pa, bb=pa if first_is_lighter else pb)
    X = {"name": "X", "m": 1.0, "r": 0.5, "x": [0.0, 5000.0, 0.0], "v": [0.0, 0.0, 0.0]}
    Z = {"name": "Z", "m": 1.0, "r": 0.5, "x": [0.0, -5000.0, 0.0], "v": [0.5, 0.25, 0.0]}
    t_end = analytic_contact_time(SEP_SLOW, 2.0, 0.2) + 30.0
    run = merge_run([X] + pair + [Z], "line", 0.5, t_end, integrator="leapfrog")
    sim = run["sim"]
    names = [pp.name for pp in sim.particles]
    try:
        sim.particles["LIGHT"]
        light_found = True
    except rebound.ParticleNotFound:
        light_found = False
    return {"names_in_order": names, "index_Z": sim.particles["Z"].index, "index_before_Z": 3,
            "light_found": light_found, "Z": sim.particles["Z"], "Z0": Z, "t_end": t_end, **run}


# ======================================================================
# Cross-check against the independent first-principles review (branch validation/physics-first-principles)
# ======================================================================
def fixture_detect(r0, u, R, dt, mode, v_com=(0.0, 0.0, 0.0)):
    """Their geometry fixtures: relative position r0 = r1 - r2 and relative velocity u = v1 - v2 at t = 0, contact
    distance R, one step dt. Two 1 kg bodies of radius R/2 with velocities +-u/2, gravity off (their model is
    constant relative velocity). Leapfrog with a single step of size dt. Returns first-callback data."""
    sim = make_sim("leapfrog", dt)
    sim.G = 0.0
    half = scale(list(r0), 0.5)
    add_bodies(sim, [{"name": "P", "m": 1.0, "r": R / 2, "x": half, "v": add(list(v_com), scale(list(u), 0.5))},
                     {"name": "Q", "m": 1.0, "r": R / 2, "x": scale(half, -1.0), "v": sub(list(v_com), scale(list(u), 0.5))}])
    rec = Recorder()
    sim.collision = mode
    sim.collision_resolve = rec.resolve
    sim.integrate(dt, exact_finish_time=1)
    return {"mode": mode, "detected": bool(rec.calls), "t_callback": rec.first_time,
            "t_contact_est": rec.contact_est[0] if rec.contact_est else None}


INDEPENDENT_FIXTURES = {
    # name: (r0, u, R, dt, expected first contact [s] or None, expected minimum distance [m])
    "slow_head_on": ((-5.0, 0.0, 0.0), (1.0, 0.0, 0.0), 2.0, 4.0, 3.0, 0.0),
    # Their fast fixture crosses at exactly dt/2 = 0.1 s, i.e. centres coincide mid-step: REBOUND then returns NaN
    # positions (G*m/0). Shifted by 3 ms so the crossing is at 0.097 s (contact window [0.095, 0.099]).
    "fast_head_on": ((-97.0, 0.0, 0.0), (1000.0, 0.0, 0.0), 2.0, 0.2, 0.095, 0.0),
    "grazing": ((-5.0, 1.9, 0.0), (10.0, 0.0, 0.0), 2.0, 1.0, 0.43755, 1.9),
    "near_miss": ((-5.0, 2.1, 0.0), (10.0, 0.0, 0.0), 2.0, 1.0, None, 2.1),
}


def independent_merger(case):
    """Their merger worked examples, started 0.1 s before contact and merged by our layer.
    head_on: m=2,1 kg, R1=R2=1 m, v1=(3,0,0), v2=(-3,0,0), contact separation 2 m (expected M=3, V=(1,0,0),
             Ki=13.5 J, Kf=1.5 J, loss=12 J, L_orb=0).
    grazing: m=1,1 kg, R=1 m, CM frame, r=(-1.6,1.2,0), v_rel=(10,0,0) at contact (expected loss 25 J,
             L_orb=(0,0,-6), merged radius 1.25992105 m)."""
    if case == "head_on":
        m1, m2, r1, r2 = 2.0, 1.0, [-1.0, 0.0, 0.0], [1.0, 0.0, 0.0]
        v1, v2 = [3.0, 0.0, 0.0], [-3.0, 0.0, 0.0]
    else:
        m1 = m2 = 1.0
        r1, r2 = [-0.8, 0.6, 0.0], [0.8, -0.6, 0.0]
        v1, v2 = [5.0, 0.0, 0.0], [-5.0, 0.0, 0.0]
    back = 0.05
    bodies = [{"name": "P", "m": m1, "r": 1.0, "x": sub(r1, scale(v1, back)), "v": v1},
              {"name": "Q", "m": m2, "r": 1.0, "x": sub(r2, scale(v2, back)), "v": v2}]
    run = merge_run(bodies, "line", 0.01, 0.5, integrator="leapfrog")
    return {"bodies": bodies, **run}


# ======================================================================
# Randomised detection sweep (adaptive IAS15 / fixed-step WHFast with a star+planet driving the step size)
# ======================================================================
T_MEET = 1.0e5  # s, upper bound of the (randomised) time of closest approach
T_AFTER = 2.0e3  # s, simulate this long past the encounter
R_SW = 1.0e3  # m, radius of each swept body (sum 2e3 m)
M_SW = 1.0e3  # kg


def sweep_params(n, seed):
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = [rng.gauss(0, 1) for _ in range(3)]
        u = scale(u, 1 / norm(u))
        w = [rng.gauss(0, 1) for _ in range(3)]
        w = sub(w, scale(u, dot(w, u)))
        w = scale(w, 1 / norm(w))
        # T: encounter time, randomised so the closest approach has a random phase relative to any fixed step grid
        out.append({"v_rel": 10 ** rng.uniform(1, 5), "b": rng.uniform(0.0, 6.0e3), "u": u, "w": w,
                    "T": T_MEET * rng.uniform(0.05, 1.0)})
    return out


def sweep_sim(p, shift, integrator="ias15", dt=None, mode="none", resolver=None):
    sim = new_sim(integrator, dt=dt)
    sim.add(m=M_SUN, name="star")
    sim.add(m=M_EARTH, a=AU, name="planet")
    r0 = 3 * AU
    vc = math.sqrt(G_SI * M_SUN / r0)
    com, vcom = [r0, 0.0, 0.0], [0.0, vc, 0.0]
    half = p["v_rel"] * p["T"] / 2
    xa = add(sub(com, scale(p["u"], half)), scale(p["w"], p["b"] / 2))
    xb = add(add(add(com, scale(p["u"], half)), scale(p["w"], -p["b"] / 2)), shift)
    va = add(vcom, scale(p["u"], p["v_rel"] / 2))
    vb = add(vcom, scale(p["u"], -p["v_rel"] / 2))
    add_bodies(sim, [{"name": "A", "m": M_SW, "r": R_SW, "x": xa, "v": va},
                     {"name": "B", "m": M_SW, "r": R_SW, "x": xb, "v": vb}])
    if mode != "none":
        sim.collision = mode
        sim.collision_resolve = resolver
    return sim


def sweep_aim(p):
    """Adjust B's initial position (first-order Newton iteration, reference IAS15 without collisions) so the
    pair meets at p["T"] with relative offset b perpendicular to the relative velocity. Returns the shift and the
    TRUE closest-approach distance (linear extrapolation of the reference state at p["T"]; curvature error over
    the few seconds involved is ~1e-3 m)."""
    shift = [0.0, 0.0, 0.0]
    des = scale(p["w"], -p["b"])
    for _ in range(6):
        s = sweep_sim(p, shift)
        s.integrate(p["T"], exact_finish_time=1)
        A, B = s.particles["A"], s.particles["B"]
        rel = sub(pos(B), pos(A))
        shift = sub(shift, sub(rel, des))
    s = sweep_sim(p, shift)
    s.integrate(p["T"], exact_finish_time=1)
    A, B = s.particles["A"], s.particles["B"]
    r, v = sub(pos(B), pos(A)), sub(vel(B), vel(A))
    t_c = -dot(r, v) / dot(v, v)
    d_min = norm(add(r, scale(v, t_c)))
    return shift, d_min, t_c


def sweep_scenarios(n=150, seed=12345):
    sc = []
    for p in sweep_params(n, seed):
        shift, d, t_c = sweep_aim(p)
        sc.append({"p": p, "shift": shift, "d_min": d, "t_c": t_c})
    return sc


def sweep_detect(sc, mode, integrator="ias15", dt=None, chunk=None):
    rec = Recorder()
    sim = sweep_sim(sc["p"], sc["shift"], integrator, dt, mode, rec.resolve)
    run_to(sim, sc["p"]["T"] + T_AFTER, chunk)
    return bool(rec.calls)


def sweep_confusion(scenarios, mode, integrator="ias15", dt=None, chunk=None, margin=0.05):
    """Compare detection with the true closest approach. Scenarios whose true distance is within `margin` of
    the contact distance are 'ambiguous' and excluded from the matrix."""
    cm = {"TP": 0, "FN": 0, "FP": 0, "TN": 0, "ambiguous": 0}
    for sc in scenarios:
        ratio = sc["d_min"] / (2 * R_SW)
        if abs(ratio - 1.0) < margin:
            cm["ambiguous"] += 1
            continue
        truth = ratio < 1.0
        det = sweep_detect(sc, mode, integrator, dt, chunk)
        cm[("TP" if det else "FN") if truth else ("FP" if det else "TN")] += 1
    return cm


# ======================================================================
# Checkpoint with a collision AFTER the restore point
# ======================================================================
def _ck_build(layer, mode, chunk, integrator):
    sim = make_sim(integrator, chunk)
    add_bodies(sim, two_spheres(200.0, 2.0, 0.5) + [{"name": "C", "m": 1.0e11, "r": 5.0, "x": [0.0, 400.0, 0.0]}])
    sim.collision = mode
    sim.collision_resolve = layer.resolve
    return sim


def checkpoint_collision(mode="line", chunk=0.5, integrator="ias15", reset_resolver=True):
    t_ck, t_end = 50.0, 130.0  # contact ~ t = 99
    ref_layer = MergeLayer()
    ref = _ck_build(ref_layer, mode, chunk, integrator)
    run_to(ref, t_ck, chunk)
    run_to(ref, t_end, chunk)

    a_layer = MergeLayer()
    a = _ck_build(a_layer, mode, chunk, integrator)
    run_to(a, t_ck, chunk)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "ck.bin")
        a.save_to_file(path)
        run_to(a, t_end, chunk)  # advance the ORIGINAL after saving
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            b = rebound.Simulation(path)
        warned = any("function pointers" in str(x.message) for x in w)
    b_layer = MergeLayer()
    restored_mode = b.collision
    restored_G = b.G
    N_restored = b.N
    if reset_resolver:
        b.collision_resolve = b_layer.resolve
    halted = None
    try:
        run_to(b, t_end, chunk)
    except rebound.Collision as exc:
        halted = str(exc)

    def state(s):
        return sorted((p.name, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.m, p.r) for p in s.particles)

    cfg = lambda s: (s.t, s.G, s.collision, s.N, s.dt, s.integrator.epsilon if integrator == "ias15" else None)  # noqa
    return {
        "restored_collision_mode": restored_mode, "restored_G": restored_G, "N_at_restore": N_restored,
        "restore_warning_emitted": warned,
        "original_equals_reference": state(a) == state(ref),
        "restored_equals_reference": state(b) == state(ref),
        "config_equal": cfg(b) == cfg(ref), "t_equal": b.t == ref.t,
        "ref_events": [(e["t"], e["survivor"], e["absorbed"]) for e in ref_layer.events],
        "restored_events": [(e["t"], e["survivor"], e["absorbed"]) for e in b_layer.events],
        "N_final_ref": ref.N, "N_final_restored": b.N,
        "names_restored": sorted(p.name for p in b.particles), "halted_with": halted,
    }


def chain_checkpoint(mode="line", dt=0.5, seed=None):
    """Chain collision A-B-C with a checkpoint taken BEFORE the collisions (t=40; contact ~ t=50). Compares the
    restored run with an uninterrupted one: event order, survivor ids, final state."""
    d = 101.037
    bodies = [dict(SPH_A, name="A", x=[-d, 0.0, 0.0], v=[2.0, 0.0, 0.0]),
              {"name": "B", "m": 1.0e3, "r": 0.8, "x": [0.0, 0.0, 0.0], "v": [0.0, 0.0, 0.0]},
              {"name": "C", "m": 1.5e3, "r": 0.9, "x": [d, 0.0, 0.0], "v": [-2.0, 0.0, 0.0]}]

    def build(layer):
        sim = make_sim("leapfrog", dt)
        if seed is not None:
            sim.rand_seed = seed
        add_bodies(sim, bodies)
        sim.collision = mode
        sim.collision_resolve = layer.resolve
        return sim

    ref_layer = MergeLayer()
    ref = build(ref_layer)
    run_to(ref, 40.0, dt)
    a_layer = MergeLayer()
    a = build(a_layer)
    run_to(a, 40.0, dt)
    with tempfile.TemporaryDirectory() as dd:
        path = os.path.join(dd, "ck.bin")
        a.save_to_file(path)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            b = rebound.Simulation(path)
    run_to(ref, 80.0, dt)
    b_layer = MergeLayer()
    b.collision_resolve = b_layer.resolve
    run_to(b, 80.0, dt)
    st = lambda s: sorted((p.name, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.m, p.r) for p in s.particles)  # noqa: E731
    ev = lambda l: [(e["t"], e["survivor"], e["absorbed"]) for e in l.events]  # noqa: E731
    return {"ref_events": ev(ref_layer), "restored_events": ev(b_layer), "events_equal": ev(ref_layer) == ev(b_layer),
            "state_equal": st(ref) == st(b), "rand_seed_restored": b.rand_seed}


# ======================================================================
# Report
# ======================================================================
if __name__ == "__main__":
    print("== refinement, WHFast fixed step: slow head-on (v_rel 2 m/s, sep 200, b=0); delay = t_detect - t_contact [s]")
    for mode in ("direct", "line"):
        for dt in (1.0, 0.1, 0.01):
            r = detection_run(mode, dt)
            print(mode, "dt", dt, "t_contact", round(r["t_contact"], 6), "delay", r["delay"], "calls", r["n_calls"],
                  "stale", r["stale"])
    print("== fast head-on (v_rel 2000 m/s, sep 2e4): dt 0.01 => 20 m per step vs R_SUM 1.8 m")
    for mode in ("direct", "line"):
        print(detection_run(mode, 0.01, v_rel=2000.0, sep=SEP_FAST))
    print("== grazing b=1.7 / near miss b=1.9 (R_SUM 1.8), v_rel 2 m/s, WHFast dt 1.0 (2 m per step) and 0.1")
    for b in (1.7, 1.9):
        for mode in ("direct", "line"):
            for dt in (1.0, 0.1):
                r = detection_run(mode, dt, b=b)
                print("b", b, mode, "dt", dt, "detected", r["detected"], "delay", r["delay"])
    print("== independent-review fixtures (their r0, u, R, dt): detection + contact-time estimate")
    for name, (r0, u, R, dt, t_exp, d_min) in INDEPENDENT_FIXTURES.items():
        for mode in ("direct", "line"):
            r = fixture_detect(r0, u, R, dt, mode)
            print(name, mode, "expected t_contact", t_exp, "->", r)
    print("== independent merger examples through our layer")
    for case in ("head_on", "grazing"):
        r = independent_merger(case)
        ev = r["layer"].events[0]
        print(case, "M", ev["post"]["m"], "v_com", ev["post"]["v"], "ke_lost", ev["ke_lost"], "L_orb", ev["L_orb"],
              "R", ev["post"]["r"], "contact_est", ev["contact_time_est"])
    print("== randomised sweep: n=150, seed=12345; adaptive IAS15 / fixed WHFast with star+planet driving the step")
    scen = sweep_scenarios()
    print("true d_min / R_sum, sorted:", [round(s["d_min"] / (2 * R_SW), 2) for s in sorted(scen, key=lambda s: s["d_min"])])
    for integ, dt, chunk in (("ias15", None, None), ("ias15", None, 1e3), ("whfast", 1e5, None),
                             ("whfast", 1e4, None), ("whfast", 1e3, None)):
        for mode in ("direct", "line"):
            print(integ, "dt", dt, "chunk", chunk, mode, sweep_confusion(scen, mode, integ, dt, chunk), flush=True)
    print("== merger vs analytic (b=0.5 m, grazing-ish)")
    m = merger_analytic()
    ev = m["layer"].events[0]
    ex = m["expected"]
    print("event t", ev["t"], "contact", m["t_contact"], "calls", m["layer"].calls, "N", m["sim"].N)
    print("M", ev["post"]["m"], ex["M"], "| v_com", ev["post"]["v"], ex["v_com"])
    print("KE lost", ev["ke_lost"], "expected 0.5*mu*v_rel^2", ex["dKE"], "| L_orb", ev["L_orb"], ex["L_orb"])
    print("== two pairs in one step (line / direct, leapfrog dt 0.5)")
    for mode, dt in (("line", 0.5), ("direct", 0.5), ("line", 5.0), ("direct", 5.0)):
        r = two_pairs_one_step(mode, dt)
        print(mode, "dt", dt, "N", r["sim"].N, "events", [(e["survivor"], e["absorbed"]) for e in r["layer"].events],
              "calls", r["layer"].calls, "stale", r["layer"].stale)
    print("== chain A-B-C (line / direct)")
    for mode in ("line", "direct"):
        r = chain_collision(mode)
        print(mode, "N", r["sim"].N, "names", [pp.name for pp in r["sim"].particles],
              "events", [(e["t"], e["survivor"], e["absorbed"]) for e in r["layer"].events], "stale", r["layer"].stale,
              "dmass", r["after"]["mass"] - r["before"]["mass"], "dp", norm(sub(r["after"]["p"], r["before"]["p"])))
    print("== three-body near collision")
    r = three_body_near_collision()
    print("events", [(e["t"], e["survivor"], e["absorbed"], e["b"]) for e in r["layer"].events], "N", r["sim"].N)
    print("== id stability")
    for lighter_first in (False, True):
        r = id_stability(lighter_first)
        print("first_is_lighter", lighter_first, r["names_in_order"], "index_Z", r["index_Z"], "LIGHT found", r["light_found"])
    print("== WHFast radial failure vs IAS15 (sep 20007, b=0, real G)")
    print(whfast_radial_failure("whfast"))
    print(whfast_radial_failure("ias15"))
    print("== merger extra numbers")
    sep0 = norm(sub(m["bodies"][0]["x"], m["bodies"][1]["x"]))
    mu = ex["mu"]
    v2 = ex["v_rel"] ** 2 + 2 * G_SI * ex["M"] * (1 / ev["sep_at_callback"] - 1 / sep0)
    print("KE lost measured", ev["ke_lost"], "vis-viva expected", 0.5 * mu * v2, "rel diff",
          abs(ev["ke_lost"] - 0.5 * mu * v2) / ev["ke_lost"])
    print("L before-after", sub(m["before"]["L"], m["after"]["L"]), "spin ledger", m["layer"].spin)
    print("E_final - E_initial", m["after"]["E"] - m["before"]["E"], "event dE_total", ev["dE_total"],
          "dKE", ev["dKE_total"], "dPE", ev["dPE_total"], "heat", m["layer"].heat_J)
    t3 = three_body_near_collision()
    e3 = t3["layer"].events[0]
    scale_p = sum(abs(pp.m) * norm(vel(pp)) for pp in t3["sim"].particles)
    print("3-body dp", norm(sub(t3["after"]["p"], t3["before"]["p"])), "scale", scale_p, "dmass",
          t3["after"]["mass"] - t3["before"]["mass"], "dKE_total", e3["dKE_total"], "ke_lost", e3["ke_lost"])
    print("== IAS15 momentum error after a merge, with/without integrator reset (3-body, C=1e11 kg)")
    for reset in (False, True):
        t3 = three_body_near_collision(reset_ias15=reset)
        print("reset_ias15", reset, "dp", norm(sub(t3["after"]["p"], t3["before"]["p"])), "errors", len(t3["layer"].errors))
    print("== chain checkpoint: restored run vs uninterrupted, 10 repetitions each, seeded (default) vs unseeded")
    print("seeded  :", [chain_checkpoint()["events_equal"] for _ in range(10)])
    print("seed=None -> explicit seed on build is overridden? ", [chain_checkpoint(seed=7)["events_equal"] for _ in range(5)])
    print("== checkpoint with collision after restore")
    print(checkpoint_collision())
    print("restore without re-setting the resolver:", checkpoint_collision(reset_resolver=False))
