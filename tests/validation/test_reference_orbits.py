"""Display-only reference orbits and main-belt sample (D-064): provenance and consistency with the J2000 preset.

None of these objects is simulated. What is checked: the committed frontend data is exactly what the archived JPL
responses say (re-parsed here by a parser written for this test), the archives match their recorded SHA-256, and the
planets' Horizons heliocentric elements reproduce the preset's own J2000 state (position AND velocity), which pins the
frame, epoch and orientation conventions the frontend uses to draw the guides."""
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "backend" / "presets" / "sources" / "reference-orbits"
ORBITS = ROOT / "frontend" / "src" / "data" / "referenceOrbits.json"
BELT = ROOT / "frontend" / "src" / "data" / "mainBelt.json"
PRESET = ROOT / "backend" / "presets" / "data" / "solar-system-j2000.json"
AU_M = 149_597_870_700.0
DAY_S = 86_400.0
OUTER = {"pluto": "9", "haumea": "136108;", "makemake": "136472;", "quaoar": "50000;", "orcus": "90482;",
         "chiron": "2060;", "2014-nw65": "523727;", "chiminigagua": "532037;"}


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def raw_elements(fname: str) -> dict:
    text = (SRC / "horizons" / fname).read_text(encoding="utf-8")
    m = re.search(r"\$\$SOE\s*\n(.*?)\n\$\$EOE", text, re.S)
    c = [x.strip() for x in m.group(1).split(",")]
    gm = float(re.search(r"Keplerian GM\s*:\s*(\S+) au\^3/d\^2", text).group(1))
    return {"jdTdb": float(c[0]), "e": float(c[2]), "iDeg": float(c[4]), "nodeDeg": float(c[5]), "periDeg": float(c[6]),
            "nDegPerDay": float(c[8]), "meanAnomalyDeg": float(c[9]), "aAu": float(c[11]), "gmAu3PerDay2": gm,
            "frame": "Reference frame : Ecliptic of J2000.0" in text, "center": "Center body name: Sun (10)" in text}


def state(el: dict) -> tuple[list[float], list[float]]:
    """Heliocentric position (m) and velocity (m/s) from osculating elements, with Horizons' own Keplerian GM."""
    a, e = el["aAu"] * AU_M, el["e"]
    i, node, peri, M = (math.radians(el[k]) for k in ("iDeg", "nodeDeg", "periDeg", "meanAnomalyDeg"))
    E = M
    for _ in range(50):
        E -= (E - e * math.sin(E) - M) / (1 - e * math.cos(E))
    mu = el["gmAu3PerDay2"] * AU_M**3 / DAY_S**2
    r = a * (1 - e * math.cos(E))
    xp, yp = a * (math.cos(E) - e), a * math.sqrt(1 - e * e) * math.sin(E)
    k = math.sqrt(mu * a) / r
    vxp, vyp = -k * math.sin(E), k * math.sqrt(1 - e * e) * math.cos(E)
    cO, sO, ci, si, cw, sw = math.cos(node), math.sin(node), math.cos(i), math.sin(i), math.cos(peri), math.sin(peri)
    p = (cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si)
    q = (-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si)
    return [xp * p[j] + yp * q[j] for j in range(3)], [vxp * p[j] + vyp * q[j] for j in range(3)]


def test_archives_match_recorded_hashes():
    retrieved = load(SRC / "retrieved.json")
    for fname, meta in retrieved["horizons"]["files"].items():
        assert hashlib.sha256((SRC / "horizons" / fname).read_bytes()).hexdigest() == meta["sha256"], fname
    assert hashlib.sha256((SRC / retrieved["sbdb"]["file"]).read_bytes()).hexdigest() == retrieved["sbdb"]["sha256"]


def test_committed_elements_are_the_raw_horizons_values():
    data = load(ORBITS)
    assert data["epoch"]["jdTdb"] == 2451545.0
    assert {o["id"]: o["horizonsCommand"] for o in data["orbits"] if o["group"] == "outer"} == OUTER
    for o in data["orbits"]:
        raw = raw_elements(o["sourceFile"])
        assert raw["frame"] and raw["center"], o["id"]
        assert raw["jdTdb"] == 2451545.0
        for key, value in o["elements"].items():
            assert value == raw[key], (o["id"], key)


def test_planet_elements_reproduce_the_preset_state():
    preset = {b["id"]: b for b in load(PRESET)["bodies"]}
    sun = preset["body-sun"]["state"]
    for o in (o for o in load(ORBITS)["orbits"] if o["group"] == "planet"):
        body = preset[o["bodyId"]]["state"]
        r_exp = [body["positionM"][j] - sun["positionM"][j] for j in range(3)]
        v_exp = [body["velocityMPerS"][j] - sun["velocityMPerS"][j] for j in range(3)]
        r, v = state(raw_elements(o["sourceFile"]))
        assert math.dist(r, r_exp) / math.hypot(*r_exp) < 1e-9, o["id"]
        assert math.dist(v, v_exp) / math.hypot(*v_exp) < 1e-9, o["id"]


def test_pluto_crosses_neptunes_radial_range():
    el = {o["id"]: o["elements"] for o in load(ORBITS)["orbits"]}
    q = lambda k: el[k]["aAu"] * (1 - el[k]["e"])
    Q = lambda k: el[k]["aAu"] * (1 + el[k]["e"])
    assert q("pluto") < Q("neptune") < Q("pluto")
    assert el["pluto"]["iDeg"] > 15


def test_main_belt_is_the_raw_sbdb_sample():
    raw = load(SRC / "sbdb-main-belt.json")
    belt = load(BELT)
    f = raw["fields"]
    assert belt["count"] == len(raw["data"]) == 10000
    assert [r[f.index("pdes")] for r in raw["data"][:3]] == ["1", "2", "3"]  # number order
    for key in ("a", "e", "i", "om", "w", "ma", "n"):
        assert belt[key] == [float(r[f.index(key)]) for r in raw["data"]], key
    assert belt["epochJdTdb"] == sorted({float(r[f.index("epoch")]) for r in raw["data"]})
    assert all(1.7 < a < 3.3 for a in belt["a"])  # SBDB class MBA: 2.0 < a < 3.2 au (as served, 4 digits)
    assert all(0 <= e < 0.5 for e in belt["e"])
