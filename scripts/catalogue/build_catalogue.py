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
    "1e24kg": 1.0e24,
    "km": 1.0e3,
    "m": 1.0,
}
UNIT_TEXT = {
    "Msun": "x (1.3271244e20 m^3/s^2 / 6.6743e-11 m^3 kg^-1 s^-2), the IAU 2015 B3 nominal solar mass parameter divided by G",
    "Rsun": "x 6.957e8 m, the IAU 2015 B3 nominal solar radius",
    "GM_m3s2": "/ 6.6743e-11 m^3 kg^-1 s^-2 (mass = GM / G)",
    "1e24kg": "x 1e24 kg",
    "km": "x 1000 m",
    "m": "unchanged",
}
RETRIEVED = "2026-10-24"
OUT = Path(__file__).resolve().parents[2] / "backend" / "catalogue_data.json"

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


def entry(eid, name, kind, mass, radius, color, notes):
    return {"id": eid, "name": name, "kind": kind, "properties": {"massKg": mass, "radiusM": radius},
            "visual": {"colorHex": color, "note": "display only, not a physical property"}, "notes": notes}


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
]

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
