# Handoff (latest — rewrite at end of each session)

**Date:** 2026-10-23 · **By:** Claude Sonnet 5.5 for the project lead

1. **Project:** PLAYING GOD — browser 3D gravitational sandbox (React/TS/Vite/Three.js frontend, FastAPI backend, backend owns physics state). See `PROJECT_BRIEF.md`.
2. **Current state:** skeleton + API contract v1 (in-memory, no physics) + an M0 REBOUND spike (experiment code, not application code). Public repo https://github.com/aarithooda/playing-god. See `STATUS.md`.
3. **Last completed milestone:** M0 (physics engine feasibility): decision accepted, **GO WITH CUSTOM COLLISION LAYER** (D-008); SI units (D-007), right-handed Cartesian (D-010), GPL-3.0-only (D-009). API milestone (contract v1 + minimal endpoints) integrated. All on branch `feature/m0-rebound-physics-api`.
4. **In progress:** nothing. The topic branch was rebased on the latest `origin/main` and pushed (normal push); `main` is untouched. Awaiting review/merge.
5. **Do first:** review/merge the branch into `main` via PR; compare `origin/validation/physics-first-principles` (independent review) with `PHYSICS_SPIKE.md`; then start P-001 (production collision layer) following the layer spec; keep P-002..P-004 in view.
6. **Relevant files:** `context/PHYSICS_SPIKE.md`, `context/DECISIONS.md` (D-007, D-008, D-009), `context/TASKS.md`, `backend/experiments/rebound_spike.py`, `backend/experiments/collision_spike.py`, `tests/spike/test_si_gravity_orbits.py`, `tests/spike/test_collisions_mergers.py`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `context/INDEPENDENT_PHYSICS_REVIEW.md` (only on the unmerged branch).
7. **Commands:** `pip install -r backend/experiments/requirements.txt`; `pytest` (88 passed on 2026-10-23); `python -m backend.experiments.rebound_spike`; `python -m backend.experiments.collision_spike`; frontend: `cd frontend && npm run build`.
8. **Do not change without investigation:** backend-owns-state (D-001); SI units and G = 6.67430e-11 set explicitly (D-007). D-008 is accepted, but REBOUND is still not in `backend/requirements.txt` and the app must not import `backend/experiments`: the production integration is the next milestone (P-001). Do not use WHFast where bodies can collide, do not return 0 from a collision resolver, do not index bodies by array position, and do not loosen test tolerances to force passes (tests named `*known_failure*` / `*limitation*` pin observed REBOUND behaviour: if they fail, REBOUND changed — read the report first). `sep 20012` in the WHFast radial failure hangs the process: do not add it to tests.
9. **Uncommitted changes / failures:** none (working tree clean after the push). Warnings: Starlette/httpx deprecation; IAS15 non-convergence RuntimeWarning after a merge with capped chunks (F10, unresolved); REBOUND restore warning (expected).

**API addendum (from the earlier API session):** `context/API_CONTRACT.md` + `backend/{models,store,main}.py` + `tests/test_api.py` implement healthz/state/create-body only. Remaining: frontend owner fixes the Vite proxy (it strips `/api`, backend serves `/api/v1/...`, T-008); implement PATCH/DELETE bodies (T-007); simulation endpoints wait for D-008. Update the contract in the same change.

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

**Date:** 2026-10-23 · **By:** Codex

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See `PROJECT_BRIEF.md`.
2. **Repository:** Context was fetched from origin before edits. Docs-only context commits are pushed to `main` (latest `bca9ab0`); the existing uncommitted `frontend/package.json` esbuild allowScripts edit is intentionally preserved and excluded.
3. **GitHub CLI:** Installed version 2.103.0 at `C:\Program Files\GitHub CLI\gh.exe`; authenticated as `biscuitfab`. `gh auth setup-git` was applied; Git fetch and push succeeded.
4. **Independent physics review:** Branch `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains `context/INDEPENDENT_PHYSICS_REVIEW.md` and its independent calculator. No PR was opened.
5. **M0:** no simulation implementation/engine verification. M0.1 and M0.2/M0.3 experiments remain open. The review is an analytical reference only; compare it with the teammate derivation and agree M0.1 before engine runs.
6. **Next:** review the pushed validation branch, agree conventions/tolerances, then run prescribed M0 fixtures. D-003 remains proposed.
