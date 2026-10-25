"""Material profile registry and validation (plan 4.2, spec 4).

The registry is the immutable list in `material_profiles.json`, validated at import. Rules (spec 4.3, DQ-2, risk R-05):
- every number a profile carries has a `provenance` entry naming its source (checked here for each present quantity);
- a quantity without a defensible source is absent and listed in `incomplete`; nothing is guessed or derived from a body's
  display `bodyType` (D-029);
- a body without a material is not an error: it resolves with exactly the legacy merge (label `material_unspecified`);
- an invalid material (unknown profile, bad layer fractions) is rejected with HTTP 422 `material_invalid`, never repaired.
No physics lives here, and no model uses these profiles before Stage 3/4.
"""
import json
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional

from backend.errors import CodedError
from backend.impact.contracts import ContractError, MaterialProfile, MaterialRef

PROFILES_PATH = Path(__file__).with_name("material_profiles.json")


def present_quantities(profile: MaterialProfile) -> set[str]:
    """Names of the numbers this profile carries; each needs a provenance entry with exactly this `quantity`."""
    out: set[str] = set()
    if profile.moment_of_inertia_factor is not None:
        out.add("momentOfInertiaFactor")
    if profile.wave_speed_m_per_s is not None:
        out.add("waveSpeedMPerS")
    if profile.ls12 is not None:
        out |= {"ls12.cStar", "ls12.muBar"}
    if profile.strength is not None:
        out |= {"strength.q0", "strength.a", "strength.B", "strength.b"}
    if profile.cratering is not None:
        out |= {"cratering.k1", "cratering.mu", "cratering.nu"}
    return out


def unsourced_quantities(profile: MaterialProfile) -> list[str]:
    have = {p.quantity for p in profile.provenance}
    return sorted(present_quantities(profile) - have)


def validate_profile(profile: MaterialProfile) -> None:
    missing = unsourced_quantities(profile)
    if missing:
        raise ContractError(f"MaterialProfile {profile.id}: no provenance for {missing}")
    if profile.ls12 is None and "ls12" not in profile.incomplete:
        raise ContractError(f"MaterialProfile {profile.id}: has no LS12 parameters, so 'ls12' must be listed in `incomplete`")
    if profile.moment_of_inertia_factor is None and "momentOfInertiaFactor" not in profile.incomplete:
        raise ContractError(f"MaterialProfile {profile.id}: has no moment of inertia factor, so it must be listed in `incomplete`")


def load_registry(path: Path = PROFILES_PATH) -> Mapping[str, MaterialProfile]:
    data = json.loads(path.read_text(encoding="utf-8"))
    profiles: dict[str, MaterialProfile] = {}
    for entry in data:
        profile = MaterialProfile.from_dict(entry)
        validate_profile(profile)
        if profile.id in profiles:
            raise ContractError(f"duplicate material profile id {profile.id}")
        profiles[profile.id] = profile
    return MappingProxyType(profiles)


REGISTRY: Mapping[str, MaterialProfile] = load_registry()


def get_profile(profile_id: str) -> Optional[MaterialProfile]:
    return REGISTRY.get(profile_id)


def list_profiles() -> list[MaterialProfile]:
    return sorted(REGISTRY.values(), key=lambda p: p.id)


def material_invalid(detail: str) -> CodedError:
    return CodedError(detail, code="material_invalid", status=422)


def resolve_material(data: "dict[str, Any] | MaterialRef | None") -> Optional[MaterialRef]:
    """Validate a body's material input. None stays None (material unspecified). Raises CodedError 422 `material_invalid`."""
    if data is None:
        return None
    try:
        ref = data if isinstance(data, MaterialRef) else MaterialRef.from_dict(data)
    except ContractError as exc:
        raise material_invalid(f"invalid material: {exc}") from exc
    if ref.profile_id not in REGISTRY:
        raise material_invalid(f"unknown material profile: {ref.profile_id}")
    return ref


def moment_of_inertia_factor(ref: Optional[MaterialRef]) -> Optional[float]:
    """The sourced factor k of the body's profile, or None (no material, or a profile without one)."""
    if ref is None:
        return None
    return REGISTRY[ref.profile_id].moment_of_inertia_factor


# Default profile per display `bodyType` for bodies that would otherwise have no material (presets, and the frontend's
# twin table in frontend/src/sim/defaultMaterial.ts for bodies the user creates). A coarse class choice, not a sourced
# composition: without it every such body resolves as `material_unspecified` and every contact is the legacy merge.
DEFAULT_PROFILE_BY_BODY_TYPE: Mapping[str, str] = MappingProxyType({
    "star": "gas-envelope-hhe", "gas-giant": "gas-envelope-hhe", "ice-giant": "water-ice", "rocky-planet": "silicate-rock",
    "moon": "silicate-rock", "asteroid": "rubble-silicate", "default": "silicate-rock"})


def default_material(body_type: str) -> MaterialRef:
    return MaterialRef(profile_id=DEFAULT_PROFILE_BY_BODY_TYPE.get(body_type, DEFAULT_PROFILE_BY_BODY_TYPE["default"]))
