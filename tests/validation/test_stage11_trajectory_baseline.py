"""Stage 11 regression baseline (D-058 safeguard 3, D-059): material annotations must not change gravity.

The digests below were captured from the preset trajectories BEFORE any Stage 11 change (commit e59cee8, tree without
`backend/presets/data/body-materials.json`). Each is the SHA-256 of the exact IEEE-754 bytes of every body's position
and velocity (in preset order) after each of 20 steps of 5 days, run in the application's own engine. A change to any
digest means the dynamics changed; it must never be 'fixed' by editing the digest without an owner-recorded reason."""
import hashlib
import os
import struct

import pytest

from backend.presets.loader import load_preset
from backend.simulation import SimulationService

BASELINE = {
    "solar-system-j2000": "8cc5976de71bebe1c8cb862ffc3e2f0ddd28790beaa1509f939017c2cb9851c5",
    "solar-system-moons-j2000": "0705ad3ee28d1e97f96000578de964f0c2937a6e60acc536abb902f6354fbd6d",
}


def trajectory_digest(preset_id: str) -> str:
    preset = load_preset(preset_id)
    eng = SimulationService()
    eng.load_bodies(preset.bodies, history_mode=preset.history_mode, sample_interval_s=preset.sample_interval_s)
    h = hashlib.sha256()
    for _ in range(20):
        eng.step(432000.0)
        for b in eng.snapshot().bodies:
            h.update(b.id.encode())
            h.update(struct.pack("<6d", b.positionM.x, b.positionM.y, b.positionM.z,
                                 b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z))
    return h.hexdigest()


@pytest.mark.parametrize("preset_id", list(BASELINE))
def test_preset_trajectories_are_bit_identical_to_the_pre_stage_11_baseline(preset_id):
    digest = trajectory_digest(preset_id)
    if os.environ.get("PRINT_BASELINE"):
        print(f"BASELINE {preset_id} {digest}")
    assert BASELINE[preset_id] is not None, "baseline not captured"
    assert digest == BASELINE[preset_id]
