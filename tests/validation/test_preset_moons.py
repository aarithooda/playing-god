"""Solar System with major moons (J2000): data derivation, frame, and behaviour in the real engine.

Expectations are transcribed independently of the preset builder: GM values from DE440 / the Horizons object-data
pages, the truth vectors from the committed raw Horizons files parsed by a parser written for this test. What is
checked is the pipeline (units, frame, epoch, masses, engine) and that the moons stay physical, not ephemeris accuracy."""
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import pytest

from backend.collisions import has_satellites, select_ias15
from backend.presets import loader
from backend.presets.loader import PresetDataError, load_preset

PID = "solar-system-moons-j2000"
SRC = Path(loader.SOURCES_DIR) / "horizons"
G = 6.67430e-11
GM = {  # km^3/s^2
    "body-earth": 398600.435507, "body-moon": 4902.800118,
    "body-io": 5959.9155, "body-europa": 3202.7121, "body-ganymede": 9887.8328, "body-callisto": 7179.2834,
    "body-titan": 8978.14, "body-rhea": 153.94, "body-iapetus": 120.52, "body-dione": 73.116, "body-tethys": 41.21}
SYSTEM_GM = {"body-earth": 398600.435507 + 4902.800118, "body-jupiter": 126712764.1, "body-saturn": 37940584.8418}
MOONS = {"body-moon": "body-earth", "body-io": "body-jupiter", "body-europa": "body-jupiter",
         "body-ganymede": "body-jupiter", "body-callisto": "body-jupiter", "body-titan": "body-saturn",
         "body-rhea": "body-saturn", "body-iapetus": "body-saturn", "body-dione": "body-saturn",
         "body-tethys": "body-saturn"}
RADIUS_KM = {"body-moon": 1737.4, "body-io": 1821.49, "body-europa": 1560.8, "body-ganymede": 2631.2,
             "body-callisto": 2410.3, "body-titan": 2575.5, "body-rhea": 764.5, "body-iapetus": 734.5,
             "body-dione": 562.5, "body-tethys": 536.3}
TARGET = {"body-sun": "10", "body-mercury": "199", "body-venus": "299", "body-earth": "399", "body-moon": "301",
          "body-mars": "4", "body-jupiter": "599", "body-io": "501", "body-europa": "502", "body-ganymede": "503",
          "body-callisto": "504", "body-saturn": "699", "body-titan": "606", "body-rhea": "605",
          "body-iapetus": "608", "body-dione": "604", "body-tethys": "603", "body-uranus": "7", "body-neptune": "8"}
# published mean sidereal periods in days (JPL SSD satellite mean elements)
PERIOD_D = {"body-moon": 27.3217, "body-io": 1.769138, "body-europa": 3.551181, "body-ganymede": 7.154553,
            "body-callisto": 16.689018, "body-titan": 15.945421, "body-tethys": 1.887802, "body-dione": 2.736915}


def raw_row(target: str) -> list[float]:
    text = (SRC / f"{target}_2451545.0.txt").read_text(encoding="utf-8")
    m = re.search(r"\$\$SOE\s*\n(.*?)\n\$\$EOE", text, re.S)
    cells = [c.strip() for c in m.group(1).split(",")]
    assert float(cells[0]) == 2451545.0
    return [float(c) for c in cells[2:8]]


def committed():
    return json.loads((Path(loader.DATA_DIR) / f"{PID}.json").read_text(encoding="utf-8"))


def sub(a, b):
    return [x - y for x, y in zip(a, b)]


def norm(a):
    return math.sqrt(sum(x * x for x in a))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


@pytest.fixture(scope="module")
def preset():
    return load_preset(PID)


# ---------- data and provenance ----------
def test_body_set_order_and_count(preset):
    assert [b.id for b in preset.bodies] == list(TARGET)
    assert preset.summary["bodyCount"] == 19
    assert [b.kind for b in preset.bodies] == ["star"] + ["planet"] * 18


def test_metadata_and_primaries(preset):
    by = {b.id: b for b in preset.bodies}
    for moon, primary in MOONS.items():
        assert by[moon].primaryId == primary and by[moon].bodyType == "moon"
        assert by[moon].assetKey == moon.removeprefix("body-")
    for b in preset.bodies:
        if b.id not in MOONS:
            assert b.primaryId is None and b.bodyType != "moon"


def test_raw_to_si_exact_and_hashes():
    retrieved = json.loads((SRC / "retrieved.json").read_text(encoding="utf-8"))
    for b in committed()["bodies"]:
        row = raw_row(b["horizonsTarget"])
        assert b["horizonsTarget"] == TARGET[b["id"]]
        assert b["state"]["positionM"] == [v * 1000.0 for v in row[:3]]
        assert b["state"]["velocityMPerS"] == [v * 1000.0 for v in row[3:]]
        digest = hashlib.sha256((SRC / b["state"]["sourceFile"]).read_bytes()).hexdigest()
        assert digest == b["state"]["sourceSha256"] == retrieved["files"][b["state"]["sourceFile"]]["sha256"]
        assert re.search(r"\{source: (DE441|jup365_merged|sat441l)\}", b["state"]["sourceLine"])


def test_masses_and_radii(preset):
    by = {b.id: b for b in preset.bodies}
    for bid, gm in GM.items():
        assert abs(by[bid].massKg * G / (gm * 1e9) - 1.0) <= 4e-16
    for bid, r in RADIUS_KM.items():
        assert by[bid].radiusM == r * 1000.0
    for planet, system_gm in SYSTEM_GM.items():  # every planet system keeps its DE440 system GM
        members = [planet] + [m for m, p in MOONS.items() if p == planet]
        assert abs(sum(by[m].massKg for m in members) * G / (system_gm * 1e9) - 1.0) <= 1e-14


def test_planets_without_listed_moons_unchanged_from_barycentre_preset(preset):
    old = {b.id: b for b in load_preset("solar-system-j2000").raw_bodies}
    new = {b.id: b for b in preset.raw_bodies}
    for bid in ("body-sun", "body-mercury", "body-venus", "body-mars", "body-uranus", "body-neptune"):
        assert new[bid].massKg == old[bid].massKg
        assert new[bid].positionM == old[bid].positionM and new[bid].velocityMPerS == old[bid].velocityMPerS


def test_system_barycentres_match_the_barycentre_preset(preset):
    """Planet + listed moons reproduce the DE441 planet-system barycentre (Horizons 3, 5, 6) to within the mass of
    the unlisted small moons (largest effect: Saturn, 0.15 km at J2000)."""
    new = {b.id: b for b in preset.raw_bodies}
    old = {b.id: b for b in load_preset("solar-system-j2000").raw_bodies}
    for planet in SYSTEM_GM:
        members = [planet] + [m for m, p in MOONS.items() if p == planet]
        mass = sum(new[m].massKg for m in members)
        pos = [sum(new[m].massKg * new[m].positionM[k] for m in members) / mass for k in range(3)]
        vel = [sum(new[m].massKg * new[m].velocityMPerS[k] for m in members) / mass for k in range(3)]
        assert math.dist(pos, old[planet].positionM) <= 500.0  # m
        assert math.dist(vel, old[planet].velocityMPerS) <= 1e-2  # m/s (Saturn: 3.3e-3, the unlisted small moons)


def test_zero_total_momentum_and_barycentre_centre(preset):
    bodies = preset.bodies
    m_tot = math.fsum(b.massKg for b in bodies)
    mom = [math.fsum(b.massKg * b.velocityMPerS[k] for b in bodies) for k in range(3)]
    scale = math.fsum(b.massKg * norm(b.velocityMPerS) for b in bodies)
    assert norm(mom) <= 1e-12 * scale
    com = [math.fsum(b.massKg * b.positionM[k] for b in bodies) / m_tot for k in range(3)]
    assert norm(com) <= 1e-12 * max(norm(b.positionM) for b in bodies)


def test_moon_relative_to_planet_geometry(preset):
    """Frame/units check: separations, binding and orbit planes of the moons relative to their planet."""
    by = {b.id: b for b in preset.bodies}
    expect_km = {"body-moon": (357e3, 407e3), "body-io": (415e3, 430e3), "body-europa": (660e3, 685e3),
                 "body-ganymede": (1060e3, 1080e3), "body-callisto": (1850e3, 1910e3),
                 "body-titan": (1180e3, 1260e3), "body-rhea": (520e3, 535e3), "body-iapetus": (3400e3, 3700e3),
                 "body-dione": (373e3, 382e3), "body-tethys": (292e3, 298e3)}

    def rel(moon):
        return (sub(by[moon].positionM, by[MOONS[moon]].positionM),
                sub(by[moon].velocityMPerS, by[MOONS[moon]].velocityMPerS))

    def tilt(moon):
        h = cross(*rel(moon))
        return math.degrees(math.acos(h[2] / norm(h)))

    for moon, primary in MOONS.items():
        r, v = rel(moon)
        lo, hi = expect_km[moon]
        assert lo * 1e3 <= norm(r) <= hi * 1e3, moon
        mu = G * (by[moon].massKg + by[primary].massKg)
        assert 0.5 * norm(v) ** 2 - mu / norm(r) < 0.0, f"{moon} is not bound to {primary}"
        assert cross(r, v)[2] > 0.0, f"{moon} is retrograde in the ecliptic frame"
    # orbit-plane tilt against the ecliptic pole identifies the frame: the Moon ~5 deg, Titan ~27 deg (Saturn's tilt)
    assert 4.0 <= tilt("body-moon") <= 6.5
    assert 24.0 <= tilt("body-titan") <= 30.0
    assert tilt("body-io") <= 5.0 and tilt("body-ganymede") <= 5.0


def test_provenance_documents_moons():
    prov = committed()
    for key in ("epoch", "frame", "origin", "units", "omitted", "assumptions", "limitations", "sources", "retrieved"):
        assert prov[key], key
    for b in prov["bodies"]:
        for part in ("gm", "radius", "state"):
            assert b[part]["basis"] in ("measured", "nominal", "derived", "assumed")
        assert b["gm"]["source"] and b["radius"]["source"] and b["state"]["sourceFile"]


@pytest.mark.parametrize("bad", ["body-nowhere", "body-moon"])
def test_primary_must_be_another_body_of_the_preset(tmp_path, monkeypatch, bad):
    shutil.copytree(loader.DATA_DIR, tmp_path / "data")
    shutil.copytree(Path(loader.DATA_DIR).parent / "sources", tmp_path / "sources")
    path = tmp_path / "data" / f"{PID}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["bodies"][4]["primaryId"] = bad  # body 4 is the Moon: an unknown primary, then itself
    path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(loader, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(loader, "SOURCES_DIR", tmp_path / "sources", raising=False)
    with pytest.raises(PresetDataError, match="primaryId"):
        load_preset(PID)


# ---------- dynamics in the real engine ----------
@pytest.fixture(scope="module")
def run():
    """One year at 5-day steps in the application engine; relative state of every moon recorded after each step."""
    from backend.simulation import SimulationService
    preset = load_preset(PID)
    eng = SimulationService()
    eng.load_bodies(preset.bodies, history_mode=preset.history_mode, sample_interval_s=preset.sample_interval_s)
    plain = load_preset("solar-system-j2000")
    old = SimulationService()
    old.load_bodies(plain.bodies, history_mode=plain.history_mode, sample_interval_s=plain.sample_interval_s)
    start = eng.snapshot()
    series = {m: [] for m in MOONS}
    for _ in range(73):  # 365 d
        eng.step(432000.0)
        old.step(432000.0)
        by = {b.id: b for b in eng.snapshot().bodies}
        for m, p in MOONS.items():
            a, c = by[m], by[p]
            series[m].append((
                [a.positionM.x - c.positionM.x, a.positionM.y - c.positionM.y, a.positionM.z - c.positionM.z],
                [a.velocityMPerS.x - c.velocityMPerS.x, a.velocityMPerS.y - c.velocityMPerS.y,
                 a.velocityMPerS.z - c.velocityMPerS.z]))
    return {"start": start, "end": eng.snapshot(), "series": series, "old_end": old.snapshot(),
            "events": eng.events(), "preset": preset}


def test_moons_stay_bound_and_near_their_initial_semimajor_axis(run):
    by = {b.id: b for b in run["preset"].bodies}
    for moon, primary in MOONS.items():
        mu = G * (by[moon].massKg + by[primary].massKg)
        r0 = sub(by[moon].positionM, by[primary].positionM)
        v0 = sub(by[moon].velocityMPerS, by[primary].velocityMPerS)
        a0 = -mu / (2.0 * (0.5 * norm(v0) ** 2 - mu / norm(r0)))
        for r, v in run["series"][moon]:
            assert 0.5 * norm(v) ** 2 - mu / norm(r) < 0.0, f"{moon} became unbound"
            assert 0.8 * a0 <= norm(r) <= 1.2 * a0, f"{moon} left its orbit region"


def test_orbital_periods_match_published_values(run):
    """Mean period within 1 % of the published sidereal period. Slow moons: accumulated orbital angle about the
    planet over 365 d. Fast moons (period < 10 d, aliased by 5-day sampling): mean angular rate from r x v."""
    for moon, period in PERIOD_D.items():
        pts = run["series"][moon]
        if period < 10.0:
            rates = [cross(r, v)[2] / (r[0] ** 2 + r[1] ** 2) for r, v in pts]  # dtheta/dt in the xy plane
            measured = 2 * math.pi / (sum(rates) / len(rates)) / 86400.0
        else:
            angle, prev = 0.0, None
            for r, _ in pts:
                ang = math.atan2(r[1], r[0])
                if prev is not None:
                    angle += (ang - prev + math.pi) % (2 * math.pi) - math.pi
                prev = ang
            measured = (len(pts) - 1) * 5.0 * 2 * math.pi / abs(angle)
        assert measured == pytest.approx(period, rel=0.01), moon


def test_energy_and_angular_momentum_conserved(run):
    a, b = run["start"].diagnostics, run["end"].diagnostics
    e0, e1 = a.kineticEnergyJ + a.potentialEnergyJ, b.kineticEnergyJ + b.potentialEnergyJ
    assert abs(e1 - e0) / abs(e0) <= 1e-12  # measured 4e-16
    l0, l1 = a.angularMomentumAboutOriginKgM2PerS, b.angularMomentumAboutOriginKgM2PerS
    assert math.dist((l0.x, l0.y, l0.z), (l1.x, l1.y, l1.z)) / norm((l0.x, l0.y, l0.z)) <= 1e-12  # measured 2e-16


def test_no_collisions_and_every_body_remains(run):
    assert run["events"] == []
    assert len(run["end"].bodies) == 19


def test_planet_systems_follow_the_barycentre_model(run):
    """The centre of mass of each planet + moons tracks the point-mass barycentre of the 9-body preset; the gap is the
    effect of resolving the moons (the Moon note in context/PRESETS.md: up to ~234 km for Earth over two years)."""
    new = {b.id: b for b in run["end"].bodies}
    old = {b.id: b for b in run["old_end"].bodies}
    for planet in SYSTEM_GM:
        members = [planet] + [m for m, p in MOONS.items() if p == planet]
        mass = sum(new[m].massKg for m in members)
        com = [sum(new[m].massKg * getattr(new[m].positionM, c) for m in members) / mass for c in "xyz"]
        o = old[planet].positionM
        assert math.dist(com, [o.x, o.y, o.z]) <= 300e3  # m; measured 117 / 1 / 107 km after 365 d
    for bid in ("body-mercury", "body-mars", "body-neptune"):
        n, o = new[bid].positionM, old[bid].positionM
        assert math.dist((n.x, n.y, n.z), (o.x, o.y, o.z)) <= 300e3  # measured 0.03 km


# ---------- integrator selection ----------
def _sim_of(p):
    import rebound
    sim = rebound.Simulation()
    sim.G = G
    for b in p.bodies:
        sim.add(m=b.massKg, r=b.radiusM, x=b.positionM[0], y=b.positionM[1], z=b.positionM[2],
                vx=b.velocityMPerS[0], vy=b.velocityMPerS[1], vz=b.velocityMPerS[2], name=b.id)
    return sim


@pytest.mark.parametrize("pid,mode,sats", [(PID, "prs23", True), ("solar-system-j2000", "global", False)])
def test_step_size_criterion_depends_on_satellites(pid, mode, sats):
    sim = _sim_of(load_preset(pid))
    assert has_satellites(sim) is sats
    select_ias15(sim)
    assert str(sim.integrator.adaptive_mode).lower().endswith(mode)


def test_global_criterion_is_kept_for_symmetric_equal_masses():
    import rebound
    sim = rebound.Simulation()
    sim.G = G
    for x in (-1e8, 0.0, 1e8):
        sim.add(m=1e24, r=1e5, x=x)
    assert has_satellites(sim) is False
    select_ias15(sim)
    assert str(sim.integrator.adaptive_mode).lower().endswith("global")


# ---------- regression: sizes, identities and the frontend fixture ----------
SHARED_NO_MOONS = ("body-sun", "body-mercury", "body-venus", "body-mars", "body-uranus", "body-neptune")
SHARED_WITH_MOONS = ("body-earth", "body-jupiter", "body-saturn")


def test_shared_bodies_keep_identity_and_physical_radius_in_both_presets(preset):
    """Loading the moons preset must not change any radius or id the nine-body preset has (Earth, Jupiter and Saturn use
    their own mean radius in both) and must not make a planet a moon."""
    old = {b.id: b for b in load_preset("solar-system-j2000").bodies}
    new = {b.id: b for b in preset.bodies}
    assert set(old) <= set(new)
    assert [i for i in new if i in old] == list(old)  # same relative order
    for bid in SHARED_NO_MOONS + SHARED_WITH_MOONS:
        assert new[bid].radiusM == old[bid].radiusM, bid
        assert new[bid].kind == old[bid].kind and new[bid].assetKey == old[bid].assetKey, bid
        assert new[bid].bodyType == old[bid].bodyType and new[bid].primaryId is None, bid
    assert new["body-earth"].radiusM == pytest.approx(6371008.4, rel=1e-15) and new["body-sun"].radiusM == 6.957e8
    assert new["body-moon"].radiusM == pytest.approx(1737400.0, rel=1e-15)
    assert new["body-sun"].radiusM > 100 * new["body-earth"].radiusM > 100 * 3 * new["body-moon"].radiusM


def test_unrelated_initial_conditions_unchanged(preset):
    old = {b.id: b for b in load_preset("solar-system-j2000").raw_bodies}
    new = {b.id: b for b in preset.raw_bodies}
    for bid in SHARED_NO_MOONS:
        assert (new[bid].massKg, new[bid].positionM, new[bid].velocityMPerS) == (old[bid].massKg, old[bid].positionM, old[bid].velocityMPerS)


def test_planets_and_moons_are_distinguished_by_primary_only(preset):
    moons = {b.id for b in preset.bodies if b.primaryId is not None}
    assert moons == set(MOONS)
    assert {b.id for b in preset.bodies if b.bodyType == "moon"} == moons
    by_id = {b.id for b in preset.bodies}
    assert all(b.primaryId in by_id for b in preset.bodies if b.primaryId)


def test_frontend_preset_fixture_is_current(preset):
    """frontend/src/test/presetBodies.json feeds the frontend size/path regression tests; it must mirror the presets."""
    fixture = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "src" / "test" / "presetBodies.json").read_text(encoding="utf-8"))
    for pid in ("solar-system-j2000", PID):
        expected = [{"id": b.id, "name": b.name, "kind": b.kind, "radiusM": b.radiusM,
                     "positionM": {"x": b.positionM[0], "y": b.positionM[1], "z": b.positionM[2]}, "colorHex": b.colorHex,
                     "bodyType": b.bodyType, "assetKey": b.assetKey, "primaryId": b.primaryId} for b in load_preset(pid).bodies]
        assert fixture[pid] == expected, pid


def test_history_api_keeps_ids_radii_and_metadata_for_both_presets():
    from fastapi.testclient import TestClient
    from backend.main import app
    client = TestClient(app)
    for pid, count in (("solar-system-j2000", 9), (PID, 19)):
        made = client.post("/api/v1/universes", json={"source": {"kind": "preset", "presetId": pid}, "activate": True}).json()
        uid = made["id"]
        epoch = client.get("/api/v1/universes").json()["activationEpoch"]
        for _ in range(3):
            client.post(f"/api/v1/universes/{uid}/step?activationEpoch={epoch}", json={"dtS": 432000.0})
        hist = client.get(f"/api/v1/universes/{uid}/history").json()
        expected = {b.id: b for b in load_preset(pid).bodies}
        assert set(hist["bodies"]) == set(expected) and len(expected) == count
        assert all(set(s["positionsM"]) == set(expected) for s in hist["samples"]) and len(hist["samples"]) >= 3
        for bid, meta in hist["bodies"].items():
            assert meta["radiusM"] == expected[bid].radiusM
            assert meta["primaryId"] == expected[bid].primaryId and meta["bodyType"] == (expected[bid].bodyType or "default")
