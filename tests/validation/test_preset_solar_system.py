"""Solar System J2000 preset: data derivation, provenance and a dynamical check against Horizons (plan 9.1, 15.1).

The expectations here are transcribed independently of the preset builder: the DE440 GM values come from the JPL SSD
"Astrodynamic Parameters" page, the truth vectors are the committed raw Horizons files parsed by a parser written for
this test. What is checked is the pipeline (units, frame, epoch, masses, engine), not ephemeris accuracy."""
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.presets import loader
from backend.presets.loader import PresetDataError, list_presets, load_preset

SRC = Path(loader.SOURCES_DIR) / "horizons"
G = 6.67430e-11
JD0, JD1, JD2 = "2451545.0", "2451910.25", "2452275.5"

# GM in km^3/s^2, JPL SSD astro_par (DE440); the Sun in m^3/s^2.
GM_KM3 = {"body-mercury": 22031.868551, "body-venus": 324858.592000, "body-earth": 398600.435507 + 4902.800118,
          "body-mars": 42828.375816, "body-jupiter": 126712764.100000, "body-saturn": 37940584.841800,
          "body-uranus": 5794556.400000, "body-neptune": 6836527.100580}
GM_SUN = 1.32712440041279419e20
TARGET = {"body-sun": "10", "body-mercury": "199", "body-venus": "299", "body-earth": "3", "body-mars": "4",
          "body-jupiter": "5", "body-saturn": "6", "body-uranus": "7", "body-neptune": "8"}


def raw_row(target: str, jd: str) -> list[float]:
    """x y z vx vy vz in km, km/s from the raw Horizons text (independent of the builder's parser)."""
    text = (SRC / f"{target}_{jd}.txt").read_text(encoding="utf-8")
    m = re.search(r"\$\$SOE\s*\n(.*?)\n\$\$EOE", text, re.S)
    cells = [c.strip() for c in m.group(1).split(",")]
    assert float(cells[0]) == float(jd)
    return [float(c) for c in cells[2:8]]


def committed():
    return json.loads((Path(loader.DATA_DIR) / "solar-system-j2000.json").read_text(encoding="utf-8"))


def test_solar_raw_to_si_exact():
    for b in committed()["bodies"]:
        row = raw_row(b["horizonsTarget"], JD0)
        assert b["state"]["positionM"] == [v * 1000.0 for v in row[:3]]
        assert b["state"]["velocityMPerS"] == [v * 1000.0 for v in row[3:]]


def test_solar_source_files_match_recorded_hashes():
    data = committed()
    retrieved = json.loads((SRC / "retrieved.json").read_text(encoding="utf-8"))
    for b in data["bodies"]:
        digest = hashlib.sha256((SRC / b["state"]["sourceFile"]).read_bytes()).hexdigest()
        assert digest == b["state"]["sourceSha256"] == retrieved["files"][b["state"]["sourceFile"]]["sha256"]
        assert "{source: DE441}" in b["state"]["sourceLine"]


def test_solar_bodies_exact_set():
    p = load_preset("solar-system-j2000")
    assert [b.id for b in p.bodies] == list(TARGET)
    assert [b.kind for b in p.bodies] == ["star"] + ["planet"] * 8
    assert "Earth" in p.bodies[3].name and "Earth–Moon barycentre" in p.bodies[3].name
    assert not any("moon" in b.id.lower() or "pluto" in b.id.lower() for b in p.bodies)  # no moons, no dwarf planets


def test_solar_masses_from_de440_gm():
    p = load_preset("solar-system-j2000")
    for b in p.bodies:
        gm = GM_SUN if b.id == "body-sun" else GM_KM3[b.id] * 1.0e9
        assert abs(b.massKg * G / gm - 1.0) <= 4e-16


def test_solar_radii_from_jpl_mean_radius():
    radii_km = {"body-mercury": 2439.4, "body-venus": 6051.8, "body-earth": 6371.0084, "body-mars": 3389.50,
                "body-jupiter": 69911.0, "body-saturn": 58232.0, "body-uranus": 25362.0, "body-neptune": 24622.0}
    for b in load_preset("solar-system-j2000").bodies:
        assert b.radiusM == (6.957e8 if b.id == "body-sun" else radii_km[b.id] * 1000.0)


def test_solar_barycentre_shift_zero_momentum():
    bodies = load_preset("solar-system-j2000").bodies
    m_tot = math.fsum(b.massKg for b in bodies)
    mom = [math.fsum(b.massKg * b.velocityMPerS[k] for b in bodies) for k in range(3)]
    scale = math.fsum(b.massKg * math.dist((0, 0, 0), b.velocityMPerS) for b in bodies)
    assert math.dist((0, 0, 0), mom) <= 1e-12 * scale
    com = [math.fsum(b.massKg * b.positionM[k] for b in bodies) / m_tot for k in range(3)]
    far = max(math.dist((0, 0, 0), b.positionM) for b in bodies)
    assert math.dist((0, 0, 0), com) <= 1e-12 * far
    # the shift is a pure translation: heliocentric vectors equal the raw Horizons differences
    sun = bodies[0]
    for b in bodies[1:]:
        raw = [(raw_row(TARGET[b.id], JD0)[k] - raw_row("10", JD0)[k]) * 1000.0 for k in range(3)]
        got = [b.positionM[k] - sun.positionM[k] for k in range(3)]
        assert got == pytest.approx(raw, rel=1e-12, abs=1e-3)


def test_solar_provenance_complete():
    data = load_preset("solar-system-j2000")
    prov = data.provenance
    for key in ("epoch", "frame", "origin", "units", "omitted", "assumptions", "limitations", "sources",
                "dataVersion", "retrieved", "bodies"):
        assert prov[key], key
    for b in prov["bodies"]:
        for part in ("gm", "radius", "state"):
            assert b[part]["basis"] in ("measured", "nominal", "derived", "assumed")
        assert b["gm"]["source"] and b["radius"]["source"] and b["state"]["sourceSha256"]
    assert "moons" in " ".join(prov["omitted"])


@pytest.fixture(scope="module")
def two_year_run():
    """Runs the preset in the application engine (dtS = 21,600 s) and compares with the Horizons truth files."""
    from backend.simulation import SimulationService
    preset = load_preset("solar-system-j2000")
    eng = SimulationService()
    eng.load_bodies(preset.bodies, history_mode=preset.history_mode, sample_interval_s=preset.sample_interval_s)
    start = eng.snapshot().diagnostics

    def worst(jd: str) -> float:
        by_id = {b.id: b for b in eng.snapshot().bodies}
        sun = by_id["body-sun"].positionM
        sun_t = raw_row("10", jd)
        out = 0.0
        for bid, target in TARGET.items():
            if bid == "body-sun":
                continue
            truth = [(raw_row(target, jd)[k] - sun_t[k]) * 1000.0 for k in range(3)]
            p = by_id[bid].positionM
            got = [p.x - sun.x, p.y - sun.y, p.z - sun.z]
            out = max(out, math.dist(got, truth) / math.dist((0, 0, 0), truth))
        return out

    result = {}
    for jd, steps in ((JD1, 1461), (JD2, 1461)):
        for _ in range(steps):
            eng.step(21600.0)
        result[jd] = worst(jd)
        assert eng.snapshot().simulationTimeS == (float(jd) - 2451545.0) * 86400.0  # landed exactly
    end = eng.snapshot().diagnostics
    e0, e1 = start.kineticEnergyJ + start.potentialEnergyJ, end.kineticEnergyJ + end.potentialEnergyJ
    result["energy_drift"] = abs(e1 / e0 - 1.0)
    result["history"] = eng.history.page(None, 0, None, 5000)
    return result


def test_solar_against_horizons_1y_2y(two_year_run):
    print(f"\nSolar System vs Horizons, worst heliocentric relative error: 1 yr {two_year_run[JD1]:.3e}, "
          f"2 yr {two_year_run[JD2]:.3e} (threshold 2e-5)")
    assert two_year_run[JD1] <= 2e-5 and two_year_run[JD2] <= 2e-5
    assert two_year_run[JD2] >= 1e-9  # a wildly-too-good number would mean the check compares a state to itself


def test_solar_energy_drift_two_years(two_year_run):
    print(f"\nSolar System K+U relative drift over 2 yr: {two_year_run['energy_drift']:.3e} (threshold 1e-12)")
    assert two_year_run["energy_drift"] <= 1e-12


def test_solar_history_is_a_5_day_grid(two_year_run):
    page = two_year_run["history"]
    assert page["mode"] == "grid" and page["sampleIntervalS"] == 432000.0
    assert [s["simulationTimeS"] for s in page["samples"]] == [k * 432000.0 for k in range(len(page["samples"]))]
    assert len(page["samples"]) == 147 and len(page["samples"][0]["positionsM"]) == 9  # floor(730.5 d / 5 d) = 146 grid samples, plus sample 0


# ---------- invalid or missing data ----------
@pytest.fixture
def broken_dirs(tmp_path, monkeypatch):
    shutil.copytree(loader.DATA_DIR, tmp_path / "data")
    shutil.copytree(loader.SOURCES_DIR, tmp_path / "sources")
    monkeypatch.setattr(loader, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(loader, "SOURCES_DIR", tmp_path / "sources")
    return tmp_path


def test_preset_invalid_file_creates_nothing(broken_dirs):
    (broken_dirs / "data" / "solar-system-j2000.json").write_text("{not json", encoding="utf-8")
    client = TestClient(app)
    before = client.get("/api/v1/universes").json()
    r = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": "solar-system-j2000"}})
    assert r.status_code == 500 and r.json()["code"] == "preset_invalid"
    assert client.get("/api/v1/universes").json() == before


def test_tampered_source_file_is_detected(broken_dirs):
    f = broken_dirs / "sources" / "horizons" / "10_2451545.0.txt"
    f.write_bytes(f.read_bytes().replace(b"E+", b"E-", 1))
    with pytest.raises(PresetDataError, match="hash"):
        load_preset("solar-system-j2000")


def test_nonfinite_or_nonpositive_values_are_rejected(broken_dirs):
    p = broken_dirs / "data" / "solar-system-j2000.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    data["bodies"][1]["gm"]["valueM3PerS2"] = -1.0
    p.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(PresetDataError):
        load_preset("solar-system-j2000")


def test_presets_list_marks_unavailable(broken_dirs):
    (broken_dirs / "data" / "solar-system-j2000.json").write_text("{}", encoding="utf-8")
    p = next(x for x in list_presets() if x["id"] == "solar-system-j2000")
    assert p["available"] is False and p["unavailableReason"]
