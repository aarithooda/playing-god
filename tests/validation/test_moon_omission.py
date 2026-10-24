"""Consequences of treating Earth + Moon as one point mass (plan 9.4, spec section 6.3). Measured, not assumed.

Model A (what the app uses): Sun + Earth-Moon barycentre (GM_E + GM_M). Model B: Sun + Earth + Moon, from the same
Horizons states (targets 10, 399, 301) and DE440 GM values. Both run in the application engine, dtS = 21,600 s."""
import math
import re
from pathlib import Path

import pytest

from backend.presets import loader
from backend.simulation import InitialBody, SimulationService

SRC = Path(loader.SOURCES_DIR) / "horizons"
JD0, JD2 = "2451545.0", "2452275.5"
GM_SUN = 1.32712440041279419e20
GM_E, GM_M = 398600.435507e9, 4902.800118e9  # JPL SSD astro_par (DE440), km^3/s^2 -> m^3/s^2
G = 6.67430e-11
R_SUN, R_EARTH, R_MOON = 6.957e8, 6371.0084e3, 1737.4e3  # IAU 2015 B3; JPL planetary / satellite mean radii
DT = 21600.0


def row(target: str, jd: str) -> list[float]:
    text = (SRC / f"{target}_{jd}.txt").read_text(encoding="utf-8")
    m = re.search(r"\$\$SOE\s*\n(.*?)\n\$\$EOE", text, re.S)
    return [float(c) * 1000.0 for c in m.group(1).split(",")[2:8]]


def body(bid, kind, gm, radius, target):
    r = row(target, JD0)
    return InitialBody(id=bid, name=bid, kind=kind, massKg=gm / G, radiusM=radius, positionM=tuple(r[:3]),
                       velocityMPerS=tuple(r[3:]), colorHex="#ffffff")


def engine(bodies):
    e = SimulationService()
    e.load_bodies(bodies, history_mode="step")
    return e


def pos(e, bid):
    b = next(x for x in e.snapshot().bodies if x.id == bid)
    return (b.positionM.x, b.positionM.y, b.positionM.z)


def test_emb_offset_from_earth_centre_recorded():
    earth, emb = row("399", JD0)[:3], row("3", JD0)[:3]
    offset_m = math.dist(earth, emb)
    print(f"\nEarth centre to Earth-Moon barycentre at J2000: {offset_m / 1e3:.1f} km (Earth mean radius 6371.0 km)")
    assert 0 < offset_m < R_EARTH  # the barycentre lies inside Earth
    assert offset_m == pytest.approx(4.89e6, rel=0.005)  # recorded in context/PRESETS.md


@pytest.fixture(scope="module")
def runs():
    a = engine([body("sun", "star", GM_SUN, R_SUN, "10"), body("emb", "planet", GM_E + GM_M, R_EARTH, "3")])
    b = engine([body("sun", "star", GM_SUN, R_SUN, "10"), body("earth", "planet", GM_E, R_EARTH, "399"),
                body("moon", "planet", GM_M, R_MOON, "301")])
    max_diff = max_offset = 0.0
    for step in range(1, 2923):  # 730.5 d
        a.step(DT)
        b.step(DT)
        if step % 4 == 0:  # daily
            sun_a, emb_a = pos(a, "sun"), pos(a, "emb")
            sun_b, e_b, m_b = pos(b, "sun"), pos(b, "earth"), pos(b, "moon")
            emb_b = [(GM_E * e_b[k] + GM_M * m_b[k]) / (GM_E + GM_M) for k in range(3)]
            helio_a = [emb_a[k] - sun_a[k] for k in range(3)]
            helio_b = [emb_b[k] - sun_b[k] for k in range(3)]
            max_diff = max(max_diff, math.dist(helio_a, helio_b))
            max_offset = max(max_offset, math.dist(e_b, emb_b))
    truth_sun, truth_emb = row("10", JD2)[:3], row("3", JD2)[:3]
    truth = [truth_emb[k] - truth_sun[k] for k in range(3)]
    sa, ea = pos(a, "sun"), pos(a, "emb")
    sb, eb, mb = pos(b, "sun"), pos(b, "earth"), pos(b, "moon")
    ebb = [(GM_E * eb[k] + GM_M * mb[k]) / (GM_E + GM_M) for k in range(3)]
    return {"max_diff": max_diff, "max_offset": max_offset,
            "vs_ephemeris_two_body": math.dist([ea[k] - sa[k] for k in range(3)], truth),
            "vs_ephemeris_three_body": math.dist([ebb[k] - sb[k] for k in range(3)], truth)}


def test_emb_point_mass_vs_three_body_bounded(runs):
    print(f"\nMoon omission over 730.5 d: max heliocentric EMB difference {runs['max_diff'] / 1e3:.1f} km "
          f"(bound 1000 km; planning probe 234 km); max Earth-centre offset in the 3-body run "
          f"{runs['max_offset'] / 1e3:.1f} km (planning probe 4,940 km)")
    assert runs["max_diff"] <= 1.0e6  # detects a regression or modelling error; it does not claim irrelevance
    assert runs["max_diff"] > 0.0  # the Moon does change the path, so this is not a vacuous comparison
    assert runs["max_offset"] < R_EARTH


def test_ephemeris_comparison_is_recorded_not_asserted(runs):
    print(f"\nEMB heliocentric position vs Horizons at 730.5 d: Sun+EMB {runs['vs_ephemeris_two_body'] / 1e3:.0f} km, "
          f"Sun+Earth+Moon {runs['vs_ephemeris_three_body'] / 1e3:.0f} km (planning probe 11,717 / 11,946 km)")
    assert math.isfinite(runs["vs_ephemeris_two_body"]) and math.isfinite(runs["vs_ephemeris_three_body"])
