"""Stage 11 (D-058, D-059): sourced material annotations of the presets. Software correctness only; the values are
quoted from the cited NASA pages and are owner-accepted, NOT independently validated."""
import json
import shutil
from pathlib import Path

import pytest

from backend.presets import loader
from backend.presets.loader import MATERIAL_QUANTITIES, PresetDataError, load_preset

PRESETS = ("solar-system-j2000", "solar-system-moons-j2000")
SOURCED_MOI = {"body-mercury": 0.35, "body-venus": 0.337, "body-earth": 0.3308, "body-moon": 0.394,
               "body-mars": 0.366, "body-jupiter": 0.254, "body-saturn": 0.210, "body-uranus": 0.225}


@pytest.mark.parametrize("pid", PRESETS)
def test_every_body_has_an_annotation_and_every_number_is_cited(pid):
    p = load_preset(pid)
    assert set(p.material_annotations) == {b.id for b in p.bodies}
    for bid, a in p.material_annotations.items():
        for name, e in a["properties"].items():
            assert e["value"] > 0 and e["units"] and e["basis"] in ("literature", "derived") and e["source"], (bid, name)
            if e["basis"] == "literature":
                assert e["source"].startswith("https://nssdc.gsfc.nasa.gov/planetary/factsheet/") and e["retrieved"]


@pytest.mark.parametrize("pid", PRESETS)
def test_sourced_moments_are_exactly_the_cited_values_and_nothing_else_is_invented(pid):
    p = load_preset(pid)
    for bid, a in p.material_annotations.items():
        moi = a["properties"].get("momentOfInertiaFactor")
        assert (moi["value"] if moi else None) == SOURCED_MOI.get(bid)
        # no composition, structure class, LS12, wave speed or cratering value exists for any body
        assert {"composition", "structureClass", "ls12", "waveSpeedMPerS", "cratering"} <= set(a["unsupported"])
        assert ("momentOfInertiaFactor" in a["unsupported"]) == (moi is None)
        assert set(a["unsupported"]) | set(a["properties"]) == set(MATERIAL_QUANTITIES) | set(a["properties"])


def test_bodies_without_a_source_stay_unsupported():
    p = load_preset("solar-system-moons-j2000")
    for bid in ("body-sun", "body-neptune", "body-io", "body-titan", "body-tethys"):
        assert "momentOfInertiaFactor" in p.material_annotations[bid]["unsupported"]


def test_mean_density_is_derived_from_gm_and_radius():
    p = load_preset("solar-system-moons-j2000")
    d = p.material_annotations["body-earth"]["properties"]["meanDensityKgPerM3"]
    assert d["basis"] == "derived" and abs(d["value"] / 5513 - 1) < 2e-3


def test_annotations_do_not_touch_the_engine_bodies():
    p = load_preset("solar-system-moons-j2000")
    assert all(not hasattr(b, "material") for b in p.bodies)


def _with_materials(tmp_path, monkeypatch, mutate):
    d = tmp_path / "data"
    shutil.copytree(loader.DATA_DIR, d)
    doc = json.loads((d / loader.MATERIALS_FILE).read_text(encoding="utf-8"))
    mutate(doc)
    (d / loader.MATERIALS_FILE).write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setattr(loader, "DATA_DIR", d)


@pytest.mark.parametrize("field", ["source", "units", "retrieved", "sourceLabel", "applicability"])
def test_an_annotation_without_a_source_field_is_rejected(tmp_path, monkeypatch, field):
    _with_materials(tmp_path, monkeypatch, lambda doc: doc["bodies"]["body-earth"]["momentOfInertiaFactor"].pop(field))
    with pytest.raises(PresetDataError, match="body-earth.momentOfInertiaFactor"):
        load_preset("solar-system-j2000")


def test_unknown_quantities_and_bad_values_are_rejected(tmp_path, monkeypatch):
    _with_materials(tmp_path, monkeypatch, lambda doc: doc["bodies"]["body-earth"].update(
        {"waveSpeedMPerS": {"value": 5000.0}}))
    with pytest.raises(PresetDataError, match="not an annotatable quantity"):
        load_preset("solar-system-j2000")
    _with_materials(tmp_path / "b", monkeypatch, lambda doc: doc["bodies"]["body-earth"]["momentOfInertiaFactor"].update(
        {"value": 0.5}))
    with pytest.raises(PresetDataError, match="within"):
        load_preset("solar-system-j2000")
