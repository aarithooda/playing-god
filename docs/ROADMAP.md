# Roadmap (evidence-based, 2026-10-26)

Ordered by the priority scheme: integrity/reproducibility, core correctness, collisions and state consistency, frontend/backend
synchronisation, regression and scientific validation, performance, preset fidelity, then new features. Evidence for each item is in
[ENGINEERING_STATUS.md](ENGINEERING_STATUS.md).

## The five next tasks

### 1. ~~Make `main` green again (resolve KD-1)~~ DONE 2026-10-26 (option (a), D-067)
- **Why:** CI has been red since PR #23; with it red, no regression signal is trustworthy. Cause: presets silently moved to
  `outcome-v1` with default materials (`api_universes.py`, `impact/materials.py`), contradicting D-045/D-060 and five tests.
- **Decide first (owner):** (a) revert the preset branch of `create_preset_universe` to `LEGACY_MERGE_CONFIG` and drop
  `InitialBody.material` for presets, restoring the documented behaviour and the five tests unchanged; or (b) keep the new behaviour,
  record a decision superseding D-045/D-060, update the five tests, regenerate preset digests deliberately, and correct the stale comments
  (`impact/config.py`, `simulation.py` docstring). (a) is the smaller change; (b) is only appropriate if outcome models for presets are intended.
- **Depends on:** nothing. **Acceptance:** `python -m pytest` and CI Backend job pass with no test weakened; a decision record exists.

### 2. Reproducible environments (Python part DONE 2026-10-26, D-067; remaining: Python version pin, one-command test script, e2e writing into tracked files, Windows/Linux fresh-clone check)
- **Why:** local pydantic 2.7 vs CI-latest changes which tests pass (KD-3); Playwright's Chromium pin is a recurring snag.
- **Do:** split runtime/dev requirements, add upper bounds or a lock file (`pip-compile`/`uv`), pin the Python version, make CI use it, add a one-command
  "run everything" script, make e2e tests not write into tracked files (KD-4).
- **Depends on:** #1 (a green baseline to lock). **Acceptance:** a fresh clone on Windows and Linux runs the documented commands with identical results.

### 3. ~~Decide the motion model~~ DONE on branch `motion/integration` (D-068; PR open). Remaining: eyes/GPU check, then merge. `origin/animations` stays separate.
- **Why:** `wip/frontend-motion-uncommitted` (interpolation) and `origin/animations` (graphics) hold unreviewed work that conflicts with the lookahead buffer; leaving
  them rots them.
- **Acceptance:** a decision record; either a rebased branch with tests passing and a browser check, or the branches archived with a reason.
- **Depends on:** #1.

### 4. Collision-engine validation plan
- **Why:** the engine is the project's largest and least validated component. Provisional science (D-059), cratering unsupported, no convergence
  studies for grazing/high-speed/multi-body cases (D-063), same-platform replay only.
- **Do:** obtain the independent review the repo prepared (`context/COLLISION_REVIEW_PACKAGE_FOR_VAIBHAV.md`), run the missing convergence studies, close the
  `PART` rows of `context/COLLISION_REQUIREMENT_TRACEABILITY.md`, add cross-platform replay in CI.
- **Acceptance:** each model carries a documented validity envelope tested at its edges; the traceability matrix has no unexplained `PART`/`MISS`.

### 5. Persistence and state-consistency hardening
- **Why:** all universes, snapshots and history die with the process; the frontend/back-end contract relies on in-memory epochs.
- **Do:** versioned on-disk save/load using the existing `CollisionState` serialisation; a backend-restart test through the real UI path.
- **Depends on:** #1, #2. **Acceptance:** restart keeps a saved universe bit-identically (same platform) and the UI reconnects without stale lookahead.

## Then (in order)
Performance (bundle splitting, >64-body frame pacing, 200+-body step latency under load); long-horizon integrator accuracy and energy-drift study;
visual regression for the WebGL scene; preset fidelity (more moons, sourced materials); only then new features (tidal deformation, new presets).

## Explicitly not yet
Tidal deformation; new presets or bodies; simulating ring grains in REBOUND; multi-user/auth; GPU-heavy visual effects; rewriting
`simulation.py`; any claim that the collision models are physically validated.
