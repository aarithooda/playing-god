"""Experiment 01 scientific validation (spec section 9, plan 15.3), run in the application's own engine.

Expectations are computed here from an independent Kepler reference (kepler_reference.py) at run time; nothing is
hard-coded from the planning probe. Every measured value is printed (pytest -s) and quoted in
context/EXPERIMENT_01_PROTOCOL.md."""
import math

import pytest

from backend.orbit_lab import OrbitLab
from backend.universes import UniverseRegistry
from tests.validation.kepler_reference import cross, elements, norm, propagate

G = 6.67430e-11
DAY = 86400.0
FACTORS = [0.90, 0.95, 1.05, 1.10]
ALL = [1.0] + FACTORS
SYSTEM = "exp01-sun-emb-j2000"


def vec(b):
    return (b.positionM.x, b.positionM.y, b.positionM.z), (b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z)


def relative_initial(engine):
    """Initial relative position and velocity of the Earth-Moon barycentre about the Sun, and mu, from the run's own
    initial snapshot (so the reference is started from exactly the state the engine started from)."""
    p = {q.name: q for q in engine.initial_snapshot.sim.particles}
    sun, emb = p["body-sun"], p["body-earth"]
    r0 = (emb.x - sun.x, emb.y - sun.y, emb.z - sun.z)
    v0 = (emb.vx - sun.vx, emb.vy - sun.vy, emb.vz - sun.vz)
    return r0, v0, G * (sun.m + emb.m)


def rel_from_positions(positions):
    s, e = positions["body-sun"], positions["body-earth"]
    return (e[0] - s[0], e[1] - s[1], e[2] - s[2])


@pytest.fixture(scope="module")
def lab():
    return OrbitLab(UniverseRegistry())


@pytest.fixture(scope="module")
def experiment(lab):
    return lab.create_experiment(SYSTEM)


def drift(engine, steps, dt=DAY):
    """Advances `steps` steps; returns the worst relative drift of K+U and of |L| about the origin."""
    d0 = engine.snapshot().diagnostics
    e0 = d0.kineticEnergyJ + d0.potentialEnergyJ
    l0 = norm(tuple(getattr(d0.angularMomentumAboutOriginKgM2PerS, a) for a in "xyz"))
    worst_e = worst_l = 0.0
    for _ in range(steps):
        engine.step(dt)
        d = engine.snapshot().diagnostics
        worst_e = max(worst_e, abs((d.kineticEnergyJ + d.potentialEnergyJ) / e0 - 1.0))
        lv = tuple(getattr(d.angularMomentumAboutOriginKgM2PerS, a) for a in "xyz")
        worst_l = max(worst_l, abs(norm(lv) / l0 - 1.0))
    return worst_e, worst_l


@pytest.fixture(scope="module")
def runs(lab, experiment):
    """Each factor's run advanced over the whole 730-day window (the baseline is factor 1.0)."""
    out = {}
    base = lab.registry.get(experiment["baselineUniverseId"]).engine
    out[1.0] = {"engine": base, "drift": drift(base, 730)}
    for f in FACTORS:
        run = lab.create_modified_run(experiment["id"], "body-earth", f, True)
        eng = lab.registry.get(run["modifiedUniverseId"]).engine
        out[f] = {"engine": eng, "drift": drift(eng, 730)}
    for f, d in out.items():
        d["samples"] = d["engine"].history.page(None, 0, None, 5000)["samples"]
    return out


@pytest.mark.parametrize("f", ALL)
def test_exp01_matches_kepler_reference(runs, f):
    eng = runs[f]["engine"]
    r0, v0, mu = relative_initial(eng)
    el = elements(r0, v0, mu)
    samples = runs[f]["samples"]
    assert len(samples) == 731
    worst = 0.0
    for s in samples:
        ref, _ = propagate(r0, v0, mu, s["simulationTimeS"])
        worst = max(worst, math.dist(rel_from_positions({k: tuple(v) for k, v in s["positionsM"].items()}), ref))
    print(f"\nf = {f}: a = {el['a'] / 1.495978707e11:.5f} au, e = {el['e']:.5f}, P = {el['period'] / DAY:.2f} d, "
          f"max |engine - Kepler| over 731 samples = {worst:.4g} m = {worst / el['a']:.3g} a (threshold 1e-10 a = {1e-10 * el['a']:.3g} m)")
    assert worst <= 1e-10 * el["a"]


def test_reference_check_is_sensitive_to_a_wrong_velocity(runs):
    """Guards the guard: a 1 % velocity error is detected by the same comparison (it would exceed 1e-3 a)."""
    eng = runs[1.10]["engine"]
    r0, v0, mu = relative_initial(eng)
    wrong = tuple(1.01 * c for c in v0)
    a = elements(r0, v0, mu)["a"]
    worst = 0.0
    for s in runs[1.10]["samples"]:
        ref, _ = propagate(r0, wrong, mu, s["simulationTimeS"])
        worst = max(worst, math.dist(rel_from_positions({k: tuple(v) for k, v in s["positionsM"].items()}), ref))
    assert worst > 1e-3 * a


def test_exp01_qualitative_ordering(runs):
    el = {f: elements(*relative_initial(runs[f]["engine"])) for f in ALL}
    order = sorted(ALL)
    for key in ("a", "period", "aphelion"):
        values = [el[f][key] for f in order]
        assert values == sorted(values), key  # larger initial speed: larger orbit, longer period, farther aphelion
    assert all(el[order[i]]["e"] != el[order[i + 1]]["e"] for i in range(len(order) - 1))
    r0 = el[1.0]["r0"]
    for f in FACTORS:
        e = el[f]
        if f > 1.0:  # speeded up: the start is (almost) the closest approach
            assert abs(e["r0"] - e["perihelion"]) <= 1e-3 * r0, f
            assert e["perihelion"] == pytest.approx(r0, rel=1e-3)
        else:  # slowed down: the start is (almost) the farthest point
            assert abs(e["r0"] - e["aphelion"]) <= 1e-3 * r0, f
            assert e["aphelion"] == pytest.approx(r0, rel=1e-3)
    # the engine's own trajectories show the same: the extreme radii it actually reached
    for f in (0.90, 1.10):
        radii = [norm(rel_from_positions({k: tuple(v) for k, v in s["positionsM"].items()})) for s in runs[f]["samples"]]
        if f > 1.0:
            assert max(radii) == pytest.approx(el[f]["aphelion"], rel=1e-3)
        else:
            assert min(radii) == pytest.approx(el[f]["perihelion"], rel=1e-3)
    print("\n" + "\n".join(f"f = {f}: a = {el[f]['a'] / 1.495978707e11:.5f} au, e = {el[f]['e']:.5f}, P = {el[f]['period'] / DAY:.2f} d, "
                           f"peri = {el[f]['perihelion'] / 1.495978707e11:.4f} au, aph = {el[f]['aphelion'] / 1.495978707e11:.4f} au" for f in order))


@pytest.mark.parametrize("f", ALL)
def test_exp01_period_matches_vis_viva(lab, experiment, f):
    """Stepping the engine to exactly the analytic period 2 pi sqrt(a^3/mu) brings the planet back to its start: the
    engine's period agrees with the vis-viva period (an error delta in P would leave a displacement ~ 2 pi a delta)."""
    if f == 1.0:
        uid = experiment["baselineUniverseId"]
        eng = lab.registry.get(uid).engine
        eng.reset()
    else:
        run = lab.create_modified_run(experiment["id"], "body-earth", f, True)
        eng = lab.registry.get(run["modifiedUniverseId"]).engine
    r0, v0, mu = relative_initial(eng)
    el = elements(r0, v0, mu)
    whole = int(el["period"] // DAY)
    for _ in range(whole):
        eng.step(DAY)
    eng.step(el["period"] - whole * DAY)
    assert eng.snapshot().simulationTimeS == pytest.approx(el["period"], rel=1e-15)
    pos = {b.id: (b.positionM.x, b.positionM.y, b.positionM.z) for b in eng.snapshot().bodies}
    back = math.dist(rel_from_positions(pos), r0)
    implied = back / (2.0 * math.pi * el["a"])
    print(f"\nf = {f}: after exactly P = {el['period'] / DAY:.3f} d the planet is {back:.4g} m from its start; "
          f"implied relative period error {implied:.3g} (threshold 1e-6)")
    assert implied <= 1e-6
    if f == 1.0:
        eng.reset()


@pytest.mark.parametrize("f", ALL)
def test_exp01_energy_and_angular_momentum_drift(runs, f):
    worst_e, worst_l = runs[f]["drift"]
    print(f"\nf = {f}: worst relative drift over 730 d: K+U {worst_e:.3g}, |L| {worst_l:.3g} (threshold 1e-12)")
    assert worst_e <= 1e-12
    assert worst_l <= 1e-12


@pytest.mark.parametrize("f", ALL)
def test_exp01_sample_times_exact(runs, f):
    assert [s["simulationTimeS"] for s in runs[f]["samples"]] == [k * DAY for k in range(731)]


def test_exp01_identical_grids_in_every_run(runs):
    reference = [s["simulationTimeS"] for s in runs[1.0]["samples"]]
    for f in FACTORS:
        assert [s["simulationTimeS"] for s in runs[f]["samples"]] == reference


def test_exp01_modified_barycentre_motion_is_the_documented_consequence(lab, experiment):
    """Spec 4.2: changing the barycentre's velocity changes the total momentum, so the system barycentre of the modified
    run moves at about m/(M+m) x dv (about 9 mm/s for x1.10). A direct consequence of the single change, not a second one."""
    run = lab.create_modified_run(experiment["id"], "body-earth", 1.10, True)
    eng = lab.registry.get(run["modifiedUniverseId"]).engine
    d = eng.snapshot().diagnostics
    speed = norm((d.totalMomentumKgMPerS.x, d.totalMomentumKgMPerS.y, d.totalMomentumKgMPerS.z)) / d.totalMassKg
    print(f"\nx1.10: system barycentre speed {speed * 1e3:.3f} mm/s, over 730 d about {speed * 730 * DAY / 1e3:.0f} km (spec text says 0.6 km)")
    assert speed == pytest.approx(9.0e-3, rel=0.05)
    # 9 mm/s over 6.3e7 s is about 580 km. (The spec text says "about 0.6 km": that is a 1000x unit slip in the spec's
    # documentary note, reported in WORKLOG.md and the protocol; the physics and the 9 mm/s figure are unaffected.)
    assert 5.0e5 < speed * 730 * DAY < 6.5e5
    base = lab.registry.get(experiment["baselineUniverseId"]).engine.snapshot().diagnostics
    assert norm((base.totalMomentumKgMPerS.x, base.totalMomentumKgMPerS.y, base.totalMomentumKgMPerS.z)) <= 1e-12 * 1e30


def test_exp01_velocity_change_is_the_only_initial_difference(lab, experiment):
    for f in FACTORS:
        lab.create_modified_run(experiment["id"], "body-earth", f, True)
        d = lab.initial_differences(experiment["id"])
        assert [x["field"] for x in d["differences"]] == ["velocityMPerS"] and d["configEqual"] is True
        v, w = d["differences"][0]["baseline"], d["differences"][0]["modified"]
        assert tuple(w) == tuple(f * c for c in v)
        angle = norm(cross(tuple(v), tuple(w))) / (norm(tuple(v)) * norm(tuple(w)))
        assert angle <= 1e-15


def test_exp01_repeatability_in_one_process(lab):
    a = lab.create_experiment(SYSTEM)  # a second experiment: separate universes, same inputs
    b = lab.create_experiment(SYSTEM)
    assert a["initialState"]["digest"] == b["initialState"]["digest"]
    traj = []
    for exp in (a, b):
        run = lab.create_modified_run(exp["id"], "body-earth", 1.05, False)
        eng = lab.registry.get(run["modifiedUniverseId"]).engine
        for _ in range(120):
            eng.step(DAY)
        traj.append(eng.history.page(None, 0, None, 5000)["samples"])
    assert traj[0] == traj[1]
