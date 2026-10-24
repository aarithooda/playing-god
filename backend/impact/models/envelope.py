"""Envelope-dominated (gas) collision approximations (spec 4.2, 14 Scenario B; decision D-040). `approximation` / `unsupported` only.

A body is ENVELOPE-DOMINATED when the mass fraction of its gas-phase layers is >= 0.5. The threshold is a provisional engineering
choice, not a physical law; exactly 0.5 counts as envelope-dominated, anything below is handled by its structure class.

Routing (target = the more massive body):
- target envelope-dominated, projectile not   -> `envelope_deposition`: the projectile is stopped in the envelope; all its mass and
  momentum go to the target, its energy is dissipated, there is no crater, no bound ejecta and NO resolved gas dynamics;
- both envelope-dominated                      -> `envelope_merge_approximation`: a perfect merge labelled `unsupported` (no validated
  reduced-order law exists for gas-giant mergers; published work is hydrodynamic case studies);
- target NOT envelope-dominated, projectile is -> `Unsupported` (never sent through a rigid-body model).
Mass and linear momentum are conserved exactly by the applier (Stage 4); the orbital angular momentum is booked as the remnant's spin
where a moment of inertia exists, otherwise reported as unmodelled. Every result carries `envelope_dynamics_not_resolved`.
"""
from backend.impact.contracts import (CollisionInput, Fidelity, MaterialProfile, OutcomeSpec, ParameterValue, RemnantSpec)
from backend.impact.models.base import Unsupported
from backend.impact.models.provisional import PROVISIONAL_LABEL, provisional

MODEL_ID = "envelope"
MODEL_VERSION = "1-provisional"
ENVELOPE_GAS_FRACTION_THRESHOLD = 0.5


def gas_mass_fraction(profile: MaterialProfile) -> float:
    """Mass fraction of the profile's gas-phase layers."""
    return sum(layer.mass_fraction for layer in profile.layers if layer.phase == "gas")


@provisional("ENV-0.5-threshold")
def is_envelope_dominated(profile: MaterialProfile) -> bool:
    return gas_mass_fraction(profile) >= ENVELOPE_GAS_FRACTION_THRESHOLD


class EnvelopeModel:
    model_id = MODEL_ID
    model_version = MODEL_VERSION

    def evaluate(self, data: CollisionInput) -> "OutcomeSpec | Unsupported":
        imp = data.impact
        tp, pp = imp.target.material_profile, imp.projectile.material_profile
        if tp is None or pp is None:
            return Unsupported(("the envelope model needs a material profile for both bodies",))
        t_env, p_env = is_envelope_dominated(tp), is_envelope_dominated(pp)
        t_gas, p_gas = gas_mass_fraction(tp), gas_mass_fraction(pp)
        if not t_env and not p_env:
            return Unsupported(("neither body is envelope-dominated",))
        if not t_env and p_env:
            return Unsupported((f"an envelope-dominated projectile (gas fraction {p_gas:.3g}) hits a non-envelope target (gas fraction {t_gas:.3g}): "
                                "no model exists and the rigid-body model is not applicable",))
        both = p_env
        outcome = "envelope_merge_approximation" if both else "envelope_deposition"
        reasons = [f"target gas mass fraction {t_gas:.6g} >= {ENVELOPE_GAS_FRACTION_THRESHOLD} (provisional threshold): envelope-dominated",
                   (f"projectile gas mass fraction {p_gas:.6g} >= {ENVELOPE_GAS_FRACTION_THRESHOLD}: both envelope-dominated, perfect merge labelled unsupported"
                    if both else f"projectile gas mass fraction {p_gas:.6g} < {ENVELOPE_GAS_FRACTION_THRESHOLD}: deposited in the envelope; gas dynamics are not resolved")]
        warnings = [PROVISIONAL_LABEL, "envelope_dynamics_not_resolved"] + (["unsupported_regime"] if both else [])
        fidelity = {"outcome": Fidelity.UNSUPPORTED if both else Fidelity.APPROXIMATION, "remnantMasses": Fidelity.COMPUTED,
                    "energyDissipated": Fidelity.APPROXIMATION}
        return OutcomeSpec(
            model_id=MODEL_ID, model_version=MODEL_VERSION, outcome=outcome, regime_reasons=tuple(reasons),
            parameters={"targetGasMassFraction": ParameterValue(t_gas, "1", "material profile layers (computed)"),
                        "projectileGasMassFraction": ParameterValue(p_gas, "1", "material profile layers (computed)"),
                        "threshold": ParameterValue(ENVELOPE_GAS_FRACTION_THRESHOLD, "1", "provisional engineering choice, D-040"),
                        "massRatio": ParameterValue(imp.mass_ratio, "1", "computed"),
                        "impactSpeed": ParameterValue(imp.impact_speed_m_per_s, "m/s", "computed")},
            largest_remnant=RemnantSpec(imp.total_mass_kg, "both", ()), second_remnant=None, debris_mass_kg=0.0,
            debris_size_distribution=None, ejecta_velocity_model="none",
            energy_partition_j={"dissipated": imp.pair_kinetic_energy_com_j}, fidelity=fidelity, warnings=tuple(warnings))
