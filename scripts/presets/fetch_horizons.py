"""Developer-only: fetches JPL Horizons vectors and (re)writes the committed Solar System preset data.

    python scripts/presets/fetch_horizons.py            # needs network; the application never does

Outputs (all committed, so the runtime and the tests never use the network):
- backend/presets/sources/horizons/<target>_<jd>.txt   raw Horizons text, exactly as returned
- backend/presets/sources/horizons/retrieved.json      retrieval time, parameters, per-file source line and SHA-256
- backend/presets/data/solar-system-j2000.json         derived SI values + provenance (no invented numbers)

Every constant below is transcribed from a cited source; nothing is estimated. GM values: JPL SSD "Astrodynamic
Parameters" (DE440; Park et al. 2021, AJ 161:105). Radii: JPL SSD "Planetary Physical Parameters" (mean radius;
Archinal et al. 2018). Sun radius: IAU 2015 Resolution B3 nominal. G: CODATA 2018 as used by JPL and by the engine.
"""
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "backend" / "presets" / "sources" / "horizons"
DATA_FILE = ROOT / "backend" / "presets" / "data" / "solar-system-j2000.json"

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
PARAMS = {  # plan section 9.1
    "format": "json", "MAKE_EPHEM": "YES", "EPHEM_TYPE": "VECTORS", "CENTER": "500@0", "REF_PLANE": "ECLIPTIC",
    "REF_SYSTEM": "ICRF", "VEC_TABLE": "2", "VEC_CORR": "NONE", "OUT_UNITS": "KM-S", "TIME_TYPE": "TDB",
    "CSV_FORMAT": "YES", "OBJ_DATA": "NO",
}
JD0, JD1, JD2 = "2451545.0", "2451910.25", "2452275.5"  # J2000.0 (initial state); +365.25 d and +730.5 d (truth)
G_SI = 6.67430e-11

# id, display name, kind, Horizons target, colour (display only), GM terms in km^3/s^2 (None for the Sun), mean radius km
BODIES = [
    ("body-sun", "Sun", "star", "10", "#ffcc33", None, None),
    ("body-mercury", "Mercury", "planet", "199", "#9ca3af", [22031.868551], 2439.4),
    ("body-venus", "Venus", "planet", "299", "#e8c07a", [324858.592000], 6051.8),
    ("body-earth", "Earth (Earth–Moon barycentre)", "planet", "3", "#3b82f6", [398600.435507, 4902.800118], 6371.0084),
    ("body-mars", "Mars (system barycentre)", "planet", "4", "#c1440e", [42828.375816], 3389.50),
    ("body-jupiter", "Jupiter (system barycentre)", "planet", "5", "#d9a066", [126712764.100000], 69911.0),
    ("body-saturn", "Saturn (system barycentre)", "planet", "6", "#e0c97f", [37940584.841800], 58232.0),
    ("body-uranus", "Uranus (system barycentre)", "planet", "7", "#7dd3fc", [5794556.400000], 25362.0),
    ("body-neptune", "Neptune (system barycentre)", "planet", "8", "#3b5bdb", [6836527.100580], 24622.0),
]
GM_SUN_M3S2 = 1.32712440041279419e20
R_SUN_M = 6.957e8
EXTRA = [("399", JD0), ("301", JD0)]  # Earth centre and Moon, for the Moon-omission validation only


def fetch(target: str, jd: str) -> str:
    q = dict(PARAMS, COMMAND=f"'{target}'", TLIST=f"'{jd}'")
    url = API + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))["result"]


def parse_row(text: str) -> list[float]:
    body = text.split("$$SOE")[1].split("$$EOE")[0].strip()
    cells = [c.strip() for c in body.split(",") if c.strip()]
    return [float(c) for c in (cells[0], *cells[2:8])]  # jd, x, y, z, vx, vy, vz


def source_line(text: str) -> str:
    return next(l.strip() for l in text.splitlines() if l.startswith("Target body name:"))


def main() -> int:
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    jobs = [(b[3], jd) for b in BODIES for jd in (JD0, JD1, JD2)] + EXTRA
    files: dict[str, dict] = {}
    for target, jd in jobs:
        name = f"{target}_{jd}.txt"
        text = fetch(target, jd)
        row = parse_row(text)
        assert row[0] == float(jd), (name, row[0])
        (SRC_DIR / name).write_bytes(text.encode("utf-8"))
        files[name] = {"target": target, "jdTdb": float(jd), "sourceLine": source_line(text),
                       "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
        print(name, files[name]["sourceLine"])
        time.sleep(0.4)
    retrieved = {"retrievedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "api": API,
                 "parameters": PARAMS | {"COMMAND": "<target>", "TLIST": "<jd>"}, "files": files}
    (SRC_DIR / "retrieved.json").write_text(json.dumps(retrieved, indent=2) + "\n", encoding="utf-8")
    write_derived(files)
    return 0


def write_derived(files: dict) -> None:
    bodies = []
    for body_id, name, kind, target, color, gm_terms, radius_km in BODIES:
        fname = f"{target}_{JD0}.txt"
        row = parse_row((SRC_DIR / fname).read_text(encoding="utf-8"))
        pos = [row[1] * 1000.0, row[2] * 1000.0, row[3] * 1000.0]
        vel = [row[4] * 1000.0, row[5] * 1000.0, row[6] * 1000.0]
        if gm_terms is None:
            gm = {"valueM3PerS2": GM_SUN_M3S2, "sourceValue": "1.32712440041279419 x 10^20 m^3 s^-2",
                  "basis": "measured",
                  "source": "JPL SSD Astrodynamic Parameters (heliocentric gravitational constant, DE440)"}
            radius = {"valueM": R_SUN_M, "sourceValue": "6.957e8 m", "basis": "nominal",
                      "source": "IAU 2015 Resolution B3 nominal solar radius (Mamajek et al., arXiv:1510.07674)"}
        else:
            total = sum(gm_terms)
            gm = {"valueM3PerS2": total * 1.0e9,
                  "sourceValue": " + ".join(f"{t!r} km^3/s^2" for t in gm_terms) if len(gm_terms) > 1
                  else f"{gm_terms[0]!r} km^3/s^2", "basis": "measured",
                  "source": "JPL SSD Astrodynamic Parameters, DE440 (Park et al. 2021, AJ 161:105)"}
            if len(gm_terms) > 1:
                gm["note"] = "Earth + Moon (Earth–Moon barycentre carries the mass of both)"
            elif target in "45678":
                gm["note"] = "planetary system GM (planet + its moons), at the system barycentre"
            radius = {"valueM": radius_km * 1000.0, "sourceValue": f"{radius_km!r} km",
                      "basis": "assumed" if target in "345678" else "measured",
                      "source": "JPL SSD Planetary Physical Parameters, mean radius (Archinal et al. 2018)"}
            if target in "345678":
                radius["note"] = "the point mass stands for a barycentre; the planet's own mean radius is used " \
                                 "for collisions and display (not a physical claim about the barycentre)"
        fobj = files[fname]
        bodies.append({
            "id": body_id, "name": name, "kind": kind, "colorHex": color, "colorNote": "display only",
            "horizonsTarget": target, "gm": gm, "radius": radius,
            "state": {"jdTdb": row[0], "sourceFile": fname, "sourceSha256": fobj["sha256"],
                      "sourceLine": fobj["sourceLine"], "positionM": pos, "velocityMPerS": vel,
                      "basis": "measured", "note": "Horizons geometric state relative to the Solar System "
                                                    "Barycenter, km -> m by x1000, before the barycentre shift"}})
    data = {
        "id": "solar-system-j2000", "name": "Solar System (J2000.0)", "dataVersion": "1",
        "description": "The Sun and the eight planets as point masses (planet systems at their barycentres), "
                       "initial state from JPL Horizons at J2000.0.",
        "epoch": {"label": "J2000.0", "jdTdb": 2451545.0, "iso": "2000-01-01T12:00:00 TDB"},
        "frame": "Ecliptic and mean equinox of J2000.0 (Horizons REF_PLANE=ECLIPTIC, REF_SYSTEM=ICRF); "
                 "right-handed; the x-y plane is the ecliptic",
        "origin": "Barycentre of the included bodies (zero total momentum), shifted from the Solar System Barycenter",
        "units": "SI: m, kg, s, m/s", "gSI": G_SI,
        "gSource": "CODATA 2018 (JPL SSD Astrodynamic Parameters); the engine's fixed value",
        "history": {"mode": "grid", "sampleIntervalS": 432000.0},
        "validationEpochs": [{"jdTdb": float(JD1), "offsetDays": 365.25}, {"jdTdb": float(JD2), "offsetDays": 730.5}],
        "bodies": bodies,
        "omitted": ["dwarf planets", "asteroids", "comets", "every separate moon (moons are out of scope; planets "
                    "with moons are system barycentres)", "general relativity", "solar oblateness",
                    "non-gravitational forces"],
        "assumptions": ["Newtonian point-mass gravity", "positions are DE441 vectors, masses are DE440 GM "
                        "(the combined effect is measured by the committed validation tests)",
                        "m = GM / G, so the source GM is reproduced exactly"],
        "limitations": ["Earth is the Earth–Moon barycentre, up to about 4,940 km from Earth's centre",
                        "omitted bodies and relativity make the long-term evolution diverge from the real system"],
        "retrieved": {"utc": json.loads((SRC_DIR / "retrieved.json").read_text())["retrievedUtc"],
                      "api": API},
        "sources": [
            {"citation": "JPL Horizons System, vector ephemerides", "url": "https://ssd-api.jpl.nasa.gov/doc/horizons.html"},
            {"citation": "JPL SSD Astrodynamic Parameters (GM, au, G)", "url": "https://ssd.jpl.nasa.gov/astro_par.html"},
            {"citation": "Park et al. 2021, AJ 161:105 (DE440/DE441)", "url": "https://ssd.jpl.nasa.gov/doc/Park.2021.AJ.DE440.pdf"},
            {"citation": "JPL SSD Planetary Physical Parameters", "url": "https://ssd.jpl.nasa.gov/planets/phys_par.html"},
            {"citation": "IAU 2015 Resolution B3 (Mamajek et al.)", "url": "https://arxiv.org/abs/1510.07674"}],
    }
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", DATA_FILE)


if __name__ == "__main__":
    sys.exit(main())
