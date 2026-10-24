"""Loads and validates the committed preset data (plan sections 9, 9.5). The runtime never uses the network.

A preset file holds SI values with their sources. Loading re-checks everything that can silently go wrong: schema,
finiteness and positivity, the SHA-256 of every archived source file, and m = GM / G. The origin is then shifted to the
barycentre of the included bodies (zero total momentum). A preset that fails is reported as unavailable; creating a
universe from it fails with `preset_invalid` and creates nothing."""
import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import get_args

from backend.models import ASSET_KEY_PATTERN, BodyType, check_kind_body_type
from backend.simulation import G_SI, InitialBody

PRESETS_DIR = Path(__file__).resolve().parent
DATA_DIR = PRESETS_DIR / "data"
SOURCES_DIR = PRESETS_DIR / "sources"

# preset id -> data file name. A preset that is excluded (see context/PRESETS.md) is simply not listed.
PRESET_FILES = {"solar-system-j2000": "solar-system-j2000.json",
                "solar-system-moons-j2000": "solar-system-moons-j2000.json"}
BASES = ("measured", "nominal", "derived", "assumed")


class PresetDataError(Exception):
    pass


class UnknownPresetError(Exception):
    pass


@dataclass
class LoadedPreset:
    summary: dict
    provenance: dict
    bodies: list[InitialBody]  # centred on the barycentre of all included bodies
    raw_bodies: list[InitialBody]  # the same bodies exactly as archived (Solar System Barycenter frame, SI)
    history_mode: str
    sample_interval_s: float


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _vec(v) -> list[float]:
    if not (isinstance(v, list) and len(v) == 3 and all(_finite(c) for c in v)):
        raise PresetDataError("a state vector must be three finite numbers")
    return [float(c) for c in v]


def load_json(preset_id: str) -> dict:
    if preset_id not in PRESET_FILES:
        raise UnknownPresetError(preset_id)
    path = Path(DATA_DIR) / PRESET_FILES[preset_id]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PresetDataError(f"cannot read preset data {path.name}: {exc}") from exc
    if not isinstance(data, dict) or data.get("id") != preset_id:
        raise PresetDataError(f"preset data {path.name} does not describe {preset_id}")
    return data


def load_preset(preset_id: str) -> LoadedPreset:
    data = load_json(preset_id)
    try:
        return _build(data)
    except PresetDataError:
        raise
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise PresetDataError(f"preset {preset_id} is malformed: {exc!r}") from exc


def _build(data: dict) -> LoadedPreset:
    if data.get("gSI") != G_SI:
        raise PresetDataError(f"preset G {data.get('gSI')} differs from the engine's G {G_SI}")
    hist = data["history"]
    interval = hist["sampleIntervalS"]
    if hist["mode"] != "grid" or not (_finite(interval) and interval > 0):
        raise PresetDataError("a preset needs grid history with a positive sample interval")
    raw = []
    for b in data["bodies"]:
        st, gm, rad = b["state"], b["gm"], b["radius"]
        for part in (st, gm, rad):
            if part.get("basis") not in BASES:
                raise PresetDataError(f"{b['id']}: missing or unknown basis label")
        src = Path(SOURCES_DIR) / "horizons" / st["sourceFile"]
        try:
            digest = hashlib.sha256(src.read_bytes()).hexdigest()
        except OSError as exc:
            raise PresetDataError(f"{b['id']}: source file {st['sourceFile']} is missing") from exc
        if digest != st["sourceSha256"]:
            raise PresetDataError(f"{b['id']}: source file {st['sourceFile']} does not match its recorded hash")
        gm_si, radius = gm["valueM3PerS2"], rad["valueM"]
        if not (_finite(gm_si) and gm_si > 0 and _finite(radius) and radius > 0):
            raise PresetDataError(f"{b['id']}: GM and radius must be finite and positive")
        mass = gm_si / G_SI
        if abs(mass * G_SI / gm_si - 1.0) > 1e-15:
            raise PresetDataError(f"{b['id']}: mass does not reproduce its GM")
        raw.append((b, mass, radius, _vec(st["positionM"]), _vec(st["velocityMPerS"])))
    for b, *_ in raw:  # renderer metadata is optional; when present it must satisfy the same rules as the API
        body_type, asset_key = b.get("bodyType"), b.get("assetKey")
        if body_type is not None and body_type not in get_args(BodyType):
            raise PresetDataError(f"{b['id']}: unknown bodyType {body_type!r}")
        if body_type is not None:
            try:
                check_kind_body_type(b["kind"], body_type)
            except ValueError as exc:
                raise PresetDataError(f"{b['id']}: {exc}") from exc
        if asset_key is not None and not (isinstance(asset_key, str) and re.fullmatch(ASSET_KEY_PATTERN, asset_key)):
            raise PresetDataError(f"{b['id']}: malformed assetKey {asset_key!r}")
    if len(raw) < 2 or len({r[0]["id"] for r in raw}) != len(raw):
        raise PresetDataError("a preset needs at least two bodies with unique ids")
    ids = {r[0]["id"] for r in raw}
    for b, *_ in raw:  # relationship metadata: a primary must be another body of the same preset
        primary = b.get("primaryId")
        if primary is not None and (primary not in ids or primary == b["id"]):
            raise PresetDataError(f"{b['id']}: primaryId {primary!r} is not another body of this preset")
    total = math.fsum(m for _, m, *_ in raw)
    centre_x = [math.fsum(m * p[k] for _, m, _, p, _ in raw) / total for k in range(3)]
    centre_v = [math.fsum(m * v[k] for _, m, _, _, v in raw) / total for k in range(3)]
    bodies = [InitialBody(
        id=b["id"], name=b["name"], kind=b["kind"], massKg=m, radiusM=r,
        positionM=tuple(p[k] - centre_x[k] for k in range(3)), velocityMPerS=tuple(v[k] - centre_v[k] for k in range(3)),
        colorHex=b["colorHex"], bodyType=b.get("bodyType"), assetKey=b.get("assetKey"),
        primaryId=b.get("primaryId"),
        basis={"mass": b["gm"]["basis"], "radius": b["radius"]["basis"], "state": b["state"]["basis"]},
        sources=(b["gm"]["source"], b["radius"]["source"], b["state"]["sourceFile"])) for b, m, r, p, v in raw]
    raw_bodies = [InitialBody(
        id=b["id"], name=b["name"], kind=b["kind"], massKg=m, radiusM=r, positionM=tuple(p), velocityMPerS=tuple(v),
        colorHex=b["colorHex"],
        basis={"mass": b["gm"]["basis"], "radius": b["radius"]["basis"], "state": b["state"]["basis"]},
        sources=(b["gm"]["source"], b["radius"]["source"], b["state"]["sourceFile"])) for b, m, r, p, v in raw]
    summary = {"id": data["id"], "name": data["name"], "description": data["description"], "available": True,
               "unavailableReason": None, "bodyCount": len(bodies), "epochLabel": data["epoch"]["label"],
               "dataVersion": data["dataVersion"], "historyMode": hist["mode"], "sampleIntervalS": float(interval)}
    return LoadedPreset(summary, data, bodies, raw_bodies, hist["mode"], float(interval))


def list_presets() -> list[dict]:
    out = []
    for preset_id in PRESET_FILES:
        try:
            out.append(load_preset(preset_id).summary)
        except PresetDataError as exc:
            out.append({"id": preset_id, "name": preset_id, "description": "", "available": False,
                        "unavailableReason": str(exc), "bodyCount": 0, "epochLabel": None, "dataVersion": None,
                        "historyMode": None, "sampleIntervalS": None})
    return out
