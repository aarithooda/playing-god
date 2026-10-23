# Status
_Concise authoritative snapshot. Update after every meaningful session._

## Stabilization baseline (2026-10-24, stabilization session) — newest, authoritative
- **Verified:** `pytest` 204 passed (1 warning: Starlette/httpx deprecation; `RuntimeWarning` is now an error in `pytest.ini`); `npx tsc --noEmit` clean; `npx vitest run` 55/55; `npm run build` OK (chunk-size warning, Three.js not code-split). CI (`.github/workflows/ci.yml`: pytest, typecheck, vitest, build) ran green on GitHub for the first pushed commit (Linux, Python 3.11, Node 20).
- **New tests:** P-003 stress (`tests/test_stress_p003.py`, 16), `GET /events` (`tests/test_events_endpoint.py`, 12), step budget/stall/lone-body (`tests/test_step_guard.py`, 14), independent validation merged (`tests/validation/`, 11), API-only live-server smoke over real HTTP (`tests/smoke/`, 2). Smoke is **not** a browser test; the browser was re-checked manually (events panel, connection state, no new console errors) but there is no automated browser test.
- **Real defect found and fixed:** REBOUND 5.2.2's default IAS15 step criterion never returns when a body's net force cancels by symmetry (3+ equal masses at rest on a line); the whole backend wedged. Fixed with the GLOBAL criterion (D-011) plus a wall-clock budget with rollback (D-012, HTTP 503). All four IAS15 non-convergence warnings had one cause (a lone body has zero acceleration, so the convergence test is 0/0); a lone body is now advanced analytically (P-004 closed).
- **Branches:** old branches retired (see `HANDOFF.md`); `feature/frontend-api-integration` is kept (worktree exists and another session was running).
- **Run:** backend `.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; frontend `cd frontend && npm ci && npm run dev`. Checks: `python -m pytest`; `cd frontend && npm run typecheck && npm test && npm run build`.
- **Open risks:** latency grows ~O(N^2 * chunks) (N=200, dtS=1e7 exceeds the 10 s budget, so 503); a rollback replays on a different internal step grid; exact-tangency and chained mergers can lack `estimatedContactTimeS`; binary64 cannot hold 1 kg on 1e16+ kg; the GLOBAL criterion changes numerics slightly vs PRS23 (still ~1e-13 relative in orbit tests) and D-011/D-012 await owner confirmation; GitHub Actions Node-20 deprecation notice.

## Integrated `main` (2026-10-24, integration session)
- **Integrated:** production REBOUND/IAS15 backend (`feature/production-rebound-simulation`, includes the M0 branch) and the React/Three.js frontend wired to the API (`feature/frontend-api-integration`, includes Nikhil's `codex/3drender`) are both in `main`. The sections below describe the pre-merge branches; where they say "not pushed / not merged" they are historical.
- **Verified on integrated main:** `pytest` 149 passed (3 known warnings); `npx tsc --noEmit` clean; `npx vitest run` 55/55; `npm run build` OK (warns that the main chunk is ~1.07 MB > 500 kB: Three.js, not yet code-split).
- **Browser journey verified manually (Playwright, 2026-10-24):** load, create bodies (SI values), select/inspect, edit name+mass (backend state updated), Step / Play / Pause, Delete, Reset, head-on merger (event shown in Event History), backend killed (error banner then "Backend: unreachable"; recovers on restart), 800x600 and 1440x900 layouts.
- **Run:** backend `.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; frontend `cd frontend && npm ci && npm run dev` (proxy forwards `/api` and `/healthz` to `BACKEND_URL`, default `http://127.0.0.1:8000`).
- **Known issues / follow-ups:** at 800x600 the centered title card slightly overlaps the Simulation panel (the inspector/control-panel overlap was fixed); frontend validation bounds duplicate backend rules; main JS chunk >500 kB; unmerged teammate branches `validation/physics-first-principles` and `validation/production-physics-review` (Codex validation work) remain for their owner; P-003 stress tests still todo; no CI (T-004).

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
