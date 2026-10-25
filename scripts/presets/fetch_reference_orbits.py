"""Developer-only: fetches the sourced orbital elements behind the Solar System reference-orbit overlay (D-064).

    python scripts/presets/fetch_reference_orbits.py            # needs network; the application never does
    python scripts/presets/fetch_reference_orbits.py --derive   # rewrite the frontend data from the archived files

The overlay is DISPLAY ONLY: none of these objects is simulated, and nothing here feeds the backend preset state.

Outputs (all committed, so the runtime and the tests never use the network):
- backend/presets/sources/reference-orbits/horizons/<target>_2451545.0.txt   raw Horizons osculating-element text
- backend/presets/sources/reference-orbits/sbdb-main-belt.json               raw SBDB Query API response
- backend/presets/sources/reference-orbits/retrieved.json                    retrieval time, parameters, SHA-256s
- frontend/src/data/referenceOrbits.json   J2000 heliocentric ecliptic elements of the planets and 8 outer bodies
- frontend/src/data/mainBelt.json          compact elements of the first numbered main-belt asteroids

Planets and outer bodies: JPL Horizons GEOMETRIC osculating elements at J2000.0 TDB (JD 2451545.0), centre = Sun
body centre (500@10), ecliptic and mean equinox of J2000.0 (the preset frame), AU-D units. Pluto is the Pluto system
barycentre (Horizons 9), like the preset's planet-system barycentres; the others are Horizons small-body records.
Main belt: JPL SBDB Query API, numbered asteroids of orbit class MBA in number order, the database's current
osculating elements at its own epoch (4 significant digits, as served). Nothing is estimated or invented.
"""
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC_DIR = ROOT / "backend" / "presets" / "sources" / "reference-orbits"
HZ_DIR = SRC_DIR / "horizons"
BELT_RAW = SRC_DIR / "sbdb-main-belt.json"
ORBITS_FILE = ROOT / "frontend" / "src" / "data" / "referenceOrbits.json"
BELT_FILE = ROOT / "frontend" / "src" / "data" / "mainBelt.json"

HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api"
HORIZONS_PARAMS = {
    "format": "json", "MAKE_EPHEM": "YES", "EPHEM_TYPE": "ELEMENTS", "CENTER": "'500@10'", "REF_PLANE": "ECLIPTIC",
    "REF_SYSTEM": "ICRF", "OUT_UNITS": "AU-D", "TIME_TYPE": "TDB", "CSV_FORMAT": "YES", "OBJ_DATA": "NO",
}
SBDB_API = "https://ssd-api.jpl.nasa.gov/sbdb_query.api"
SBDB_PARAMS = {"fields": "pdes,a,e,i,om,w,ma,n,epoch", "sb-kind": "a", "sb-ns": "n", "sb-class": "MBA", "limit": "10000"}
JD0 = "2451545.0"

# id, display name, group, Horizons COMMAND, preset body id that the orbit belongs to (planets only)
TARGETS = [
    ("mercury", "Mercury", "planet", "199", "body-mercury"),
    ("venus", "Venus", "planet", "299", "body-venus"),
    ("earth", "Earth", "planet", "3", "body-earth"),
    ("mars", "Mars", "planet", "4", "body-mars"),
    ("jupiter", "Jupiter", "planet", "5", "body-jupiter"),
    ("saturn", "Saturn", "planet", "6", "body-saturn"),
    ("uranus", "Uranus", "planet", "7", "body-uranus"),
    ("neptune", "Neptune", "planet", "8", "body-neptune"),
    ("pluto", "Pluto", "outer", "9", None),
    ("haumea", "Haumea", "outer", "136108;", None),
    ("makemake", "Makemake", "outer", "136472;", None),
    ("quaoar", "Quaoar", "outer", "50000;", None),
    ("orcus", "Orcus", "outer", "90482;", None),
    ("chiron", "Chiron", "outer", "2060;", None),
    ("2014-nw65", "2014 NW65", "outer", "523727;", None),
    ("chiminigagua", "Chiminigagua", "outer", "532037;", None),
]


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def horizons_file(command: str) -> str:
    return f"{command.rstrip(';')}_{JD0}.txt"


def parse_elements(text: str) -> dict:
    """The single CSV row: JDTDB, date, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR."""
    body = text.split("$$SOE")[1].split("$$EOE")[0].strip()
    c = [x.strip() for x in body.split(",") if x.strip()]
    v = [float(x) for x in (c[0], *c[2:])]
    keys = ["jdTdb", "e", "qAu", "iDeg", "nodeDeg", "periDeg", "tpJd", "nDegPerDay", "meanAnomalyDeg",
            "trueAnomalyDeg", "aAu", "apoAu", "periodDays"]
    return dict(zip(keys, v))


def target_line(text: str) -> str:
    return next(l.strip() for l in text.splitlines() if l.startswith("Target body name:"))


def fetch() -> None:
    HZ_DIR.mkdir(parents=True, exist_ok=True)
    files: dict[str, dict] = {}
    for _, _, _, command, _ in TARGETS:
        q = dict(HORIZONS_PARAMS, COMMAND=f"'{command}'", TLIST=f"'{JD0}'")
        text = json.loads(get(HORIZONS_API + "?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)))["result"]
        name = horizons_file(command)
        assert parse_elements(text)["jdTdb"] == float(JD0), name
        (HZ_DIR / name).write_bytes(text.encode("utf-8"))
        files[name] = {"command": command, "sourceLine": target_line(text),
                       "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
        print(name, files[name]["sourceLine"])
        time.sleep(0.4)
    raw = get(SBDB_API + "?" + urllib.parse.urlencode(SBDB_PARAMS))
    BELT_RAW.write_bytes(raw)
    retrieved = {
        "retrievedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "horizons": {"api": HORIZONS_API, "parameters": HORIZONS_PARAMS | {"COMMAND": "<command>", "TLIST": f"'{JD0}'"},
                     "files": files},
        "sbdb": {"api": SBDB_API, "parameters": SBDB_PARAMS, "file": BELT_RAW.name,
                 "sha256": hashlib.sha256(raw).hexdigest()},
    }
    (SRC_DIR / "retrieved.json").write_text(json.dumps(retrieved, indent=2) + "\n", encoding="utf-8")


def derive() -> None:
    retrieved = json.loads((SRC_DIR / "retrieved.json").read_text(encoding="utf-8"))
    orbits = []
    for oid, name, group, command, body_id in TARGETS:
        fname = horizons_file(command)
        el = parse_elements((HZ_DIR / fname).read_text(encoding="utf-8"))
        entry = {"id": oid, "name": name, "group": group, "horizonsCommand": command,
                 "sourceLine": retrieved["horizons"]["files"][fname]["sourceLine"], "sourceFile": fname,
                 "elements": {k: el[k] for k in ("jdTdb", "e", "aAu", "iDeg", "nodeDeg", "periDeg", "meanAnomalyDeg",
                                                 "nDegPerDay")}}
        if body_id:
            entry["bodyId"] = body_id
        orbits.append(entry)
    ORBITS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ORBITS_FILE.write_text(json.dumps({
        "description": "Display-only reference orbits: heliocentric osculating Kepler ellipses at J2000.0. Not "
                       "simulated and not an ephemeris (perturbations after the epoch are ignored).",
        "epoch": {"label": "J2000.0", "jdTdb": 2451545.0},
        "frame": "Ecliptic and mean equinox of J2000.0 (Horizons REF_PLANE=ECLIPTIC, REF_SYSTEM=ICRF), "
                 "centred on the Sun (500@10); the preset frame",
        "units": "au, deg, deg/day, JD (TDB)",
        "source": "JPL Horizons geometric osculating elements; raw responses in "
                  "backend/presets/sources/reference-orbits/horizons (D-064)",
        "retrievedUtc": retrieved["retrievedUtc"],
        "orbits": orbits,
    }, indent=2) + "\n", encoding="utf-8")

    raw = json.loads(BELT_RAW.read_text(encoding="utf-8"))
    fields = raw["fields"]
    idx = {f: fields.index(f) for f in fields}
    rows = [r for r in raw["data"] if all(r[idx[f]] not in (None, "") for f in fields)]
    epochs = sorted({r[idx["epoch"]] for r in rows})
    cols = {k: [float(r[idx[k]]) for r in rows] for k in ("a", "e", "i", "om", "w", "ma", "n")}
    BELT_FILE.write_text(json.dumps({
        "description": "Main-belt asteroids for display only (not simulated): JPL SBDB osculating elements of the "
                       f"first {len(rows)} numbered asteroids of orbit class MBA, in number order. Positions at "
                       "other times use two-body propagation from the database epoch.",
        "source": "JPL SBDB Query API; raw response backend/presets/sources/reference-orbits/sbdb-main-belt.json (D-064)",
        "frame": "Heliocentric ecliptic and mean equinox of J2000.0",
        "units": {"a": "au", "e": "1", "i": "deg", "om": "deg", "w": "deg", "ma": "deg", "n": "deg/day",
                  "epochJdTdb": "JD (TDB)"},
        "retrievedUtc": retrieved["retrievedUtc"],
        "count": len(rows), "totalMatching": raw["count"], "epochJdTdb": [float(e) for e in epochs],
        "epochIndex": [epochs.index(r[idx["epoch"]]) for r in rows] if len(epochs) > 1 else None,
        **cols,
    }, separators=(",", ":")) + "\n", encoding="utf-8")
    print("wrote", ORBITS_FILE, "and", BELT_FILE, f"({len(rows)} asteroids, epochs {epochs})")


if __name__ == "__main__":
    if "--derive" not in sys.argv:
        fetch()
    derive()
    sys.exit(0)
