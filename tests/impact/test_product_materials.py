"""H2 / H3 (repair 2026-10-28): material identity of collision products.

H2 — the composition rule of D-035 (a product keeps a material only when both bodies had the same one) is unchanged: no mixing model is
invented. What was wrong is that outcome-v1 applied it SILENTLY: the products lost their material (and therefore any rotation state and the
outcome models for every later contact) without a word in the event or the record. The event now says so.

H3 — debris parcels never carried a material in the engine's side table, although their descriptor named one, so every contact with a
parcel fell to the material-unspecified legacy merge, and a parcel falling back on its own (same-material) parent stripped the parent of its
material and spin. Parcels now carry the material their event's products carry under the same rule (hit-and-run debris comes from the
target alone, so it is the target's), parcel-body contacts go through the ordinary pipeline (plan 3.10) with the warning
`debris_parcel_contact`, and two parcels aggregate into one parcel (plan 3.9 explicit rule: momentum-conserving, no rotation state, the
population descriptor follows the mass)."""
import math

import pytest

from backend.impact.contracts import DebrisDescriptor, MaterialRef
from backend.simulation import ConflictError
from tests.helpers import make
from tests.impact.test_engine_outcomes import ROCK, pair_service, run_and_check_conservation

ICE = {"profileId": "water-ice"}
SPIN = {"x": 0.0, "y": 0.0, "z": 1.0e-4}


def test_a_mixed_material_collision_says_that_its_products_carry_no_material():
    from backend.models import BodyUpdate

    svc2, t, p, _ = pair_service(1.3)
    svc2.update_body(p.id, BodyUpdate(material=ICE))
    out = run_and_check_conservation(svc2)
    (event,) = out.events
    assert event.type == "collision"
    assert "product_material_unspecified" in event.warnings
    (record,) = svc2.collision_records()
    assert "product_material_unspecified" in record.result.warnings
    assert all(b.material is None for b in out.bodies)  # D-035 is unchanged: no material is invented for a mixed product


def test_a_same_material_collision_has_no_such_warning_and_keeps_the_spin_state():
    svc, t, p, _ = pair_service(1.3, spin=SPIN)
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert "product_material_unspecified" not in event.warnings
    target = next(b for b in out.bodies if b.id == t.id)
    assert target.material is not None and target.material.profileId == "silicate-rock" and target.spinRadPerS is not None


def test_parcels_of_a_same_material_event_carry_that_material():
    svc, *_ = pair_service(8.0)
    out = svc.step(svc.approach_s)
    parcels = [b for b in out.bodies if b.representation == "debris-parcel"]
    assert parcels
    for b in parcels:
        assert b.material is not None and b.material.profileId == "silicate-rock"
        assert b.debris.materialProfileId == "silicate-rock"
        assert svc._rotations.get(b.id) is None  # a population has no rotation state


def test_parcels_of_a_mixed_material_event_carry_none_and_their_descriptor_agrees():
    svc, t, p, _ = pair_service(8.0)
    from backend.models import BodyUpdate

    svc.update_body(p.id, BodyUpdate(material=ICE))
    out = svc.step(svc.approach_s)
    parcels = [b for b in out.bodies if b.representation == "debris-parcel"]
    assert parcels
    assert all(b.material is None and b.debris.materialProfileId is None for b in parcels)


def _aim_at(svc, target, mass, radius, material, spin=None, closing=2.0e3):
    v = (target.velocityMPerS.x, target.velocityMPerS.y, target.velocityMPerS.z)
    speed = math.sqrt(sum(c * c for c in v))
    uhat = tuple(c / speed for c in v)
    extra = {"material": material} if material else {}
    if spin:
        extra["spinRadPerS"] = spin
    for k in (8.0, 12.0, 20.0, 30.0, 45.0, 70.0):
        gap = k * max(target.radiusM, radius)
        pos = tuple(getattr(target.positionM, a) + gap * u for a, u in zip("xyz", uhat))
        vel = tuple(v[i] - closing * uhat[i] for i in range(3))
        try:
            body = svc.add_body(make("hunter", m=mass, r=radius, x=pos, v=vel, **extra))
            return body, gap / closing
        except ConflictError:
            continue
    pytest.skip("no free spot ahead of the parcel for this realisation")


def test_a_parcel_hitting_a_same_material_spinning_body_keeps_the_bodys_material_and_spin_and_links_the_event():
    svc, *_ = pair_service(8.0)
    first = svc.step(svc.approach_s).events[0]
    parcel = max((b for b in svc.snapshot().bodies if b.representation == "debris-parcel"), key=lambda b: b.massKg)
    hunter, travel = _aim_at(svc, parcel, mass=50.0 * parcel.massKg, radius=3.0 * parcel.radiusM, material=ROCK, spin=SPIN)
    out = svc.step(3.0 * travel)
    hits = [e for e in out.events if parcel.id in e.bodyIds]
    assert hits, "the aimed body did not reach the parcel"
    (event,) = hits
    assert event.type == "collision" and "material_unspecified" not in event.warnings
    assert "debris_parcel_contact" in event.warnings
    assert event.parentEventId == first.id
    survivor = next(b for b in out.bodies if b.id == hunter.id)
    assert survivor.material is not None and survivor.material.profileId == "silicate-rock"
    assert survivor.spinRadPerS is not None, "the body keeps its rotation state"


def test_two_parcels_aggregate_into_one_parcel_whose_descriptor_follows_the_mass():
    svc, t, p, _ = pair_service(3.0)
    for body in (t, p):  # make both bodies parcels of an earlier event, exactly as the applier registers them
        svc._products[body.id] = ("debris-parcel", "col-0", DebrisDescriptor(body.massKg, None, 0.0, "silicate-rock", 7))
    out = run_and_check_conservation(svc)
    (event,) = out.events
    assert event.type == "collision" and event.outcome == "perfect_merge" and "debris_parcels_aggregated" in event.warnings
    (survivor,) = out.bodies
    assert survivor.id == t.id and survivor.representation == "debris-parcel"
    assert survivor.debris.totalMassKg == survivor.massKg
    assert survivor.material == type(survivor.material)(profileId="silicate-rock", layers=None)
    assert svc._rotations.get(t.id) is None and svc._sites.get(t.id) is None
    assert isinstance(svc._materials[t.id], MaterialRef)


# ------------------------------------------------------------------------------------------------ H2 decision (D-069): every path pinned
@pytest.mark.parametrize("x,b", [(1.3, 0.0), (3.0, 0.0), (8.0, 0.0), (2.0, 0.4)])
def test_every_product_of_a_mixed_outcome_has_no_material_and_the_event_says_so(x, b):
    """Remnant, fragments and parcels of a mixed pair carry no material (D-035, no mixing model), and the event and record say so."""
    from backend.models import BodyUpdate

    svc, t, p, _ = pair_service(x, b)
    svc.update_body(p.id, BodyUpdate(material=ICE))
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert event.type == "collision" and "product_material_unspecified" in event.warnings
    products = [bd for bd in out.bodies if bd.id in set(event.survivingBodyIds + event.createdBodyIds)]
    assert products and all(bd.material is None and bd.spinRadPerS is None for bd in products)
    assert all(bd.debris.materialProfileId is None for bd in products if bd.representation == "debris-parcel")
    (record,) = svc.collision_records()
    assert "product_material_unspecified" in record.warnings


def test_a_mixed_hit_and_run_loses_no_material_and_carries_no_such_warning():
    """Hit-and-run keeps both identities: each remnant keeps its own material and the target's debris is the target's."""
    from backend.models import BodyUpdate

    svc, t, p, _ = pair_service(1.5, 0.7)
    svc.update_body(p.id, BodyUpdate(material=ICE))
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert event.outcome == "hit_and_run" and "product_material_unspecified" not in event.warnings
    by_id = {bd.id: bd for bd in out.bodies}
    assert by_id[t.id].material.profileId == "silicate-rock" and by_id[p.id].material.profileId == "water-ice"
    assert all(bd.material.profileId == "silicate-rock" for bd in out.bodies if bd.representation == "debris-parcel")


def test_a_later_impact_on_a_material_less_product_is_the_labelled_legacy_merge():
    """The consequence of the policy, made visible: the next contact of a mixed product is a `merger` whose record says
    `material_unspecified` (no material is invented for it)."""
    from backend.models import BodyUpdate

    svc, t, p, _ = pair_service(1.3)
    svc.update_body(p.id, BodyUpdate(material=ICE))
    first = svc.step(svc.approach_s)
    remnant = next(bd for bd in first.bodies if bd.id == t.id)
    hunter, travel = _aim_at(svc, remnant, mass=0.05 * remnant.massKg, radius=0.2 * remnant.radiusM, material=ROCK)
    out = svc.step(3.0 * travel)
    hits = [e for e in out.events if remnant.id in e.bodyIds]
    assert hits and hits[0].type == "merger"
    assert "material_unspecified" in svc.collision_records()[-1].warnings


def test_a_legacy_merger_of_two_materials_is_flagged_on_the_step_and_its_event_is_unchanged():
    """In mode legacy-merge (presets, Orbit Lab) the merger event stays byte-exact (D-033), so the material loss is reported on the step."""
    from backend.simulation import LEGACY_MERGE_CONFIG, SimulationService

    svc, t, p, _ = pair_service(1.3, svc=SimulationService(LEGACY_MERGE_CONFIG))
    from backend.models import BodyUpdate

    svc.update_body(p.id, BodyUpdate(material=ICE))
    out = svc.step(svc.approach_s)
    (event,) = out.events
    assert event.type == "merger" and not hasattr(event, "warnings")
    assert "product_material_unspecified" in out.warnings
    assert all(bd.material is None for bd in out.bodies)


def test_a_legacy_merger_of_one_material_is_not_flagged():
    from backend.simulation import LEGACY_MERGE_CONFIG, SimulationService

    svc, *_ = pair_service(1.3, svc=SimulationService(LEGACY_MERGE_CONFIG))
    out = svc.step(svc.approach_s)
    assert "product_material_unspecified" not in out.warnings
