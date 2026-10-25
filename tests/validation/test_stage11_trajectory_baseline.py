"""Stage 11 regression baseline (D-058 safeguard 3, D-059): material annotations must not change gravity.

The digests below were captured from the preset trajectories BEFORE any Stage 11 change (commit e59cee8, tree without
`backend/presets/data/body-materials.json`). Each is the SHA-256 of the exact IEEE-754 bytes of every body's position
and velocity (in preset order) after each of 20 steps of 5 days, run in the application's own engine. A change to any
digest means the dynamics changed; it must never be 'fixed' by editing the digest without an owner-recorded reason.

Re-baselined once for `solar-system-moons-j2000` on `integration/main-plus-collision-engine` (D-063): `main` 4ae90a2 changed that
preset's DATA (Phobos/Deimos and updated states, commits 404b5ba..bd08e6a). The new value is exactly what the pure `origin/main`
code produces for the new data (computed from `git archive origin/main`), and the merged collision code reproduces it bit for bit,
so the collision engine still changes no preset dynamics. Previous value (old preset data): 0705ad3ee28d...902f6354fbd6d."""
import hashlib
import os
import struct

import pytest

from backend.presets.loader import load_preset
from backend.simulation import SimulationService

BASELINE = {
    "solar-system-j2000": "8cc5976de71bebe1c8cb862ffc3e2f0ddd28790beaa1509f939017c2cb9851c5",
    "solar-system-moons-j2000": "8e7023558ab70013bd7048ff1b9a0a66c92961f895835dfec4de342bd578d59b",
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
