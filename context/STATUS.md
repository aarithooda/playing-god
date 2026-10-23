# Status
_Concise authoritative snapshot. Update after every meaningful session._

- **Phase:** M0 physics spike in progress: first experiment pass run (uncommitted); awaiting joint review.
- **Branch / commits:** `main` = `origin/main` at `ad4bd59`; M0 experiment code and doc updates are uncommitted (see `git status`).
- **Works (verified 2026-10-23):** backend serves `GET /health` -> `{"status":"ok"}`; Vite dev server serves the PLAYING GOD page and proxies `/api/health` to the backend; `npm run build` succeeds.
- **API (2026-10-23, uncommitted):** `GET /healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies` implemented in-memory (no physics); rest planned. See `API_CONTRACT.md`.
- **Tests (run 2026-10-23):** `pytest tests/test_api.py tests/test_health.py` -> 30 passed. Full `pytest`: 11 spike tests FAIL (uncommitted `backend/experiments/rebound_spike.py` was refactored; tests/spike expect old functions) — needs the spike owner.
- **M0 findings (details in PHYSICS_SPIKE.md):** orbits conserve E/L to 1e-11 or better; 'direct' collision mode misses fast collisions, 'line' caught all tested; merger conserves mass/momentum; restore is bitwise-identical but the collision resolver must be re-set; REBOUND is GPL-3.0-only. Provisional: GO WITH A CUSTOM COLLISION LAYER.
- **Not implemented:** everything else — simulation, physics engine, collisions, tidal model, checkpoints, Three.js scene, API contracts. M0 criteria are only provisionally evidenced: AI-run, not independently reviewed; units/tolerances unagreed; several cases untested (see PHYSICS_SPIKE.md).
- **Known risks/issues:** REBOUND GPL-3.0-only license needs a team decision; esbuild postinstall warning on `npm install` (build/dev still work); no frontend tests or CI; collaborators added 2026-10-23 (biscuitfab, 19nikhiljha, manharrawat49-bit), workflow confirmation pending (T-005).
- **GitHub:** public repo https://github.com/aarithooda/playing-god ; `main` tracks `origin/main`.
- **Next milestone:** M0 — Physics Engine Feasibility Spike (`TASKS.md`, `PHYSICS_SPIKE.md`).

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

- **Phase:** M0 physics-engine feasibility spike; implementation still pre-simulation.
- **GitHub:** CLI 2.103.0 installed and authenticated as `biscuitfab`; Git credential setup succeeded. `main` context is pushed through `bca9ab0`.
- **Review branch:** `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains an independent analytical report and standard-library calculator; no PR opened.
- **Uncommitted main change:** `frontend/package.json` esbuild allowScripts edit; preserved and excluded from commits.
- **Not verified:** no REBOUND engine run, checkpoint experiment, collision implementation, or M0 go/no-go.
- **Tasks:** M0.1 agreement and M0.2/M0.3 experiments remain open; the independent report is a comparison reference, not a task closure.
- **Next milestone:** compare derivations, agree M0.1 units/conventions/tolerances, then run M0 fixtures.
