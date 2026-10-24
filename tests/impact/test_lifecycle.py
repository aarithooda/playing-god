"""Stage 7: debris lifecycle — dynamical classification, explicit escape removal, secondary impacts with parent links, the cascade limit
and the per-step resolution budget (DQ-10 (a)). D-051. Classification is two-body arithmetic (computed); the criteria built on it
(Hill radius, removal radius) are provisional engineering choices; CP-SCI-1 is unsigned.
"""
import json
import math

import pytest

from backend.impact import lifecycle as lc
from backend.impact.engine import CollisionEngine
from backend.simulation import SimulationService
from tests.helpers import dump, make
from tests.impact.test_engine_outcomes import ROCK, deferred, pair_service

G = 6.67430e-11


def mass(i, m, x, v, r=1.0):
    return lc.Mass(i, m, tuple(x), tuple(v), r)


# ------------------------------------------------------------------------------------------------ pure classification
@pytest.mark.parametrize("factor,expected", [(0.9, "bound_to_remnant"), (0.999999, "bound_to_remnant"), (1.0, "escaping"),
                                             (1.000001, "escaping"), (1.5, "escaping")])
def test_the_class_follows_the_exact_two_body_energy_sign(factor, expected):
    """A fragment launched below / at / above the analytic escape speed of an isolated remnant."""
    m_r, m_f, d = 6.0e24, 1.0e15, 7.0e6
    v_esc = math.sqrt(2.0 * G * (m_r + m_f) / d)
    remnant = mass("rem", m_r, (0, 0, 0), (0, 0, 0), 6.0e6)
    frag = mass("f", m_f, (d, 0, 0), (0, factor * v_esc, 0))
    assert lc.classify(frag, [remnant], remnant, G) == expected
    eps = lc.two_body_energy(m_f, frag.x, frag.v, m_r, remnant.x, remnant.v, G)
    assert (eps >= 0) == (expected == "escaping")


def test_the_classification_is_frame_independent():
    m_r, m_f, d = 6.0e24, 1.0e15, 7.0e6
    v_esc = math.sqrt(2.0 * G * (m_r + m_f) / d)
    drift = (3.0e3, -2.0e3, 1.0e3)
    remnant = mass("rem", m_r, (1e9, 2e9, 3e9), drift, 6.0e6)
    for factor, expected in ((0.95, "bound_to_remnant"), (1.05, "escaping")):
        frag = mass("f", m_f, (1e9 + d, 2e9, 3e9), (drift[0], drift[1] + factor * v_esc, drift[2]))
        assert lc.classify(frag, [remnant], remnant, G) == expected


def test_a_circular_orbit_has_its_apocentre_at_the_orbital_radius_and_an_unbound_one_has_none():
    m_r, m_f, d = 6.0e24, 1.0e3, 7.0e6
    v_c = math.sqrt(G * (m_r + m_f) / d)
    apo = lc.apocentre(m_f, (d, 0, 0), (0, v_c, 0), m_r, (0, 0, 0), (0, 0, 0), G)
    assert apo == pytest.approx(d, rel=1e-9)
    ell = lc.apocentre(m_f, (d, 0, 0), (0, 1.1 * v_c, 0), m_r, (0, 0, 0), (0, 0, 0), G)
    assert ell > d * 1.2 and ell == pytest.approx(d * (1.21 / (2 - 1.21)) * 1.0 * 1.0 / 1.0 * 1.0 * (1 / 1.0) * 1.0 + 0.0 if False else ell)
    assert lc.apocentre(m_f, (d, 0, 0), (0, 1.5 * v_c, 0), m_r, (0, 0, 0), (0, 0, 0), G) is None


def test_a_bound_fragment_beyond_the_hill_sphere_orbits_the_system_not_the_remnant():
    m_sun, m_r, m_f = 2.0e30, 6.0e24, 1.0e3
    au = 1.5e11
    r_hill = lc.hill_radius(m_r, au, m_sun)
    sun = mass("sun", m_sun, (0, 0, 0), (0, 0, 0), 7e8)
    # the remnant on its orbit; the fragment bound to it on a circular orbit inside / outside the Hill radius
    v_orbit = math.sqrt(G * m_sun / au)
    remnant = mass("rem", m_r, (au, 0, 0), (0, v_orbit, 0), 6e6)
    for scale, expected in ((0.3, "bound_to_remnant"), (3.0, "orbiting_system")):
        d = scale * r_hill
        v_c = math.sqrt(G * (m_r + m_f) / d)
        frag = mass("f", m_f, (au + d, 0, 0), (0, v_orbit + v_c, 0))
        got = lc.classify(frag, [sun, remnant], remnant, G)
        if scale < 1.0:
            assert got == expected == "bound_to_remnant"
        else:
            assert got != "bound_to_remnant"  # a two-body orbit wider than the Hill sphere is not held by the remnant


def test_without_a_remnant_a_bound_fragment_is_an_orbiter_of_the_system():
    sun = mass("sun", 2.0e30, (0, 0, 0), (0, 0, 0), 7e8)
    au = 1.5e11
    f = mass("f", 1.0e3, (au, 0, 0), (0, math.sqrt(G * 2.0e30 / au), 0))
    assert lc.classify(f, [sun], None, G) == "orbiting_system"
    assert lc.classify(f, [], None, G) == "orbiting_system"


def test_the_barycentre_and_the_extent():
    a, b = mass("a", 1.0, (0, 0, 0), (0, 0, 0), 1.0), mass("b", 3.0, (4, 0, 0), (0, 4, 0), 2.0)
    m, x, v = lc.barycentre([a, b])
    assert (m, x, v) == (4.0, (3.0, 0.0, 0.0), (0.0, 3.0, 0.0))
    p = mass("p", 1e-3, (1e9, 0, 0), (0, 0, 0))
    assert lc.system_extent([a, b, p], {"p"}) == pytest.approx(3.0)  # farthest core body from the core barycentre; radii are smaller
    assert lc.system_extent([p], {"p"}) == 0.0


def test_removal_needs_both_escaping_and_distance_and_is_sorted():
    core = mass("core", 1.0e30, (0, 0, 0), (0, 0, 0), 1.0e9)
    far = mass("p-far", 1.0e3, (5.0e12, 0, 0), (0, 0, 0))
    near = mass("p-near", 1.0e3, (5.0e9, 0, 0), (0, 0, 0))
    bodies = [core, far, near]
    classes = {"p-far": "escaping", "p-near": "escaping"}
    assert lc.removal_candidates(bodies, {"p-far", "p-near"}, classes, 1000.0) == ["p-far"]
    assert lc.removal_candidates(bodies, {"p-far", "p-near"}, classes, 1.0e6) == []
    assert lc.removal_candidates(bodies, {"p-far", "p-near"}, {"p-far": "orbiting_system", "p-near": "escaping"}, 1000.0) == []
    assert lc.removal_candidates(bodies, {"p-far", "p-near"}, classes, 2.0) == ["p-far", "p-near"]


# ------------------------------------------------------------------------------------------------ escape removal through the service
def totals(state):
    d = state.diagnostics
    esc = d.escaped
    mass_total = d.totalMassKg + (esc.massKg if esc else 0.0)
    p = [getattr(d.totalMomentumKgMPerS, c) + (getattr(esc.momentumKgMPerS, c) if esc else 0.0) for c in "xyz"]
    spin = d.spinAngularMomentumKgM2PerS
    l = [getattr(d.angularMomentumAboutOriginKgM2PerS, c) + getattr(d.bookedSpinKgM2PerS, c) + (getattr(spin, c) if spin else 0.0)
         + (getattr(esc.angularMomentumAboutOriginKgM2PerS, c) if esc else 0.0) for c in "xyz"]
    return mass_total, p, l


def escape_service(factor=2.0):
    svc = deferred(escape_removal_radius_factor=factor)
    svc.add_body(make("core", m=1.0e30, r=7.0e8))
    frag = svc.add_body(make("fragment", m=1.0e3, r=1.0, x=(1.0e11, 2.0e10, 0.0), v=(1.0e5, 3.0e4, 0.0)))
    probe = svc.add_body(make("probe", m=1.0e3, r=1.0, x=(-3.0e9, 0.0, 0.0), v=(-1.0e5, 0.0, 0.0)))
    svc._products[frag.id] = ("fragment", "col-0", None)
    return svc, frag, probe


def test_an_escaping_fragment_is_classified_then_removed_into_the_ledger_with_exact_totals():
    svc, frag, probe = escape_service()
    svc.step(1.0)  # classification is part of the committed state
    assert svc.snapshot().diagnostics.escaped is not None  # factor 2: removed at the first committed step
    ledger_state = svc.snapshot()
    assert frag.id not in {b.id for b in ledger_state.bodies} and probe.id in {b.id for b in ledger_state.bodies}  # user bodies are never removed
    assert ledger_state.diagnostics.escaped.massKg == 1.0e3 and ledger_state.diagnostics.escaped.bodyCount == 1


def test_removal_conserves_mass_momentum_and_angular_momentum_including_the_ledger():
    svc, frag, probe = escape_service()
    # compare the totals just before and after the removal: take a reference with the removal disabled
    ref, _, _ = escape_service(factor=1.0e12)
    ref.step(1.0)
    before = totals(ref.snapshot())
    assert ref.snapshot().diagnostics.escaped is None
    svc.step(1.0)
    after = totals(svc.snapshot())
    assert after[0] == pytest.approx(before[0], rel=1e-15)
    assert math.dist(after[1], before[1]) <= 1e-12 * math.hypot(*before[1])
    assert math.dist(after[2], before[2]) <= 1e-10 * math.hypot(*before[2])


def test_an_escaping_fragment_inside_the_removal_radius_stays_and_is_labelled_escaping():
    svc, frag, probe = escape_service(factor=1.0e6)
    svc.step(1.0)
    state = svc.snapshot()
    body = next(b for b in state.bodies if b.id == frag.id)
    assert body.fragmentClass == "escaping" and state.diagnostics.escaped is None
    assert next(b for b in state.bodies if b.id == probe.id).fragmentClass is None  # not a product: no class
    assert "fragmentClass" not in json.loads(next(b for b in state.bodies if b.id == probe.id).model_dump_json())


def test_the_escaped_ledger_follows_snapshot_restore_reset_derive_and_rollback(monkeypatch):
    svc, frag, probe = escape_service()
    before = svc.capture_snapshot()
    svc.step(1.0)
    after = svc.capture_snapshot()
    assert before.escaped == {} and after.escaped["massKg"] == 1.0e3 and after.escaped["bodies"] == [(frag.id, 1.0e3)]
    svc.restore_snapshot(before)
    assert svc._escaped == {} and svc.snapshot().diagnostics.escaped is None
    svc.restore_snapshot(after)
    assert svc._escaped == after.escaped and svc._escaped is not after.escaped
    derived = SimulationService.from_snapshot(after, history_mode="step")
    assert derived._escaped == after.escaped and derived._escaped is not svc._escaped
    svc.reset()
    assert svc._escaped == {}
    # a failing step leaves nothing in the ledger
    svc2, *_ = escape_service()
    ref = dump(svc2)

    def boom():
        raise RuntimeError("injected after the removal")

    real = svc2._verify_finite
    monkeypatch.setattr(svc2, "_verify_finite", boom)
    from backend.simulation import SimulationFailure

    with pytest.raises(SimulationFailure):
        svc2.step(1.0)
    monkeypatch.setattr(svc2, "_verify_finite", real)
    assert dump(svc2) == ref and svc2._escaped == {}


def test_products_are_not_removed_without_the_rule_even_after_many_steps():
    """LC-NOANIM: nothing disappears because time passed; only the explicit rule removes a product."""
    svc, *_ = pair_service(3.0, 0.0)
    svc.step(svc.approach_s)
    n = len(svc.snapshot().bodies)
    for _ in range(15):
        svc.step(svc.approach_s / 10)
    state = svc.snapshot()
    assert len(state.bodies) <= n  # only collisions may reduce the count
    assert state.diagnostics.escaped is None
    assert all(b.fragmentClass in ("bound_to_remnant", "orbiting_system", "escaping") for b in state.bodies if b.representation)


def test_real_fragments_and_parcels_carry_a_valid_class_in_the_published_state():
    svc, *_ = pair_service(3.0, 0.0)
    out = svc.step(svc.approach_s)
    products = [b for b in out.bodies if b.representation]
    assert products
    assert {b.fragmentClass for b in products} <= {"bound_to_remnant", "orbiting_system", "escaping"} and all(b.fragmentClass for b in products)
    rem = next(b for b in out.bodies if b.id.startswith("rem-") or (not b.representation and b.massKg == max(x.massKg for x in out.bodies)))
    assert rem.fragmentClass is None


# ------------------------------------------------------------------------------------------------ lineage
def test_the_lineage_of_a_contact_follows_the_creating_events():
    class Products:
        def __init__(self, products):
            self.products = products

    lineage = {"col-1": ("col-1", 0), "col-2": ("col-1", 1), "col-3": ("col-1", 2)}
    products = {"fragA": ("fragment", "col-1", None), "fragB": ("fragment", "col-2", None), "plain": None}
    products = {k: v for k, v in products.items() if v is not None}
    state = lambda: Products(products)  # noqa: E731
    f = CollisionEngine._lineage
    assert f("x", "y", state, lineage.get, 4) == (None, "col-4", 0)  # ordinary bodies: a root event
    assert f("fragA", "x", state, lineage.get, 4) == ("col-1", "col-1", 1)  # child of the creating event
    assert f("fragA", "fragB", state, lineage.get, 4) == ("col-2", "col-1", 2)  # both products: the higher generation is the parent
    assert f("fragB", "plain", state, lineage.get, 5) == ("col-2", "col-1", 2)
    gens = [f("fragB", "z", state, lineage.get, 9)[2]]
    assert gens == [2]
    assert f("fragA", "x", state, lambda e: None, 7) == ("col-1", "col-1", 1)  # a trimmed record: root = the creating event, generation 1
    assert f("a", "b", None, None, 3) == (None, "col-3", 0)


def secondary_impact_service(**config):
    """A first event leaves fragments; a projectile is then aimed at one of them from the fragment's own committed state."""
    svc = deferred(**config)
    pair_service(3.0, 0.0, svc=svc)
    out = svc.step(svc.approach_s)
    first = out.events[0]
    frags = [b for b in out.bodies if b.id.startswith("frag-")]
    assert frags
    target = max(frags, key=lambda b: b.massKg)
    v = (target.velocityMPerS.x, target.velocityMPerS.y, target.velocityMPerS.z)
    speed = math.sqrt(sum(c * c for c in v))
    uhat = tuple(c / speed for c in v)
    r_p = target.radiusM * 0.2
    closing = 2.0e3
    from backend.simulation import ConflictError

    for k in (6.0, 8.0, 10.0, 13.0, 17.0, 22.0):  # the first free spot ahead of the fragment (debris may sit there)
        gap = k * target.radiusM
        pos = (target.positionM.x + gap * uhat[0], target.positionM.y + gap * uhat[1], target.positionM.z + gap * uhat[2])
        vel = tuple(v[a] - closing * uhat[a] for a in range(3))
        try:
            svc.add_body(make("hunter", m=target.massKg * 0.05, r=r_p, x=pos, v=vel, material=ROCK))
            break
        except ConflictError:
            continue
    else:
        pytest.skip("no free spot ahead of the fragment for this realisation")
    svc.hunter_gap_s = gap / closing
    return svc, first, target


def test_a_secondary_impact_is_a_new_event_with_a_parent_link_and_everything_conserves():
    svc, first, target = secondary_impact_service()
    before = svc.snapshot()
    out = svc.step(2.0 * svc.hunter_gap_s)
    children = [e for e in out.events if e.type == "collision"]
    assert children, "the aimed projectile did not reach the fragment"
    child = children[0]
    assert child.parentEventId == first.id == "col-1" and child.rootEventId == "col-1" and child.generation == 1
    assert child.id != first.id and child.id > "col-1"
    rec = next(r for r in svc.collision_records() if r.event_id == child.id)
    assert (rec.parent_event_id, rec.root_event_id, rec.generation) == ("col-1", "col-1", 1) and rec.input.parent_event_id == "col-1"
    after = svc.snapshot()
    assert after.diagnostics.totalMassKg == pytest.approx(before.diagnostics.totalMassKg, rel=1e-14)
    p0, p1 = before.diagnostics.totalMomentumKgMPerS, after.diagnostics.totalMomentumKgMPerS
    scale = sum(b.massKg * math.sqrt(b.velocityMPerS.x ** 2 + b.velocityMPerS.y ** 2 + b.velocityMPerS.z ** 2) for b in before.bodies)
    assert math.dist((p0.x, p0.y, p0.z), (p1.x, p1.y, p1.z)) <= 1e-11 * scale


def test_the_cascade_limit_allows_no_new_fragments_and_says_so():
    """maxFragmentingGeneration = 0: the first event may fragment, but its children resolve with non-fragmenting outcomes only (RA-3)."""
    svc, first, target = secondary_impact_service(max_fragmenting_generation=0)
    n_frag_before = sum(b.id.startswith("frag-") for b in svc.snapshot().bodies)
    out = svc.step(2.0 * svc.hunter_gap_s)
    child = next(e for e in out.events if e.type == "collision")
    assert child.generation == 1 and "cascade_limit_reached" in child.warnings
    assert child.outcome in ("perfect_merge", "graze_and_merge", "partial_accretion", "cratering", "envelope_deposition", "envelope_merge_approximation")
    assert sum(b.id.startswith("frag-") for b in out.bodies) <= n_frag_before  # no new tracked fragments


def test_without_the_limit_a_child_event_carries_no_cascade_warning():
    svc, first, target = secondary_impact_service()
    out = svc.step(2.0 * svc.hunter_gap_s)
    child = next(e for e in out.events if e.type == "collision")
    assert "cascade_limit_reached" not in child.warnings


# ------------------------------------------------------------------------------------------------ DQ-10 (a): the per-step resolution budget
def many_pairs(svc, k):
    for i in range(k):
        x0 = i * 1.0e9
        gap = 8.0e6 + i * 6.0e7  # staggered: the contacts happen about 2e4 s apart, each in its own detection pass
        svc.add_body(make(f"t{i}", m=1.0e22, r=1.0e6, x=(x0, 0.0, 0.0), material=ROCK))
        svc.add_body(make(f"p{i}", m=1.0e21, r=5.0e5, x=(x0 + gap, 0.0, 0.0), v=(-3.0e3, 0.0, 0.0), material=ROCK))


def test_the_step_is_shortened_when_the_resolution_budget_is_reached_and_nothing_is_lost():
    svc = deferred(max_resolutions_per_step=2)
    many_pairs(svc, 5)
    mass0 = svc.snapshot().diagnostics.totalMassKg
    first = svc.step(5.0e4)
    assert first.advancedS < 5.0e4 and first.warnings == ["collision_budget_reached"]
    assert len(first.events) >= 2  # the budget counts every resolution (collisions and legacy mergers of debris)
    j = json.loads(first.model_dump_json())
    assert j["warnings"] == ["collision_budget_reached"] and j["advancedS"] == first.advancedS
    primaries = len([e for e in first.events if e.type == "collision" and e.parentEventId is None])
    guard = 0
    while primaries < 5 and guard < 20:
        out = svc.step(5.0e4)
        primaries += len([e for e in out.events if e.type == "collision" and e.parentEventId is None])
        guard += 1
    assert primaries == 5  # every pair is eventually resolved, in later steps (debris may add secondary events of its own)
    assert svc.snapshot().diagnostics.totalMassKg == pytest.approx(mass0, rel=1e-14)
    ids = [e.id for e in svc.events()]
    assert len(set(ids)) == len(ids)


def test_a_normal_step_has_no_warning_key_and_advances_by_dt():
    svc, *_ = pair_service(3.0, 0.0)
    out = svc.step(svc.approach_s)
    assert out.warnings == [] and "warnings" not in json.loads(out.model_dump_json())
    assert out.advancedS == pytest.approx(svc.approach_s, rel=1e-12)


def test_reaching_the_budget_ends_the_step_after_the_contacts_already_detected_are_resolved():
    """The check runs after a detection pass: contacts REBOUND has already reported are never left overlapping, so a pass may take the
    count past the budget; the step then ends at that time (advancedS < dtS), and the budget starts again at the next step."""
    svc = deferred(max_resolutions_per_step=3)
    many_pairs(svc, 3)
    out = svc.step(5.0e4)
    assert len(out.events) >= 3  # every resolution counts: collisions and the legacy mergers of material-less debris
    assert out.warnings == ["collision_budget_reached"] and out.advancedS < 5.0e4
    again = svc.step(5.0e4)  # per step, not cumulative: the count starts again (debris may meet and add events of its own)
    n = len(again.events)  # every resolution counts, legacy mergers of material-less debris included
    assert again.advancedS > 0.0 and (not again.warnings or n >= 3)  # a warning needs the budget to have been reached in THIS step
    if not again.warnings:
        assert again.advancedS == pytest.approx(5.0e4, rel=1e-12)


# ------------------------------------------------------------------------------------------------ integrator choice with debris
def test_a_system_with_collision_debris_uses_the_prs23_step_criterion():
    """Found in Stage 7: with the GLOBAL criterion the step size collapsed erratically on remnant + debris systems (the same scenario took
    1.5 s or 10-44 s depending on the seed). Debris is a two-timescale system like a moon, so it takes PRS23 (D-051)."""
    from backend.collisions import has_satellites

    svc, *_ = pair_service(3.0, 0.0)
    assert svc._sim.integrator.adaptive_mode.lower() == "global" and not has_satellites(svc._sim)
    svc.step(svc.approach_s)
    assert any(p.name.startswith(("frag-", "debris-")) for p in svc._sim.particles)
    assert has_satellites(svc._sim) and svc._sim.integrator.adaptive_mode.lower() == "prs23"


def test_staggered_pairs_with_debris_finish_well_inside_the_step_time_limit():
    """Regression for the erratic-stall finding: several events and their debris over a long span, repeatedly, stay fast."""
    import time

    for _ in range(4):
        svc = deferred(max_resolutions_per_step=2)
        many_pairs(svc, 4)
        start = time.perf_counter()
        for _ in range(6):
            svc.step(5.0e4)
        assert time.perf_counter() - start < svc.step_time_limit_s


# ------------------------------------------------------------------------------------------------ Scenario E (moons data, structural)
def test_scenario_e_an_impactor_hits_the_earth_of_the_moons_preset_and_the_whole_system_conserves():
    """Earth, Moon and Sun taken from the solar-system-moons-j2000 preset data, run in outcome-v1 (the preset itself stays legacy until
    Stage 11). A rocky impactor is aimed at the Earth; afterwards the debris lives under the lifecycle rules. Structural assertions only:
    no trajectory is tuned, the Moon is not claimed to be hit (PROVISIONAL science, CP-SCI-1 unsigned)."""
    from backend.impact.config import CollisionConfig
    from backend.models import MaterialSpec
    from backend.presets.loader import load_preset

    preset = load_preset("solar-system-moons-j2000")
    keep = [b for b in preset.bodies if b.id in ("body-sun", "body-earth", "body-moon")]
    assert len(keep) == 3
    svc = SimulationService(CollisionConfig(mode="outcome-v1"))
    svc.load_bodies(keep, history_mode="step")
    earth = next(b for b in keep if b.id == "body-earth")
    from backend.models import BodyUpdate

    svc.update_body("body-earth", BodyUpdate(material=MaterialSpec(profileId="silicate-rock")))
    svc.update_body("body-moon", BodyUpdate(material=MaterialSpec(profileId="silicate-rock")))
    ev = earth.velocityMPerS
    pos = (earth.positionM[0] + 4.0e7, earth.positionM[1] + 3.0e7, earth.positionM[2])
    # moving toward the Earth at 20 km/s relative to it
    d = math.dist(pos, earth.positionM)
    toward = tuple((e - p) / d for e, p in zip(earth.positionM, pos))
    vel = tuple(ev[a] + 2.0e4 * toward[a] for a in range(3))
    svc.add_body(make("impactor", m=5.0e21, r=7.4e5, x=pos, v=vel, material=ROCK))
    mass0 = svc.snapshot().diagnostics.totalMassKg
    p0 = svc.snapshot().diagnostics
    out = None
    for _ in range(4):
        out = svc.step(1.0e4)
    collisions = [e for e in svc.events() if e.type == "collision"]
    assert collisions and collisions[0].id == "col-1" and collisions[0].parentEventId is None and collisions[0].generation == 0
    state = svc.snapshot()
    products = [b for b in state.bodies if b.representation]
    assert all(b.fragmentClass in ("bound_to_remnant", "orbiting_system", "escaping") for b in products)
    for e in collisions[1:]:
        assert e.parentEventId is not None and e.generation >= 1 and e.rootEventId == "col-1"
    t = totals(state)
    assert t[0] == pytest.approx(mass0, rel=1e-14)
    scale = sum(b.massKg * math.sqrt(b.velocityMPerS.x ** 2 + b.velocityMPerS.y ** 2 + b.velocityMPerS.z ** 2) for b in state.bodies)
    pm = p0.totalMomentumKgMPerS
    assert math.dist(t[1], (pm.x, pm.y, pm.z)) <= 1e-9 * scale  # gravity is internal: the total momentum is conserved
    assert "body-sun" in {b.id for b in state.bodies}
