"""Collision-engine configuration (plan 4.1, 9.2, 9.4) and the default-mode policy constants."""
from dataclasses import dataclass, field
from typing import Literal, Optional

from backend.impact.serialization import (SCHEMA_VERSION, Contract, ContractError, _non_negative, _positive)


@dataclass(frozen=True)
class CollisionTolerances(Contract):
    """Per-event conservation tolerances (plan 9.2). Residuals are relative; see `conservation` (Stage 4)."""

    mass_rel: float = 1.0e-14
    momentum_rel: float = 1.0e-12
    angular_momentum_rel: float = 1.0e-10
    dissipated_energy_floor_rel: float = 1.0e-9  # dissipatedJ >= -floor * KE_com
    contact_distance_rel: float = 1.0e-9
    replay_cross_platform_rel: float = 1.0e-12

    def _validate(self) -> None:
        _positive("CollisionTolerances", mass_rel=self.mass_rel, momentum_rel=self.momentum_rel,
                  angular_momentum_rel=self.angular_momentum_rel,
                  dissipated_energy_floor_rel=self.dissipated_energy_floor_rel,
                  contact_distance_rel=self.contact_distance_rel,
                  replay_cross_platform_rel=self.replay_cross_platform_rel)


CollisionMode = Literal["legacy-merge", "outcome-v1"]
# The mode of a newly created sandbox universe. It is "legacy-merge" until Stage 4 step 4b (CP-4b) flips this one
# constant (D-033); presets and Orbit Lab runs stay "legacy-merge" until Stage 11 regardless of it.
DEFAULT_SANDBOX_MODE: CollisionMode = "legacy-merge"
DEFAULT_SEED = 12345  # == backend.simulation.RAND_SEED (not imported: backend.impact must not depend on the service)
MAX_SEED = 2**63 - 1


@dataclass(frozen=True)
class CollisionConfig(Contract):
    """Per-universe collision configuration (plan 4.1). Part of snapshots from Stage 2/10 on."""

    mode: CollisionMode = DEFAULT_SANDBOX_MODE
    seed: int = DEFAULT_SEED
    max_tracked_fragments_per_event: int = 16
    max_tracked_fragments_total: int = 64
    max_debris_parcels_per_event: int = 4
    max_debris_parcels_total: int = 32
    # DQ-6 is open: no engineering default may be invented, so the threshold is unset until the owner decides.
    tracked_fragment_min_mass_fraction: Optional[float] = None
    max_resolutions_per_step: int = 64
    max_fragmenting_generation: int = 2
    reserve_for_user: int = 8
    escape_removal_radius_factor: float = 1000.0
    separation_epsilon: float = 1.0e-3
    tolerances: CollisionTolerances = field(default_factory=CollisionTolerances)
    schema_version: int = SCHEMA_VERSION

    def _validate(self) -> None:
        if not 0 <= self.seed <= MAX_SEED:
            raise ContractError(f"CollisionConfig.seed: must be within [0, 2^63-1], got {self.seed!r}")
        for name in ("max_tracked_fragments_per_event", "max_tracked_fragments_total", "max_debris_parcels_per_event",
                     "max_debris_parcels_total", "max_resolutions_per_step", "max_fragmenting_generation",
                     "reserve_for_user"):
            if getattr(self, name) < 0:
                raise ContractError(f"CollisionConfig.{name}: must be >= 0")
        if self.max_resolutions_per_step < 1:
            raise ContractError("CollisionConfig.max_resolutions_per_step: must be >= 1")
        if self.max_tracked_fragments_per_event > self.max_tracked_fragments_total:
            raise ContractError("CollisionConfig: per-event fragment budget exceeds the total budget")
        if self.max_debris_parcels_per_event > self.max_debris_parcels_total:
            raise ContractError("CollisionConfig: per-event parcel budget exceeds the total budget")
        if self.tracked_fragment_min_mass_fraction is not None and not 0.0 < self.tracked_fragment_min_mass_fraction < 1.0:
            raise ContractError("CollisionConfig.tracked_fragment_min_mass_fraction: must be within (0, 1) or null")
        _positive("CollisionConfig", escape_removal_radius_factor=self.escape_removal_radius_factor)
        if not 0.0 < self.separation_epsilon < 1.0:
            raise ContractError("CollisionConfig.separation_epsilon: must be within (0, 1)")


