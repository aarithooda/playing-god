"""Validity envelope of the gravity-regime (LS12) model, kept as data (plan 3.6, D-041). Outside it the selector reports
`Unsupported` or labels the result an extrapolation; it never silently applies the equations (spec 6.3, 6.5).

All three bounds come from what the LS12 calibration covered, as recorded in COLLISION_SCIENTIFIC_MODELS.md 4.2 and the fetched text
(D-041); they are PROVISIONAL (see `provisional.py`), not part of any approved physical law.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class LS12Envelope:
    min_target_radius_m: float = 1.0e4  # smallest target of the LS12 simulation set (R_targ = 10^4 m): below it strength may matter
    min_mass_ratio: float = 1.0 / 45000.0  # "1:1 to almost 1:45,000" (abstract): below it the cratering route applies
    velocity_band_m_per_s: tuple[float, float] = (1.0, 5.0e3)  # "0.001 to 5 km/s": outside it LS12 is an extrapolation


LS12_ENVELOPE = LS12Envelope()

# Outcomes that remove or redistribute mass and so depend on the strength/gravity balance. Mergers at v <= v_esc do not.
DISRUPTIVE_OUTCOMES = frozenset({"partial_accretion", "partial_erosion", "hit_and_run", "catastrophic_disruption",
                                 "super_catastrophic_disruption"})
