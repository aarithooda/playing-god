"""The body catalogue: sourced, reusable single-body definitions (plan section 10).

Entries are copies to start from, never live references: `get_catalogue()` hands out a deep copy every time, so nothing a
caller does can change the catalogue, and creating or editing a body in a universe never touches it. Entries carry no
positions or velocities (they are not systems), and colour is a display choice. The data file is committed; validation
at load rejects missing sources, non-finite numbers and unknown bases.
"""
import copy
import json
import math
import re
from functools import lru_cache
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent / "catalogue_data.json"
BASES = ("measured", "nominal", "estimated", "illustrative")
BODY_TYPES = ("star", "rocky-planet", "gas-giant", "ice-giant", "moon", "asteroid", "default")
ASSET_KEY_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class CatalogueDataError(Exception):
    pass


@lru_cache(maxsize=1)
def _load() -> dict:
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CatalogueDataError(f"cannot read the catalogue: {exc}") from exc
    seen = set()
    for e in data["entries"]:
        if e["id"] in seen or e["kind"] not in ("star", "planet"):
            raise CatalogueDataError(f"bad catalogue entry {e.get('id')}")
        seen.add(e["id"])
        body_type, asset_key = e.get("bodyType"), e.get("assetKey")
        if body_type not in BODY_TYPES or not isinstance(asset_key, str) or not ASSET_KEY_PATTERN.fullmatch(asset_key):
            raise CatalogueDataError(f"{e['id']}: renderer bodyType and assetKey are required and must be valid")
        if (e["kind"] == "star") != (body_type == "star"):
            raise CatalogueDataError(f"{e['id']}: bodyType {body_type!r} does not match kind {e['kind']!r}")
        for key in ("massKg", "radiusM"):
            p = e["properties"][key]
            if not (isinstance(p["value"], float) and math.isfinite(p["value"]) and p["value"] > 0):
                raise CatalogueDataError(f"{e['id']}.{key}: value must be finite and positive")
            if p["basis"] not in BASES or not p["sources"] or not all(s.get("citation") and s.get("url") for s in p["sources"]):
                raise CatalogueDataError(f"{e['id']}.{key}: basis and sources are required")
    return data


def get_catalogue() -> dict:
    return copy.deepcopy(_load())


def catalogue_ids() -> frozenset[str]:
    return frozenset(e["id"] for e in _load()["entries"])
