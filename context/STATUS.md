# Status
_Concise authoritative snapshot. Update after every meaningful session._

## Backend physics (branch `feature/production-rebound-simulation`, 2026-10-23, local only: not pushed, not merged)
- **Done:** production REBOUND/IAS15 service (`backend/simulation.py`), merger layer (`backend/collisions.py`), endpoints state, POST/PATCH/DELETE bodies, step, reset, events (`API_CONTRACT.md` matches the code). `rebound` is in `backend/requirements.txt`; `backend/store.py` was replaced by `simulation.py`.
- **Tests (fresh run):** `pytest` -> **149 passed, 3 warnings** (88 earlier + 61 new: 23 service/physics, 38 API simulation cases). The 3 warnings are the Starlette/httpx deprecation and two IAS15 non-convergence RuntimeWarnings inside the old spike tests; the production tests pass with `-W error::RuntimeWarning` (91 passed).
- **Evidence:** 2-body acceleration vs Newton rel 1e-6 (pins G); circular Sun-Earth orbit returns to start within 1e-9 a and dE/E < 1e-10 over one period via 10 chunked requests; merger conserves mass exactly and momentum to 1e-12 relative, KE loss, relative speed, spin and contact time match closed forms; fast 2000 m/s head-on not tunnelled; radial infall through a single 3e5 s request merges once; rollback restores state after injected failures; concurrent steps serialize.
- **Limits:** see "Physics limitations" in `API_CONTRACT.md` (energy/angular momentum not conserved by merges, detection-time events, untested extreme cases, no wall-clock limit per step).
- **Frontend must know:** `status` is always `paused`; Play = loop of `POST /simulation/step` (dtS in [1e-6, 1e8]); response carries `events` and `advancedS`; merge survivor keeps its id, absorbed id disappears; 409 on overlap at create/patch; Vite still strips `/api` (T-008).

- **Phase:** M0 complete (engine decision accepted); integration branch `feature/m0-rebound-physics-api` pushed for review. Next milestone: production engine integration (P-001).
- **Decisions (accepted 2026-10-23):** D-008 **GO WITH CUSTOM COLLISION LAYER** (REBOUND + IAS15 + `line` detection + our own merger layer; evidence, failure modes and limitations in `PHYSICS_SPIKE.md`); D-007 SI units with explicit G; D-010 right-handed Cartesian; D-009 project license GPL-3.0-only (`LICENSE`, `THIRD_PARTY_NOTICES.md`; project decision, not legal advice).
- **Units:** SI project-wide (D-007): m, m/s, kg, s, J, kg·m²/s, G = 6.67430e-11. REBOUND's own SI constant (6.67408e-11) is overridden.
- **Git:** work is on branch `feature/m0-rebound-physics-api` (API commit + M0 spike + license + docs, rebased on the latest `origin/main`, pushed with a normal push; `main` untouched). Branch `origin/validation/physics-first-principles` (independent physics review) is still unmerged.
- **Tests (run 2026-10-23):** `pytest` -> **88 passed, 3 warnings** (1 health + 29 API + 58 spike; ~9 s; run twice, identical). Spike tests need REBOUND 5.2.2 (`backend/experiments/requirements.txt`, installed only in the local `.venv`) and skip without it. `npm run build` re-run 2026-10-23: OK.
- **Works:** backend `/health`, `/healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies` (in-memory, no physics); Vite page; API contract v1 (`API_CONTRACT.md`).
- **M0 findings in one line each:** orbits conserve E, L to ≤1e-12 (IAS15); `direct` detection misses fast collisions (50/50 sweep collisions, 91% of fast phases), `line` had 0 errors in 144 swept scenarios (evidence, not proof); merger conserves mass/momentum to 1e-12 but kinetic+potential energy and orbital angular momentum are not conserved (booked in ledgers); checkpoint restore is bitwise identical but the resolver must be re-registered; WHFast is unsafe near collisions; collision order is random unless `rand_seed` is fixed; IAS15 needs a reset after a merge.
- **Not implemented:** the simulation itself (no REBOUND in the app, no events, no checkpoints endpoint, no tidal model, no Three.js scene).
- **Known risks:** see `PHYSICS_SPIKE.md` (untested: strongly curved paths, tree modes, many simultaneous collisions, scale; IAS15 warning after a merge with capped chunks); no frontend tests or CI; Vite proxy strips `/api` while the backend serves `/api/v1` (T-008); workflow confirmation by all four collaborators pending (T-005).
- **GitHub:** public repo https://github.com/aarithooda/playing-god ; collaborators added 2026-10-23.
- **Next:** review/merge the topic branch, then P-001 (production collision layer in the app) and the follow-ups P-002..P-004.

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

- **Phase:** M0 physics-engine feasibility spike; implementation still pre-simulation.
- **GitHub:** CLI 2.103.0 installed and authenticated as `biscuitfab`; Git credential setup succeeded. `main` context is pushed through `bca9ab0`.
- **Review branch:** `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains an independent analytical report and standard-library calculator; no PR opened.
- **Uncommitted main change:** `frontend/package.json` esbuild allowScripts edit; preserved and excluded from commits.
- **Not verified:** no REBOUND engine run, checkpoint experiment, collision implementation, or M0 go/no-go.
- **Tasks:** M0.1 agreement and M0.2/M0.3 experiments remain open; the independent report is a comparison reference, not a task closure.
- **Next milestone:** compare derivations, agree M0.1 units/conventions/tolerances, then run M0 fixtures.

_(origin/main side of the merge, kept as history:)_

- **Main:** main tracks origin/main at fac831b; the only uncommitted change is the pre-existing frontend/package.json esbuild allowScripts edit.
- **Remote branches fetched:** feature/m0-rebound-physics-api at 14af4f4 and codex/3drender at 397e563; local tracking branches and clean separate worktrees point to those exact remote commits. Aarit has six branch-only commits and one main-only commit; Nikhil has one branch-only and five main-only commits. Neither is merged.
- **Aarit M0/API branch:** contains API/state endpoints, REBOUND spike/collision/merger/checkpoint harness and tests, license/doc decisions. Branch-local STATUS reports 88 pytest passes and frontend build OK; not rerun in this session.
- **Nikhil 3D branch:** adds scene/canvas, camera controls, body inspector, control panel, event timeline and styling. It is behind current main and should be rebased before PR.
- **Worktrees:** C:\Users\calli\code\playing-god-feature-m0-rebound-physics-api and C:\Users\calli\code\playing-god-codex-3drender are clean, separate checkouts.
- **PRs:** no open PRs found.
- **Independent review:** validation/physics-first-principles is pushed separately and unmerged.
- **Main verification:** fetched refs, created local tracking refs and materialized separate clean worktrees. No app tests run; existing checkouts and branch tips were not moved, merged, rebased, or reset.
