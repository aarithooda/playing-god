# Worklog (chronological; append new entries at the bottom)

## 2026-10-24 — Frontend local dependency recovery
- Owner/AI: Codex
- Goal: resolve Vite's failure to import `@react-three/fiber` and get the frontend running.
- Finding: Fiber/Drei were already declared in package.json and package-lock.json, but the local install was incomplete. First `npm ci` failed because two Vite processes held `esbuild.exe`; after stopping those checkout-local Vite processes, `npm ci` installed 243 packages.
- Verification: `npm ls @react-three/fiber @react-three/drei --depth=0` shows both packages; `npm run build` succeeded (640 modules; pre-existing chunk-size warning); `http://localhost:5173/` returned HTTP 200.
- Risk: npm reported 6 audit vulnerabilities (3 moderate, 1 high, 2 critical); no `npm audit fix` run. No application source, dependency manifest, or lockfile changed.
- Commit: context-only record pending sync.

## 2026-10-23 — Repository initialization
- Owner/AI: project lead / Claude Sonnet 5.5 (Claude Code)
- Goal: minimal runnable skeleton + shared context system + Git/GitHub.
- Changed: created README, .gitignore, .env.example, pytest.ini, context/*, backend/, frontend/, tests/.
- Tests: `pytest` -> 1 passed (1 deprecation warning); `npm run build` OK; manual probe: backend `/health` ok, Vite page title PLAYING GOD, `/api/health` proxy ok.
- Commit: baseline on `main` (hash via `git log`).
- Remaining: GitHub push (see HANDOFF.md).

## 2026-10-23 — GitHub setup
- Owner/AI: project lead / Claude Sonnet 5.5
- Installed gh 2.103.0 via winget; user ran `gh auth login`; created private repo aarithooda/playing-god and pushed `main` (tracking set).
- Docs-only follow-up commit updates STATUS/HANDOFF/TASKS.

## 2026-10-23 — Team workflow and M0 plan (docs only)
- Owner/AI: project lead / Claude Sonnet 5.5
- Goal: collaboration system and testable plan for the physics spike.
- Changed: added `TEAM_WORKFLOW.md`, `PHYSICS_SPIKE.md`; added M0 to `TASKS.md` (T-001 superseded, T-005 added); updated STATUS, HANDOFF, DECISIONS (D-004), AI_WORKFLOW, README; repo made public.
- Tests: `pytest` rerun after doc changes (result in STATUS). No code changed; no M0 experiments run.
- Commit: not yet committed (awaiting review).

## 2026-10-23 — M0 REBOUND spike, first evidence pass
- Owner/AI: project lead / Claude Sonnet 5.5
- Goal: smallest experiments on REBOUND: orbits, collision detection/tunnelling, merger, checkpoint, performance, license.
- Added: `backend/experiments/{__init__,rebound_spike,requirements}`, `tests/spike/*`; updated PHYSICS_SPIKE (results), TASKS, STATUS, DECISIONS (D-006), ARCHITECTURE, HANDOFF.
- Tests: `pytest` -> 15 passed (2 warnings, incl. REBOUND's warning about resetting function pointers after load). Experiment table: `python -m backend.experiments.rebound_spike`.
- Notes: first E4 version had a misleading "passed_through" metric and too-short IAS15 window; both replaced. Early IAS15 'line' misses at v=20/50 were verified as true misses by independent closest-approach sampling.
- Commit: none (awaiting review). Remaining: independent review, units/tolerance agreement, untested cases, license decision.

## 2026-10-23 — API contract v1 + minimal API
- Owner/AI: project lead / Claude Sonnet 5.5
- Added: `context/API_CONTRACT.md`, `backend/models.py`, `backend/store.py`, `tests/test_api.py`; `backend/main.py` now serves `/healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies` (kept `/health`). In-memory store; tests isolate via `app.dependency_overrides[get_store]` (no public reset endpoint).
- Tests: `pytest tests/test_api.py tests/test_health.py` -> 30 passed. Full `pytest` -> 33 passed, 11 FAILED in `tests/spike/` (pre-existing: uncommitted `rebound_spike.py` no longer has `orbit(dt=)`, `merger`, `tunnelling`, etc.; logic moved to untracked `collision_spike.py`; not touched here).
- Not committed. Other endpoints in the contract are planned only.

## 2026-10-23 — M0 decision-ready: SI units, extended collision/merger/checkpoint evidence
- Owner/AI: project lead / Claude Sonnet 5.5
- Goal: SI convention, implement the planned collision tests, verify merger mechanics and checkpoint reproducibility, make an evidence-backed recommendation.
- Changed: rewrote `backend/experiments/rebound_spike.py` (SI, explicit G, seeded) and added `collision_spike.py` (merge layer with ledgers, stable ids, sweep, fixtures, checkpoint-with-collision); replaced `tests/spike/*` with `test_si_gravity_orbits.py` and `test_collisions_mergers.py` (58 tests; the previous 14-test file was removed because it targeted the old dimensionless harness); rewrote `PHYSICS_SPIKE.md`; updated STATUS, TASKS, HANDOFF, DECISIONS (D-007, D-008, D-009; D-006 superseded), ARCHITECTURE.
- Tests: `pytest` -> 88 passed, 3 warnings (run twice). Negative control: wrong G (REBOUND SI value) gives a 1e-3 orbit return error vs the 1e-10 bound. Explicit probes (not in the suite): WHFast radial pass at integer separations 20000–20019 (3 failures, one hang), IAS15 reselect after merge (dp 9.3e-6 -> 4.5e-13), random collision order vs `rand_seed`.
- Findings: F1–F11 in `PHYSICS_SPIKE.md`. Cross-checked six fixtures from the independent review on `origin/validation/physics-first-principles` (all agree).
- Repo state noticed: local main has an API-contract commit (2dfc8ac) and is 3 commits behind origin/main (Codex docs); nothing was pulled, committed or pushed.
- Commit: none. Remaining: joint sign-off, license decision, untested items (P-003), F10.

## 2026-10-23 — M0 integration: topic branch, license, reconciliation with origin/main
- Owner/AI: project lead / Claude Sonnet 5.5
- Goal: finish M0 and push a clean topic branch (no push to `main`, no force-push).
- Done: verified state (local `main` was 1 ahead / 3 behind, spike files uncommitted); created `feature/m0-rebound-physics-api`; committed the spike + tests, then `LICENSE` (GPL-3.0-only, text from the REBOUND wheel), `THIRD_PARTY_NOTICES.md` and README license section, then docs (D-008 accepted, D-009 GPL-3.0-only, D-010 coordinates, TASKS/STATUS/HANDOFF); rebased onto the latest `origin/main`, preserving the Codex GitHub-sync entries.
- Tests after the rebase: `pytest` -> 88 passed, 3 warnings; `cd frontend && npm run build` -> OK. Rebase conflicts were only in `context/STATUS.md`, `HANDOFF.md`, `WORKLOG.md`; the remote's GitHub-sync entries are kept (WORKLOG entries, and a 'Remote sync notes' section in STATUS and HANDOFF).

## 2026-10-23 — GitHub CLI setup
- Owner/AI: Codex.
- Goal: install GitHub CLI for repository operations.
- Changed: machine installed GitHub CLI 2.103.0 with winget; executable at `C:\Program Files\GitHub CLI\gh.exe`; machine PATH contains its directory.
- Verified: executable reports 2.103.0. `gh auth status` reports no logged-in GitHub host; no authentication flow was started. Current process PATH has not refreshed.
- Repo sync: fetched origin; `main` is aligned with `origin/main` at `ad4bd59`. Existing `frontend/package.json` change preserved.
- Pending: local review branch `validation/physics-first-principles` commit `a6540f0` remains unpushed pending GitHub authentication.

## 2026-10-23 — GitHub auth and review branch sync
- Owner/AI: Codex.
- Verified GitHub CLI login as `biscuitfab`; ran `gh auth setup-git` and Git fetch succeeded.
- Pushed `validation/physics-first-principles` commit `a6540f0`; branch now tracks origin. No PR created.
- Updated this handoff/status to reflect the authenticated Git setup and pushed independent review branch.
- Preserved the existing uncommitted `frontend/package.json` edit; only context files were staged for the main docs commits.

- Follow-up: pushed docs-only main context commits `b2dd01f` and `bca9ab0`; main now tracks origin. The existing package.json edit remains uncommitted and untouched.

## 2026-10-23 — Fetched teammate branches
- Fetched origin and found new branches: `feature/m0-rebound-physics-api` at `14af4f4` and `codex/3drender` at `397e563`.
- Created local tracking refs at exact remote tips; did not checkout, merge, rebase, or reset any branch. Main remained on `47c1bfb`; existing package.json edit preserved.
- Inspected branch commit summaries, file lists, and Aarit branch context. Its STATUS reports 88 pytest passes and frontend build OK; these were not independently rerun.
- GitHub reports no PRs for the repository. Updated handoff/status/tasks for review; no code changes or app tests.

- Follow-up: materialized both fetched teammate tips in separate clean worktrees: C:\Users\calli\code\playing-god-feature-m0-rebound-physics-api and C:\Users\calli\code\playing-god-codex-3drender. No existing worktree or branch pointer was changed. Current divergence from main: Aarit 6 branch-only / 1 main-only; Nikhil 1 branch-only / 5 main-only.

## 2026-10-23 — Production REBOUND simulation (backend session)
- Branch `feature/production-rebound-simulation` from `feature/m0-rebound-physics-api`; merged `origin/main` locally (context-doc conflicts resolved by keeping both sides). No push, no merge into main.
- Added `backend/collisions.py` (merge layer ported from the spike, no spike imports), `backend/simulation.py` (service: REBOUND ids by `name`, chunked transactional steps, events, reset), new models/bounds, endpoints PATCH/DELETE bodies, step, reset, events; removed `backend/store.py`; `rebound` added to `backend/requirements.txt`.
- Tests: `tests/test_simulation_service.py`, `tests/test_api_simulation.py`; one existing test (`test_body_id_is_stable_and_unique`) now places the second body at a distinct position because overlapping creation returns 409; `tests/test_api.py` imports renamed to the new service. No tests deleted or weakened.
- Result: `pytest` 149 passed, 3 warnings (spike + Starlette).

## 2026-10-24 — Frontend API integration (branch feature/frontend-api-integration, local only)
- Built on codex/3drender + local merge of origin/main. Added typed API client, SI view model, explicit render transform, `useSimulation` hook, live inspector/create/delete, backend events, Vite proxy without `/api` rewrite (also proxies `/healthz`). See `frontend/README.md`.
- Coded against `backend/models.py` at backend commit `8d7ab36` (`feature/production-rebound-simulation`); that branch's `API_CONTRACT.md` was checked at integration time (2026-10-24) and already documents step/reset/events/PATCH/DELETE as implemented; the earlier note calling it stale was incorrect.
- Verified: tsc, 55 vitest tests, `npm run build`, and a manual browser run against a backend served from an export of `8d7ab36` (create, select, PATCH, Play/Pause, single Step, DELETE, Reset, merger event, disconnected state).

## 2026-10-24 — Integration into main (Claude Sonnet 5.5)
- Realigned local `main` to `origin/main` (old local commit kept on `backup/local-main-2dfc8ac`), fast-forwarded to `feature/production-rebound-simulation`, merged `feature/frontend-api-integration` (only conflict: this file; kept both entries and corrected the wrong 'API contract is stale' note).
- Verified on main: pytest 149 passed; tsc OK; vitest 55/55; build OK (chunk-size warning). Manual Playwright browser journey passed against a backend on port 8010 (port 8000 was held by another process, left untouched).
- Fixed the Body Inspector overlapping the control panel at 800x600 (`BodyInspector.tsx` maxHeight, no minHeight). Title card still overlaps the control panel at 800 px: follow-up.

## 2026-10-24 — Independent production physics validation
- Reviewer: Codex; branch `validation/production-physics-review` based on `feature/production-rebound-simulation` at `af3b29a`; no production implementation edited.
- Added independent Newton/Kepler/energy/angular-momentum/radial-fall checks and collision edge fixtures under `tests/validation/`; created a branch-local Python 3.12 environment with the branch's declared dependencies (REBOUND 5.2.2).
- Independent suite: 11 passed. Full suite: 160 passed, 3 warnings. IAS15 non-convergence was logged in the steep radial-fall and 1e16:1 mass-ratio independent cases; two REBOUND RuntimeWarnings remain in legacy spike tests and one Starlette/httpx deprecation was reported.
- Results: acceleration relative error 3.06e-8; one-period orbit relative position error 1.34e-15, energy drift 4.35e-16, angular-momentum drift 1.82e-16; head-on/grazing merger momentum, contact-state KE and spin ledger matched independent calculations. Swept high-speed collision, near miss, exact tangency, two simultaneous pairs and one three-body chain were exercised.
- Limitations recorded: estimated contact time is null for exact tangency and the second same-step triple-chain merger; detection timestamp can lag contact; binary64 rounds away 1 kg when added to 1e16 kg; 0.49c is a numerical stress case only, not physically valid Newtonian input.
- Full report: `context/PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`. Production code and `main` unchanged; review branch remains separate.

## 2026-10-23 — Independent first-principles physics reference
- Owner/AI: Codex, independent computational-physics review.
- Goal: derive expected SI gravity, merger, collision geometry, checkpoint and tolerance checks without consulting another reviewer's calculations or engine outputs.
- Changed: added `context/INDEPENDENT_PHYSICS_REVIEW.md` and standard-library-only `context/independent_reference.py`; refreshed STATUS/HANDOFF and added a note to TASKS.
- Calculation: `python context/independent_reference.py` ran and printed the worked examples. This is not an application test or an engine test.
- Not done: no REBOUND execution, checkpoint experiment, task closure, or D-003 decision. M0.1 agreement and cross-review remain outstanding.
- Git: docs/calculation only on `validation/physics-first-principles`, based on latest pulled origin/main; local main package.json change was left untouched.

## 2026-10-24 — Baseline stabilization (Claude Sonnet 5.5)
- Merged the two Codex validation branches into main (docs, `tests/validation/`, reference calculator); retired obsolete branches (see HANDOFF).
- Baseline re-run before changes: pytest 149 (3 warnings), tsc clean, vitest 55/55, build OK.
- **IAS15 warnings (P-004):** all four (2 in tests/spike, 2 in tests/validation) come from a lone remaining body after a merge: a=0 makes IAS15's convergence ratio 0/0. A minimal pure-REBOUND repro (1 body, 0.5 s chunks, warns around chunk ~200) is pinned in `tests/test_step_guard.py`. Fix: advance a lone body analytically; the spike tests ignore only that message.
- **Engine stall found while writing the events tests:** 3 equal masses on a line hang `integrate` (PRS23). A stale server from an earlier session on port 8000 wedged the same way during the browser check. Characterized (modes, min_dt, symmetric layouts) and fixed with the GLOBAL criterion, a heartbeat watchdog and a 503 budget (D-011/D-012).
- Removed REBOUND's "Name hash table needs repairs" warning by scanning for bodies instead of name lookup.
- **Tolerance changes (disclosed):** `tests/validation/` circular orbit: element-wise abs 2e-3 m on a zero component (1.3e-14 a) replaced by the report's documented 2e-8*a norm; head-on KE: 0.1 J bound replaced by contact-state KE plus gravity work F*v_rel*delay (delay = detection minus analytic contact) within 0.02 J. Both had depended on PRS23's step grid.
- P-003 observed: e=0.6 binary over 3 periods E,L drift <1e-10; e=0.9 pericentre inside contact merges with the estimate within 0.02R/v of the Kepler time; near-miss orbits (5%, 50% clearance) give no false merger; hyperbolic flyby matches the conic to 1e-8 r0; rings of 4/6/12 and a seeded 10-body collapse merge to one body with exact mass and 1e-11 momentum; five simultaneous pairs; 2e30:1 orbit closes; 1e12:1 merger exact; 1e17:1 loses 1 kg to binary64 as documented.
- CI added and green on GitHub; a clean-venv install of `backend/requirements.txt` reproduced 204 passed. Manual browser check only (no automated browser test).
- Process note: two `taskkill /IM python.exe` calls to clear hung test processes also ended any other python process of the user on this machine.

## 2026-10-24 — Baseline closed (Claude Sonnet 5.5)
- Verified HEAD `b9f1a01` on `main`, clean, equal to origin. Fresh local run: pytest 204 passed (1 Starlette/httpx deprecation warning), `tsc` clean, vitest 55/55, build OK. CI green for `b9f1a01`.
- Recorded acceptance (Vaibhav, relayed by the project lead) of D-011, D-012 and the two restated `tests/validation/` tolerances. No new analytical review was performed in this session.
- Rollback guarantees confirmed present in `tests/test_step_guard.py` (state/time/events/event ids/ledgers restored, service continues, real stall stopped, 503); no new test needed.

## 2026-10-24 — Local baseline cleanup (Codex)
- Fetched origin and aligned the local `main` worktree to `8f3c37b`, the current clean milestone baseline. Removed the old uncommitted `frontend/package.json` `allowScripts` edit per the user's request.
- Removed local worktrees/branches whose commits are already ancestors of `main`: `codex/3drender`, `feature/m0-rebound-physics-api`, `m0-collision-validation`, `validation/physics-first-principles`, and `validation/production-physics-review`.
- Confirmed `feature/frontend-api-integration` is fully merged and has no open PR; deleted its remote branch name. Only remote `main` remains. Stopped the old Vite server on port 5174; main frontend on 5173 and backend on 8000 remain running.
- Attempted to remove the separate uncommitted `C:\Users\calli\code\playing-god-t3` research repository, but the filesystem safety policy rejected recursive deletion. Left that directory and its untracked files untouched; it is the only extra project directory still present under `C:\Users\calli\code`.

## 2026-10-24 — Restore frontend/backend connection
- Owner/AI: Codex
- Goal: resolve the frontend remaining at “connecting to the simulation backend”.
- Finding: the existing backend process accepted connections but did not answer requests. A clean restart exposed `ModuleNotFoundError: No module named 'rebound'` in this checkout's `.venv`; REBOUND was already declared in `backend/requirements.txt`.
- Changed: installed the declared backend requirements (including REBOUND 5.2.2) and started Uvicorn at `127.0.0.1:8000`.
- Verification: backend `/healthz` and `/api/v1/simulation/state`, plus both same routes through the Vite proxy at `http://localhost:5173`, returned HTTP 200. Initial state is paused at 0 s with no bodies.
- No application source, manifest, or lockfile changed; backend server remains running in this app session.

## 2026-10-24 — Add close control to body inspector
- Owner/AI: Codex
- Goal: let users dismiss the selected-body menu with a small visible control.
- Changed: `BodyInspector` now renders a compact accessible × button; `App` clears `selectedBodyId` on close, hiding the panel. Selecting a body continues to open it.
- Verification: `npm run build` passed (640 modules transformed). Existing main bundle >500 kB warning remains. Test suite not run.
- Branch: `frontend/close-body-inspector`; not merged.

## 2026-10-24 — Copy inspector fix to bug-fix branch
- Owner/AI: Codex
- Goal: create a dedicated bug-fix branch containing the inspector close-button change.
- Changed: created `bugfix/body-inspector-close` from latest `origin/main` and cherry-picked the close-button commit. Current handoff/status/task notes now identify it as the active branch.
- Preserved: existing `frontend/close-body-inspector` branch was not modified or deleted.
- Verification: branch is based on `origin/main` and contains the close-button commit. No additional build/test was needed; source is unchanged from the already-built commit.

## 2026-10-24 — Avoid overlap in automatic body defaults
- Owner/AI: Codex
- Goal: allow consecutive body creation without the repeated default position causing an overlap conflict, while preserving validation for manually selected positions.
- Changed: added a placement helper that derives a clear default from existing spherical bodies and the new body's radius. The create form recalculates while placement is automatic and freezes it after the user edits a coordinate. Backend validation remains authoritative for manual overlap attempts.
- Verification: `npm run build` passed (640 modules transformed); existing large-chunk warning remains. Test suite not run.
- Branch: `bugfix/body-inspector-close`; source commit `526c2a7` pushed. Not merged.

## 2026-10-24 — Add body double-click focus and zoom
- Owner/AI: Codex
- Goal: select bodies with one click and focus/zoom to them on a double-click.
- Changed: `CelestialBody` now forwards double-click separately from click selection. `App` routes focus requests through `UniverseCanvas`; `CameraRig` recenters on the body and moves 10% closer per focus, with a display-radius-based minimum distance.
- Verification: `npm run build` passed (640 modules transformed); existing large-chunk warning remains. Test suite not run.
- Branch: `bugfix/body-inspector-close`; commit `82d0dcb` pushed to origin. This branch also carries the prior dynamic-default fix.

## 2026-10-24 — Fix visible placement and smooth camera focus
- Owner/AI: Codex
- Goal: place newly created bodies so their rendered spheres do not overlap, and animate camera focus.
- Changed: create defaults now check physical radii and rendered radii after the post-create fit transform, using a stride scaled for large bodies. Camera and orbit target now smoothstep to the focused body over 0.65 s.
- Verification: frontend Vitest 57/57 passed; `npm run build` passed with the existing large-chunk warning. Browser E2E not run.
- Branch: `bugfix/body-inspector-close`; code and context changes are local and need commit/push. Not merged.

## 2026-10-24 — Add manual 3D body placement and fixed focus distance
- Owner/AI: Codex
- Goal: prevent repeated focus from zooming indefinitely and let users choose body positions in the scene.
- Changed: focus requests return to `max(4.5 × display radius, 8 scene units)`. The create form now starts a camera-facing 3D placement mode with a translucent gray sphere matching the body display size; pointer movement previews, wheel adjusts depth, click commits the location to SI form fields, and Escape cancels. Added a regression test for the picked-position state handoff.
- Verification: frontend Vitest 59/59 passed; production build passed with existing >500 kB chunk warning. Browser E2E not run.
- Branch: `bugfix/body-inspector-close`; code and context changes are local and need commit/push. Not merged.

### Push follow-up
- Code commit `f192a48` was pushed to `origin/bugfix/body-inspector-close`; context updates are being committed separately. Branch remains unmerged.

## 2026-10-24 — Refine focus and make 3D placement exact and immediate
- Owner/AI: Codex
- Goal: reduce focus zoom, improve placement depth control, and create directly from the 3D click.
- Changed: focus now settles at a fixed 70 scene units. Scroll depth sensitivity increased 30%. A placement click submits immediately; the preview and selected world coordinate use the same camera ray/plane intersection, and the scene scale is preserved on that create to prevent the visible body shifting after refit.
- Verification: frontend Vitest 59/59 passed; production build passed with existing large-chunk warning. Browser E2E not run.
- Branch: `bugfix/body-inspector-close`; source and context updates are local and need commit/push. Not merged.

### Push follow-up
- Source commit `ad8bdb3` was pushed to `origin/bugfix/body-inspector-close`; this context update is being committed separately. Branch remains unmerged.

## 2026-10-24 — Slightly increase focus zoom
- Owner/AI: Codex
- Goal: make the default focus view show the selected body a little larger.
- Changed: reduced the fixed focus distance from 70 to 66 scene units (about 6% closer at the default framing); focus remains fixed so repeated taps do not zoom in progressively.
- Verification: frontend Vitest 59/59 passed; `npm run build` passed with the existing large-chunk warning. Browser E2E not run.
- Branch: `bugfix/body-inspector-close`; source commit `efbc2ee` pushed to origin. Not merged.

## 2026-10-24 — Frame focused body to a consistent screen size
- Owner/AI: Codex
- Goal: make focus produce a specific apparent body size instead of moving each body to one fixed scene distance.
- Changed: focus now smoothly frames the displayed sphere to 25% of the canvas height. Distance is derived from displayed radius and perspective-camera vertical field of view, so object size is consistent across bodies and repeated focus remains deterministic.
- Verification: `npm run build` passed with the existing large-chunk warning. No test suite or browser E2E was run.
- Branch: `bugfix/body-inspector-close`; source commit `2ad5167` pushed to origin. Not merged.

## 2026-10-24 — Dismiss body inspector on outside click
- Owner/AI: Codex
- Goal: close the selected-body inspector when the user clicks elsewhere, in addition to its close button.
- Changed: `BodyInspector` listens for document pointer-down events and ignores events whose target is inside the panel; outside presses call the existing close action.
- Verification: `npm run build` passed with the existing large-chunk warning. Frontend tests and browser E2E were not run.
- Branch: `bugfix/body-inspector-close`; changes awaiting commit and push. Not merged.
