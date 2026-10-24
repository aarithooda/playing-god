"""Gravity-regime collision outcomes after Leinhardt & Stewart (2012, ApJ 745, 79; "LS12") with the graze-and-merge boundary of
Genda, Kokubo & Ida (2012, ApJ 744, 137; "G12"). Pure functions of numbers: no REBOUND, no service state.

STATUS: PROVISIONAL (D-038). CP-SCI-1 is not signed off. Each relation is tagged `@provisional(<id>)` (models/provisional.py)
and every outcome built here carries the warning `provisional:CP-SCI-1`. The equations are kept exactly as recorded in
COLLISION_SCIENTIFIC_MODELS.md 4.2/4.3; they are not tuned to any reference value.

Notation (SI): M_t target, M_p projectile (M_t >= M_p), gamma = M_p/M_t, M_tot, mu = M_p M_t/M_tot, R_t, R_p physical radii, v_i impact
speed, b = sin(theta) the impact parameter (0 = head-on), R_C1 = radius of a sphere of the combined mass at rho_1 = 1000 kg/m^3.
Q_R = 0.5 mu v_i^2 / M_tot (LS12 eq. 1). The universal law (eqs. 4, 5) gives the largest remnant in the disruption regime:
M_lr/M_tot = -0.5 (Q_R/Q'*_RD - 1) + 0.5, continued above Q_R/Q'*_RD = 1.8 by the super-catastrophic power law (eq. 44).

Outcome classes (plan 3.6): merge for v_i <= v_esc (physical radii); for b >= b_crit graze-and-merge or hit-and-run (G12 v_cr); for
b < b_crit the largest remnant decides: M_lr > M_t partial accretion, M_lr <= M_t and Q_R/Q'* < 1 partial erosion, 1 <= Q_R/Q'* < 1.8
catastrophic, >= 1.8 super-catastrophic. Hit-and-run is a minimal approximation (the projectile's own erosion, eqs. 46-54, is not
modelled and is reported as a warning). Spin does not enter (LS12 had no pre-impact spin): `spin_not_in_model` is raised when a body rotates.
"""
import math
from typing import Optional

from backend.impact.contracts import (CollisionInput, Fidelity, ImpactState, OutcomeSpec, ParameterValue, RemnantSpec)
from backend.impact.models.base import Unsupported
from backend.impact.models.provisional import PROVISIONAL_LABEL, provisional
from backend.impact.models.validity import DISRUPTIVE_OUTCOMES, LS12_ENVELOPE

MODEL_ID = "ls12"
MODEL_VERSION = "1-provisional"
RHO1_KG_PER_M3 = 1000.0
SUPERCAT_TRANSITION = 1.8
SUPERCAT_ETA = -1.5
BETA = 2.85
C1, C2, C3, C4, C5 = 2.43, -0.0408, 1.86, 1.08, 2.5  # Genda et al. 2012 eq. 16


# ------------------------------------------------------------------------------------------------ definitions (verbatim)
def reduced_mass(m_target: float, m_projectile: float) -> float:
    return m_target * m_projectile / (m_target + m_projectile)


def specific_impact_energy(m_target: float, m_projectile: float, v_i: float) -> float:
    """LS12 eq. 1: Q_R = 0.5 mu v_i^2 / M_tot [J/kg]."""
    return 0.5 * reduced_mass(m_target, m_projectile) * v_i * v_i / (m_target + m_projectile)


def r_c1(m_total: float, rho1: float = RHO1_KG_PER_M3) -> float:
    """Radius of a sphere of the combined mass at density rho_1 (LS12 definition of R_C1)."""
    return (3.0 * m_total / (4.0 * math.pi * rho1)) ** (1.0 / 3.0)


def mutual_escape_speed(g: float, m_total: float, r_target: float, r_projectile: float) -> float:
    """Two-body escape speed at contact, sqrt(2 G M_tot / (R_t + R_p)) (G12 eq. 8): the merge criterion used here."""
    return math.sqrt(2.0 * g * m_total / (r_target + r_projectile))


# ------------------------------------------------------------------------------------------------ disruption thresholds
@provisional("LS12-eq28-qrd-gamma1")
def q_star_rd_gamma1(c_star: float, r_c1_m: float, g: float) -> float:
    """Catastrophic disruption threshold for equal masses, Q*_RD,gamma=1 = c* (4/5) pi rho_1 G R_C1^2 [J/kg] (eq. 28)."""
    return c_star * 0.8 * math.pi * RHO1_KG_PER_M3 * g * r_c1_m * r_c1_m


@provisional("LS12-eq23-mass-ratio")
def q_star_rd(c_star: float, mu_bar: float, gamma: float, r_c1_m: float, g: float) -> float:
    """Mass-ratio correction (eq. 23): Q*_RD = Q*_RD,gamma=1 (0.25 (gamma+1)^2 / gamma)^(2/(3 mubar) - 1). gamma = M_p/M_t in (0, 1]."""
    if not 0.0 < gamma <= 1.0:
        raise ValueError("gamma must be within (0, 1]")
    return q_star_rd_gamma1(c_star, r_c1_m, g) * (0.25 * (gamma + 1.0) ** 2 / gamma) ** (2.0 / (3.0 * mu_bar) - 1.0)


@provisional("LS12-eq6-bcrit")
def b_crit(r_target: float, r_projectile: float) -> float:
    """Grazing threshold (eq. 6): the projectile's centre is tangent to the target, b_crit = R_t / (R_t + R_p)."""
    return r_target / (r_target + r_projectile)


@provisional("LS12-eq11-15-interacting-mass")
def interacting_mass_fraction(r_target: float, r_projectile: float, b: float) -> float:
    """alpha = interacting projectile mass / M_p (eqs. 7, 11): l = (R+r)(1-b); alpha = (3 r l^2 - l^3)/(4 r^3), 1 for l >= 2r, 0 for l <= 0."""
    if not 0.0 <= b <= 1.0:
        raise ValueError("impact parameter must be within [0, 1]")
    length = (r_target + r_projectile) * (1.0 - b)
    if length >= 2.0 * r_projectile:
        return 1.0
    if length <= 0.0:
        return 0.0
    return (3.0 * r_projectile * length * length - length ** 3) / (4.0 * r_projectile ** 3)


@provisional("LS12-eq11-15-interacting-mass")
def interacting_reduced_mass(m_target: float, m_projectile: float, alpha: float) -> float:
    """mu_alpha = alpha M_p M_t / (alpha M_p + M_t) (eq. 12)."""
    return alpha * m_projectile * m_target / (alpha * m_projectile + m_target)


@provisional("LS12-eq11-15-interacting-mass")
def q_prime_star_rd(q_star: float, mu: float, mu_alpha: float, mu_bar: float) -> float:
    """Oblique-impact threshold (eq. 15): Q'*_RD = (mu / mu_alpha)^(2 - 3 mubar / 2) Q*_RD."""
    return (mu / mu_alpha) ** (2.0 - 1.5 * mu_bar) * q_star


# ------------------------------------------------------------------------------------------------ largest remnant
@provisional("LS12-eq5-universal-law")
def largest_remnant_fraction_linear(ratio: float) -> float:
    """Universal law (eqs. 4/5), ratio = Q_R / Q'*_RD: M_lr / M_tot = -0.5 (ratio - 1) + 0.5."""
    return -0.5 * (ratio - 1.0) + 0.5


@provisional("LS12-eq44-supercatastrophic")
def largest_remnant_fraction_supercatastrophic(ratio: float, eta: float = SUPERCAT_ETA) -> float:
    """Super-catastrophic power law (eq. 44): M_lr / M_tot = (0.1 / 1.8^eta) ratio^eta. Equals 0.1 at ratio = 1.8, as the linear law does."""
    return (0.1 / SUPERCAT_TRANSITION ** eta) * ratio ** eta


def largest_remnant_fraction(ratio: float) -> float:
    """M_lr / M_tot for any ratio >= 0: linear up to the 1.8 transition, power law above. Continuous at 1.8 (both give 0.1)."""
    if ratio < 0.0:
        raise ValueError("ratio must be >= 0")
    return largest_remnant_fraction_linear(ratio) if ratio <= SUPERCAT_TRANSITION else largest_remnant_fraction_supercatastrophic(ratio)


# ------------------------------------------------------------------------------------------------ graze-and-merge boundary
@provisional("G12-eq16-graze-and-merge")
def graze_and_merge_speed_ratio(gamma: float, b: float) -> float:
    """G12 eq. 16: v_cr / v_esc = c1 Gamma Theta^c5 + c2 Gamma + c3 Theta^c5 + c4, Gamma = (1-gamma)/(1+gamma), Theta = 1 - b (= 1 - sin theta)."""
    big_gamma = (1.0 - gamma) / (1.0 + gamma)
    theta = 1.0 - b
    return C1 * big_gamma * theta ** C5 + C2 * big_gamma + C3 * theta ** C5 + C4


# ------------------------------------------------------------------------------------------------ the model
def _param(value: float, unit: str, source: str) -> ParameterValue:
    return ParameterValue(value, unit, source)


class LS12Model:
    """`OutcomeModel` for pairs of bodies whose target profile carries LS12 parameters. See the module docstring."""

    model_id = MODEL_ID
    model_version = MODEL_VERSION

    def __init__(self, g: float):
        self.g = g

    def evaluate(self, data: CollisionInput) -> "OutcomeSpec | Unsupported":
        imp = data.impact
        profile = imp.target.material_profile
        if profile is None or profile.ls12 is None:
            return Unsupported(("the target's material profile has no LS12 parameters (c*, mu_bar): incomplete profile, nothing is assumed",))
        if profile.structure_class == "envelope-dominated":
            return Unsupported(("envelope-dominated targets are never routed through the rigid-body LS12 model",))
        return self._evaluate(imp, profile.ls12.c_star, profile.ls12.mu_bar, profile.structure_class)

    def _evaluate(self, imp: ImpactState, c_star: float, mu_bar: float, structure_class: str) -> "OutcomeSpec | Unsupported":
        g = self.g
        m_t, m_p = imp.target.mass_kg, imp.projectile.mass_kg
        r_t, r_p = imp.target.radius_m, imp.projectile.radius_m
        v_i, b = imp.impact_speed_m_per_s, imp.impact_parameter
        m_tot, gamma = imp.total_mass_kg, imp.mass_ratio
        mu = imp.reduced_mass_kg
        v_esc = mutual_escape_speed(g, m_tot, r_t, r_p)
        q_r = specific_impact_energy(m_t, m_p, v_i)
        src = "LS12 (provisional, D-038)"
        params = {"impactSpeed": _param(v_i, "m/s", "computed"), "escapeSpeedPhysicalRadii": _param(v_esc, "m/s", "G12 eq. 8 (computed)"),
                  "impactParameter": _param(b, "1", "computed"), "massRatio": _param(gamma, "1", "computed"),
                  "specificImpactEnergy": _param(q_r, "J/kg", "LS12 eq. 1 (computed)"), "cStar": _param(c_star, "1", f"material profile ({src})"),
                  "muBar": _param(mu_bar, "1", f"material profile ({src})"), "structureClass": _param(0.0, structure_class, "material profile")}
        warnings: list[str] = [PROVISIONAL_LABEL]
        if imp.target.spin_rad_per_s is not None or imp.projectile.spin_rad_per_s is not None:
            warnings.append("spin_not_in_model")
        low, high = LS12_ENVELOPE.velocity_band_m_per_s
        extrapolated = not (low <= v_i <= high)
        if extrapolated:
            warnings.append("outside_calibration_velocity")
        reasons: list[str] = []
        fidelity = {"outcome": Fidelity.MODEL, "remnantMasses": Fidelity.MODEL}
        if extrapolated:
            fidelity = {k: Fidelity.APPROXIMATION for k in fidelity}

        def spec(outcome: str, lr: float, second: Optional[RemnantSpec], debris: float, extra_reasons: list[str], extra_params=None,
                 extra_warnings=(), fid=None) -> OutcomeSpec:
            return OutcomeSpec(
                model_id=MODEL_ID, model_version=MODEL_VERSION, outcome=outcome, regime_reasons=tuple(reasons + extra_reasons),
                parameters={**params, **(extra_params or {})}, largest_remnant=RemnantSpec(lr, "target" if lr <= m_t * (1 + 1e-15) else "both", ()),
                second_remnant=second, debris_mass_kg=debris, debris_size_distribution=None, ejecta_velocity_model="none",
                energy_partition_j={"pairKineticEnergyCom": imp.pair_kinetic_energy_com_j}, fidelity=fid or fidelity,
                warnings=tuple(dict.fromkeys([*warnings, *extra_warnings])))

        if v_i <= v_esc:
            return spec("perfect_merge", m_tot, None, 0.0, [f"v_i = {v_i:.6g} m/s <= v_esc = {v_esc:.6g} m/s: bound, the bodies merge (no strength model needed)"])

        env = LS12_ENVELOPE
        crit = b_crit(r_t, r_p)
        params["bCrit"] = _param(crit, "1", "LS12 eq. 6 (provisional)")
        if b >= crit:
            ratio = graze_and_merge_speed_ratio(gamma, b)
            v_cr = ratio * v_esc
            params["vCriticalGrazeAndMerge"] = _param(v_cr, "m/s", "G12 eq. 16 (provisional; calibrated for protoplanets only)")
            gz = ["b = %.6g >= b_crit = %.6g: grazing impact" % (b, crit)]
            gz_warn = ("g12_protoplanet_calibration",)
            gz_fid = {"outcome": Fidelity.APPROXIMATION, "remnantMasses": Fidelity.APPROXIMATION}
            if v_i <= v_cr:
                return spec("graze_and_merge", m_tot, None, 0.0, gz + [f"v_i <= v_cr = {v_cr:.6g} m/s: graze-and-merge"], extra_warnings=gz_warn, fid=gz_fid)
            if r_t < env.min_target_radius_m:
                return Unsupported(gz + [f"v_i > v_cr: hit-and-run with target radius {r_t:.6g} m < {env.min_target_radius_m:g} m: strength regime, no supported model (D-041)"])
            alpha = interacting_mass_fraction(r_t, r_p, b)
            q_star = q_star_rd(c_star, mu_bar, gamma, r_c1(m_tot), g)
            q_prime = q_prime_star_rd(q_star, mu, interacting_reduced_mass(m_t, m_p, alpha), mu_bar) if alpha > 0.0 else math.inf
            lr = min(m_t, largest_remnant_fraction(q_r / q_prime) * m_tot) if math.isfinite(q_prime) else m_t
            lr = max(lr, 0.0)
            second = RemnantSpec(m_p, "projectile", ())
            return spec("hit_and_run", lr, second, max(m_tot - lr - m_p, 0.0),
                        gz + [f"v_i > v_cr = {v_cr:.6g} m/s: hit-and-run; two remnants"],
                        {"interactingMassFraction": _param(alpha, "1", "LS12 eq. 11 (provisional)")},
                        gz_warn + ("projectile_erosion_not_modelled",), gz_fid)

        # head-on / oblique but not grazing: the universal law
        alpha = interacting_mass_fraction(r_t, r_p, b)
        r_c = r_c1(m_tot)
        q_star = q_star_rd(c_star, mu_bar, gamma, r_c, g)
        q_prime = q_prime_star_rd(q_star, mu, interacting_reduced_mass(m_t, m_p, alpha), mu_bar)
        ratio = q_r / q_prime
        frac = largest_remnant_fraction(ratio)
        m_lr = frac * m_tot
        extra = {"rC1": _param(r_c, "m", "LS12 definition (rho_1 = 1000 kg/m^3)"), "QStarRD": _param(q_star, "J/kg", "LS12 eq. 23 (provisional)"),
                 "interactingMassFraction": _param(alpha, "1", "LS12 eq. 11 (provisional)"),
                 "QPrimeStarRD": _param(q_prime, "J/kg", "LS12 eq. 15 (provisional)"), "QRatio": _param(ratio, "1", "Q_R / Q'*_RD"),
                 "largestRemnantFraction": _param(frac, "1", "LS12 eqs. 5, 44 (provisional)")}
        if ratio >= SUPERCAT_TRANSITION:
            outcome = "super_catastrophic_disruption"
        elif ratio >= 1.0:
            outcome = "catastrophic_disruption"
        elif m_lr > m_t:
            outcome = "partial_accretion"
        else:
            outcome = "partial_erosion"
        why = [f"b = {b:.6g} < b_crit = {crit:.6g}; v_i > v_esc", f"Q_R / Q'*_RD = {ratio:.6g}: {outcome.replace('_', ' ')}, M_lr / M_tot = {frac:.6g}"]
        if outcome in DISRUPTIVE_OUTCOMES and r_t < env.min_target_radius_m:
            return Unsupported(why + [f"target radius {r_t:.6g} m < {env.min_target_radius_m:g} m: strength regime, no supported model (D-041)"])
        if gamma < env.min_mass_ratio:
            return Unsupported(why + [f"mass ratio {gamma:.3g} < {env.min_mass_ratio:.3g}: below the LS12 range; the cratering route applies"])
        m_lr = min(m_lr, m_tot)
        return spec(outcome, m_lr, None, m_tot - m_lr, why, extra)
