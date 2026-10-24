"""Stage 4a: collision outcomes through the real service in mode "outcome-v1" (selector -> realiser -> validator -> applier -> events).
Scenarios are built as free-space pairs whose impact speed and parameter are set from the gravitational approach, and every claim is a
whole-system claim (diagnostics before and after the step), not only the event's own report. Scientific content PROVISIONAL (D-038)."""
import dataclasses
import json
import math
import random

import pytest

import backend.impact.engine as engine_module
from backend.errors import CodedError
from backend.impact.applier import realise as real_realise
from backend.impact.config import CollisionConfig
from backend.models import EventList, StepResponse
from backend.simulation import G_SI, LEGACY_MERGE_CONFIG, SimulationFailure, SimulationService
from tests.helpers import dump, make
from tests.impact import legacy_scenarios as ls
from tests.impact.scenarios import G

ROCK = {"profileId": "silicate-rock"}


def deferred(**config) -> SimulationService:
    return SimulationService(CollisionConfig(mode="outcome-v1", **config))


def pair_service(x, b=0.0, m_t=1.0e22, m_p=5.0e21, r_t=1.0e6, material=ROCK, svc=None, spin=None):
    """Target at rest, projectile approaching so that the contact speed is x * v_esc and the contact impact parameter is b (free space:
    the start speed follows from energy conservation, the offset from angular momentum conservation)."""
    svc = svc or deferred()
    r_p = r_t * (m_p / m_t) ** (1 / 3)
    big_r = r_t + r_p
    v_esc = math.sqrt(2 * G * (m_t + m_p) / big_r)
    d0 = 4.0 * big_r
    v_c = x * v_esc
    v_start_sq = v_c ** 2 - 2 * G * (m_t + m_p) * (1 / big_r - 1 / d0)
    assert v_start_sq > 0, "choose x >= 0.9 for this start distance"
    v_start = math.sqrt(v_start_sq)
    offset = b * big_r * v_c / v_start
    svc.approach_s = 1.5 * d0 / (0.5 * (v_start + v_c))  # long enough to reach contact and move on a little
    extra = {} if material is None else {"material": material}
    t = svc.add_body(make("target", m=m_t, r=r_t, **extra, **({} if spin is None else {"spinRadPerS": spin})))
    p = svc.add_body(make("projectile", m=m_p, r=r_p, x=(d0, offset, 0.0), v=(-v_start, 0.0, 0.0), **extra))
    return svc, t, p, v_esc


def totals(state):
    d = state.diagnostics
    p = (d.totalMomentumKgMPerS.x, d.totalMomentumKgMPerS.y, d.totalMomentumKgMPerS.z)
    l_orb = (d.angularMomentumAboutOriginKgM2PerS.x, d.angularMomentumAboutOriginKgM2PerS.y, d.angularMomentumAboutOriginKgM2PerS.z)
    booked = (d.bookedSpinKgM2PerS.x, d.bookedSpinKgM2PerS.y, d.bookedSpinKgM2PerS.z)
    spin = (0.0, 0.0, 0.0) if d.spinAngularMomentumKgM2PerS is None else (
        d.spinAngularMomentumKgM2PerS.x, d.spinAngularMomentumKgM2PerS.y, d.spinAngularMomentumKgM2PerS.z)
    l_total = tuple(a + b + c for a, b, c in zip(l_orb, booked, spin))
    return d.totalMassKg, p, l_total


def run_and_check_conservation(svc, dt=None):
    dt = dt or svc.approach_s
    before = totals(svc.snapshot())
    p_scale = sum(b.massKg * math.sqrt(b.velocityMPerS.x ** 2 + b.velocityMPerS.y ** 2 + b.velocityMPerS.z ** 2) for b in svc.snapshot().bodies)
    out = svc.step(dt)
    after = totals(out)
    assert after[0] == pytest.approx(before[0], rel=1e-14)
    assert math.dist(after[1], before[1]) <= 1e-11 * p_scale
    l_scale = max(math.sqrt(sum(c * c for c in before[2])), 1.0)
    assert math.dist(after[2], before[2]) <= 1e-8 * l_scale + 1e-3 * 0, (after[2], before[2])
    return out


# ------------------------------------------------------------------------------------------------ each outcome through the service
@pytest.mark.parametrize("x,b", [(0.9, 0.0), (1.3, 0.0), (3.0, 0.0), (8.0, 0.0), (2.0, 0.4), (5.0, 0.6)])
def test_free_space_collisions_are_resolved_and_conserved_system_wide(x, b):
    svc, t, p, _ = pair_service(x, b)
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.type == "collision"
    (record,) = svc.collision_records()
    assert record.outcome_spec.outcome == event.outcome and record.result is not None and record.result.conservation.within_tolerance
    assert record.result_digest == record.result.result_digest == record.result.compute_digest()
    assert event.massResidualRel <= 1e-14 and event.momentumResidualRel <= 1e-12
    ids = {bd.id for bd in out.bodies}
    assert set(event.survivingBodyIds + event.createdBodyIds) == ids and not (set(event.removedBodyIds) & ids)
    assert event.id == "col-1" and record.event_id == "col-1"
    # identity table (plan 3.7)
    if event.outcome in ("catastrophic_disruption", "super_catastrophic_disruption"):
        assert set(event.removedBodyIds) == {t.id, p.id} and any(i.startswith("rem-1-") for i in ids)
    elif event.outcome == "hit_and_run":
        assert {t.id, p.id} <= ids and event.removedBodyIds == []  # both identities continue
    else:
        assert t.id in ids and event.removedBodyIds == [p.id]


def test_event_numbers_identity_and_body_json_of_the_products():
    svc, t, p, _ = pair_service(8.0)
    out = svc.step(svc.approach_s)
    (event,) = out.events
    by_id = {b.id: b for b in out.bodies}
    parcel = next(b for b in out.bodies if b.id.startswith("debris-"))
    j = json.loads(parcel.model_dump_json())
    assert j["representation"] == "debris-parcel" and j["originEventId"] == "col-1" and j["debris"]["sampleSeed"] >= 0
    assert j["debris"]["sizeDistribution"] is None and j["debris"]["totalMassKg"] == parcel.massKg and parcel.bodyType == "asteroid"
    rem = next(b for b in out.bodies if b.id.startswith("rem-"))
    rj = json.loads(rem.model_dump_json())
    assert rj["originEventId"] == "col-1" and "representation" not in rj and rem.name.endswith("remnant")
    # ordinary bodies keep exactly the old shape
    plain = svc.add_body(make("plain", m=1e20, r=10.0, x=(1e12, 0, 0)))
    assert "originEventId" not in json.loads(plain.model_dump_json())


def test_the_collision_event_round_trips_through_the_api_models():
    svc, *_ = pair_service(3.0)
    out = svc.step(svc.approach_s)
    listing = EventList(events=svc.events())
    again = EventList.model_validate_json(listing.model_dump_json())
    assert again == listing and json.loads(listing.model_dump_json())["events"][0]["type"] == "collision"
    step = StepResponse.model_validate_json(out.model_dump_json())
    assert step.events[0].type == "collision" and step.events[0].id == "col-1"


def test_merger_and_collision_events_share_one_counter_and_never_collide():
    svc = deferred()
    pair_service(3.0, svc=svc)  # material pair -> collision event col-1
    svc.add_body(make("plain-a", m=1e12, r=10.0, x=(1e12, 0, 0), v=(5, 0, 0)))
    svc.add_body(make("plain-b", m=1e12, r=10.0, x=(1e12 + 100.0, 0, 0), v=(-5, 0, 0)))
    svc.step(svc.approach_s)
    ids = [e.id for e in svc.events()]
    assert sorted(ids) == ["col-2", "evt-1"] or sorted(ids) == ["col-1", "evt-2"]  # one counter for both kinds, in detection order
    assert len(set(i.split("-")[1] for i in ids)) == 2 and {i.split("-")[0] for i in ids} == {"col", "evt"}


def test_a_pair_without_materials_in_outcome_v1_keeps_the_legacy_merger_and_the_label_only_in_the_record():
    svc, *_ = pair_service(3.0, material=None)
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert event.type == "merger" and not hasattr(event, "outcome") and "material_unspecified" not in json.dumps(event.model_dump())
    (record,) = svc.collision_records()
    assert "material_unspecified" in record.warnings and record.result is None and record.outcome_spec.outcome == "legacy_merge"
    assert svc._rotations == {} and svc._materials == {} and svc._products == {}


def test_mode_legacy_merge_never_emits_collision_events_even_with_materials():
    svc, *_ = pair_service(3.0, svc=SimulationService(LEGACY_MERGE_CONFIG))
    out = svc.step(svc.approach_s)
    assert [e.type for e in out.events] == ["merger"] and svc.collision_records() == []


# ------------------------------------------------------------------------------------------------ hit-and-run
def test_hit_and_run_continues_for_many_steps_with_no_spurious_contact_and_no_loss():
    svc, t, p, _ = pair_service(1.5, b=0.7, m_t=1.0e24, m_p=1.0e23, r_t=2.0e6)
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.outcome == "hit_and_run", event.outcome
    assert sorted(event.survivingBodyIds) == sorted([t.id, p.id]) and event.removedBodyIds == []
    mass0 = out.diagnostics.totalMassKg
    sep = []
    for _ in range(60):
        out = svc.step(5.0e3)
        assert out.events == []  # one physical contact -> one event; the separated remnants do not re-trigger
        bodies = {b.id: b for b in out.bodies}
        sep.append(math.dist((bodies[t.id].positionM.x, bodies[t.id].positionM.y, bodies[t.id].positionM.z),
                             (bodies[p.id].positionM.x, bodies[p.id].positionM.y, bodies[p.id].positionM.z)))
    assert out.diagnostics.totalMassKg == pytest.approx(mass0, rel=1e-14)
    assert sep[-1] > sep[0]  # they move apart


def test_hit_and_run_around_a_star_survives_ten_orbits():
    star_mass, a = 1.98847e30, 1.495978707e11
    v_orbit = math.sqrt(G * star_mass / a)
    period = 2 * math.pi * math.sqrt(a ** 3 / (G * star_mass))
    svc = deferred()
    svc.add_body(make("sun", m=star_mass, r=6.9634e8))
    m_t, m_p, r_t = 1.0e24, 1.0e23, 2.0e6
    r_p = r_t * 0.1 ** (1 / 3)
    big_r = r_t + r_p
    v_esc = math.sqrt(2 * G * (m_t + m_p) / big_r)
    d0 = 4.0 * big_r
    v_c = 1.5 * v_esc
    v_start = math.sqrt(v_c ** 2 - 2 * G * (m_t + m_p) * (1 / big_r - 1 / d0))
    offset = 0.7 * big_r * v_c / v_start
    t = svc.add_body(make("target", m=m_t, r=r_t, x=(a, 0, 0), v=(0, v_orbit, 0), material=ROCK))
    p = svc.add_body(make("projectile", m=m_p, r=r_p, x=(a + d0, offset, 0), v=(-v_start, v_orbit, 0), material=ROCK))
    out = svc.step(3.0e3)
    assert [e.type for e in out.events] == ["collision"] and out.events[0].outcome == "hit_and_run"
    before = out.diagnostics.totalMassKg
    done, events = 0.0, []
    while done < 10 * period:
        out = svc.step(5.0e6)
        done += out.advancedS
        events += out.events
    assert out.diagnostics.totalMassKg == pytest.approx(before, rel=1e-13)
    assert events == [], [e.id for e in events]  # no spurious contact in ten orbits


# ------------------------------------------------------------------------------------------------ failures: fallback and rollback
def test_an_invalid_result_is_not_applied_and_the_labelled_fallback_merge_is_used(monkeypatch):
    calls = {"n": 0}

    def tampered_once(data, spec, g, **kw):
        calls["n"] += 1
        res = real_realise(data, spec, g, **kw)
        if calls["n"] == 1:
            return dataclasses.replace(res, conservation=dataclasses.replace(res.conservation, within_tolerance=False))
        return res

    monkeypatch.setattr(engine_module, "realise", tampered_once)
    svc, *_ = pair_service(8.0)
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert event.outcome == "perfect_merge" and "model_failed_fallback" in event.warnings and "unsupported_regime" in event.warnings
    assert len(out.bodies) == 1 and calls["n"] == 2
    assert totals(out)[0] == pytest.approx(1.5e22, rel=1e-14)


def test_when_the_fallback_is_invalid_too_the_step_rolls_back_byte_identically(monkeypatch):
    def always_tampered(data, spec, g, **kw):
        res = real_realise(data, spec, g, **kw)
        return dataclasses.replace(res, conservation=dataclasses.replace(res.conservation, within_tolerance=False))

    svc, *_ = pair_service(8.0)
    before = dump(svc)
    monkeypatch.setattr(engine_module, "realise", always_tampered)
    with pytest.raises(SimulationFailure, match="collision_unresolvable|cannot be resolved|invalid"):
        svc.step(svc.approach_s)
    monkeypatch.undo()
    assert dump(svc) == before and svc.events() == [] and svc.collision_records() == []
    assert svc._products == {} and svc.last_failure["kind"] == "step_failed"
    assert len(svc.step(svc.approach_s).events) == 1  # the engine is usable afterwards and the event number was given back (col-1)
    assert svc.events()[0].id == "col-1"


def test_an_exception_while_applying_rolls_everything_back(monkeypatch):
    svc, *_ = pair_service(8.0)
    before = dump(svc)

    def explode(result, state):
        # mutate first, then fail: the step must still restore the whole state
        state.meta.clear()
        raise RuntimeError("injected during application")

    monkeypatch.setattr(engine_module, "apply_result", explode)
    with pytest.raises(SimulationFailure):
        svc.step(svc.approach_s)
    monkeypatch.undo()
    assert dump(svc) == before and svc.collision_records() == []


# ------------------------------------------------------------------------------------------------ budgets
def test_debris_goes_back_to_the_remnant_when_the_parcel_budget_is_zero():
    svc = deferred(max_debris_parcels_per_event=0, max_debris_parcels_total=0)
    pair_service(8.0, svc=svc)
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert "debris_returned_to_remnant" in event.warnings and event.debrisMassKg == 0.0 and not any(b.id.startswith("debris-") for b in out.bodies)
    assert out.diagnostics.totalMassKg == pytest.approx(1.5e22, rel=1e-14)  # nothing was discarded


def test_the_body_cap_with_the_reserve_blocks_new_parcels_without_losing_mass():
    svc = deferred()
    for i in range(191):  # 191 distant bodies + the pair = 193 > MAX_BODIES - reserve_for_user = 192
        svc.add_body(make(f"far{i}", m=1e10, r=1.0, x=(1e12 + 1e5 * i, 1e12, 0)))
    pair_service(8.0, svc=svc)
    mass0 = svc.snapshot().diagnostics.totalMassKg
    out = svc.step(svc.approach_s)
    ev = next(e for e in out.events if e.type == "collision")
    assert "debris_returned_to_remnant" in ev.warnings and not any(b.id.startswith("debris-") for b in out.bodies)
    assert out.diagnostics.totalMassKg == pytest.approx(mass0, rel=1e-14)


# ------------------------------------------------------------------------------------------------ identities over many events
def test_ids_are_unique_over_a_thousand_random_events():
    rnd = random.Random(20261024)
    event_ids, body_ids = [], []
    svc = deferred()
    outcomes = set()
    for _ in range(1000):
        svc.reset()
        x = rnd.uniform(0.95, 9.0)
        b = rnd.choice([0.0, 0.2, 0.5, 0.8])
        m_p = 1.0e22 * rnd.choice([1.0, 0.5, 0.2, 0.05])
        pair_service(x, b, m_t=1.0e22, m_p=m_p, svc=svc)
        out = svc.step(svc.approach_s)
        for e in out.events:
            event_ids.append(e.id)
            outcomes.add(e.outcome if e.type == "collision" else "merger")
        body_ids += [bd.id for bd in out.bodies if bd.id.startswith(("rem-", "debris-"))]
    assert len(event_ids) >= 900 and len(set(event_ids)) == len(event_ids)
    assert len(set(body_ids)) == len(body_ids)
    assert len(outcomes) >= 4  # the sweep exercised several outcome classes


# ------------------------------------------------------------------------------------------------ state paths of the new tables
def test_products_follow_snapshot_restore_reset_and_derive():
    svc, *_ = pair_service(8.0)
    snap_before = svc.capture_snapshot()
    svc.step(svc.approach_s)
    assert any(v[0] == "debris-parcel" for v in svc._products.values())
    snap_after = svc.capture_snapshot()
    assert snap_after.products == svc._products and snap_after.digest != snap_before.digest
    svc.restore_snapshot(snap_before)
    assert svc._products == {} and svc.collision_records() == []
    svc.restore_snapshot(snap_after)
    assert svc._products == snap_after.products and len(svc.collision_records()) == 1
    derived = SimulationService.from_snapshot(snap_after, history_mode="step")
    assert derived._products == svc._products and derived._products is not svc._products
    svc.reset()
    assert svc._products == {}


def test_a_parcel_that_merges_into_a_body_stops_being_a_parcel():
    svc, *_ = pair_service(8.0)
    svc.step(svc.approach_s)
    parcel_id = next(i for i, v in svc._products.items() if v[0] == "debris-parcel")
    svc._merge_collision_state(parcel_id, "gone-body")
    assert parcel_id not in svc._products


def test_replay_gives_identical_numbers_in_a_fresh_universe():
    def run():
        svc, *_ = pair_service(3.0)
        out = svc.step(svc.approach_s)
        return sorted((round(b.massKg, 3), b.radiusM, b.velocityMPerS.x, b.velocityMPerS.y, b.positionM.x) for b in out.bodies), out.events[0].outcome

    assert run() == run()


# ------------------------------------------------------------------------------------------------ legacy exactness (D-033, DQ-2)
EXACT = ["kepler_merge", "four_chain", "probe_heavy_created_first", "probe_heavy_created_second", "extreme_ratio", "equal_mass_tie", "fast_impact"]


@pytest.mark.parametrize("name", EXACT)
def test_material_less_scenarios_give_byte_identical_events_in_both_modes(name):
    legacy = ls.run_scenario(SimulationService, name)
    new = ls.run_scenario(deferred, name)
    assert json.dumps(new["events"], sort_keys=True) == json.dumps(legacy["events"], sort_keys=True)  # byte-identical event JSON
    assert [b["id"] for b in new["bodies"]] == [b["id"] for b in legacy["bodies"]]
    for a, b in zip(new["bodies"], legacy["bodies"]):
        assert a["massKg"] == b["massKg"] and a["radiusM"] == b["radiusM"]
        scale = max(abs(c) for c in b["positionM"] + [1.0])
        # a lone remnant drifts analytically in outcome-v1 and is integrated in legacy-merge: equal to round-off (accepted at CP-1, D-035)
        assert all(abs(x - y) <= 1e-12 * scale for x, y in zip(a["positionM"] + a["velocityMPerS"], b["positionM"] + b["velocityMPerS"]))


def test_material_less_universe_has_no_collision_state_at_all():
    for name in EXACT:
        bodies, steps = ls.SCENARIOS[name]()
        svc = deferred()
        svc.load_bodies(bodies, history_mode="step")
        for dt in steps:
            svc.step(dt)
        assert svc._materials == {} and svc._rotations == {} and svc._products == {}
        assert all(e.type == "merger" for e in svc.events())


# ------------------------------------------------------------------------------------------------ system-wide grid through the real engine
@pytest.mark.parametrize("gamma", [1.0, 0.3, 0.05])
@pytest.mark.parametrize("b", [0.0, 0.5, 0.9, 0.97])
@pytest.mark.parametrize("x", [0.95, 1.4, 3.0, 9.0])
def test_engine_grid_conserves_the_whole_system_and_never_fails(gamma, b, x):
    """Mass, momentum and total angular momentum (orbit + spin states + booked ledger) of the whole universe are conserved through the
    event for every point, whichever resolution tier the engine used; the step never fails."""
    svc, t, p, _ = pair_service(x, b, m_t=1.0e22, m_p=1.0e22 * gamma, spin={"x": 0.0, "y": 0.0, "z": 2.0e-4})
    out = run_and_check_conservation(svc)
    events = [e for e in out.events]
    assert len(events) == 1 and events[0].type == "collision"
    assert events[0].massResidualRel <= 1e-14 and events[0].momentumResidualRel <= 1e-12


def test_the_engine_uses_the_last_resort_for_a_slow_grazing_equal_mass_impact_and_books_the_spin():
    svc, *_ = pair_service(1.05, 0.97, m_t=1.0e22, m_p=1.0e22, spin={"x": 0.0, "y": 0.0, "z": 2.0e-4})
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert "spin_not_represented_fallback" in event.warnings and "model_failed_fallback" in event.warnings
    assert svc._rotations == {} and svc._resolver.spin  # the angular momentum sits in the booked ledger, reported as unmodelled
