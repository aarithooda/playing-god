"""Read-only catalogue endpoint (plan section 12.2)."""
from fastapi import APIRouter

from backend.catalogue import get_catalogue

router = APIRouter(prefix="/api/v1/catalogue")


@router.get("")
def catalogue() -> dict:
    return get_catalogue()
