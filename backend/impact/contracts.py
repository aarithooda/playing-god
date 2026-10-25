"""Versioned data contracts of the collision & particle engine (plan section 4). Data only: no physics, no REBOUND.

Every contract is a frozen dataclass that
- validates on construction (finite floats, positive masses, unit quaternions, layer fractions summing to 1);
- serialises to canonical JSON (`to_json`: sorted keys, no whitespace, no NaN/Infinity) and parses back with
  `from_json` / `from_dict`, bit-for-bit (`Contract.from_json(c.to_json()) == c`);
- uses snake_case attributes and camelCase JSON keys with SI-unit suffixes (D-007).

Readers are strict: unknown keys, a wrong type, a non-finite number or a `schemaVersion` this code does not know are
rejected with `ContractError` (never repaired). Writer and reader are the same codebase, so an additive field ships
together with its reader update; a breaking change bumps `SCHEMA_VERSION` and keeps a reader for the previous version.

Spec: context/specs/COLLISION_PARTICLE_ENGINE_SPEC.md (section 13). Plan: context/COLLISION_ENGINE_PLAN.md section 4.
"""
import math
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Optional

from backend.impact.config import (DEFAULT_SANDBOX_MODE, DEFAULT_SEED, MAX_SEED, CollisionConfig, CollisionMode,  # noqa: F401
                                   CollisionTolerances)
from backend.impact.serialization import (FRACTION_SUM_TOLERANCE, SCHEMA_VERSION, UNIT_QUATERNION_TOLERANCE, Contract,  # noqa: F401
                                          ContractError, _digest_or_empty, _fraction, _fractions_sum_to_one, _non_negative,
                                          _positive, _unit_quaternion, canonical_digest, canonical_json, jfield)


class Fidelity(str, Enum):
    """How an output quantity was obtained (plan 4.11, spec 12.4). Diagnostics and the UI show it."""

    COMPUTED = "computed"  # directly from simulation state
    MODEL = "model"  # a published law inside its calibration envelope
    APPROXIMATION = "approximation"  # an engineering choice or a bounded extrapolation
    STATISTICAL = "statistical"  # a population representation
    VISUAL = "visual"  # no physical meaning
    UNSUPPORTED = "unsupported"  # outside every model envelope; a fallback was used


Quaternion = tuple[float, float, float, float]  # (w, x, y, z)
Representation = Literal["body", "fragment", "debris-parcel"]
Outcome = Literal[
    "perfect_merge", "graze_and_merge", "hit_and_run", "partial_accretion", "partial_erosion", "cratering",
    "catastrophic_disruption", "super_catastrophic_disruption", "envelope_deposition",
    "envelope_merge_approximation", "legacy_merge",
]
FragmentClass = Literal["bound_to_remnant", "orbiting_system", "escaping"]


@dataclass(frozen=True)
class Vec3(Contract):
    """A vector in the single inertial right-handed frame of D-010 unless the field name says `...Local`."""

    x: float
    y: float
    z: float

    @classmethod
    def of(cls, v) -> "Vec3":
        return cls(v[0], v[1], v[2])

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.x, self.y, self.z)


# ----------------------------------------------------------------------------------------------------------------
# Materials (plan 4.2, 4.3)
# ----------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class CompositionLayer(Contract):
    """One entry of a composition: a material and the share of the body's mass it holds."""

    material_id: str
    mass_fraction: float

    def _validate(self) -> None:
        if not self.material_id:
            raise ContractError("CompositionLayer.material_id: must not be empty")
        _fraction("CompositionLayer", mass_fraction=self.mass_fraction)


def _validate_composition(owner: str, layers: tuple[CompositionLayer, ...]) -> None:
    if layers:
        _fractions_sum_to_one(owner, [layer.mass_fraction for layer in layers])


@dataclass(frozen=True)
class Layer(Contract):
    """A layer of a material profile (outer -> inner). `phase` allows molten / partially molten / gas layers."""

    material_id: str
    mass_fraction: float
    phase: Literal["solid", "molten", "partial", "gas"]
    melt_fraction: Optional[float] = None
    density_kg_per_m3: Optional[float] = None

    def _validate(self) -> None:
        if not self.material_id:
            raise ContractError("Layer.material_id: must not be empty")
        _fraction("Layer", mass_fraction=self.mass_fraction, melt_fraction=self.melt_fraction)
        _positive("Layer", density_kg_per_m3=self.density_kg_per_m3)


def _validate_layers(owner: str, layers: tuple[Layer, ...]) -> None:
    if not layers:
        raise ContractError(f"{owner}: at least one layer is required")
    _fractions_sum_to_one(owner, [layer.mass_fraction for layer in layers])


@dataclass(frozen=True)
class Ls12Params(Contract):
    """Leinhardt & Stewart (2012) material parameters. Values only with a citation; see COLLISION_SCIENTIFIC_MODELS.md."""

    c_star: float
    c_star_uncertainty: Optional[float]
    mu_bar: float
    source: str

    def _validate(self) -> None:
        _positive("Ls12Params", c_star=self.c_star, mu_bar=self.mu_bar)
        _non_negative("Ls12Params", c_star_uncertainty=self.c_star_uncertainty)
        if not self.source:
            raise ContractError("Ls12Params.source: a citation is required")


@dataclass(frozen=True)
class StrengthParams(Contract):
    """Benz & Asphaug (1999)-form strength-regime parameters (decision-gated, DQ-9)."""

    q0: float
    a: float
    big_b: float = jfield("B")
    b: float = 0.0
    units_note: str = ""
    source: str = ""
    velocity_regime_m_per_s: Optional[tuple[float, float]] = None

    def _validate(self) -> None:
        if not self.source:
            raise ContractError("StrengthParams.source: a citation is required")


@dataclass(frozen=True)
class CrateringParams(Contract):
    """Housen & Holsapple (2011) point-source scaling constants for one target class."""

    k1: float
    mu: float
    nu: float
    ybar: Optional[float]
    source: str

    def _validate(self) -> None:
        _positive("CrateringParams", k1=self.k1)
        if not 0.0 < self.mu < 1.0:
            raise ContractError(f"CrateringParams.mu: must be within (0, 1), got {self.mu!r}")
        if not self.source:
            raise ContractError("CrateringParams.source: a citation is required")


@dataclass(frozen=True)
class Provenance(Contract):
    """Where one number of a material profile comes from. Every number must be traceable."""

    quantity: str
    value: float
    source: str
    uncertainty: Optional[float]
    basis: Literal["measured", "literature", "engineering"]

    def _validate(self) -> None:
        if not self.quantity or not self.source:
            raise ContractError("Provenance: quantity and source are required")
        _non_negative("Provenance", uncertainty=self.uncertainty)


@dataclass(frozen=True)
class Validity(Contract):
    notes: str
    range_hints: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class MaterialProfile(Contract):
    """A registry entry (`material_profiles.json`, Stage 2). Bulk density is computed from mass and radius, not stored."""

    id: str
    category: Literal["rock", "metal", "ice", "gas", "molten", "mixed"]
    structure_class: Literal["rubble", "strong", "strengthless-planet", "envelope-dominated"]
    layers: tuple[Layer, ...]
    appearance: Literal["rock", "metal", "ice", "molten", "gas", "dust"]
    provenance: tuple[Provenance, ...]
    validity: Validity
    # None = no sourced value: a body with this profile cannot carry a spin state (no moment of inertia, DQ-2).
    moment_of_inertia_factor: Optional[float] = None
    # Quantities a model might need that this profile does NOT have (no invented values): e.g. "ls12", "cratering".
    incomplete: tuple[str, ...] = ()
    ls12: Optional[Ls12Params] = None
    strength: Optional[StrengthParams] = None
    cratering: Optional[CrateringParams] = None
    wave_speed_m_per_s: Optional[float] = None
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", self.id):
            raise ContractError(f"MaterialProfile.id: must be lower-case kebab, got {self.id!r}")
        _validate_layers("MaterialProfile.layers", self.layers)
        if self.moment_of_inertia_factor is not None and not 0.0 < self.moment_of_inertia_factor <= 0.4:
            raise ContractError(f"MaterialProfile.moment_of_inertia_factor: must be within (0, 0.4] or null, got {self.moment_of_inertia_factor!r}")
        _positive("MaterialProfile", wave_speed_m_per_s=self.wave_speed_m_per_s)
        if not self.provenance:
            raise ContractError("MaterialProfile.provenance: every number must be traceable; at least one entry is required")


@dataclass(frozen=True)
class MaterialRef(Contract):
    """A body's material: a registry profile id, optionally with validated layer overrides. Absent = `null` on the body."""

    profile_id: str
    layers: Optional[tuple[Layer, ...]] = None

    def _validate(self) -> None:
        if not self.profile_id:
            raise ContractError("MaterialRef.profile_id: must not be empty")
        if self.layers is not None:
            _validate_layers("MaterialRef.layers", self.layers)


# ----------------------------------------------------------------------------------------------------------------
# Rotation and debris descriptors (plan 4.3, 4.4)
# ----------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Orientation(Contract):
    """Unit quaternion (w, x, y, z), body -> world, at `epoch_s`."""

    quaternion: Quaternion
    epoch_s: float

    def _validate(self) -> None:
        _unit_quaternion("Orientation.quaternion", self.quaternion)


@dataclass(frozen=True)
class RotationState(Contract):
    """Torque-free rigid rotation: q(t) = exp(1/2 Omega (t - t0)) q0 with constant omega (an `approximation` for
    non-spherical bodies; no precession is modelled)."""

    omega_rad_per_s: Vec3
    q0: Quaternion
    t0_s: float
    moment_of_inertia_kg_m2: float

    def _validate(self) -> None:
        _unit_quaternion("RotationState.q0", self.q0)
        _positive("RotationState", moment_of_inertia_kg_m2=self.moment_of_inertia_kg_m2)


@dataclass(frozen=True)
class SizeDistribution(Contract):
    kind: Literal["power-law"]
    exponent: float
    d_min_m: float
    d_max_m: float

    def _validate(self) -> None:
        _positive("SizeDistribution", d_min_m=self.d_min_m, d_max_m=self.d_max_m)
        if self.d_max_m < self.d_min_m:
            raise ContractError("SizeDistribution: d_max_m must be >= d_min_m")


@dataclass(frozen=True)
class DebrisDescriptor(Contract):
    """What a debris parcel represents: a population with a total mass (statistical, plan 3.9)."""

    total_mass_kg: float
    size_distribution: Optional[SizeDistribution]  # None until the fragment stage (5) resolves the population
    velocity_dispersion_m_per_s: float
    material_profile_id: Optional[str]
    sample_seed: int

    def _validate(self) -> None:
        _positive("DebrisDescriptor", total_mass_kg=self.total_mass_kg)
        _non_negative("DebrisDescriptor", velocity_dispersion_m_per_s=self.velocity_dispersion_m_per_s)
        if self.sample_seed < 0:
            raise ContractError("DebrisDescriptor.sample_seed: must be >= 0")


# ----------------------------------------------------------------------------------------------------------------
# Impact capture and model I/O (plan 4.5, 4.6)
# ----------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class BodyImpactState(Contract):
    """One body frozen at the contact time. `material_profile` is a resolved copy (None = material unspecified)."""

    id: str
    mass_kg: float
    radius_m: float
    position_m: Vec3
    velocity_m_per_s: Vec3
    representation: Representation = "body"
    spin_rad_per_s: Optional[Vec3] = None
    orientation: Optional[Orientation] = None
    material_profile: Optional[MaterialProfile] = None
    origin_event_id: Optional[str] = None

    def _validate(self) -> None:
        if not self.id:
            raise ContractError("BodyImpactState.id: must not be empty")
        _positive("BodyImpactState", mass_kg=self.mass_kg, radius_m=self.radius_m)


@dataclass(frozen=True)
class MutualEscapeSpeed(Contract):
    """Both mutual escape speeds are recorded and labelled (plan 3.5): LS12's R_C1 form and the physical-radii form."""

    ls12_rc1: Optional[float] = jfield("ls12RC1")
    physical_radii: float = 0.0

    def _validate(self) -> None:
        _positive("MutualEscapeSpeed", ls12_rc1=self.ls12_rc1)
        _non_negative("MutualEscapeSpeed", physical_radii=self.physical_radii)


@dataclass(frozen=True)
class ContactLatLon(Contract):
    """Impact site relative to the target's spin pole and prime meridian, degrees; None when the target has no spin."""

    target: Optional[tuple[float, float]]


@dataclass(frozen=True)
class ContactPointLocal(Contract):
    """Contact direction in each body's own frame (equal to the world frame for a body without rotation)."""

    target: Vec3
    projectile: Vec3


@dataclass(frozen=True)
class Environment(Contract):
    dominant_attractor_id: Optional[str]
    hill_radius_m: Optional[float]
    nearby_body_ids: tuple[str, ...] = ()

    def _validate(self) -> None:
        _positive("Environment", hill_radius_m=self.hill_radius_m)


@dataclass(frozen=True)
class ImpactState(Contract):
    """The pre-impact state, frozen before anything is mutated (spec 3.2). Target = the more massive body."""

    detection_time_s: float
    contact_time_s: float
    contact_time_estimated: bool
    rewind_s: float
    target: BodyImpactState
    projectile: BodyImpactState
    relative_velocity_m_per_s: Vec3
    impact_speed_m_per_s: float
    contact_point_m: Vec3
    contact_normal: Vec3  # unit, target -> projectile
    contact_point_local: ContactPointLocal
    contact_lat_lon_deg: ContactLatLon
    impact_angle_deg: float
    impact_parameter: float  # b = sin(theta), 0 = head-on
    spin_axis_angle_deg: Optional[float]
    total_mass_kg: float
    reduced_mass_kg: float
    mass_ratio: float  # gamma = M_projectile / M_target
    mutual_escape_speed_m_per_s: MutualEscapeSpeed
    specific_impact_energy_j_per_kg: float  # Q_R
    pair_momentum_kg_m_per_s: Vec3
    pair_kinetic_energy_com_j: float
    pair_orbital_angular_momentum_com_kg_m2_per_s: Vec3
    environment: Environment
    chunk_criterion_satisfied: bool
    schema_version: int = SCHEMA_VERSION
    # D-063 (additive, defaults keep older records readable): how the contact state was obtained. "integrated": the relative state
    # comes from integrating a copy of the whole system back to the contact time (positions and velocities refer to the same time);
    # "linear_rewind": positions rewound in a straight line, velocities of the detection time (the only method before D-063).
    contact_state_method: Literal["linear_rewind", "integrated"] = "linear_rewind"
    detection_relative_speed_m_per_s: Optional[float] = None  # |v_rel| at the detection time, for comparison with the impact speed
    contact_separation_residual_rel: Optional[float] = None  # |d(t_c) - (R_t + R_p)| / (R_t + R_p) of the integrated contact state

    def _validate(self) -> None:
        _non_negative("ImpactState", rewind_s=self.rewind_s, detection_relative_speed_m_per_s=self.detection_relative_speed_m_per_s,
                      contact_separation_residual_rel=self.contact_separation_residual_rel, impact_speed_m_per_s=self.impact_speed_m_per_s,
                      specific_impact_energy_j_per_kg=self.specific_impact_energy_j_per_kg,
                      pair_kinetic_energy_com_j=self.pair_kinetic_energy_com_j)
        _positive("ImpactState", total_mass_kg=self.total_mass_kg, reduced_mass_kg=self.reduced_mass_kg)
        _fraction("ImpactState", impact_parameter=self.impact_parameter)
        if not 0.0 < self.mass_ratio <= 1.0:
            raise ContractError(f"ImpactState.mass_ratio: must be within (0, 1] (projectile/target), got {self.mass_ratio!r}")
        norm = math.sqrt(sum(c * c for c in self.contact_normal.as_tuple()))
        if abs(norm - 1.0) > 1.0e-9:
            raise ContractError(f"ImpactState.contact_normal: must be a unit vector, got norm {norm!r}")


@dataclass(frozen=True)
class CollisionInput(Contract):
    """Everything a pure outcome model receives."""

    event_id: str
    parent_event_id: Optional[str]
    generation: int
    impact: ImpactState
    config: CollisionConfig
    seed: int
    input_digest: str = ""
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not self.event_id:
            raise ContractError("CollisionInput.event_id: must not be empty")
        if self.generation < 0:
            raise ContractError("CollisionInput.generation: must be >= 0")
        if not 0 <= self.seed <= MAX_SEED:
            raise ContractError("CollisionInput.seed: must be within [0, 2^63-1]")
        _digest_or_empty("CollisionInput.input_digest", self.input_digest)

    def compute_digest(self) -> str:
        """Digest of the canonical form with `inputDigest` blanked, so the digest never covers itself."""
        data = self.to_dict()
        data["inputDigest"] = ""
        return canonical_digest(data)


@dataclass(frozen=True)
class ParameterValue(Contract):
    """A model parameter that was used, with its unit and its source (inspectable via diagnostics)."""

    value: float
    unit: str
    source: str


@dataclass(frozen=True)
class RemnantSpec(Contract):
    mass_kg: float
    from_: Literal["target", "projectile", "both"] = jfield("from")
    composition: tuple[CompositionLayer, ...] = ()

    def _validate(self) -> None:
        _positive("RemnantSpec", mass_kg=self.mass_kg)
        _validate_composition("RemnantSpec.composition", self.composition)


@dataclass(frozen=True)
class OutcomeSpec(Contract):
    """Pure model output (no state change). Realised into bodies and parcels by the fragment stage."""

    model_id: str
    model_version: str
    outcome: Outcome
    regime_reasons: tuple[str, ...]
    parameters: dict[str, ParameterValue]
    largest_remnant: RemnantSpec
    second_remnant: Optional[RemnantSpec]
    debris_mass_kg: float
    debris_size_distribution: Optional[SizeDistribution]
    ejecta_velocity_model: str
    energy_partition_j: dict[str, float]
    fidelity: dict[str, Fidelity]
    warnings: tuple[str, ...] = ()
    fields_extra: dict[str, float] = field(default_factory=dict)
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not self.model_id or not self.model_version:
            raise ContractError("OutcomeSpec: model_id and model_version are required")
        _non_negative("OutcomeSpec", debris_mass_kg=self.debris_mass_kg)


# ----------------------------------------------------------------------------------------------------------------
# Result of a resolved collision (plan 4.6 - 4.8)
# ----------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class BodyPost(Contract):
    """Full physical state of a body after the event (surviving, transformed or newly created)."""

    id: str
    mass_kg: float
    radius_m: float
    position_m: Vec3
    velocity_m_per_s: Vec3
    representation: Representation = "body"
    material: Optional[MaterialRef] = None
    rotation: Optional[RotationState] = None
    composition: tuple[CompositionLayer, ...] = ()
    origin_event_id: Optional[str] = None
    fragment_class: Optional[FragmentClass] = None

    def _validate(self) -> None:
        if not self.id:
            raise ContractError("BodyPost.id: must not be empty")
        _positive("BodyPost", mass_kg=self.mass_kg, radius_m=self.radius_m)
        _validate_composition("BodyPost.composition", self.composition)


@dataclass(frozen=True)
class ParcelPost(Contract):
    """A debris parcel after the event: a massive, gravitating body that stands for a population (statistical)."""

    id: str
    mass_kg: float
    radius_m: float
    position_m: Vec3
    velocity_m_per_s: Vec3
    debris: DebrisDescriptor
    origin_event_id: Optional[str] = None
    fragment_class: Optional[FragmentClass] = None

    def _validate(self) -> None:
        if not self.id:
            raise ContractError("ParcelPost.id: must not be empty")
        _positive("ParcelPost", mass_kg=self.mass_kg, radius_m=self.radius_m)


@dataclass(frozen=True)
class DamageProfile(Contract):
    kind: Literal["power-law-falloff"]
    inner_radius_m: float
    exponent: float

    def _validate(self) -> None:
        _positive("DamageProfile", inner_radius_m=self.inner_radius_m)


@dataclass(frozen=True)
class EjectaCone(Contract):
    axis_local: Vec3
    half_angle_deg: float

    def _validate(self) -> None:
        if not 0.0 < self.half_angle_deg <= 180.0:
            raise ContractError(f"EjectaCone.half_angle_deg: must be within (0, 180], got {self.half_angle_deg!r}")


@dataclass(frozen=True)
class Propagation(Contract):
    """Reduced-order geodesic front (an `approximation`, never a resolved shock; plan 3.8). Missing wave speed = static site."""

    model: Literal["geodesic-front-v1"]
    wave_speed_m_per_s: Optional[float]
    attenuation_length_m: Optional[float]
    antipodal_focusing: bool

    def _validate(self) -> None:
        _positive("Propagation", wave_speed_m_per_s=self.wave_speed_m_per_s, attenuation_length_m=self.attenuation_length_m)


@dataclass(frozen=True)
class ImpactSite(Contract):
    """A localized impact in BODY-LOCAL coordinates, so it stays attached to the surface as the body rotates."""

    site_id: str
    body_id: str
    event_id: str
    time_s: float
    center_local: Vec3  # unit vector
    crater_radius_m: float
    transient_depth_m: float
    damage_profile: DamageProfile
    ejecta_cone: EjectaCone
    energy_j: float
    propagation: Propagation
    fidelity: Fidelity
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        _non_negative("ImpactSite", crater_radius_m=self.crater_radius_m, transient_depth_m=self.transient_depth_m,
                      energy_j=self.energy_j)
        norm = math.sqrt(sum(c * c for c in self.center_local.as_tuple()))
        if abs(norm - 1.0) > 1.0e-9:
            raise ContractError(f"ImpactSite.center_local: must be a unit vector, got norm {norm!r}")


@dataclass(frozen=True)
class MassLedger(Contract):
    """Where every kilogram went (plan principle 6: no silent mass loss)."""

    consumed_bodies_kg: float
    remnants_kg: float
    fragments_kg: float
    parcels_kg: float
    escaped_kg: float
    returned_to_remnant_kg: float

    def _validate(self) -> None:
        _non_negative("MassLedger", consumed_bodies_kg=self.consumed_bodies_kg, remnants_kg=self.remnants_kg,
                      fragments_kg=self.fragments_kg, parcels_kg=self.parcels_kg, escaped_kg=self.escaped_kg,
                      returned_to_remnant_kg=self.returned_to_remnant_kg)


@dataclass(frozen=True)
class EnergyReport(Contract):
    """Energy partition (plan 4.8). `dissipated_j` is the remainder; it must not be negative beyond tolerance."""

    kinetic_translational_before_j: float
    kinetic_translational_after_j: float
    rotational_before_j: float
    rotational_after_j: float
    mutual_potential_before_j: float
    mutual_potential_after_j: float
    self_gravitational_before_j: float
    self_gravitational_after_j: float
    dissipated_j: float
    dissipated_non_negative: bool


@dataclass(frozen=True)
class ConservationReport(Contract):
    mass_before_kg: float
    mass_after_kg: float
    mass_residual_rel: float
    momentum_before_kg_m_per_s: Vec3
    momentum_after_kg_m_per_s: Vec3
    momentum_residual_rel: float
    angular_momentum_before_kg_m2_per_s: Vec3
    angular_momentum_after_kg_m2_per_s: Vec3
    angular_momentum_residual_rel: Optional[float]
    angular_momentum_unmodelled: Optional[str]
    energy: EnergyReport
    tolerances: CollisionTolerances
    within_tolerance: bool

    def _validate(self) -> None:
        _positive("ConservationReport", mass_before_kg=self.mass_before_kg)
        _non_negative("ConservationReport", mass_after_kg=self.mass_after_kg, mass_residual_rel=self.mass_residual_rel,
                      momentum_residual_rel=self.momentum_residual_rel)


@dataclass(frozen=True)
class CollisionResult(Contract):
    """The realised outcome, validated before it is committed (spec 13.2)."""

    event_id: str
    outcome: Outcome
    removed_body_ids: tuple[str, ...]
    transformed: tuple[BodyPost, ...]
    created: tuple[BodyPost, ...]
    debris_parcels: tuple[ParcelPost, ...]
    impact_sites: tuple[ImpactSite, ...]
    mass_ledger: MassLedger
    conservation: ConservationReport
    warnings: tuple[str, ...]
    fidelity: dict[str, Fidelity]
    result_digest: str = ""
    fields_extra: dict[str, float] = field(default_factory=dict)
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not self.event_id:
            raise ContractError("CollisionResult.event_id: must not be empty")
        _digest_or_empty("CollisionResult.result_digest", self.result_digest)
        ids = [b.id for b in self.transformed] + [b.id for b in self.created] + [p.id for p in self.debris_parcels]
        if len(set(ids)) != len(ids):
            raise ContractError("CollisionResult: a body id appears more than once among the products")

    def compute_digest(self) -> str:
        """Digest of the canonical form with `resultDigest` blanked, so the digest never covers itself."""
        data = self.to_dict()
        data["resultDigest"] = ""
        return canonical_digest(data)


# ----------------------------------------------------------------------------------------------------------------
# Records and the API event (plan 4.9)
# ----------------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class CollisionEvent(Contract):
    """Summary event `type: "collision"` for the event list. The full record is `CollisionRecord`. The legacy
    `merger` event is a different, unchanged shape (backend.models.Event)."""

    id: str
    outcome: Outcome
    simulation_time_s: float
    estimated_contact_time_s: Optional[float]
    body_ids: tuple[str, str]  # [target, projectile]
    surviving_body_ids: tuple[str, ...]
    created_body_ids: tuple[str, ...]
    removed_body_ids: tuple[str, ...]
    parent_event_id: Optional[str]
    root_event_id: str
    generation: int
    model_id: str
    model_version: str
    impact_speed_m_per_s: float
    impact_angle_deg: float
    specific_impact_energy_j_per_kg: float
    largest_remnant_mass_kg: float
    debris_mass_kg: float
    mass_residual_rel: float
    momentum_residual_rel: float
    warnings: tuple[str, ...]
    fidelity_summary: dict[str, Fidelity]
    has_visual: bool
    type: Literal["collision"] = "collision"
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if self.generation < 0:
            raise ContractError("CollisionEvent.generation: must be >= 0")
        _positive("CollisionEvent", largest_remnant_mass_kg=self.largest_remnant_mass_kg)
        _non_negative("CollisionEvent", debris_mass_kg=self.debris_mass_kg, impact_speed_m_per_s=self.impact_speed_m_per_s)


@dataclass(frozen=True)
class CollisionRecord(Contract):
    """Everything about one event, for inspection and dry-run replay (spec 10.2)."""

    event_id: str
    parent_event_id: Optional[str]
    root_event_id: str
    generation: int
    input: CollisionInput
    selection_reasons: tuple[str, ...]
    outcome_spec: Optional[OutcomeSpec]
    result: Optional[CollisionResult]
    warnings: tuple[str, ...]
    fidelity: dict[str, Fidelity]
    input_digest: str
    result_digest: str
    detail_dropped: bool = False
    legacy_event_id: Optional[str] = None  # the `merger` event (evt-<n>) of the same physical event, if one was emitted
    fields_extra: dict[str, float] = field(default_factory=dict)
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not self.event_id:
            raise ContractError("CollisionRecord.event_id: must not be empty")
        if self.generation < 0:
            raise ContractError("CollisionRecord.generation: must be >= 0")
        _digest_or_empty("CollisionRecord.input_digest", self.input_digest)
        _digest_or_empty("CollisionRecord.result_digest", self.result_digest)


# ----------------------------------------------------------------------------------------------------------------
# Visual event description (plan 4.10, DQ-12)
# ----------------------------------------------------------------------------------------------------------------
Appearance = Literal["rock", "metal", "ice", "molten", "gas", "dust"]


@dataclass(frozen=True)
class VisualImpactSite(Contract):
    body_id: str
    center_local: Vec3
    center_world_at_contact_m: Vec3
    normal_world: Vec3


@dataclass(frozen=True)
class VisualPhase(Contract):
    """One phase of the sequence. `simulation-time` phases follow the displayed simulation time (they represent
    material); `visual-wall-clock` phases are visual-only, freeze while paused and replay on a seek back (DQ-12)."""

    name: Literal["contact", "flash", "cratering", "ejecta", "separation", "cloud-expansion", "aftermath"]
    start_s: float
    end_s: Optional[float]
    basis: Literal["simulation-time", "visual-wall-clock"]
    duration_wall_s: Optional[float] = None

    def _validate(self) -> None:
        _positive("VisualPhase", duration_wall_s=self.duration_wall_s)
        if self.end_s is not None and self.end_s < self.start_s:
            raise ContractError("VisualPhase: end_s must be >= start_s")


@dataclass(frozen=True)
class EjectaSource(Contract):
    body_id: str
    axis_local: Vec3
    half_angle_deg: float
    mass_kg: Optional[float]
    speed_range_m_per_s: tuple[float, float]

    def _validate(self) -> None:
        _positive("EjectaSource", mass_kg=self.mass_kg)
        if self.speed_range_m_per_s[0] < 0.0 or self.speed_range_m_per_s[1] < self.speed_range_m_per_s[0]:
            raise ContractError("EjectaSource.speed_range_m_per_s: must be 0 <= min <= max")


@dataclass(frozen=True)
class DebrisCloud(Contract):
    initial_radius_m: float
    expansion_speed_m_per_s: float
    material_appearance: Appearance

    def _validate(self) -> None:
        _positive("DebrisCloud", initial_radius_m=self.initial_radius_m)
        _non_negative("DebrisCloud", expansion_speed_m_per_s=self.expansion_speed_m_per_s)


@dataclass(frozen=True)
class VisualOnlyEffect(Contract):
    """A purely visual effect: it has NO mass field by design (DQ-12). It never represents or alters physical mass."""

    kind: Literal["flash", "glow", "shock-indicator"]
    intensity: float
    lifetime_wall_s: float

    def _validate(self) -> None:
        _fraction("VisualOnlyEffect", intensity=self.intensity)
        _positive("VisualOnlyEffect", lifetime_wall_s=self.lifetime_wall_s)


@dataclass(frozen=True)
class VisualEventDescription(Contract):
    """Built only from a validated, committed result. The renderer reads it and body states; it derives no outcome."""

    event_id: str
    outcome: Outcome
    time_s: float
    impact_site: VisualImpactSite
    phases: tuple[VisualPhase, ...]
    ejecta_sources: tuple[EjectaSource, ...]
    fragment_body_ids: tuple[str, ...]
    debris_parcel_ids: tuple[str, ...]
    cloud: Optional[DebrisCloud]
    visual_only: tuple[VisualOnlyEffect, ...]
    material_appearance: dict[str, Appearance]
    fidelity_notes: tuple[str, ...]
    schema_version: int = SCHEMA_VERSION
