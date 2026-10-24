"""Read routes of the collision engine (plan 3.1). Stage 2: the material registry. Later stages add collision records,
body surfaces and dry-run replay here."""
from fastapi import APIRouter

from backend.impact.contracts import SCHEMA_VERSION
from backend.impact.materials import list_profiles

router = APIRouter(prefix="/api/v1", tags=["collisions"])


@router.get("/materials")
def get_materials() -> dict:
    """The immutable registry of material profiles. Each number carries provenance; quantities without a defensible source are
    absent and named in `incomplete` (never guessed)."""
    return {"schemaVersion": SCHEMA_VERSION, "profiles": [p.to_dict() for p in list_profiles()]}
