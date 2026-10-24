"""Developer-only: writes backend/catalogue_data.json from the transcribed source numbers below.

    python scripts/catalogue/build_catalogue.py

Every number is transcribed from the cited source (2026-10-24); nothing is estimated. The SI value is the source number
times the unit factor named in `UNIT`. tests/test_catalogue.py re-derives every value from the recorded source number and
unit with its own factor table, so a conversion error here is caught there.
"""
import json
from pathlib import Path

G = 6.67430e-11
GM_SUN_NOMINAL = 1.3271244e20  # IAU 2015 B3 nominal solar mass parameter, m^3 s^-2
UNIT = {
    "Msun": GM_SUN_NOMINAL / G,  # kg: nominal GM / G
    "Rsun": 6.957e8,  # m: IAU 2015 B3 nominal solar radius
    "GM_m3s2": 1.0 / G,  # kg per (m^3 s^-2)
    "GM_km3s2": 1.0e9 / G,  # kg per (km^3 s^-2)
    "1e24kg": 1.0e24,
    "km": 1.0e3,
    "m": 1.0,
}
UNIT_TEXT = {
    "Msun": "x (1.3271244e20 m^3/s^2 / 6.6743e-11 m^3 kg^-1 s^-2), the IAU 2015 B3 nominal solar mass parameter divided by G",
    "Rsun": "x 6.957e8 m, the IAU 2015 B3 nominal solar radius",
    "GM_m3s2": "/ 6.6743e-11 m^3 kg^-1 s^-2 (mass = GM / G)",
    "GM_km3s2": "x 1e9 m^3/km^3 / 6.67430e-11 m^3 kg^-1 s^-2 (mass = GM / G)",
    "1e24kg": "x 1e24 kg",
    "km": "x 1000 m",
    "m": "unchanged",
}
RETRIEVED = "2026-10-24"
OUT = Path(__file__).resolve().parents[2] / "backend" / "catalogue_data.json"
PRESET_FILE = Path(__file__).resolve().parents[2] / "backend" / "presets" / "data" / "solar-system-moons-j2000.json"

ARCHIVE = "https://exoplanetarchive.ipac.caltech.edu/overview/"
JPL_PHYS = "https://ssd.jpl.nasa.gov/planets/phys_par.html"
IAU = ("IAU 2015 Resolution B3 (Mamajek et al. 2015)", "https://arxiv.org/abs/1510.07674")


def src(citation, url):
    return {"citation": citation, "url": url, "retrieved": RETRIEVED}


def prop(number, unit, shown, basis, sources, minus=None, plus=None, rng=None, note=None):
    f = UNIT[unit]
    p = {
        "value": number * f,
        "uncertainty": None,
        "basis": basis,
        "sourceValue": shown,
        "sourceNumber": number,
        "sourceUnit": unit,
        "conversion": f"{shown.split(' (')[0].split(' ±')[0]} {UNIT_TEXT[unit]}",
        "sources": sources,
    }
    if rng is not None:
        p["uncertainty"] = {"range": [rng[0] * f, rng[1] * f]}
        p["sourceRange"] = list(rng)
    elif minus is not None or plus is not None:
        p["uncertainty"] = {"minus": (minus if minus is not None else plus) * f, "plus": (plus if plus is not None else minus) * f}
        p["sourceUncertainty"] = {"minus": minus if minus is not None else plus, "plus": plus if plus is not None else minus}
    if note:
        p["note"] = note
    return p


RENDER_METADATA = {
    "sun": ("star", "sun"), "proxima-centauri": ("star", "proxima-centauri"),
    "trappist-1": ("star", "trappist-1"), "sirius-a": ("star", "sirius-a"),
    "betelgeuse": ("star", "betelgeuse"),
    "mercury": ("rocky-planet", "mercury"), "venus": ("rocky-planet", "venus"),
    "earth": ("rocky-planet", "earth"), "mars": ("rocky-planet", "mars"),
    "jupiter": ("gas-giant", "jupiter"), "saturn": ("gas-giant", "saturn"),
    "uranus": ("ice-giant", "uranus"), "neptune": ("ice-giant", "neptune"),
    "moon": ("moon", "moon"), "phobos": ("moon", "phobos"), "deimos": ("moon", "deimos"),
    "io": ("moon", "io"), "europa": ("moon", "europa"), "ganymede": ("moon", "ganymede"),
    "callisto": ("moon", "callisto"), "titan": ("moon", "titan"), "rhea": ("moon", "rhea"),
    "iapetus": ("moon", "iapetus"), "dione": ("moon", "dione"), "tethys": ("moon", "tethys"),
}

PRESET_BODY_BY_ID = {body["id"].removeprefix("body-"): body for body in json.loads(PRESET_FILE.read_text(encoding="utf-8"))["bodies"]}


def entry(eid, name, kind, mass, radius, color, notes):
    body_type, asset_key = RENDER_METADATA[eid]
    return {"id": eid, "name": name, "kind": kind, "bodyType": body_type, "assetKey": asset_key,
            "properties": {"massKg": mass, "radiusM": radius},
            "visual": {"colorHex": color, "note": "display only, not a physical property"}, "notes": notes}


def preset_visual(body_id):
    body = PRESET_BODY_BY_ID[body_id]
    return body["colorHex"]


def satellite_entry(eid, name, gm_km3s2, gm_sigma, radius_km, radius_sigma, color, gm_reference):
    mass = prop(gm_km3s2, "GM_km3s2", f"GM = {gm_km3s2} ± {gm_sigma} km^3 s^-2 ({gm_reference})", "measured",
                [src("JPL SSD Planetary Satellite Physical Parameters", "https://ssd.jpl.nasa.gov/sats/phys_par/sep.html")],
                minus=gm_sigma, plus=gm_sigma)
    radius = prop(radius_km, "km", f"{radius_km} ± {radius_sigma} km (mean radius)", "measured",
                  [src("JPL SSD Planetary Satellite Physical Parameters (mean-radius ref. 1: Archinal et al. 2018)",
                       "https://ssd.jpl.nasa.gov/sats/phys_par/sep.html")], minus=radius_sigma, plus=radius_sigma)
    return entry(eid, name, "planet", mass, radius, color, "Single-body catalogue values; the source reports GM, converted to mass as GM / G.")


ENTRIES = [
    entry("sun", "Sun", "star",
          prop(1.32712440041279419e20, "GM_m3s2", "GM☉ = 1.32712440041279419e20 m^3 s^-2", "measured",
               [src("JPL SSD Astrodynamic Parameters (heliocentric gravitational constant, DE440)", "https://ssd.jpl.nasa.gov/astro_par.html")]),
          prop(6.957e8, "m", "6.957e8 m", "nominal", [src(*IAU)], note="a defined standard value, not a best estimate"),
          "#fdb813", "The Sun's mass is GM☉ / G; the radius is the IAU nominal value."),
    entry("proxima-centauri", "Proxima Centauri", "star",
          prop(0.1221, "Msun", "0.1221 ± 0.0022 M☉", "measured",
               [src("NASA Exoplanet Archive, Proxima Cen host-star row: Faria et al. 2022, A&A 658, A115", ARCHIVE + "Proxima%20Cen")], minus=0.0022, plus=0.0022),
          prop(0.141, "Rsun", "0.141 ± 0.021 R☉", "measured",
               [src("NASA Exoplanet Archive, Proxima Cen host-star rows (the same value is listed with Anglada-Escudé et al. 2016, Nature 536, 437)", ARCHIVE + "Proxima%20Cen")], minus=0.021, plus=0.021),
          "#e0573a", "A red dwarf. The radius uncertainty is about 15%."),
    entry("trappist-1", "TRAPPIST-1", "star",
          prop(0.0898, "Msun", "0.0898 ± 0.0023 M☉", "measured",
               [src("Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022 (via the NASA Exoplanet Archive host-star row)", ARCHIVE + "TRAPPIST-1")], minus=0.0023, plus=0.0023),
          prop(0.1192, "Rsun", "0.1192 ± 0.0013 R☉", "measured",
               [src("Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022 (via the NASA Exoplanet Archive host-star row)", ARCHIVE + "TRAPPIST-1")], minus=0.0013, plus=0.0013),
          "#c0392b", "Only the star: this entry is not the TRAPPIST-1 planetary system."),
    entry("sirius-a", "Sirius A", "star",
          prop(2.063, "Msun", "2.063 ± 0.023 M☉", "measured",
               [src("Bond et al. 2017, ApJ 840, 70, doi:10.3847/1538-4357/aa6af8 (dynamical mass)", "https://arxiv.org/abs/1703.10625")], minus=0.023, plus=0.023),
          prop(1.7144, "Rsun", "1.7144 ± 0.0090 R☉", "measured",
               [src("Bond et al. 2017, ApJ 840, 70, doi:10.3847/1538-4357/aa6af8 (interferometric radius of Davis et al. 2011, adjusted to their parallax)", "https://arxiv.org/abs/1703.10625")], minus=0.0090, plus=0.0090),
          "#cfe3ff", "Sirius A only; its white-dwarf companion Sirius B is not included."),
    entry("betelgeuse", "Betelgeuse", "star",
          prop(17.75, "Msun", "16.5–19 M☉ (range; value is the midpoint 17.75)", "estimated",
               [src("Joyce et al. 2020, ApJ 902, 63, doi:10.3847/1538-4357/abb8db (present-day mass from evolutionary modelling)", "https://arxiv.org/abs/2006.09837")], rng=(16.5, 19.0),
               note="model-dependent estimate; the value shown is the midpoint of the published range"),
          prop(764.0, "Rsun", "764 (+116/−62) R☉", "estimated",
               [src("Joyce et al. 2020, ApJ 902, 63, doi:10.3847/1538-4357/abb8db (model prediction)", "https://arxiv.org/abs/2006.09837")], minus=62.0, plus=116.0,
               note="model-dependent estimate"),
          "#ff6a3d", "A red supergiant: mass and radius are model-dependent estimates, not direct measurements."),
    entry("earth", "Earth", "planet",
          prop(5.97217, "1e24kg", "5.97217 ± 0.00028 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.00028, plus=0.00028),
          prop(6371.0084, "km", "6371.0084 ± 0.0001 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=0.0001, plus=0.0001),
          "#3b82f6", "Earth alone, without the Moon."),
    entry("mars", "Mars", "planet",
          prop(0.641691, "1e24kg", "0.641691 ± 0.000030 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.000030, plus=0.000030),
          prop(3389.50, "km", "3389.50 ± 0.2 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=0.2, plus=0.2),
          "#c1440e", "Mars alone, without its moons."),
    entry("jupiter", "Jupiter", "planet",
          prop(1898.125, "1e24kg", "1898.125 ± 0.088 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.088, plus=0.088),
          prop(69911.0, "km", "69911 ± 6 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=6.0, plus=6.0),
          "#d9a066", "Jupiter alone, without its moons."),
    entry("neptune", "Neptune", "planet",
          prop(102.4092, "1e24kg", "102.4092 ± 0.0048 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.0048, plus=0.0048),
          prop(24622.0, "km", "24622 ± 19 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=19.0, plus=19.0),
          "#3b5bdb", "Neptune alone, without its moons."),
    entry("mercury", "Mercury", "planet",
          prop(0.330103, "1e24kg", "0.330103 ± 0.000021 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.000021, plus=0.000021),
          prop(2439.4, "km", "2439.4 ± 0.1 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=0.1, plus=0.1),
          preset_visual("mercury"), "Mercury alone."),
    entry("venus", "Venus", "planet",
          prop(4.86731, "1e24kg", "4.86731 ± 0.00023 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.00023, plus=0.00023),
          prop(6051.8, "km", "6051.8 ± 1.0 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=1.0, plus=1.0),
          preset_visual("venus"), "Venus alone."),
    entry("saturn", "Saturn", "planet",
          prop(568.317, "1e24kg", "568.317 ± 0.026 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.026, plus=0.026),
          prop(58232.0, "km", "58232 ± 6 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=6.0, plus=6.0),
          preset_visual("saturn"), "Saturn alone, without its moons."),
    entry("uranus", "Uranus", "planet",
          prop(86.8099, "1e24kg", "86.8099 ± 0.0040 × 10^24 kg", "measured", [src("JPL SSD Planetary Physical Parameters", JPL_PHYS)], minus=0.0040, plus=0.0040),
          prop(25362.0, "km", "25362 ± 7 km (mean radius)", "measured", [src("JPL SSD Planetary Physical Parameters (Archinal et al. 2018)", JPL_PHYS)], minus=7.0, plus=7.0),
          preset_visual("uranus"), "Uranus alone, without its moons."),
    satellite_entry("moon", "Moon", 4902.800, 0.001, 1737.4, 0.1, preset_visual("moon"), "DE440"),
    satellite_entry("phobos", "Phobos", 0.0007087, 0.0000006, 11.08, 0.04, preset_visual("phobos"), "MAR097"),
    satellite_entry("deimos", "Deimos", 0.0000962, 0.0000028, 6.2, 0.24, preset_visual("deimos"), "MAR097"),
    satellite_entry("io", "Io", 5959.91547, 0.00135, 1821.49, 0.50, preset_visual("io"), "JUP365"),
    satellite_entry("europa", "Europa", 3202.71210, 0.00181, 1560.80, 0.30, preset_visual("europa"), "JUP365"),
    satellite_entry("ganymede", "Ganymede", 9887.83275, 0.00247, 2631.20, 1.70, preset_visual("ganymede"), "JUP365"),
    satellite_entry("callisto", "Callisto", 7179.28340, 0.00324, 2410.30, 1.50, preset_visual("callisto"), "JUP365"),
    satellite_entry("titan", "Titan", 8978.13710, 0.00025, 2574.76, 0.02, preset_visual("titan"), "SAT441"),
    satellite_entry("rhea", "Rhea", 153.94175, 0.00041, 763.50, 0.60, preset_visual("rhea"), "SAT441"),
    satellite_entry("iapetus", "Iapetus", 120.51511, 0.00242, 734.30, 2.80, preset_visual("iapetus"), "SAT441"),
    satellite_entry("dione", "Dione", 73.11607, 0.00005, 561.40, 0.40, preset_visual("dione"), "SAT441"),
    satellite_entry("tethys", "Tethys", 41.21353, 0.00031, 531.10, 0.60, preset_visual("tethys"), "SAT441"),
]

CATALOGUE_ORDER = [
    "sun", "proxima-centauri", "trappist-1", "sirius-a", "betelgeuse",
    "mercury", "venus", "earth", "moon", "mars", "phobos", "deimos",
    "jupiter", "io", "europa", "ganymede", "callisto", "saturn", "titan",
    "rhea", "iapetus", "dione", "tethys", "uranus", "neptune",
]
ENTRIES.sort(key=lambda e: CATALOGUE_ORDER.index(e["id"]))

DATA = {
    "version": "1",
    "notes": [
        "Catalogue entries are single bodies, not validated systems: nothing here has positions or velocities.",
        "Colour is a display choice, not a physical property.",
        "A catalogue entry is a reusable copy: adding it to a universe never changes the catalogue.",
    ],
    "entries": ENTRIES,
}

if __name__ == "__main__":
    OUT.write_text(json.dumps(DATA, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT, len(ENTRIES), "entries")
