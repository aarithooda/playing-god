"""Perfectly inelastic merger: the only outcome of the original engine, kept as the `legacy_merge` outcome model.

`merge_pair` is THE implementation of the merger arithmetic. The legacy in-callback resolver
(`backend.collisions.MergeResolver`) and the deferred engine (`backend.impact.engine`) both call it, so the two
paths cannot drift apart. The operation order is the original one on purpose: results are bit-identical.

Physics (context/PHYSICS_SPIKE.md, COLLISION_SCIENTIFIC_MODELS.md 4.1):
- the heavier body keeps its id (ties: the first of the pair as reported by the detector);
- mass and linear momentum are conserved; the remnant sits at the centre of mass with the centre-of-mass velocity;
- the remnant radius conserves volume ((r1^3 + r2^3)^(1/3): equal densities are assumed; label: approximation);
- translational kinetic energy 0.5 mu v_rel^2 is dissipated, and the orbital angular momentum mu (r_rel x v_rel) is
  booked as remnant spin (a bookkeeping vector: no rotation model is involved).
SI units. Pure: no REBOUND, no service state.
"""
import math
from dataclasses import dataclass
from typing import Callable

from backend.impact.contracts import (CollisionInput, Fidelity, OutcomeSpec, ParameterValue, RemnantSpec)
from backend.impact.models.base import Unsupported

Vec = list[float]
MODEL_ID = "perfect_merge"
MODEL_VERSION = "1"

# (t_end, dt_last_done, r_rel, u_rel, contact_distance) -> estimated contact time or None
ContactTimeFn = Callable[[float, float, Vec, Vec, float], "float | None"]


def _sub(a: Vec, b: Vec) -> Vec:
    return [x - y for x, y in zip(a, b)]


def _add(a: Vec, b: Vec) -> Vec:
    return [x + y for x, y in zip(a, b)]


def _scale(a: Vec, s: float) -> Vec:
    return [x * s for x in a]


def _dot(a: Vec, b: Vec) -> float:
    return sum(x * y for x, y in zip(a, b))


def _cross(a: Vec, b: Vec) -> Vec:
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def _norm(a: Vec) -> float:
    return math.sqrt(_dot(a, a))


@dataclass(frozen=True)
class PairBody:
    """One body as the detector saw it at the detection time (SI)."""

    id: str
    mass: float
    radius: float
    position: tuple[float, float, float]
    velocity: tuple[float, float, float]


@dataclass(frozen=True)
class MergeResult:
    survivor_id: str
    absorbed_id: str
    remove_code: int  # REBOUND convention: 1 removes the first body of the pair, 2 the second
    mass: float
    radius: float
    position: Vec
    velocity: Vec
    kinetic_energy_lost_j: float
    orbital_angular_momentum: Vec
    event: dict  # the legacy `merger` event fields (without the id)


def merge_pair(first: PairBody, second: PairBody, t: float, dt_last_done: float, contact_time: ContactTimeFn) -> MergeResult:
    """Merge two bodies. `first`/`second` are in detector order (REBOUND's p1, p2); `t` is the detection time."""
    if first.mass >= second.mass:
        surv, gone, remove = first, second, 2
    else:
        surv, gone, remove = second, first, 1
    ms, mg = surv.mass, gone.mass
    total_m = ms + mg
    xs, xg, vs, vg = list(surv.position), list(gone.position), list(surv.velocity), list(gone.velocity)
    r_rel, v_rel = _sub(xs, xg), _sub(vs, vg)
    mu = ms * mg / total_m
    p_tot = _add(_scale(vs, ms), _scale(vg, mg))
    v_com = _scale(p_tot, 1.0 / total_m)
    x_com = _scale(_add(_scale(xs, ms), _scale(xg, mg)), 1.0 / total_m)
    ke_lost = 0.5 * mu * _dot(v_rel, v_rel)
    l_orb = _scale(_cross(r_rel, v_rel), mu)
    event = {
        "simulationTimeS": t,
        "estimatedContactTimeS": contact_time(t, dt_last_done, r_rel, v_rel, surv.radius + gone.radius),
        "bodyIds": [surv.id, gone.id],
        "resultBodyId": surv.id,
        "resultMassKg": total_m,
        "relativeSpeedMPerS": _norm(v_rel),
        "kineticEnergyLostJ": ke_lost,
        "spinAddedKgM2PerS": l_orb,
    }
    return MergeResult(surv.id, gone.id, remove, total_m, (surv.radius ** 3 + gone.radius ** 3) ** (1.0 / 3.0), x_com, v_com,
                       ke_lost, l_orb, event)


class PerfectMergeModel:
    """`OutcomeModel` view of the merger: describes the outcome of a recorded impact for the collision record."""

    model_id = MODEL_ID
    model_version = MODEL_VERSION

    def evaluate(self, data: CollisionInput) -> "OutcomeSpec | Unsupported":
        impact = data.impact
        reasons = ["legacy perfect merge: the only outcome of the original engine, applied to every pair"]
        warnings: list[str] = []
        if impact.target.material_profile is None or impact.projectile.material_profile is None:
            reasons.append("material_unspecified: a body has no material profile, so the exact legacy merge is used (D-033 DQ-2)")
            warnings.append("material_unspecified")
        return OutcomeSpec(
            model_id=MODEL_ID, model_version=MODEL_VERSION, outcome="legacy_merge", regime_reasons=tuple(reasons),
            parameters={"impactSpeed": ParameterValue(impact.impact_speed_m_per_s, "m/s", "computed from the detected pair"),
                        "totalMass": ParameterValue(impact.total_mass_kg, "kg", "computed")},
            largest_remnant=RemnantSpec(impact.total_mass_kg, "both", ()), second_remnant=None, debris_mass_kg=0.0,
            debris_size_distribution=None, ejecta_velocity_model="none",
            energy_partition_j={"dissipated": impact.pair_kinetic_energy_com_j},
            fidelity={"outcome": Fidelity.APPROXIMATION, "remnantState": Fidelity.COMPUTED,
                      "remnantRadius": Fidelity.APPROXIMATION, "energyDissipated": Fidelity.COMPUTED},
            warnings=tuple(warnings))
