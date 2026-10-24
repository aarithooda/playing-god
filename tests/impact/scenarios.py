"""Builders of `CollisionInput`s for the pure-model tests (Stage 3+). The impact geometry is constructed analytically (straight line,
no gravity) and passed through the real `capture_impact`, so the inputs have exactly the shape the engine produces."""
import dataclasses
import math
from typing import Optional

from backend.impact.config import CollisionConfig
from backend.impact.contracts import CollisionInput, Layer, MaterialProfile
from backend.impact.geometry import capture_impact
from backend.impact.materials import get_profile
from backend.impact.models.perfect_merge import PairBody
from backend.impact.records import build_input
from backend.collisions import contact_time_estimate

G = 6.67430e-11
EARTH_LIKE = dict(m_t=5.97e24, r_t=6.371e6)


def profile(profile_id="silicate-rock", **changes) -> MaterialProfile:
    return dataclasses.replace(get_profile(profile_id), **changes)


def gas_profile(gas_fraction: float, base="silicate-rock") -> MaterialProfile:
    """A copy of `base` whose layers hold `gas_fraction` of their mass as gas (0 < fraction < 1) or all of it (1)."""
    layers = (Layer("hhe-gas", 1.0, "gas"),) if gas_fraction >= 1.0 else (
        Layer("hhe-gas", gas_fraction, "gas"), Layer("silicate-rock", 1.0 - gas_fraction, "solid"))
    return dataclasses.replace(profile(base), layers=layers)


def make_input(m_t=1.0e22, m_p=1.0e22, r_t=1.0e6, r_p=None, v=None, v_over_esc=None, b=0.0, target: Optional[MaterialProfile] = "rock",
               projectile: Optional[MaterialProfile] = "rock", spin=None) -> CollisionInput:
    """Impact of a projectile (m_p <= m_t) on a target at impact parameter b. Give the speed `v` [m/s] or `v_over_esc` (multiple of the
    two-body escape speed at contact). Radii default to equal bulk densities. Profiles default to the shipped silicate rock; pass None for
    "no material" or a MaterialProfile."""
    if r_p is None:
        r_p = r_t * (m_p / m_t) ** (1.0 / 3.0)
    big_r = r_t + r_p
    if v is None:
        v = v_over_esc * math.sqrt(2.0 * G * (m_t + m_p) / big_r)
    n = (math.sqrt(1.0 - b * b), b, 0.0)
    tau = 1.0e-3 * big_r / max(v, 1.0e-9)
    tgt = PairBody("target", m_t, r_t, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    prj = PairBody("projectile", m_p, r_p, tuple(c * big_r + (-v if i == 0 else 0.0) * tau for i, c in enumerate(n)), (-v, 0.0, 0.0))
    impact, _ = capture_impact(tgt, prj, 100.0, 10.0 * tau, [], True, contact_time_estimate, G)
    rock = get_profile("silicate-rock")
    resolve = lambda p: rock if p == "rock" else p  # noqa: E731
    impact = dataclasses.replace(
        impact, target=dataclasses.replace(impact.target, material_profile=resolve(target)),
        projectile=dataclasses.replace(impact.projectile, material_profile=resolve(projectile)))
    if spin is not None:
        from backend.impact.contracts import Vec3
        impact = dataclasses.replace(impact, target=dataclasses.replace(impact.target, spin_rad_per_s=Vec3(0.0, 0.0, spin)))
    return build_input(1, impact, CollisionConfig(), "test", "0")
