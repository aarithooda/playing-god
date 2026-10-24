"""Deterministic merger scenarios used to prove that deferred resolution reproduces the legacy merger.

The setups are the P-003 stress scenarios (tests/test_stress_p003.py) and the first scenarios of the M0 detection sweep
(backend/experiments/collision_spike.py), rebuilt with FIXED body ids via `SimulationService.load_bodies` so that two
runs are comparable id for id. Golden values (tests/impact/test_deferred_equivalence.py) were produced by running these
exact setups on the unchanged legacy code of commit f2c2da3.

`run_scenario(engine_factory, name)` returns a plain, JSON-able record of every event and the final bodies.
"""
import math
import random
from typing import Callable

from backend.simulation import InitialBody, SimulationService

G = 6.67430e-11


def body(bid, m, r, x=(0.0, 0.0, 0.0), v=(0.0, 0.0, 0.0)) -> InitialBody:
    return InitialBody(id=bid, name=bid, kind="planet", massKg=m, radiusM=r, positionM=tuple(map(float, x)),
                       velocityMPerS=tuple(map(float, v)), colorHex="#ffffff")


def _norm(a):
    return math.sqrt(sum(c * c for c in a))


def kepler_merge():
    """e = 0.9 binary whose periapsis (100 m) is inside the contact distance (150 m): merges after ~T/2."""
    m1, m2, a, e = 5e12, 1e12, 1000.0, 0.9
    big_m, gm = m1 + m2, G * (m1 + m2)
    r_apo = a * (1 + e)
    v_rel = math.sqrt(gm * (1 - e) / (a * (1 + e)))
    period = 2 * math.pi * math.sqrt(a ** 3 / gm)
    bodies = [body("one", m1, 100.0, (-m2 / big_m * r_apo, 0, 0), (0, -m2 / big_m * v_rel, 0)),
              body("two", m2, 50.0, (m1 / big_m * r_apo, 0, 0), (0, m1 / big_m * v_rel, 0))]
    return bodies, [period]


def ring(n):
    bodies = []
    for i in range(n):
        ang = 2 * math.pi * i / n
        d = (math.cos(ang), math.sin(ang), 0.0)
        bodies.append(body(f"ring{i}", 1e6, 5.0, tuple(100.0 * c for c in d), tuple(-10.0 * c for c in d)))
    return bodies, [100.0 / 10.0 + 5.0]


def homologous_collapse(seed=20261024, n=10, tau=40.0):
    rnd = random.Random(seed)
    bodies = []
    for i in range(n):
        d = [rnd.gauss(0, 1) for _ in range(3)]
        shell = rnd.uniform(200.0, 400.0)
        pos = [shell * c / _norm(d) for c in d]
        bodies.append(body(f"h{i}", rnd.uniform(1e5, 1e7), 20.0, pos, tuple(-c / tau for c in pos)))
    return bodies, [60.0]


def five_pairs():
    bodies = []
    for k in range(5):
        y = 1000.0 * k
        bodies.append(body(f"H{k}", 2e6 * (k + 1), 2.0, (-50.0, y, 0.0), (10.0, 0.01 * k, 0.0)))
        bodies.append(body(f"L{k}", 1e6, 1.0, (50.0, y, 0.0), (-10.0, 0.0, 0.0)))
    return bodies, [8.0, 5.0]


def four_chain():
    xs, vs, ms = [-40.0, 0.0, 12.0, 24.0], [8.0, 0.0, 0.0, -6.0], [3e6, 1e6, 2e6, 4e6]
    return [body(f"c{i}", m, 5.0, (x, 0, 0), (v, 0, 0)) for i, (x, v, m) in enumerate(zip(xs, vs, ms))], [4.0, 20.0]


def probe_into_heavy(probe_first):
    probe = body("probe", 1.0, 0.5, (-200.0, 0, 0), (300.0, 0, 0))
    heavy = body("heavy", 1e12, 10.0)
    return ([probe, heavy] if probe_first else [heavy, probe]), [2.0]


def extreme_ratio():
    return [body("heavy", 1e17, 1e3), body("probe", 1.0, 1.0, (-1e5, 0, 0), (1e3, 0, 0))], [300.0]


def equal_mass_tie():
    """Equal masses: legacy keeps the id of REBOUND's first particle (p1)."""
    return [body("first", 1e9, 5.0, (-100.0, 0, 0), (20.0, 0, 0)), body("second", 1e9, 5.0, (100.0, 0, 0), (-20.0, 0, 0))], [8.0]


def fast_impact():
    """Relative speed 1e5 m/s, radii 1 m: crosses the 2 m contact distance in 2e-5 s, far below any internal step."""
    return [body("fast", 1e3, 1.0, (-500.0, 0, 0), (5.0e4, 0, 0)), body("slow", 1e6, 1.0, (500.0, 0, 0), (-5.0e4, 0, 0))], [0.05]


def spike_sweep_scenario(index: int):
    """Scenario `index` of the M0 sweep (seed 12345): Sun + Earth-like planet + two small bodies A, B that meet
    at a random relative speed (10..1e5 m/s) and impact parameter. Only scenarios that really touch are used."""
    from backend.experiments import collision_spike as sp

    scenarios = _sweep_cache()
    sc = scenarios[index]
    p, shift = sc["p"], sc["shift"]
    r0 = 3 * sp.AU
    vc = math.sqrt(sp.G_SI * sp.M_SUN / r0)
    half = p["v_rel"] * p["T"] / 2
    com, vcom = [r0, 0.0, 0.0], [0.0, vc, 0.0]
    xa = sp.add(sp.sub(com, sp.scale(p["u"], half)), sp.scale(p["w"], p["b"] / 2))
    xb = sp.add(sp.add(sp.add(com, sp.scale(p["u"], half)), sp.scale(p["w"], -p["b"] / 2)), shift)
    va = sp.add(vcom, sp.scale(p["u"], p["v_rel"] / 2))
    vb = sp.add(vcom, sp.scale(p["u"], -p["v_rel"] / 2))
    bodies = [body("star", sp.M_SUN, 6.957e8), body("a", sp.M_SW, sp.R_SW, xa, va), body("b", sp.M_SW, sp.R_SW, xb, vb)]
    return bodies, [p["T"] + sp.T_AFTER]


_SWEEP: list | None = None


def _sweep_cache():
    global _SWEEP
    if _SWEEP is None:
        from backend.experiments import collision_spike as sp
        _SWEEP = sp.sweep_scenarios(24, 12345)
    return _SWEEP


def sweep_hitting_indices(limit=6) -> list[int]:
    """Indices (in the seed-12345 sweep) of the first scenarios whose true closest approach is clearly inside contact."""
    from backend.experiments import collision_spike as sp

    hits = [i for i, sc in enumerate(_sweep_cache()) if sc["d_min"] < 0.8 * 2 * sp.R_SW]
    return hits[:limit]


SCENARIOS: dict[str, Callable[[], tuple[list[InitialBody], list[float]]]] = {
    "kepler_merge": kepler_merge,
    "ring4": lambda: ring(4), "ring6": lambda: ring(6), "ring12": lambda: ring(12),
    "homologous10": homologous_collapse,
    "five_pairs": five_pairs,
    "four_chain": four_chain,
    "probe_heavy_created_first": lambda: probe_into_heavy(False),
    "probe_heavy_created_second": lambda: probe_into_heavy(True),
    "extreme_ratio": extreme_ratio,
    "equal_mass_tie": equal_mass_tie,
    "fast_impact": fast_impact,
}


def run_scenario(factory: Callable[[], SimulationService], name_or_spec) -> dict:
    """Run a scenario on a fresh engine from `factory` and return {events: [...], bodies: [...], t: ...}."""
    if isinstance(name_or_spec, str):
        bodies, steps = SCENARIOS[name_or_spec]()
    else:
        bodies, steps = name_or_spec
    engine = factory()
    engine.load_bodies(bodies, history_mode="step")
    for dt in steps:
        engine.step(dt)
    events = []
    for ev in engine.events():
        events.append({
            "id": ev.id, "simulationTimeS": ev.simulationTimeS, "estimatedContactTimeS": ev.estimatedContactTimeS,
            "bodyIds": list(ev.bodyIds), "resultBodyId": ev.resultBodyId, "resultMassKg": ev.resultMassKg,
            "relativeSpeedMPerS": ev.relativeSpeedMPerS, "kineticEnergyLostJ": ev.kineticEnergyLostJ,
            "spinAddedKgM2PerS": [ev.spinAddedKgM2PerS.x, ev.spinAddedKgM2PerS.y, ev.spinAddedKgM2PerS.z]})
    state = engine.snapshot()
    final = [{"id": b.id, "massKg": b.massKg, "radiusM": b.radiusM,
              "positionM": [b.positionM.x, b.positionM.y, b.positionM.z],
              "velocityMPerS": [b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z]} for b in state.bodies]
    return {"events": events, "bodies": final, "t": state.simulationTimeS}
