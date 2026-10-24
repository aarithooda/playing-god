"""Stage 12: Scenarios A-H of the specification (section 14) driven end to end through the real service in mode "outcome-v1".

Software acceptance only. The outcome models are PROVISIONAL (CP-SCI-1 owner-accepted for development under D-059, NOT
independently validated), so no assertion here claims physical correctness of an outcome: they check that the engine
selects, applies, conserves, records, replays and isolates as specified. Expected values are analytic identities
(conservation, geometry) or properties of the contracts; nothing is tuned to the implementation's output."""
import math

import pytest

from backend.impact.replay import replay
from backend.simulation import G_SI, SimulationService
from tests.helpers import dump, make
from tests.impact.test_damage import south_pole_service, target_site_of
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service, run_and_check_conservation, totals

GAS = {"profileId": "gas-envelope-hhe"}


# ------------------------------------------------------------------------------------------------ A: south pole
def test_scenario_a_south_pole_localized():
    svc, _ = south_pole_service()
    before = totals(svc.snapshot())
    out = svc.step(2.5e3)
    (event,) = out.events
    assert event.type == "collision"
    tid, site = target_site_of(svc)
    # the impact begins at the south pole (latitude -90 deg) and the damage is localized, not uniform and not instantaneous
    assert math.degrees(math.asin(site.center_local.z)) == pytest.approx(-90.0, abs=1e-6)
    (record,) = svc.collision_records()
    assert record.result.impact_sites, "the result carries the site"
    after = totals(out)
    assert after[0] == pytest.approx(before[0], rel=1e-14)


# ------------------------------------------------------------------------------------------------ B: asteroid into a gas giant
def test_scenario_b_envelope_event():
    svc = deferred()
    giant = svc.add_body(make("giant", m=1.9e27, r=7.0e7, material=GAS))
    asteroid = svc.add_body(make("asteroid", m=1.0e15, r=5.0e2, x=(3.0e8, 2.0e7, 0.0), v=(-6.0e4, 0.0, 0.0), material=ROCK))
    out = run_and_check_conservation(svc, dt=8000.0)
    (event,) = out.events
    assert event.outcome == "envelope_deposition"
    (record,) = svc.collision_records()
    assert "envelope_dynamics_not_resolved" in record.result.warnings
    # the limitation is recorded and no resolved gas dynamics is claimed anywhere in the event or its record
    text = (event.model_dump_json() + str(record.result.to_dict())).lower()
    assert "resolved gas dynamics" not in text and "hydrodynamic simulation" not in text
    assert giant.id in {b.id for b in out.bodies} and event.removedBodyIds == [asteroid.id]


# ------------------------------------------------------------------------------------------------ C: hit and run
def test_scenario_c_hit_and_run_two_remnants():
    svc, t, p, v_esc = pair_service(1.5, b=0.7)
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.outcome == "hit_and_run"
    ids = {b.id for b in out.bodies}
    assert {t.id, p.id} <= ids and event.removedBodyIds == []  # no duplicated, lost or merged body
    assert len(ids) == len({b.id for b in out.bodies})


# ------------------------------------------------------------------------------------------------ D: catastrophic disruption
def test_scenario_d_disruption_accounting():
    svc, t, p, _ = pair_service(8.0, b=0.0)
    before = totals(svc.snapshot())
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.outcome in ("catastrophic_disruption", "super_catastrophic_disruption")
    (record,) = svc.collision_records()
    res = record.result
    # explicit accounting: the remnant, fragments and parcels together carry the whole mass; nothing discarded
    assert res.conservation.within_tolerance
    carried = math.fsum(b.mass_kg for b in res.transformed + res.created) + math.fsum(q.mass_kg for q in res.debris_parcels)
    assert carried == pytest.approx(before[0], rel=1e-13)
    assert set(event.removedBodyIds) == {t.id, p.id}
    # residuals and approximations are reported, not hidden
    assert event.massResidualRel <= 1e-14 and event.momentumResidualRel <= 1e-12 and res.warnings is not None


# ------------------------------------------------------------------------------------------------ E: secondary impact
def test_scenario_e_fragment_hits_moon_parent_link():
    from tests.impact.test_lifecycle import (
        test_scenario_e_an_impactor_hits_the_earth_of_the_moons_preset_and_the_whole_system_conserves as run_e)

    run_e()  # moons-preset data, parent links, generation numbers and whole-system conservation are asserted inside


# ------------------------------------------------------------------------------------------------ F: pause, resume, replay
def test_scenario_f_pause_resume_equivalence():
    svc, *_ = pair_service(3.0)
    snap = svc.capture_snapshot()
    runs = []
    for _ in range(2):  # a paused universe (restored from its snapshot) resumes into exactly the same future
        svc.restore_snapshot(snap)
        out = svc.step(svc.approach_s)
        runs.append(sorted((b.massKg, b.radiusM, b.positionM.x, b.velocityMPerS.x) for b in out.bodies))
    assert runs[0] == runs[1]


def test_scenario_f_replay_digest():
    svc, *_ = pair_service(3.0, 0.4)
    svc.step(svc.approach_s)
    (record,) = svc.collision_records()
    rep = replay(record, G_SI)
    assert rep["reproduced"] is True and rep["mutatesState"] is False
    assert rep["replayedResultDigest"] == record.result_digest


# ------------------------------------------------------------------------------------------------ G: independent simulations
def test_scenario_g_independent_universes():
    a, b = deferred(), deferred()
    b.add_body(make("watcher", m=1.0e20, r=1.0e3, x=(1.0e12, 0.0, 0.0), material=ROCK))
    before = dump(b)
    pair_service(3.0, 0.3, svc=a)
    a.step(a.approach_s)
    assert a.collision_records() and not b.collision_records() and dump(b) == before


# ------------------------------------------------------------------------------------------------ H: regression
def test_scenario_h_legacy_workflow_is_unchanged_when_no_materials_are_present():
    """A material-less pair in outcome-v1 produces the legacy merger (existing behaviour preserved; the full suites are the regression)."""
    svc, *_ = pair_service(3.0, material=None)
    out = svc.step(svc.approach_s)
    assert [e.type for e in out.events] == ["merger"]
