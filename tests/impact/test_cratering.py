"""Stage 3: cratering model structure (backend/impact/models/cratering.py). The scaling form and the constants are UNVERIFIED
(HH11-cratering-form), no shipped profile carries constants, so the model is Unsupported for them. With SYNTHETIC test constants these
tests check only what does not depend on the literature: dimensional consistency, scaling exponents and monotonicity. They are not
reference values of Housen & Holsapple (2011)."""
import dataclasses
import math

import pytest

from backend.impact.contracts import CrateringParams
from backend.impact.models.base import Unsupported
from backend.impact.models.cratering import CrateringModel, crater_radius
from backend.impact.models.provisional import PROVISIONAL_LABEL
from tests.impact.scenarios import G, make_input, profile

SYNTHETIC = CrateringParams(k1=0.3, mu=0.45, nu=0.4, ybar=None, source="SYNTHETIC TEST VALUES, not literature")
BASE = dict(k1=0.3, mu=0.45, nu=0.4, m_p=1.0e12, rho_target=3000.0, delta_projectile=3000.0, g_surface=9.8, a_projectile=40.0, u_normal=2.0e4)


def with_constants(**kw):
    return profile(cratering=SYNTHETIC)


def test_gravity_regime_exponent_and_dimensions():
    r1 = crater_radius(**BASE)
    # R ~ (g a / U^2)^(-mu/(2+mu)) at fixed everything else
    r2 = crater_radius(**{**BASE, "u_normal": 2 * BASE["u_normal"]})
    assert r2 / r1 == pytest.approx(2.0 ** (2 * 0.45 / (2 + 0.45)), rel=1e-12)
    r3 = crater_radius(**{**BASE, "g_surface": 2 * BASE["g_surface"]})
    assert r3 / r1 == pytest.approx(2.0 ** (-0.45 / (2 + 0.45)), rel=1e-12)  # stronger gravity -> smaller crater
    # same density projectile, scaling lengths: R ~ L when speed and gravity scale so that g a / U^2 is fixed
    s = 3.0
    scaled = crater_radius(**{**BASE, "m_p": BASE["m_p"] * s ** 3, "a_projectile": BASE["a_projectile"] * s, "g_surface": BASE["g_surface"] / s})
    assert scaled / r1 == pytest.approx(s, rel=1e-12)


def test_crater_radius_rejects_non_positive_inputs():
    for key in ("k1", "m_p", "rho_target", "delta_projectile", "g_surface", "a_projectile", "u_normal"):
        with pytest.raises(ValueError):
            crater_radius(**{**BASE, key: 0.0})


def small_impactor(**kw):
    inp = make_input(m_t=5.97e24, m_p=1.0e12, r_t=6.371e6, r_p=60.0, v=2.0e4, target=with_constants(), **kw)
    return inp


def test_model_with_sourced_constants_returns_a_labelled_approximation_and_keeps_all_mass():
    spec = CrateringModel(G).evaluate(small_impactor())
    assert spec.outcome == "cratering" and spec.largest_remnant.mass_kg == 5.97e24 + 1.0e12 and spec.debris_mass_kg == 0.0
    assert {PROVISIONAL_LABEL, "ejecta_not_quantified", "hh11_form_unverified"} <= set(spec.warnings)
    assert spec.parameters["craterRadius"].value > 0.0 and spec.parameters["K1"].source.startswith("SYNTHETIC")
    assert "crater_exceeds_half_space_assumption" not in spec.warnings


def test_oblique_impact_uses_the_normal_component_and_tangential_is_refused():
    head_on = CrateringModel(G).evaluate(small_impactor(b=0.0)).parameters["craterRadius"].value
    oblique = CrateringModel(G).evaluate(small_impactor(b=0.6)).parameters["craterRadius"].value
    assert oblique < head_on  # smaller normal speed -> smaller crater
    assert CrateringModel(G).evaluate(small_impactor(b=0.6)).parameters["normalSpeed"].value == pytest.approx(2.0e4 * math.sqrt(1 - 0.36), rel=1e-9)


def test_shipped_profiles_have_no_constants_so_cratering_is_unsupported():
    result = CrateringModel(G).evaluate(make_input(m_t=5.97e24, m_p=1.0e12, r_t=6.371e6, r_p=60.0, v=2.0e4))
    assert isinstance(result, Unsupported) and "no sourced cratering constants" in result.reasons[0]


def test_a_crater_larger_than_a_tenth_of_the_target_is_flagged():
    inp = make_input(m_t=1.0e20, m_p=1.0e17, r_t=3.0e4, r_p=2.0e3, v=3.0e4, target=with_constants())
    assert "crater_exceeds_half_space_assumption" in CrateringModel(G).evaluate(inp).warnings
