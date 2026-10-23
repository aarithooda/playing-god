"""M0 REBOUND feasibility experiments, part 1: SI setup, gravity, orbits, checkpoint, performance.
Throwaway evidence code, not application code. Collisions/mergers live in collision_spike.py.

PROJECT UNITS (decided by the team): SI. Position m, velocity m/s, mass kg, time s, radius m,
energy J, angular momentum kg m^2/s, G = 6.67430e-11 m^3 kg^-1 s^-2.

REBOUND scaling implications (observed, see context/PHYSICS_SPIKE.md):
- `sim.units = ("m", "s", "kg")` only labels units and sets G to REBOUND's own constant 6.67408e-11,
  which differs from the project's 6.67430e-11 by 3.3e-5 relative. We therefore ALWAYS set `sim.G` explicitly
  (new_sim below) and test that we did.
- `sim.dt` and every time argument are seconds; IAS15 `epsilon` is dimensionless; WHFast needs a dt in seconds.
- Doubles resolve ~1.5e11 m * 2.2e-16 = 3e-5 m at 1 AU, which bounds collision-geometry precision there.

Run everything and print the tables:  python -m backend.experiments.rebound_spike
"""
import math
import os
import random
import tempfile
import time
import warnings

import rebound

G_SI = 6.67430e-11  # m^3 kg^-1 s^-2 (project constant)
M_SUN = 1.98847e30  # kg
M_EARTH = 5.9722e24  # kg
AU = 1.495978707e11  # m
RAND_SEED = 12345  # fixed so repeated runs resolve simultaneous collisions in the same order


# ---------- small vector helpers (no numpy dependency) ----------
def norm(v):
    return math.sqrt(sum(c * c for c in v))


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def add(a, b):
    return [x + y for x, y in zip(a, b)]


def scale(a, s):
    return [x * s for x in a]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def pos(p):
    return [p.x, p.y, p.z]


def vel(p):
    return [p.vx, p.vy, p.vz]


# ---------- simulation factory ----------
def rebound_units_G():
    """G that REBOUND itself assigns for SI units (for documentation of the mismatch)."""
    s = rebound.Simulation()
    s.units = ("m", "s", "kg")
    return s.G


def new_sim(integrator="ias15", dt=None):
    sim = rebound.Simulation()
    sim.units = ("m", "s", "kg")
    sim.G = G_SI  # override REBOUND's 6.67408e-11 with the project constant
    sim.rand_seed = RAND_SEED  # REBOUND resolves simultaneous collisions in random order unless seeded
    sim.integrator = integrator
    if dt is not None:
        sim.dt = dt
    return sim


def totals(sim, exclude=()):
    """Conserved-quantity bookkeeping computed from the live state (SI): mass kg, p kg m/s,
    L kg m^2/s about the origin, KE/PE/E in J. `exclude` lists particle indices to leave out."""
    ps = [p for i, p in enumerate(sim.particles) if i not in exclude]
    mom = [sum(p.m * getattr(p, c) for p in ps) for c in ("vx", "vy", "vz")]
    ang = [0.0, 0.0, 0.0]
    for p in ps:
        ang = add(ang, cross(pos(p), scale(vel(p), p.m)))
    ke = sum(0.5 * p.m * dot(vel(p), vel(p)) for p in ps)
    pe = 0.0
    for i in range(len(ps)):
        for j in range(i + 1, len(ps)):
            pe -= sim.G * ps[i].m * ps[j].m / norm(sub(pos(ps[i]), pos(ps[j])))
    return {"mass": sum(p.m for p in ps), "p": mom, "L": ang, "KE": ke, "PE": pe, "E": ke + pe}


# ---------- gravity: acceleration ----------
def acceleration_check(m1=M_EARTH, m2=7.342e22, r=3.844e8):
    """Earth-Moon-like pair at rest. Quantity: acceleration of body 1 [m/s^2].
    Analytic: G m2 / r^2 evaluated at the final separation (REBOUND stores the acceleration of the last step)."""
    sim = new_sim("ias15")
    sim.add(m=m1)
    sim.add(m=m2, x=r)
    sim.integrate(10.0)
    p, q = sim.particles[0], sim.particles[1]
    rr = norm(sub(pos(q), pos(p)))
    expected = G_SI * m2 / rr ** 2
    measured = p.ax
    return {"expected": expected, "measured": measured, "abs_err": abs(measured - expected),
            "rel_err": abs(measured - expected) / expected}


# ---------- two-body orbits ----------
def orbit(integrator="ias15", e=0.0, a=AU, M=M_SUN, m=M_EARTH, n_orbits=10):
    """Sun-Earth-like orbit in SI. Expected period T = 2 pi sqrt(a^3 / (G (M+m))) [s], analytic and independent
    of REBOUND. After an integer number of periods the relative position must return to its start."""
    sim = new_sim(integrator)
    sim.add(m=M)
    sim.add(m=m, a=a, e=e)
    sim.move_to_com()
    period = 2 * math.pi * math.sqrt(a ** 3 / (G_SI * (M + m)))
    if integrator != "ias15":
        sim.dt = period / 200
    t0 = totals(sim)
    r0 = sub(pos(sim.particles[1]), pos(sim.particles[0]))
    sim.integrate(n_orbits * period)
    t1 = totals(sim)
    r1 = sub(pos(sim.particles[1]), pos(sim.particles[0]))
    return {
        "integrator": integrator, "e": e, "period_s": period,
        "rel_dE": abs((t1["E"] - t0["E"]) / t0["E"]),
        "rel_dL": norm(sub(t1["L"], t0["L"])) / norm(t0["L"]),
        "rel_dp": norm(sub(t1["p"], t0["p"])) / (M * math.sqrt(G_SI * M / a)),  # relative to a typical |m v|
        "return_err_m": norm(sub(r1, r0)), "return_err_rel": norm(sub(r1, r0)) / norm(r0),
        "steps": sim.steps_done,
    }


# ---------- checkpoint: smooth 3-body, no collisions ----------
def checkpoint(integrator="ias15"):
    """Uninterrupted run vs save -> restore -> advance. Three bodies (star, planet, small planet), SI."""
    def build():
        sim = new_sim(integrator)
        sim.add(m=M_SUN, name="star")
        sim.add(m=M_EARTH, a=AU, e=0.0167, name="earth")
        sim.add(m=6.39e23, a=1.524 * AU, e=0.093, inc=0.03, name="mars")
        sim.move_to_com()
        if integrator != "ias15":
            sim.dt = 86400.0
        return sim

    t1, t2 = 1.0e7, 2.0e7
    ref = build()
    ref.integrate(t1)
    ref.integrate(t2)
    a = build()
    a.integrate(t1)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "ck.bin")
        a.save_to_file(path)
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            b = rebound.Simulation(path)
        warned = any("function pointers" in str(x.message) for x in w)
    b.integrate(t2)
    state = lambda s: [(p.name, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.m) for p in s.particles]  # noqa: E731
    same_cfg = (ref.t == b.t and ref.G == b.G and str(ref.integrator).split("name=")[-1].split(",")[0]
                == str(b.integrator).split("name=")[-1].split(",")[0])
    return {"integrator": integrator, "bitwise_equal": state(ref) == state(b), "same_t_G_integrator": same_cfg,
            "restore_warning_emitted": warned, "G_restored": b.G}


# ---------- performance ----------
def performance(N, integrator, collision="none"):
    """Steps per second for N bodies (no actual collisions occur; bodies have radius 1e6 m). `collision` is the
    REBOUND search mode, to measure the cost of detection itself."""
    rng = random.Random(0)
    sim = new_sim(integrator)
    sim.add(m=M_SUN)
    for _ in range(N - 1):
        sim.add(m=1e-6 * M_SUN, r=1.0e6, a=rng.uniform(0.5, 5) * AU, e=rng.uniform(0, 0.1), inc=rng.uniform(0, 0.1),
                Omega=rng.uniform(0, 6.28), omega=rng.uniform(0, 6.28), f=rng.uniform(0, 6.28))
    if integrator != "ias15":
        sim.dt = 86400.0
    if collision != "none":
        sim.collision = collision
        sim.collision_resolve = "merge"
    t0 = time.perf_counter()
    steps = 20
    sim.steps(steps)
    return {"N": N, "integrator": integrator, "collision": collision, "steps_per_s": steps / (time.perf_counter() - t0)}


if __name__ == "__main__":
    print("rebound", rebound.__version__, "| project G", G_SI, "| REBOUND SI-units G", rebound_units_G())
    print("accel", acceleration_check())
    for integ in ("ias15", "whfast"):
        for e in (0.0, 0.5):
            print("orbit", orbit(integ, e=e))
    for integ in ("ias15", "whfast"):
        print("checkpoint", checkpoint(integ))
    for N in (2, 10, 100, 500):
        for integ in ("ias15", "whfast"):
            for col in ("none", "direct", "line"):
                print("perf", performance(N, integ, col))
