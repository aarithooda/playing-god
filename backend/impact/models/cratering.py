"""Point-source cratering by a small impactor (Housen & Holsapple 2011; Holsapple 1993) — STRUCTURE ONLY (status: unverified).

The form used is the one recorded in COLLISION_SCIENTIFIC_MODELS.md 4.4 (marked [VERIFY] there):
    R = K1 (m/rho)^(1/3) [ (g a / U^2) (rho/delta)^(2 nu/mu) ]^(-mu/(2+mu)),
with m, a, delta the projectile's mass, radius and bulk density, rho the target's bulk density, g = G M_t / R_t^2 the target's surface
gravity, U the speed normal to the surface, U = v_i sqrt(1 - b^2), and K1, mu, nu the target-class constants of the material profile
(`MaterialProfile.cratering`, each with a citation). NO shipped profile has these constants (risk R-05, D-037), so for every shipped
profile the model reports `Unsupported`; it computes only when a profile supplies sourced constants. The ejecta distribution (the
escaping mass) needs constants that are not recorded, so no ejecta mass is claimed: the projectile is accreted and the result says so
(`ejecta_not_quantified`). Fidelity: approximation. Crater radius > 0.1 target radius leaves the half-space assumption (warning).
"""
import math

from backend.impact.contracts import (CollisionInput, Fidelity, OutcomeSpec, ParameterValue, RemnantSpec)
from backend.impact.models.base import Unsupported
from backend.impact.models.provisional import PROVISIONAL_LABEL, provisional

MODEL_ID = "cratering"
MODEL_VERSION = "1-structure"
HALF_SPACE_LIMIT = 0.1  # crater radius / target radius (COLLISION_SCIENTIFIC_MODELS.md 4.4)


@provisional("HH11-cratering-form")
def crater_radius(k1: float, mu: float, nu: float, m_p: float, rho_target: float, delta_projectile: float, g_surface: float,
                  a_projectile: float, u_normal: float) -> float:
    """Crater radius [m] for the form in the module docstring. All inputs SI and > 0."""
    if min(k1, m_p, rho_target, delta_projectile, g_surface, a_projectile, u_normal) <= 0.0:
        raise ValueError("all inputs of the cratering law must be > 0")
    pi2 = g_surface * a_projectile / (u_normal * u_normal)
    return k1 * (m_p / rho_target) ** (1.0 / 3.0) * (pi2 * (rho_target / delta_projectile) ** (2.0 * nu / mu)) ** (-mu / (2.0 + mu))


class CrateringModel:
    model_id = MODEL_ID
    model_version = MODEL_VERSION

    def __init__(self, g: float):
        self.g = g

    def evaluate(self, data: CollisionInput) -> "OutcomeSpec | Unsupported":
        imp = data.impact
        profile = imp.target.material_profile
        if profile is None or profile.cratering is None:
            return Unsupported(("the target's material profile has no sourced cratering constants (K1, mu, nu): incomplete profile, nothing is assumed",))
        if imp.impact_speed_m_per_s <= 0.0:
            return Unsupported(("cratering needs a positive impact speed",))
        cr = profile.cratering
        r_t, r_p = imp.target.radius_m, imp.projectile.radius_m
        rho_t = imp.target.mass_kg / (4.0 / 3.0 * math.pi * r_t ** 3)
        delta = imp.projectile.mass_kg / (4.0 / 3.0 * math.pi * r_p ** 3)
        g_surface = self.g * imp.target.mass_kg / (r_t * r_t)
        u_normal = imp.impact_speed_m_per_s * math.sqrt(max(0.0, 1.0 - imp.impact_parameter ** 2))
        if u_normal <= 0.0:
            return Unsupported(("a purely tangential impact has no normal speed: the point-source law does not apply",))
        radius = crater_radius(cr.k1, cr.mu, cr.nu, imp.projectile.mass_kg, rho_t, delta, g_surface, r_p, u_normal)
        warnings = [PROVISIONAL_LABEL, "ejecta_not_quantified", "hh11_form_unverified"]
        if radius > HALF_SPACE_LIMIT * r_t:
            warnings.append("crater_exceeds_half_space_assumption")
        return OutcomeSpec(
            model_id=MODEL_ID, model_version=MODEL_VERSION, outcome="cratering",
            regime_reasons=(f"mass ratio {imp.mass_ratio:.3g}: point-source cratering; projectile accreted, crater radius {radius:.6g} m",),
            parameters={"craterRadius": ParameterValue(radius, "m", "cratering form of COLLISION_SCIENTIFIC_MODELS.md 4.4 (unverified)"),
                        "normalSpeed": ParameterValue(u_normal, "m/s", "computed"), "K1": ParameterValue(cr.k1, "1", cr.source),
                        "mu": ParameterValue(cr.mu, "1", cr.source), "nu": ParameterValue(cr.nu, "1", cr.source)},
            largest_remnant=RemnantSpec(imp.total_mass_kg, "both", ()), second_remnant=None, debris_mass_kg=0.0,
            debris_size_distribution=None, ejecta_velocity_model="none",
            energy_partition_j={"dissipated": imp.pair_kinetic_energy_com_j},
            fidelity={"outcome": Fidelity.APPROXIMATION, "craterRadius": Fidelity.APPROXIMATION, "remnantMasses": Fidelity.COMPUTED},
            warnings=tuple(warnings))
