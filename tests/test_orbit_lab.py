"""Orbit Lab (Experiment 01) at the service level: system data, baseline/modified runs, isolation and comparison."""
import json
import math
import re
from pathlib import Path

import pytest

from backend import orbit_lab
from backend.errors import CodedError
from backend.models import BodyUpdate
from backend.presets import loader
from backend.simulation import SimulationService
from tests.helpers import DAY, dump, make

G = 6.67430e-11
SRC = Path(loader.SOURCES_DIR) / "horizons"
FACTORS = [0.90, 0.95, 1.05, 1.10]


@pytest.fixture
def lab(registry):
    return orbit_lab.OrbitLab(registry)


def raw(target: str) -> list[float]:
    text = (SRC / f"{target}_2451545.0.txt").read_text(encoding="utf-8")
    m = re.search(r"\$\$SOE\s*\n(.*?)\n\$\$EOE", text, re.S)
    return [float(c) * 1000.0 for c in m.group(1).split(",")[2:8]]


def bodies_of(engine):
    return {b.id: b for b in engine.snapshot().bodies}


def advance(engine, days, registry=None, uid=None):
    for _ in range(int(days)):
        engine.step(DAY)


def test_exp01_system_bodies_and_sources(lab):
    (system,) = lab.list_systems()
    assert system["id"] == "exp01-sun-emb-j2000"
    assert system["bodyIds"] == ["body-sun", "body-earth"] and system["selectableBodyIds"] == ["body-earth"]
    assert system["speedFactors"] == FACTORS
    assert system["observationWindowS"] == 63072000.0 == 730 * DAY
    assert system["historyMode"] == "grid" and system["sampleIntervalS"] == DAY
    assert system["presetId"] == "solar-system-j2000"
    assert "Two-body" in system["modelNote"] and "not a forecast" in system["modelNote"]
    # the system is read from the committed file, not from code
    on_disk = json.loads((Path(orbit_lab.__file__).parent / "orbit_lab_systems.json").read_text(encoding="utf-8"))
    assert [s["id"] for s in on_disk["systems"]] == ["exp01-sun-emb-j2000"]


def test_exp01_initial_state_from_horizons_exact(lab):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    b = bodies_of(lab.registry.get(exp["baselineUniverseId"]).engine)
    assert list(b) == ["body-sun", "body-earth"]
    sun, emb = raw("10"), raw("3")
    rel_pos = [emb[k] - sun[k] for k in range(3)]
    rel_vel = [emb[3 + k] - sun[3 + k] for k in range(3)]
    got_pos = [b["body-earth"].positionM.x - b["body-sun"].positionM.x, b["body-earth"].positionM.y - b["body-sun"].positionM.y, b["body-earth"].positionM.z - b["body-sun"].positionM.z]
    got_vel = [b["body-earth"].velocityMPerS.x - b["body-sun"].velocityMPerS.x, b["body-earth"].velocityMPerS.y - b["body-sun"].velocityMPerS.y, b["body-earth"].velocityMPerS.z - b["body-sun"].velocityMPerS.z]
    assert got_pos == pytest.approx(rel_pos, rel=1e-12, abs=1e-3)
    assert got_vel == pytest.approx(rel_vel, rel=1e-12, abs=1e-9)
    # masses reproduce the DE440 GM values exactly (GM = m G)
    assert b["body-sun"].massKg * G == pytest.approx(1.32712440041279419e20, rel=1e-15)
    assert b["body-earth"].massKg * G == pytest.approx((398600.435507 + 4902.800118) * 1e9, rel=1e-15)
    assert b["body-earth"].name.startswith("Earth") and "barycentre" in b["body-earth"].name


def test_exp01_two_body_barycentre_zero_momentum(lab):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    bs = list(bodies_of(lab.registry.get(exp["baselineUniverseId"]).engine).values())
    m = sum(x.massKg for x in bs)
    mom = [math.fsum(x.massKg * getattr(x.velocityMPerS, a) for x in bs) for a in "xyz"]
    com = [math.fsum(x.massKg * getattr(x.positionM, a) for x in bs) / m for a in "xyz"]
    scale = math.fsum(x.massKg * math.hypot(x.velocityMPerS.x, x.velocityMPerS.y, x.velocityMPerS.z) for x in bs)
    assert math.hypot(*mom) <= 1e-12 * scale
    assert math.hypot(*com) <= 1e-12 * 1.5e11


def test_baseline_is_a_grid_run_activated_with_sample_zero(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    u = registry.get(exp["baselineUniverseId"])
    assert u.role == "baseline" and u.experiment_id == exp["id"] and registry.active_id == u.id
    assert u.engine.history_mode == "grid" and u.engine.history.sample_interval_s == DAY
    assert u.engine.history.page(None, 0, None, 10)["nextIndex"] == 1
    assert exp["modifiedUniverseId"] is None
    assert exp["initialState"]["digest"] == u.engine.initial_state_digest
    assert exp["initialState"]["epoch"] == "J2000.0"


@pytest.mark.parametrize("f", FACTORS)
def test_speed_factor_preserves_direction(lab, f):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", f, False)
    base = bodies_of(lab.registry.get(exp["baselineUniverseId"]).engine)["body-earth"].velocityMPerS
    mod = bodies_of(lab.registry.get(run["modifiedUniverseId"]).engine)["body-earth"].velocityMPerS
    assert (mod.x, mod.y, mod.z) == (f * base.x, f * base.y, f * base.z)  # floating-point exact product
    dot = base.x * mod.x + base.y * mod.y + base.z * mod.z
    cos = dot / (math.hypot(base.x, base.y, base.z) * math.hypot(mod.x, mod.y, mod.z))
    assert math.acos(min(1.0, cos)) <= 1e-7  # acos near 1 is coarse; the exact-product check above is the strict one
    cross = (base.y * mod.z - base.z * mod.y, base.z * mod.x - base.x * mod.z, base.x * mod.y - base.y * mod.x)
    assert math.hypot(*cross) / (math.hypot(base.x, base.y, base.z) * math.hypot(mod.x, mod.y, mod.z)) <= 1e-15
    prov = run["modification"]
    assert prov["bodyId"] == "body-earth" and prov["speedFactor"] == f
    assert prov["originalVelocityMPerS"] == [base.x, base.y, base.z] and prov["modifiedVelocityMPerS"] == [mod.x, mod.y, mod.z]
    assert prov["baselineUniverseId"] == exp["baselineUniverseId"] and prov["units"] == "m/s"
    assert prov["baselineInitialDigest"] == exp["initialState"]["digest"]


def test_modified_derived_from_initial_not_current(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    base = registry.get(exp["baselineUniverseId"]).engine
    advance(base, 100)  # the baseline has moved on by 100 days
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    mod = registry.get(run["modifiedUniverseId"]).engine
    assert mod.snapshot().simulationTimeS == 0.0
    fresh = lab.create_experiment("exp01-sun-emb-j2000")
    expected = bodies_of(registry.get(fresh["baselineUniverseId"]).engine)["body-earth"].positionM
    assert bodies_of(mod)["body-earth"].positionM == expected  # the initial position, not the 100-day one
    assert base.snapshot().simulationTimeS == 100 * DAY  # and the baseline kept its progress


def test_initial_differences_only_selected_velocity(lab):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    lab.create_modified_run(exp["id"], "body-earth", 1.05, False)
    d = lab.initial_differences(exp["id"])
    assert d["configEqual"] is True
    assert len(d["differences"]) == 1
    (diff,) = d["differences"]
    assert diff["bodyId"] == "body-earth" and diff["field"] == "velocityMPerS"
    assert diff["modified"] == pytest.approx([1.05 * v for v in diff["baseline"]], rel=1e-15)


def test_initial_differences_detects_a_second_difference(lab, registry):
    """The check must be able to fail: change a mass in the modified run's initial state and it must show up."""
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.05, False)
    mod = registry.get(run["modifiedUniverseId"]).engine
    mod._initial.sim.particles[0].m *= 1.0000001  # tamper with the private initial copy
    mod._initial.digest = "tampered"
    d = lab.initial_differences(exp["id"])
    assert {x["field"] for x in d["differences"]} >= {"velocityMPerS", "massKg"}


def test_sample_grids_identical(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 0.95, False)
    b, m = registry.get(exp["baselineUniverseId"]).engine, registry.get(run["modifiedUniverseId"]).engine
    advance(b, 12)
    advance(m, 12)
    tb = [s["simulationTimeS"] for s in b.history.page(None, 0, None, 100)["samples"]]
    tm = [s["simulationTimeS"] for s in m.history.page(None, 0, None, 100)["samples"]]
    assert tb == tm == [k * DAY for k in range(13)]


def test_comparison_common_grid_and_separation(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    b, m = registry.get(exp["baselineUniverseId"]).engine, registry.get(run["modifiedUniverseId"]).engine
    advance(b, 10)
    advance(m, 6)  # the runs are at different simulation times
    c = lab.comparison(exp["id"], "body-earth")
    assert c["commonSampleCount"] == 7 and c["timesS"] == [k * DAY for k in range(7)]
    assert c["baseline"]["simulationTimeS"] == 10 * DAY and c["modified"]["simulationTimeS"] == 6 * DAY
    assert c["timesDiffer"] is True and c["comparedUpToS"] == 6 * DAY
    assert c["separationM"][0] == 0.0 or c["separationM"][0] < 1e-6  # same initial state at t = 0
    for k in range(7):
        bp, mp = c["baselinePositionM"][k], c["modifiedPositionM"][k]
        assert c["separationM"][k] == pytest.approx(math.dist(bp, mp), rel=1e-15)
    assert c["separationM"][6] > 1e7  # +10 % speed for six days: tens of thousands of km
    assert all(c["separationM"][i] <= c["separationM"][i + 1] for i in range(6))  # grows monotonically early on
    assert c["controlled"] is True and c["modification"]["speedFactor"] == 1.10


def test_comparison_incomplete_reported(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    # no modified run yet
    none = lab.comparison(exp["id"], "body-earth")
    assert none["complete"] is False and any("no modified run" in i for i in none["issues"])
    assert none["commonSampleCount"] == 0 and none["timesS"] == []
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    # modified not advanced
    fresh = lab.comparison(exp["id"], "body-earth")
    assert fresh["complete"] is False and fresh["commonSampleCount"] == 1
    assert any("not advanced" in i for i in fresh["issues"])
    b = registry.get(exp["baselineUniverseId"]).engine
    m = registry.get(run["modifiedUniverseId"]).engine
    advance(b, 5)
    advance(m, 5)
    partial = lab.comparison(exp["id"], "body-earth")
    assert partial["windowCompleteBoth"] is False and partial["complete"] is False and partial["commonSampleCount"] == 6
    assert partial["issues"] == []  # incomplete only because the window is not reached yet, which is not an error
    with pytest.raises(CodedError) as e:
        lab.comparison(exp["id"], "body-nobody")
    assert e.value.status == 422


def test_window_complete_after_730_days(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 0.90, False)
    for uid in (exp["baselineUniverseId"], run["modifiedUniverseId"]):
        advance(registry.get(uid).engine, 730)
    c = lab.comparison(exp["id"], "body-earth")
    assert c["commonSampleCount"] == 731 and c["windowCompleteBoth"] is True and c["complete"] is True
    assert c["observationWindowS"] == 63072000.0 and c["sampleIntervalS"] == DAY
    assert c["timesS"][-1] == 730 * DAY


def test_comparison_flags_uncontrolled_modified_run(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    m = registry.get(run["modifiedUniverseId"]).engine
    advance(m, 3)
    m.update_body("body-earth", BodyUpdate(massKg=6.0e24))
    c = lab.comparison(exp["id"], "body-earth")
    assert c["controlled"] is False and c["firstUncontrolledAtS"] == 3 * DAY
    assert any("uncontrolled since" in i for i in c["issues"])


def test_modified_edit_marks_uncontrolled_and_reset_restores_controlled(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    m = registry.get(run["modifiedUniverseId"]).engine
    assert m.audit_edits is True and m.controlled is True
    advance(m, 2)
    m.update_body("body-earth", BodyUpdate(massKg=6.0e24))
    assert m.controlled is False and m.first_uncontrolled_at_s == 2 * DAY
    m.reset()
    assert m.controlled is True and len(m.audit) == 1 and m.audit[0]["changes"]["massKg"][1] == 6.0e24


def test_cosmetic_edit_keeps_controlled(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    m = registry.get(run["modifiedUniverseId"]).engine
    m.update_body("body-earth", BodyUpdate(name="Home", colorHex="#00ff00"))
    assert m.controlled is True and m.audit[-1]["physical"] is False


def test_baseline_engine_does_not_audit(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    assert registry.get(exp["baselineUniverseId"]).engine.audit_edits is False


def test_modified_ops_leave_baseline_bitwise(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    b = registry.get(exp["baselineUniverseId"]).engine
    m = registry.get(run["modifiedUniverseId"]).engine
    advance(b, 20)
    before = dump(b) + repr(b.history.page(None, 0, None, 5000)["samples"])
    advance(m, 30)
    m.update_body("body-earth", BodyUpdate(massKg=1.0e25))
    m.add_body(make("Probe", x=(5e11, 0, 0)))
    snap = m.capture_snapshot()
    advance(m, 5)
    m.restore_snapshot(snap)
    m.reset()
    assert dump(b) + repr(b.history.page(None, 0, None, 5000)["samples"]) == before


def test_reset_modified_only(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    b = registry.get(exp["baselineUniverseId"]).engine
    m = registry.get(run["modifiedUniverseId"]).engine
    advance(b, 9)
    advance(m, 9)
    m_initial = dump(SimulationService.from_snapshot(m.initial_snapshot, history_mode="grid", sample_interval_s=DAY))
    baseline_before = dump(b)
    m.reset()
    assert m.snapshot().simulationTimeS == 0.0 and b.snapshot().simulationTimeS == 9 * DAY
    assert dump(b) == baseline_before
    assert m.snapshot().bodies[1].velocityMPerS.model_dump() == bodies_of(SimulationService.from_snapshot(m.initial_snapshot, history_mode="grid", sample_interval_s=DAY))["body-earth"].velocityMPerS.model_dump()
    assert m_initial  # the derived initial state was reconstructible


@pytest.mark.parametrize("factor", [0.5, 1.0, 1.1000001, 1e9, 0.0, -1.05, float("nan")])
def test_disallowed_factor_rejected_without_change(lab, registry, factor):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    before = [dump(u.engine) for u in registry.list()]
    count = len(registry.list())
    with pytest.raises(CodedError) as e:
        lab.create_modified_run(exp["id"], "body-earth", factor, False)
    assert e.value.status == 422
    assert len(registry.list()) == count and [dump(u.engine) for u in registry.list()] == before
    assert lab.get(exp["id"])["modifiedUniverseId"] is None


@pytest.mark.parametrize("body_id", ["body-sun", "body-mars", "nobody", ""])
def test_disallowed_body_rejected_without_change(lab, registry, body_id):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    count = len(registry.list())
    with pytest.raises(CodedError) as e:
        lab.create_modified_run(exp["id"], body_id, 1.10, False)
    assert e.value.status == 422 and len(registry.list()) == count


def test_unknown_system_and_experiment(lab):
    with pytest.raises(CodedError) as e:
        lab.create_experiment("exp99")
    assert e.value.status == 404 and e.value.code == "system_not_found"
    with pytest.raises(CodedError) as e2:
        lab.get("exp-nope")
    assert e2.value.status == 404 and e2.value.code == "experiment_not_found"


def test_replace_modified_requires_flag_and_inactive(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    first = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    with pytest.raises(CodedError) as e:
        lab.create_modified_run(exp["id"], "body-earth", 0.90, False)
    assert e.value.status == 409 and e.value.code == "modified_run_exists"
    assert lab.get(exp["id"])["modifiedUniverseId"] == first["modifiedUniverseId"]
    registry.activate(first["modifiedUniverseId"])  # the run to be replaced is active
    with pytest.raises(CodedError) as e2:
        lab.create_modified_run(exp["id"], "body-earth", 0.90, True)
    assert e2.value.status == 409 and e2.value.code == "experiment_has_active_run"
    assert lab.get(exp["id"])["modifiedUniverseId"] == first["modifiedUniverseId"]  # untouched
    registry.activate(exp["baselineUniverseId"])
    second = lab.create_modified_run(exp["id"], "body-earth", 0.90, True)
    assert second["modifiedUniverseId"] != first["modifiedUniverseId"]
    assert second["modification"]["speedFactor"] == 0.90
    with pytest.raises(CodedError) as e3:
        registry.get(first["modifiedUniverseId"])
    assert e3.value.status == 404


def test_delete_experiment_with_active_run_rejected(lab, registry):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    with pytest.raises(CodedError) as e:
        lab.delete(exp["id"])  # the baseline is the active universe
    assert e.value.status == 409 and e.value.code == "experiment_has_active_run"
    registry.activate("uni-default")
    lab.delete(exp["id"])
    assert [u.id for u in registry.list()] == ["uni-default"]
    with pytest.raises(CodedError):
        lab.get(exp["id"])


def test_experiment_creation_fails_cleanly_on_bad_preset(lab, registry, tmp_path, monkeypatch):
    import shutil
    shutil.copytree(loader.DATA_DIR, tmp_path / "data")
    shutil.copytree(loader.SOURCES_DIR, tmp_path / "sources")
    (tmp_path / "data" / "solar-system-j2000.json").write_text("{broken", encoding="utf-8")
    monkeypatch.setattr(loader, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(loader, "SOURCES_DIR", tmp_path / "sources")
    with pytest.raises(CodedError) as e:
        lab.create_experiment("exp01-sun-emb-j2000")
    assert e.value.status == 500 and e.value.code == "preset_invalid"
    assert [u.id for u in registry.list()] == ["uni-default"] and registry.active_id == "uni-default"
    assert lab.list_experiments() == []


def test_universe_limit_leaves_no_half_made_experiment(lab, registry):
    for i in range(7):
        registry.create(f"u{i}")
    with pytest.raises(CodedError) as e:
        lab.create_experiment("exp01-sun-emb-j2000")
    assert e.value.code == "universe_limit"
    assert lab.list_experiments() == []


def test_experiment_repeatable_digests(lab, registry):
    a = lab.create_experiment("exp01-sun-emb-j2000")
    ma = lab.create_modified_run(a["id"], "body-earth", 1.10, False)
    b = lab.create_experiment("exp01-sun-emb-j2000")
    mb = lab.create_modified_run(b["id"], "body-earth", 1.10, False)
    assert a["initialState"]["digest"] == b["initialState"]["digest"]
    assert registry.get(ma["modifiedUniverseId"]).engine.initial_state_digest == registry.get(mb["modifiedUniverseId"]).engine.initial_state_digest
    assert registry.get(ma["modifiedUniverseId"]).engine.initial_state_digest != a["initialState"]["digest"]


def test_experiment_bitwise_repeatable_trajectories(lab, registry):
    runs = []
    for _ in range(2):
        exp = lab.create_experiment("exp01-sun-emb-j2000")
        run = lab.create_modified_run(exp["id"], "body-earth", 1.05, False)
        for uid in (exp["baselineUniverseId"], run["modifiedUniverseId"]):
            advance(registry.get(uid).engine, 60)
        runs.append([registry.get(uid).engine.history.page(None, 0, None, 5000)["samples"] for uid in (exp["baselineUniverseId"], run["modifiedUniverseId"])])
    assert runs[0] == runs[1]  # same process, same inputs: identical samples, bit for bit


def test_only_one_modification_kind(lab):
    exp = lab.create_experiment("exp01-sun-emb-j2000")
    run = lab.create_modified_run(exp["id"], "body-earth", 1.10, False)
    d = lab.initial_differences(exp["id"])
    assert [x["field"] for x in d["differences"]] == ["velocityMPerS"]
    assert set(run["modification"]) == {"baselineUniverseId", "baselineInitialDigest", "bodyId", "originalVelocityMPerS", "modifiedVelocityMPerS", "speedFactor", "units", "createdAtIso"}
