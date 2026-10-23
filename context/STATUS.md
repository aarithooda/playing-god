# Status
_Concise authoritative snapshot. Update after every meaningful session._

## Starfield zoom stability MERGED (2026-10-24) — newest
- **Merged to `main`:** PR #5 (`frontend/starfield-zoom-stability`) as merge commit `7bae95e` (parents `ede80c0` and PR head `2427434`); `main` is `7bae95e`. Frontend only: `StarfieldShell` keeps drei's `<Stars>` shell a stable apparent size when zoomed out (uniform scale by camera distance beyond 700 scene units, star point-size compensation, larger `camera.far`), and `CelestialBody` keeps bodies at least 3 px in radius on screen (display-only scale; physics, backend, API, camera controls and positions untouched). Helpers: `sim/starfieldScale.ts`, `sim/bodyVisibility.ts`, `components/canvas/starfieldShader.ts` (shader patch pinned against the installed drei source by a test).
- **Review:** none recorded. Merged under **D-015**, a one-PR-only owner exception (same shape as D-014); the normal independent-review rule stays in force for every other PR, including the remaining UI branches.
- **Verified:** before the PR, `tsc` clean, `vitest` 117 passed (12 files), `npm run build` OK, backend `pytest` 259 passed; owner confirmed the zoom behaviour visually in a browser. GitHub CI (backend pytest, frontend tsc/vitest/build) passed on PR head `2427434` and on the merged `main` commit `7bae95e`. Not measured: frame rate, trackpad input.
- **Not done / next:** the other UI branches (e.g. `panel`, `frontend/close-body-inspector`, `bugfix/body-inspector-close`) are not integrated and were not touched; D-014's deferred diagnostics-panel relocation still applies when the sidebar layout lands. PR #4 (docs for the T-012 merge) is still open.

## T-012 diagnostics panel implemented, PR open (2026-10-24) — newest
- **Branch `frontend/t012-diagnostics-panel`** (PR pending review, not merged): new `components/ui/DiagnosticsPanel.tsx` (collapsed by default, bottom-left, "whole system, not the selected body"), `sim/diagnosticsFormat.ts`, a 6-line mount in `App.tsx`. Shows the six B1 quantities with API field names and SI units, angular momentum "about the origin (0,0,0)", booked spin "bookkeeping only", the point-mass note on U, and two clearly labelled derived sums (K+U, orbital L + booked spin; "Not conserved across mergers"). `null` is "Undefined" (never 0), a null vector is wholly undefined, derived sums propagate null. No drift indicators (omitted: a correct baseline would exceed T-012).
- **Behaviour change vs the B1 parser:** a missing, unsupported-version or malformed `diagnostics` no longer rejects the whole state; `diagnostics` becomes `null` with `diagnosticsIssue` and the panel says so (bodies stay visible). The strict `parseDiagnosticsDto` is unchanged.
- **Verified on the branch:** `tsc` clean; `vitest` 96 passed (9 files; 69 before); `npm run build` OK; backend `pytest` 259 passed; real-browser check at 800x600 against a live backend (values match the API, merger case: L_z -183.3 + spin -666.7 = -850 = pre-merger L_z). Not run: automated browser E2E (none exists). Shared files touched: `App.tsx` (mount only) — Nikhil's `bugfix/body-inspector-close` also edits it.

## B1 scientific diagnostics MERGED (2026-10-24) — newest
- **Merged to `main`:** PR #1 backend (`d2352b0`) then PR #2 frontend data path (`3ca349e`); D-013 accepted. Every state/step/reset response now carries `diagnostics` (version 1: total mass, momentum, kinetic and potential energy, angular momentum about the origin, booked merger spin; `null` for undefined values). Spec: `API_CONTRACT.md` "Diagnostics". Frontend: types, strict parser and view-model pass-through only.
- **Verified on `main` `3ca349e`:** `pytest` 259 passed (1 Starlette/httpx deprecation warning), `tsc` clean, `vitest` 69 passed (7 files), `npm run build` OK; GitHub CI green for the `main` push (`d2352b0`) and for PR #2 against `main`. Evidence categories: analytical/oracle physics tests = pytest; independent physics review = Vaibhav (PR #1). **Not existing:** diagnostics UI, browser E2E.
- **Not done / next:** the diagnostics panel (needs the frontend owner's UI area: inspector or info panel, units, "about origin" label, `null` shown as "Undefined", re-baseline any drift readout on events, edits and reset); K+U is not conserved across mergers. Deferred in the contract: centre of mass, per-body fields, energy-loss ledger, orbital elements.

## Backend connection restored (2026-10-24)
- The frontend had stayed at “connecting to the simulation backend” because the backend process was unresponsive. A clean restart revealed `ModuleNotFoundError: No module named 'rebound'` in this checkout's `.venv`.
- Installed declared backend dependencies from `backend/requirements.txt` (REBOUND 5.2.2) and started Uvicorn at `127.0.0.1:8000`. Backend `/healthz`, backend `/api/v1/simulation/state`, and both routes through Vite at `http://localhost:5173` returned HTTP 200. State begins paused at 0 s with no bodies.
- No tracked application source or dependency manifests changed; server is running in this app session.

## Frontend local dependency recovery (2026-10-24)
- Fixed local Vite import-analysis failure for `@react-three/fiber`: `frontend/package.json` and lockfile already declared Fiber/Drei; the local `node_modules` install was incomplete and Vite held `esbuild.exe` open. Stopped the two Vite processes for this checkout, ran `npm ci` successfully (243 packages), then `npm run build` passed (640 modules; existing >500 kB chunk warning).
- Frontend is running at `http://localhost:5173/` and returns HTTP 200. This is a local environment repair; no application source or dependency manifest changed. `npm ci` reported 6 audit vulnerabilities (3 moderate, 1 high, 2 critical); not auto-fixed.

## Engineering baseline CLOSED (2026-10-24) — newest, authoritative
- **Baseline code:** `main` at `b9f1a01` (docs-only commits may follow). **D-011 and D-012 accepted**, and Vaibhav accepted the two restated `tests/validation/` tolerances (accepted by the physics reviewer; the numerical evidence is the test runs below, not a new analytical derivation). Fresh local re-run on `b9f1a01`: pytest 204 passed (1 warning), `tsc` clean, vitest 55/55, build OK; CI green for `b9f1a01`.
- Evidence categories: analytical/physics review = `context/INDEPENDENT_PHYSICS_REVIEW.md`, `PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`; automated numerical/API tests = pytest; manual browser check = one, not repeatable; **not existing:** automated browser E2E, large-N performance tests, tree collision modes, high-resolution three-body reference.
- Known limitation: double precision cannot store a 1 kg body added to a body of ~1e16 kg or more (mass within one ulp; momentum still conserved).
- Non-blocking backlog: browser E2E (T-010), larger-N/long-step performance, tree collision modes, three-body reference, bundle code-splitting, Node 20 Actions deprecation. Recommended next milestone: product features on this baseline.

### Stabilization details (2026-10-24)
- **Verified:** `pytest` 204 passed (1 warning: Starlette/httpx deprecation; `RuntimeWarning` is now an error in `pytest.ini`); `npx tsc --noEmit` clean; `npx vitest run` 55/55; `npm run build` OK (chunk-size warning, Three.js not code-split). CI (`.github/workflows/ci.yml`: pytest, typecheck, vitest, build) ran green on GitHub for the first pushed commit (Linux, Python 3.11, Node 20).
- **New tests:** P-003 stress (`tests/test_stress_p003.py`, 16), `GET /events` (`tests/test_events_endpoint.py`, 12), step budget/stall/lone-body (`tests/test_step_guard.py`, 14), independent validation merged (`tests/validation/`, 11), API-only live-server smoke over real HTTP (`tests/smoke/`, 2). Smoke is **not** a browser test; the browser was re-checked manually (events panel, connection state, no new console errors) but there is no automated browser test.
- **Real defect found and fixed:** REBOUND 5.2.2's default IAS15 step criterion never returns when a body's net force cancels by symmetry (3+ equal masses at rest on a line); the whole backend wedged. Fixed with the GLOBAL criterion (D-011) plus a wall-clock budget with rollback (D-012, HTTP 503). All four IAS15 non-convergence warnings had one cause (a lone body has zero acceleration, so the convergence test is 0/0); a lone body is now advanced analytically (P-004 closed).
- **Branches:** all topic/review worktrees and local branch refs have been retired. `feature/frontend-api-integration` was verified as an ancestor of `main` with no open PR, then its remote branch name was deleted. Only `main` remains locally and on `origin`.
- **Run:** backend `.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; frontend `cd frontend && npm ci && npm run dev`. Checks: `python -m pytest`; `cd frontend && npm run typecheck && npm test && npm run build`.
- **Open risks:** latency grows ~O(N^2 * chunks) (N=200, dtS=1e7 exceeds the 10 s budget, so 503); a rollback replays on a different internal step grid; exact-tangency and chained mergers can lack `estimatedContactTimeS`; binary64 cannot hold 1 kg on 1e16+ kg; the GLOBAL criterion changes numerics slightly vs PRS23 (still ~1e-13 relative in orbit tests) ; GitHub Actions Node-20 deprecation notice.

## Integrated `main` (2026-10-24, integration session)
- **Integrated:** production REBOUND/IAS15 backend (`feature/production-rebound-simulation`, includes the M0 branch) and the React/Three.js frontend wired to the API (`feature/frontend-api-integration`, includes Nikhil's `codex/3drender`) are both in `main`. The sections below describe the pre-merge branches; where they say "not pushed / not merged" they are historical.
- **Verified on integrated main:** `pytest` 149 passed (3 known warnings); `npx tsc --noEmit` clean; `npx vitest run` 55/55; `npm run build` OK (warns that the main chunk is ~1.07 MB > 500 kB: Three.js, not yet code-split).
- **Browser journey verified manually (Playwright, 2026-10-24):** load, create bodies (SI values), select/inspect, edit name+mass (backend state updated), Step / Play / Pause, Delete, Reset, head-on merger (event shown in Event History), backend killed (error banner then "Backend: unreachable"; recovers on restart), 800x600 and 1440x900 layouts.
- **Run:** backend `.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; frontend `cd frontend && npm ci && npm run dev` (proxy forwards `/api` and `/healthz` to `BACKEND_URL`, default `http://127.0.0.1:8000`).
- **Known issues / follow-ups:** at 800x600 the centered title card slightly overlaps the Simulation panel (the inspector/control-panel overlap was fixed); frontend validation bounds duplicate backend rules; main JS chunk >500 kB. Later stabilization notes below supersede these pre-merge follow-ups.

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
