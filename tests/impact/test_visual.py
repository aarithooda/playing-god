"""Stage 8 gap / Stage 9 input: the VisualEventDescription of a recorded collision (D-055). Visual, not physical: these tests check what the
description claims and that it is derived only from the recorded result; they say nothing about whether the physics is right."""
import dataclasses

import pytest
from fastapi.testclient import TestClient

from backend import universes
from backend.impact import visual
from backend.impact.contracts import ContractError, VisualEventDescription, VisualOnlyEffect
from backend.main import app
from tests.helpers import make
from tests.impact.test_engine_outcomes import deferred, pair_service

UID = universes.DEFAULT_UNIVERSE_ID


def records_for(x, b, gamma=1.0, **kw):
    svc = deferred()
    pair_service(x, b, m_t=1.0e22, m_p=1.0e22 * gamma, svc=svc, **kw)
    out = svc.step(svc.approach_s)
    return svc, out


def test_a_legacy_merge_has_no_description_and_the_route_says_so():
    svc = universes.get_registry().get(UID).engine
    svc.add_body(make("a", m=1.0e22, r=1.0e6))
    svc.add_body(make("b", m=1.0e17, r=2.0e4, x=(3.0e6, 0.0, 0.0), v=(-1.5e3, 0.0, 0.0)))
    svc.step(2.5e3)
    assert visual.describe_visual(svc.collision_records()[0]) is None
    r = TestClient(app).get(f"/api/v1/universes/{UID}/collisions/col-1/visual")
    assert r.status_code == 404 and "collision_visual_unavailable" in str(r.json())


@pytest.mark.parametrize("x,b,gamma", [(0.95, 0.0, 1.0), (1.4, 0.4, 0.3), (3.0, 0.3, 1.0), (9.0, 0.0, 1.0), (2.0, 0.8, 0.2), (3.0, 0.0, 0.05)])
def test_the_description_follows_the_recorded_result(x, b, gamma):
    svc, out = records_for(x, b, gamma)
    rec = svc.collision_records()[0]
    d = visual.describe_visual(rec)
    assert d is not None and d.event_id == rec.event_id and d.outcome == rec.result.outcome and d.time_s == rec.input.impact.contact_time_s
    assert VisualEventDescription.from_dict(d.to_dict()) == d  # serialisable and strict
    assert set(d.fragment_body_ids) == {p.id for p in rec.result.created if p.representation == "fragment"}
    assert set(d.debris_parcel_ids) == {p.id for p in rec.result.debris_parcels}
    assert d.impact_site.body_id == rec.input.impact.target.id and d.impact_site.center_world_at_contact_m == rec.input.impact.contact_point_m
    # exactly one visual-only phase and one visual-only effect, both the flash; every material phase follows simulation time
    wall = [p for p in d.phases if p.basis == "visual-wall-clock"]
    assert [p.name for p in wall] == ["flash"] and [e.kind for e in d.visual_only] == ["flash"]
    material = [p for p in d.phases if p.basis == "simulation-time"]
    assert all(p.end_s is None for p in material if p.name != "contact")  # no duration of a material phase is invented
    assert all(p.start_s == d.time_s for p in material if p.name not in ("contact", "aftermath"))
    assert [p.name for p in d.phases][0] == "contact" and [p.name for p in d.phases][-1] == "aftermath"
    assert any("not signed off" in n for n in d.fidelity_notes) and any("visual-only" in n for n in d.fidelity_notes)
    debris = sum(p.mass_kg for p in rec.result.created if p.representation == "fragment") + sum(p.mass_kg for p in rec.result.debris_parcels)
    if d.ejecta_sources:
        assert d.ejecta_sources[0].mass_kg == pytest.approx(debris, rel=1e-12)
        lo, hi = d.ejecta_sources[0].speed_range_m_per_s
        assert 0.0 <= lo <= hi
    assert (d.cloud is not None) == ("cloud-expansion" in [p.name for p in d.phases])
    assert visual.describe_visual(rec) == d  # deterministic


def test_phases_follow_the_outcome_class_and_cratering_never_shows_disruption_phases():
    crater = visual.phase_names("cratering", True, True, False)
    assert "cratering" in crater and "separation" not in crater and "cloud-expansion" not in crater
    for outcome in ("catastrophic_disruption", "super_catastrophic_disruption"):
        names = visual.phase_names(outcome, True, True, False)
        assert "cratering" not in names and "separation" in names and "cloud-expansion" in names
        assert "cloud-expansion" not in visual.phase_names(outcome, True, False, False)
    assert visual.phase_names("perfect_merge", False, False, False) == ["contact", "flash", "aftermath"]
    assert "separation" in visual.phase_names("hit_and_run", False, False, True)
    assert "ejecta" not in visual.phase_names("partial_accretion", False, False, False)


def test_a_disruption_has_a_cloud_built_from_its_parcels_and_a_flash_without_mass():
    svc, out = records_for(9.0, 0.0)
    rec = svc.collision_records()[0]
    d = visual.describe_visual(rec)
    assert rec.result.outcome in ("catastrophic_disruption", "super_catastrophic_disruption")
    assert d.cloud is not None and d.cloud.initial_radius_m == max(p.radius_m for p in rec.result.debris_parcels) and d.cloud.expansion_speed_m_per_s > 0
    flash = d.visual_only[0]
    assert flash.lifetime_wall_s == visual.FLASH_LIFETIME_WALL_S and 0.0 < flash.intensity <= 1.0
    assert "massKg" not in flash.to_dict() and not hasattr(flash, "mass_kg")
    with pytest.raises(ContractError):
        VisualOnlyEffect.from_dict({**flash.to_dict(), "massKg": 1.0})  # the visual-only type refuses a mass field


def test_the_description_does_not_depend_on_anything_but_the_record():
    svc, out = records_for(3.0, 0.3)
    rec = svc.collision_records()[0]
    bare = dataclasses.replace(rec, selection_reasons=(), warnings=("x",))
    assert visual.describe_visual(bare).phases == visual.describe_visual(rec).phases
    assert visual.describe_visual(dataclasses.replace(rec, result=None)) is None  # no validated result, no description


def test_events_say_they_have_a_description_and_the_route_serves_it():
    svc = universes.get_registry().get(UID).engine
    pair_service(3.0, 0.3, svc=svc)
    out = svc.step(svc.approach_s)
    event = next(e for e in out.events if e.type == "collision")
    assert event.hasVisual is True
    client = TestClient(app)
    j = client.get(f"/api/v1/universes/{UID}/collisions/{event.id}/visual").json()
    assert j["eventId"] == event.id and j["universeId"] == UID and j["phases"][0]["name"] == "contact"
    assert {p["basis"] for p in j["phases"]} == {"simulation-time", "visual-wall-clock"}
    assert client.get(f"/api/v1/universes/{UID}/collisions/col-99/visual").status_code == 404
