"""Read-only preset descriptions (plan section 12.2). Creating a universe from a preset is POST /api/v1/universes."""
from fastapi import APIRouter

from backend.errors import CodedError
from backend.presets.loader import PresetDataError, UnknownPresetError, list_presets, load_preset

router = APIRouter(prefix="/api/v1/presets")


@router.get("")
def presets() -> dict:
    return {"presets": list_presets()}


@router.get("/{preset_id}")
def preset(preset_id: str) -> dict:
    try:
        loaded = load_preset(preset_id)
    except UnknownPresetError:
        raise CodedError(f"unknown preset: {preset_id}", code="preset_not_found", status=404) from None
    except PresetDataError as exc:
        raise CodedError(f"preset {preset_id} cannot be loaded: {exc}", code="preset_invalid", status=500) from exc
    return {**loaded.summary, "provenance": loaded.provenance}
