"""Stage 2: materials and rotation travel with the engine state on EVERY path (persistence), and nothing changes for bodies that
have neither. Separate from the physics tests (spec 10.7)."""
import json
import math

import pytest

from backend import universes
from backend.api_universes import create_preset_universe
from backend.errors import CodedError
from backend.impact import rotation as rot  # noqa: F401
from backend.impact.contracts import MaterialRef
from backend.impact.config import CollisionConfig
from backend.models import Body, BodyUpdate
from backend.simulation import ConflictError, SimulationFailure, SimulationService
from tests.helpers import dump, make
from tests.impact import legacy_scenarios as ls

# Digests computed on the code of f2c2da3 (the digest function was not touched before Stage 2): materials and rotation must not
# change them for any universe that has none.
DIGEST_F2C2DA3 = {
    "solar-system-moons-j2000": "16adff0c96f149ab520e07c006df09d87f809aae7c802b9fefa6aa55673fc99b",
    "solar-system-j2000": "6362dc2b7471a7ad761b1a1a4a2177482d49c34d9c62b487f5aec893f11e4c63",
}
KEPLER_DIGEST_F2C2DA3 = "2a7085987072fe9eaf4d1c10f54978bace463cb036418742a37ad4d9cefa2743"
ROCK = {"profileId": "silicate-rock"}
SPIN = {"x": 0.0, "y": 0.0, "z": 7.2921e-5}


def engine(mode="legacy-merge"):
    return SimulationService(CollisionConfig(mode=mode))


def with_rock(svc, spin=SPIN, mass=6.0e24, radius=6.4e6, x=(0, 0, 0), v=(0, 0, 0), material=ROCK, name="planet"):
    return svc.add_body(make(name, m=mass, r=radius, x=x, v=v, material=material, spinRadPerS=spin))


# ------------------------------------------------------------------ nothing changes without material or spin
@pytest.mark.parametrize("preset", sorted(DIGEST_F2C2DA3))
def test_preset_digests_are_unchanged(preset):
    u = create_preset_universe(universes.get_registry(), preset, None, False)
    assert u.engine.initial_state_digest == DIGEST_F2C2DA3[preset]


def test_a_fixed_id_universe_digest_is_unchanged():
    svc = engine()
    svc.load_bodies(ls.kepler_merge()[0], history_mode="step")
    assert svc.initial_state_digest == svc.capture_snapshot().digest == KEPLER_DIGEST_F2C2DA3


def test_a_body_without_material_has_exactly_the_old_json_and_no_spin_state():
    svc = engine()
    body = svc.add_body(make("plain", m=1e20, r=10.0))
    dumped = json.loads(body.model_dump_json())
    assert set(dumped) == {"id", "name", "massKg", "radiusM", "positionM", "velocityMPerS", "colorHex", "kind", "catalogueEntryId",
                           "bodyType", "assetKey", "primaryId"}
    state = json.loads(svc.snapshot().model_dump_json())
    assert "spinAngularMomentumKgM2PerS" not in state["diagnostics"]  # diagnostics v1 keys only
    assert set(state["diagnostics"]) == {"version", "totalMassKg", "totalMomentumKgMPerS", "kineticEnergyJ", "potentialEnergyJ",
                                         "angularMomentumAboutOriginKgM2PerS", "bookedSpinKgM2PerS"}
    assert svc._materials == {} and svc._rotations == {}


def test_a_material_without_spin_creates_no_spin_state_and_only_the_material_field():
    svc = engine()
    body = svc.add_body(make("rock", m=1e20, r=10.0, material=ROCK))
    dumped = json.loads(body.model_dump_json())
    assert dumped["material"] == {"profileId": "silicate-rock", "layers": None}
    assert "spinRadPerS" not in dumped and "orientation" not in dumped and svc._rotations == {}


# ------------------------------------------------------------------ rotation state creation and publication
def test_spin_creates_a_rotation_state_with_i_equal_k_m_r_squared_and_publishes_orientation():
    svc = engine()
    body = with_rock(svc)
    state = svc._rotations[body.id]
    assert state.moment_of_inertia_kg_m2 == pytest.approx(0.4 * 6.0e24 * 6.4e6 ** 2, rel=1e-15)
    assert body.spinRadPerS.z == 7.2921e-5 and body.orientation.epochS == 0.0 and body.orientation.quaternion == [1.0, 0.0, 0.0, 0.0]
    out = svc.step(1.0e4)
    published = next(b for b in out.bodies if b.id == body.id)
    half = 0.5 * 7.2921e-5 * 1.0e4  # rotation about z: q = (cos, 0, 0, sin)
    assert published.orientation.epochS == 1.0e4
    assert published.orientation.quaternion == pytest.approx([math.cos(half), 0.0, 0.0, math.sin(half)], abs=1e-12)
    assert out.diagnostics.spinAngularMomentumKgM2PerS.z == pytest.approx(state.moment_of_inertia_kg_m2 * 7.2921e-5, rel=1e-14)


def test_orientation_at_create_sets_the_epoch_state():
    svc = engine()
    q = [0.5, 0.5, 0.5, 0.5]
    body = svc.add_body(make("o", m=1e20, r=10.0, material=ROCK, orientation={"quaternion": q, "epochS": 0.0}))
    assert body.orientation.quaternion == q and body.spinRadPerS.z == 0.0 and svc._rotations[body.id].q0 == (0.5, 0.5, 0.5, 0.5)


@pytest.mark.parametrize("kwargs,code", [
    ({"spinRadPerS": SPIN}, "rotation_requires_material"),
    ({"material": {"profileId": "gas-envelope-hhe"}, "spinRadPerS": SPIN}, "rotation_requires_material"),
    ({"orientation": {"quaternion": [1, 0, 0, 0], "epochS": 0.0}}, "rotation_requires_material"),
    ({"material": ROCK, "orientation": {"quaternion": [2, 0, 0, 0], "epochS": 0.0}}, "rotation_invalid"),
    ({"material": {"profileId": "nope"}}, "material_invalid"),
])
def test_invalid_requests_are_rejected_before_anything_changes(kwargs, code):
    svc = engine()
    svc.add_body(make("keep", m=1e20, r=10.0))
    before = dump(svc)
    with pytest.raises(CodedError) as err:
        svc.add_body(make("bad", m=1e20, r=10.0, x=(1e6, 0, 0), **kwargs))
    assert err.value.code == code and err.value.status == 422
    assert dump(svc) == before and svc._materials == {} and svc._rotations == {}


# ------------------------------------------------------------------ patch / delete
def test_patch_sets_clears_and_revalidates():
    svc = engine()
    plain = svc.add_body(make("p", m=1e20, r=10.0))
    got = svc.update_body(plain.id, BodyUpdate(material=ROCK))
    assert got.material.profileId == "silicate-rock" and svc._rotations == {}
    got = svc.update_body(plain.id, BodyUpdate(spinRadPerS=SPIN))
    assert got.spinRadPerS.z == 7.2921e-5 and plain.id in svc._rotations
    i_before = svc._rotations[plain.id].moment_of_inertia_kg_m2
    svc.update_body(plain.id, BodyUpdate(massKg=2e20))  # inertia follows the mass; omega is kept
    assert svc._rotations[plain.id].moment_of_inertia_kg_m2 == pytest.approx(2 * i_before, rel=1e-15)
    with pytest.raises(CodedError) as err:  # clearing the material of a rotating body is refused ...
        svc.update_body(plain.id, BodyUpdate(material=None))
    assert err.value.code == "rotation_requires_material"
    got = svc.update_body(plain.id, BodyUpdate(material=None, spinRadPerS=None))  # ... unless the spin is cleared too
    assert got.material is None and got.spinRadPerS is None and svc._materials == {} and svc._rotations == {}
    with pytest.raises(CodedError) as err:
        svc.update_body(plain.id, BodyUpdate(spinRadPerS=SPIN))  # no material -> no spin state
    assert err.value.code == "rotation_requires_material"
    with pytest.raises(CodedError) as err:
        svc.update_body(plain.id, BodyUpdate(material={"profileId": "nope"}))
    assert err.value.code == "material_invalid"


def test_patch_to_a_profile_without_a_moment_of_inertia_is_refused_while_rotating():
    svc = engine()
    body = with_rock(svc)
    before = dump(svc)
    with pytest.raises(CodedError) as err:
        svc.update_body(body.id, BodyUpdate(material={"profileId": "gas-envelope-hhe"}))
    assert err.value.code == "rotation_requires_material" and dump(svc) == before


def test_delete_removes_the_side_tables():
    svc = engine()
    body = with_rock(svc)
    svc.add_body(make("companion", m=1e20, r=10.0, x=(1e9, 0, 0)))  # REBOUND warns when the last particle is removed
    svc.delete_body(body.id)
    assert svc._materials == {} and svc._rotations == {}


def test_material_and_spin_edits_do_not_flag_an_audited_run_as_uncontrolled():
    """Gravity ignores both, so Orbit Lab's controlled-run flag stays; the edit is still audited."""
    svc = engine()
    svc.audit_edits = True
    body = svc.add_body(make("p", m=1e20, r=10.0))
    svc.controlled = True
    svc.update_body(body.id, BodyUpdate(material=ROCK))
    assert svc.controlled is True and svc.audit[-1]["op"] == "update" and svc.audit[-1]["physical"] is False


# ------------------------------------------------------------------ digest only when non-default
def test_digest_includes_material_and_rotation_only_when_present():
    svc = engine()
    svc.load_bodies(ls.kepler_merge()[0], history_mode="step")
    base = svc.capture_snapshot().digest
    assert base == KEPLER_DIGEST_F2C2DA3
    svc.update_body("one", BodyUpdate(material=ROCK))
    with_material = svc.capture_snapshot().digest
    svc.update_body("one", BodyUpdate(spinRadPerS=SPIN))
    with_spin = svc.capture_snapshot().digest
    assert len({base, with_material, with_spin}) == 3
    svc.update_body("one", BodyUpdate(spinRadPerS=None))
    svc.update_body("one", BodyUpdate(material=None))
    assert svc.capture_snapshot().digest == base  # back to default state -> the old digest again


# ------------------------------------------------------------------ every state path
def state_tables(svc):
    return dict(svc._materials), dict(svc._rotations)


def test_snapshot_restore_reset_and_derive_keep_materials_and_rotation_bitwise():
    svc = engine()
    keeper = with_rock(svc, x=(0, 0, 0))
    snap = svc.capture_snapshot()
    assert snap.materials == svc._materials and snap.rotations == svc._rotations
    other = with_rock(svc, spin={"x": 1e-5, "y": 2e-5, "z": 3e-5}, mass=1e22, radius=1e6, x=(1e9, 0, 0), name="other")
    assert len(svc._rotations) == 2
    svc.restore_snapshot(snap)
    assert set(svc._rotations) == {keeper.id} and set(svc._materials) == {keeper.id} and other.id not in svc._meta
    assert svc._rotations[keeper.id] == snap.rotations[keeper.id]
    derived = SimulationService.from_snapshot(snap, history_mode="step")
    assert state_tables(derived) == state_tables(svc)
    assert derived._rotations is not svc._rotations and derived._materials is not svc._materials
    derived.update_body(keeper.id, BodyUpdate(spinRadPerS={"x": 0, "y": 0, "z": 1e-3}))
    assert svc._rotations[keeper.id].omega_rad_per_s.z == 7.2921e-5  # independent engines share nothing
    svc.reset()  # the initial snapshot was taken on an empty universe
    assert state_tables(svc) == ({}, {})


def test_a_failed_mutation_restores_the_tables_through_the_checkpoint():
    """The commit guard refuses at its second call (after the tables were changed): the checkpoint must restore them."""
    svc = engine()
    body = with_rock(svc)
    before_tables, before = state_tables(svc), dump(svc)
    calls = {"n": 0}

    def guard():
        calls["n"] += 1
        if calls["n"] == 2:
            raise CodedError("refused at the commit point", code="deactivated_during_step")

    with pytest.raises(CodedError):
        svc.update_body(body.id, BodyUpdate(spinRadPerS={"x": 0, "y": 0, "z": 5e-5}, material={"profileId": "iron"}), guard=guard)
    assert calls["n"] == 2
    assert state_tables(svc) == before_tables and dump(svc) == before


def test_a_failed_step_restores_the_tables():
    svc = engine()
    body = with_rock(svc)
    other = with_rock(svc, x=(1e10, 0, 0), name="b2")
    before_tables, before = state_tables(svc), dump(svc)
    svc._verify_finite = lambda: (_ for _ in ()).throw(ArithmeticError("injected"))
    with pytest.raises(SimulationFailure):
        svc.step(100.0)
    del svc._verify_finite
    assert state_tables(svc) == before_tables and dump(svc) == before and other.id in svc._rotations and body.id in svc._rotations


# ------------------------------------------------------------------ mergers of bodies that have the new state
def collide(mode, spin_a, spin_b, mat_a=ROCK, mat_b=ROCK):
    svc = engine(mode)
    a = svc.add_body(make("a", m=2e12, r=10.0, x=(-60, 0, 0), v=(5, 0, 0), material=mat_a, spinRadPerS=spin_a))
    b = svc.add_body(make("b", m=1e12, r=8.0, x=(60, 0, 0), v=(-5, 0, 0), material=mat_b, spinRadPerS=spin_b))
    out = svc.step(30.0)
    assert len(out.events) == 1
    return svc, a, b, out


@pytest.mark.parametrize("mode", ["legacy-merge", "outcome-v1"])
def test_merging_books_the_spin_angular_momentum_into_the_existing_ledger(mode):
    sa, sb = {"x": 0, "y": 0, "z": 1e-3}, {"x": 0, "y": 2e-3, "z": 0}
    svc, a, b, out = collide(mode, sa, sb)
    ev = out.events[0]
    i_a, i_b = 0.4 * 2e12 * 10.0 ** 2, 0.4 * 1e12 * 8.0 ** 2
    expected = [ev.spinAddedKgM2PerS.x + 0.0 + 0.0, ev.spinAddedKgM2PerS.y + i_b * 2e-3, ev.spinAddedKgM2PerS.z + i_a * 1e-3]
    booked = svc._resolver.spin[ev.resultBodyId]
    assert booked == pytest.approx(expected, rel=1e-12, abs=1e-6)
    assert svc._rotations == {}  # the remnant has no rotation model (no spin state is invented)
    state = svc.snapshot()
    assert state.diagnostics.bookedSpinKgM2PerS.y == pytest.approx(expected[1], rel=1e-12, abs=1e-6)
    assert state.diagnostics.spinAngularMomentumKgM2PerS is None
    assert "spinAngularMomentumKgM2PerS" not in json.loads(state.model_dump_json())["diagnostics"]


@pytest.mark.parametrize("mode", ["legacy-merge", "outcome-v1"])
def test_remnant_keeps_a_material_only_when_both_bodies_had_the_same_one(mode):
    svc, a, b, out = collide(mode, None, None)
    assert svc._materials == {out.events[0].resultBodyId: MaterialRef("silicate-rock")}
    svc2, _, _, out2 = collide(mode, None, None, mat_b={"profileId": "iron"})
    assert svc2._materials == {}  # unknown composition: no material is invented
    svc3, _, _, out3 = collide(mode, None, None, mat_b=None)
    assert svc3._materials == {}


def test_material_less_merge_is_byte_identical_to_the_pre_stage_2_behaviour():
    """The golden legacy values (tests/impact/test_deferred_equivalence.py) already pin this; here: no tables are touched."""
    svc = engine()
    bodies, steps = ls.probe_into_heavy(False)
    svc.load_bodies(bodies, history_mode="step")
    svc.step(steps[0])
    assert svc._materials == {} and svc._rotations == {} and len(svc.events()) == 1


def test_rotating_bodies_do_not_change_gravity():
    """Spin and material are bookkeeping for the collision engine: the trajectory is bit-identical with and without them."""
    plain, rich = engine(), engine()
    for svc, extra in ((plain, {}), (rich, {"material": ROCK, "spinRadPerS": SPIN})):
        svc.add_body(make("sun", m=2e30, r=7e8))
        svc.add_body(make("earth", m=6e24, r=6.4e6, x=(1.5e11, 0, 0), v=(0, 29780.0, 0), **extra))
    a, b = plain.step(1e6), rich.step(1e6)
    pa = {x.name: x for x in a.bodies}
    pb = {x.name: x for x in b.bodies}
    for name in pa:
        assert pa[name].positionM == pb[name].positionM and pa[name].velocityMPerS == pb[name].velocityMPerS
