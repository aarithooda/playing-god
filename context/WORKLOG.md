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

## 2026-10-24 — B1 scientific diagnostics merged (Claude Sonnet 5.5)
- Designed (proposal, then owner approval), implemented and merged the diagnostics contract (D-013): pure `backend/diagnostics.py::compute_diagnostics` (fsum, order-independent, `null` for undefined/overflow, +0.0 never -0.0), wired into `SimulationService._snapshot` so it is atomic with `bodies`; frontend data path (types, strict parser, view model), no UI.
- Review: Vaibhav approved the physics; his P3 (NaN/inf `potentialEnergyJ` for an unusable `g` in the pure helper) fixed in `8405ac2` with 16 regression tests. Nikhil approved the consumer side and suggested `Diagnostics.version: Literal[1]` (adopted). A live response also exposed `-0.0` for a single body; fixed and tested.
- Findings recorded: K+U is not conserved across a merger and orbital L only together with booked spin; the `heat_J` ledger stays server-private; deleting the last body makes REBOUND warn "Last particle removed" (harmless, pinned by a `pytest.warns` test). Measured cost at N=200: ~3.7 ms.
- Merge: PR #1 -> `d2352b0`, PR #2 retargeted to `main` and merged -> `3ca349e`. Fresh runs on `3ca349e`: pytest 259 passed, tsc clean, vitest 69 passed, build OK; GitHub CI green on both merge points. No diagnostics UI and no Experiment 01 were started.

## 2026-10-24 — T-012 system diagnostics panel (Claude Sonnet 5.5)
- Phase 1 check: `main` = `origin/main` = `b2eaf64`, GitHub CI success for it (and for `3ca349e`, `d2352b0`); local pytest 259, tsc, vitest 69, build OK.
- Built the panel on topic branch `frontend/t012-diagnostics-panel` as a new component plus a minimal `App.tsx` mount (bottom-left, collapsed by default) to avoid Nikhil's in-flight inspector/control-panel/canvas work. Derived sums (K+U, L+spin) are labelled and propagate `null`. Drift indicators omitted on purpose.
- Changed B1's parse behaviour: unusable `diagnostics` degrade to `null` + reason instead of failing the whole state (requirement: never crash, never reinterpret an unknown version). Tests updated for that (not weakened): missing, unsupported version, malformed all still never yield values.
- Tests +27 frontend (96 total): panel (labels/units, null scalar/vector, zero vs Undefined, huge/tiny values, missing/unsupported, loading/error, updates and reset), format helpers, parser leniency, hook follows load/step/reset. Real-browser check against a live backend (own ports; the teammate's backend on 8000 and Vite on 5173 were left alone).

## 2026-10-24 — T-012 merged under owner exception D-014 (Claude Sonnet 5.5)
- Recorded D-014 (one-PR-only exception; TEAM_WORKFLOW unchanged and not weakened), then merged PR #3 with a normal merge commit `ede80c0` onto `b2eaf64`. The PR head was `c736da3` plus one docs-only commit (`b0f2a1d`, the D-014 record; no code differs); CI (backend + frontend jobs) passed on `b0f2a1d` before the merge and on `ede80c0` after it. No review was recorded on GitHub; Nikhil's comment reported the sidebar overlap, deferred to the layout integration.

## 2026-10-24 — Starfield zoom stability merged (Claude Sonnet 5.5)
- Fixed the dynamic starfield shrinking, and planets disappearing, when zooming far out. Causes: drei `<Stars>` is a fixed world-space shell (apparent size falls with distance; fixed `far = 2000` clips it) and bodies project below one pixel. Fix: `StarfieldShell` (uniform scale beyond 700 units, point-size compensation, `camera.far` that covers the scaled shell) and a 3 px minimum projected body radius (display-only).
- A review pass found a real defect in the first version: drei's shader positions stars with `w = 0.5`, which halves the effective far plane, so about half the stars vanished for camera distances of roughly 4,200-5,100 (and similar bands further out). Fixed, with a regression test using a real three.js projection matrix; the shader patch is also pinned against the installed drei source. A pixel comparison against the 700-unit reference then matched from 1,000 to 1e15 units.
- Merge: PR #5 -> `7bae95e` (normal GitHub merge commit, pinned to head `2427434`). No independent review: owner-authorized one-PR exception recorded as D-015. CI passed on the PR head and on the merged `main` commit. Other branches (Nikhil, Vaibhav, Manhar) and Experiment 01 were not touched.

## 2026-10-24 — M0: PR #4 reconciled with main (Claude Sonnet 5.5)
- Verified before touching anything: local `main` = `origin/main` = `7f9aea0`, clean tree; PR #4 head `c06451a`, docs only (3 files, +6/-3), CI green on that head, GitHub reported it as conflicting with `main`.
- Merged `origin/main` into `docs/t012-merged` (normal merge commit). Conflicts only in `STATUS.md` and `WORKLOG.md`; resolved by keeping both sides: starfield STATUS section first, then the T-012 section retitled MERGED (the stale "PR open" heading and "newest" tag dropped); D-014 worklog entry before the starfield worklog entry. `TASKS.md` merged cleanly. Recorded D-017 (one-PR owner exception, no independent review).
- Not started: M1-M5 (body inspector, panels, outline, axes/grid). No code changed by this PR.

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
- Branch: `bugfix/body-inspector-close`; code and context source commit `336ab26` is pushed to origin. Not merged.

## 2026-10-24 — Add manual 3D body placement and fixed focus distance
- Owner/AI: Codex
- Goal: prevent repeated focus from zooming indefinitely and let users choose body positions in the scene.
- Changed: focus requests return to `max(4.5 × display radius, 8 scene units)`. The create form now starts a camera-facing 3D placement mode with a translucent gray sphere matching the body display size; pointer movement previews, wheel adjusts depth, click commits the location to SI form fields, and Escape cancels. Added a regression test for the picked-position state handoff.
- Verification: frontend Vitest 59/59 passed; production build passed with existing >500 kB chunk warning. Browser E2E not run.
- Branch: `bugfix/body-inspector-close`; code and context source commit `336ab26` is pushed to origin. Not merged.

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
- Branch: `bugfix/body-inspector-close`; source/context commit `3e03479` pushed to origin. Not merged.

## 2026-10-24 — Bound zoom-out and repeat starfield shells
- Owner/AI: Codex
- Goal: stop zooming once all displayed bodies visually collapse to one point, while keeping the starfield around the scene during zoom-out.
- Changed: `UniverseCanvas` computes the displayed-body bounding extent around the orbit target and sets the OrbitControls maximum distance for a one-pixel projected diameter. The perspective camera far plane grows to include the body cloud at that distance. The starfield now adds contiguous, geometrically expanding spherical shells when the camera approaches the current shell's outer edge.
- Verification: `npm run build` passed (640 modules); existing >500 kB bundle warning remains. No tests or browser E2E were run.
- Branch: `bugfix/body-inspector-close`; source commit `66e8fc3` is pushed to origin. Not merged.

## 2026-10-24 — Smooth the starfield and keep bodies visible at zoom limit
- Owner/AI: Codex
- Goal: remove visible boundaries between repeated star annuli and keep bodies distinguishable at maximum zoom-out.
- Changed: replaced layered Drei `Stars` shells with one camera-centered spherical starfield rendered behind body meshes, avoiding shell transitions as the view moves. Changed the zoom cap from a 1 px cloud diameter to 6% of the viewport height. The camera far plane continues to expand to include the body set at that cap.
- Verification: `npm run build` passed (640 modules); existing >500 kB bundle warning remains. No tests or browser E2E were run.
- Branch: `bugfix/body-inspector-close`; source commit `af7a810` is pushed to origin. Not merged.

## 2026-10-24 — Restore zoom parallax in continuous starfield
- Owner/AI: Codex
- Goal: retain a continuous background while restoring the starfield's visible zoom effect.
- Changed: anchored a single Drei `Stars` point volume at the universe origin, spanning 300–10,000 scene units. The stars now show perspective parallax as the camera moves through the volume; `renderOrder=-1` and disabled depth testing keep the field behind opaque bodies. Camera far range includes the star volume. The 6% body-cloud zoom limit remains.
- Verification: `npm run build` passed (640 modules); existing >500 kB bundle warning remains. No tests or browser E2E were run.
- Branch: `bugfix/body-inspector-close`; source commit `bae5301` is pushed to origin. Not merged.

## 2026-10-24 — Restore dense background universe and meaningful zoom limit
- Owner/AI: Codex
- Goal: restore a full, continuous star background while retaining enough zoom-out for a small but visible body system.
- Changed: replaced the sparse origin-centered 300–10,000 scene-unit point volume with 80,000 stars on a spherical field centered at the OrbitControls target. The sphere scales continuously to remain around the camera, preserving close-range parallax while procedurally continuing with no outer edge or shell seam. Set the maximum displayed body-cloud height to 10% of the viewport and expanded the far plane to include the dynamic sphere.
- Verification: `npm run build` passed (640 modules); existing >500 kB bundle warning remains. No tests or browser E2E were run.
- Branch: `bugfix/body-inspector-close`, based on `c99d5ca`. Local only; not committed or pushed by instruction.

## 2026-10-24 — Revert universe background zoom changes
- Owner/AI: Codex
- Goal: remove only the universe starfield/zoom-limit experiments while retaining unrelated UI fixes.
- Changed: restored `frontend/src/components/canvas/UniverseCanvas.tsx` from `3e03479`, which retains the existing focus, placement, and inspector behavior but uses the original static Drei starfield and has no added zoom cap or dynamic far-plane logic. Updated current-state docs; older zoom experiments remain in this append-only log as history.
- Verification: `npm run build` passed (640 modules; existing >500 kB chunk warning). No test suite or browser E2E was run.
- Branch: `bugfix/body-inspector-close`; rollback was pushed at the user's explicit request.

## 2026-10-24 — Keep body inspector open while orbit-dragging
- Owner/AI: Codex
- Goal: allow camera rotation around the selected body without click-away dismissal closing its inspector.
- Changed: outside-pointer handling tracks pointer movement and only schedules close after a click release under a 6 px movement threshold. The 300 ms delay lets a second press cancel the pending close so double-click-and-drag works; ordinary outside clicks still close the inspector.
- Verification: `npm run build` passed (640 modules); existing >500 kB chunk warning remains. Tests and browser E2E were not run.
- Branch: `bugfix/body-inspector-close`; source commit `336ab26` is pushed to origin. Not merged.

## 2026-10-24 — Keep inspector open on body clicks
- Owner/AI: Codex
- Goal: allow clicking bodies while the inspector is open without dismissing the inspector, while preserving click-away elsewhere.
- Changed: added a window-capture raycast that tags pointer events hitting displayed body spheres. The inspector ignores those marked events; its existing drag threshold and delayed outside-click close remain in place.
- Verification: `npm run build` passed (641 modules); existing >500 kB chunk warning remains. Tests and browser E2E were not run.
- Branch: `bugfix/body-inspector-close`; changes are local and need commit/push. Not merged.
## 2026-10-24 — Remove selected-body ring
- Owner/AI: Codex
- Goal: remove the white ring displayed around a selected body while preserving ordinary selection.
- Changed: removed the conditional ring mesh from `CelestialBody`; selection state, click handlers, inspector/focus behavior, and subtle emissive selection highlight remain unchanged.
- Verification: `npm run build` passed (641 modules); the existing >500 kB chunk warning remains. Tests and browser E2E were not run.
- Branch: `bugfix/body-inspector-close`; source and context changes are ready to commit and push, not merged.

### Push follow-up
- Source/context commit `ff372a0` is pushed to `origin/bugfix/body-inspector-close`; branch remains unmerged.

## 2026-10-24 — M1: body inspector, focus, placement, undo (Claude Sonnet 5.5)
- Merged `origin/bugfix/body-inspector-close` (head `de0d004`, unchanged since recon) into a branch from `origin/main` `969cb4a`. Docs conflicts: kept both sides. Code conflicts in `CelestialBody.tsx` / `UniverseCanvas.tsx`: rewrote both by hand on top of `main`'s starfield and min-size code (starfield files untouched).
- Deliberate rework of the branch's dismissal: R3F `onPointerMissed` replaces the document listeners / marker / timer (reason: the old rule closed the inspector on any press outside it, including panel buttons, and its ray test used the true radius while `main` draws enlarged minimum-size bodies). `PlacementCursor` now uses pure helpers in `sim/placement.ts`, reports the preview point for the readout, and ignores presses after the first. Added the SI coordinate readout, the 10 s undo (`useUndoableCreate`, `UndoNotice`) and `createBody` returning the new id (one existing expectation in `useSimulation.test.tsx` updated for the extra `id`).
- Tests +21 (138 total) and a browser pass; details in `STATUS.md`. Superseded `frontend/close-body-inspector`, `panel` and `feature/grid-axis` untouched. Owner exception for this PR: D-018.

## 2026-10-24 — M2: sidebars, free-area layout, centred scene (Claude Sonnet 5.5)
- Merged `origin/panel` (head `e76b09e`, unchanged since recon) onto `main` `aca0e7e`. Kept `main` for the four conflicted files and rebuilt the layout on it: `Sidebar`, `layout.ts`, `theme.ts`, solid panel styles; diagnostics moved under Event History; wordmark, first-use call to action, free-area overlays.
- Replaced the panel branch's CSS `left` shift of a 100vw canvas (leaves an uncovered strip when the insets differ) with `camera.setViewOffset`; the canvas stays exactly full-bleed and picking/placement stay exact (verified in the browser). Dropped the branch's blanket `background: transparent` panel style (readability) and its `isExpanded` visibility hack on `ControlPanel`.
- Tests +18 (156 total); the browser pass found a narrow-window overflow when both sidebars were open and shrinking, fixed by enforcing the rule on resize. Owner exception: D-019.

## 2026-10-24 — M3: selection outline and focus follow (Claude Sonnet 5.5)
- Started from `main` `25abca3` (M1 #7 and M2 #8 merged; no open PRs). Chose drei `Outlines` (constant-pixel back-face shell, no post-processing, no new dependency) over a billboard ring or a render pass; removed the emissive glow because it tinted the body. Pixel width is given in CSS px and multiplied by the device pixel ratio.
- Focus: kept the existing eased, screen-size-based framing and view direction; fixed the case where a moving body outruns the camera by easing toward the live position and then carrying camera and target with the body (pure maths in `sim/focusTracking.ts`, tested). Release rule is "target moved by someone else" (user pan), so it needs no input-handler coupling. Added the inspector's "Focused" badge via an `onFocusRelease` callback.
- Browser pass found no defects in M3; one test artifact (stuck synthetic pan state made a later badge check read false; a clean reload showed the badge persists through sidebar collapse/expand). Owner exception: D-020.

## 2026-10-24 — Simulation stall investigation (Claude Sonnet 5.5)
- **Evidence preserved, nothing reset.** The affected backend was still alive: `GET /healthz` 200 in 4 ms, `GET /api/v1/simulation/state` hung >15 s (direct and through Vite), process at ~100% of one core (249 CPU-s). `py-spy dump --native/--locals` (installed in a scratch venv, read-only) showed one AnyIO worker in `step -> _advance -> integrate -> reb_simulation_steps -> update_acceleration` for `dt_s=1e7`, `t0=151500000` (4.80 yr), and 7 workers queued in `snapshot()` (the page refreshes). Line numbers matched commit `8d7ab36` (no heartbeat/watchdog, default PRS23 criterion), not current `main`. A read-only `ReadProcessMemory` decode of its `rebound.Simulation` struct (same user, no code injection) gave: REBOUND 5.2.2, `G=6.6743e-11`, N=3, `t=155344829.88062295`, IAS15 `dt=5.2e-25` (later 7.1e-25), three 5.972e24 kg / 6.371e6 m bodies with x,y equal to 0.27 m and z = -3.37e9, 0, +3.37e9 m, the outer two with vz = +/-401.5 m/s toward the middle one. `t` was bit-identical hours later: frozen, not slow. Scratch artefacts (not committed): `pyspy_*.txt`, `remote_sim_state.json`, `read_remote_sim.py`, `exp_step.py` in the session scratchpad.
- **Replay on that recovered state (out of tree):** old code (`git archive 8d7ab36`) did not return in 60 s at `dt=1e7` or `1e5`; current `main` returned in 2.3 s with `merger, merger`. Conclusion: the numerical failure is the already-known D-011 wedge; the live process predates the fix. The original start state is unavailable, so the first 4.8 years were not reproduced.
- **Why the UI looked half-alive:** `/healthz` is lock-free; `GET /state` shared the step's lock; the frontend had no timeouts and queued the initial load behind everything else. Fixes and tests as in `STATUS.md`; decision proposed as D-021. Also added a frontend resync after a step with unknown outcome and honest "reachable but not responding" wording.
- Unrelated PR #9 (M3) was not touched.

## 2026-10-24 — M4: axes and grid (Claude Sonnet 5.5)
- Started from `main` `f32d52d` (M3 #9 and stall fix #10 merged; no open PRs). First verified the mapping in `renderTransform.ts` (scene = (x, z, -y)): the physics x-y plane is the horizontal scene plane, so the grid is drei's `Grid` at scene y = 0 and the axes are built through `toScenePosition` rather than a second hand-derived mapping.
- Chose drei `Grid` (shader plane, no geometry/dependency cost, fades by itself) and plain `lineSegments` for the axes; labels are drei `Html` (DOM) so no font is downloaded. Cell size is a 1-2-5 metre value near 5 scene units, so the legend number is readable and stays fixed while the display scale is held. Placement shows the grid through a derived value (`userGrid || placementMode`), never by writing the user's setting.
- Browser pass caught washed-out axis colours (sRGB hex used as linear vertex colour), fixed. Owner exception: D-022 (takes effect only if the owner merges).

## 2026-10-24 — M5: final verification and documentation (Claude Sonnet 5.5)
- Started from `main` `f3b0057`. Re-ran everything first (pytest 265, tsc, vitest 198, build) before changing anything, then ran the browser journey described in `STATUS.md`.
- The pass found one real defect (Fit view hid the fitted bodies under the right sidebar on a narrow window). Method: a WebGL framebuffer probe (read pixels in the same frame as a render, cluster bright blobs, report CSS positions) because pane screenshots are cropped device pixels and lag; clicks use frame x 0.964 = CSS px. Fix: `sim/framing.ts` (+5 tests), applied when the camera is reset.
- `ARCHITECTURE.md` was badly stale (said Three.js was not installed, "no simulation", "no CI", described the pre-M1 dismissal and the selection ring); rewritten to the code as merged. `README.md` gained a "Using it" section and lost its stale M0 wording. No code other than the framing fix changed. Owner exception: D-023.

## 2026-10-24 — Autonomous final integration and handover (Claude Sonnet 5.5)
- Authorization: the owner's chat message "Autonomous Final Integration, M5 Completion, and Repository Handover" explicitly allows creating and merging PRs, resolving conflicts and deleting verified merged branches without further approval, and forbids force-pushes, history rewrites, bypassing CI, faking reviews and losing data.
- Audit (before acting): no open PRs; `main` = `f3b0057`, CI success; every remote branch except `frontend/close-body-inspector` was an ancestor of `main`; local `integration/m5-final-docs` was 2 commits ahead and unpushed (its first push failed once with a transient `Could not resolve host`, retried successfully). Stale worktree `Playing God-frontend` inspected: clean, branch merged, only ignored build artefacts.
- Backend on :8000 inspected before any decision: pid 18780, started from `25abca3`, healthy (state read in 6 ms), holding a real used universe (t = 2.574e9 s). Not restarted (state not restorable via the API); backed up read-only. Unrelated: the earlier stuck backend (pid 5328) had been restarted at the owner's request before.
- Merged PR #12 (M5) with a pinned-head normal merge commit `a2de061` after CI success on that head. Re-verified the merged `main` (suites, CI) and re-ran the end-to-end scenarios on it (list in `STATUS.md`). Cleanup: archive tag for the one unmerged commit, explicit-list deletion of 16 remote branches (each verified as an ancestor of `main` immediately before), `git branch -d` for 13 local branches, removal of the stale worktree. Handover docs in this PR (#13); decision record D-024.
- Experiment 01: looked for its definition in all context documents and README; there is none. Reported as a prerequisite, not guessed.

## 2026-10-24 — UI-2 / UI-4 / UI-6 independent frontend work (Codex)
- Started on dedicated branch `frontend/ui-2-4-6` from agreed `main` `d5220f9`; honored UI-0 ownership by leaving `UniverseCanvas.tsx` unchanged and deferring rendering metrics. `App.tsx` only wires the history panel.
- Added bounded client-local history of backend-returned positions, a non-seeking timeline/controls, merger event estimate/spin details that exist in the API DTO, focus-visible/reduced-motion/accessibility refinements, and a Playwright CI/browser setup. Updated README and architecture; status/handoff/tasks updated.
- Verification: TypeScript check passed; Vitest 212/212 across 25 files; production build succeeded with the existing >500 kB chunk warning; Playwright 2/2 passed; `git diff --check` passed. E2E uses stubbed API responses and does not replace integration against the eventual Simulation Lab contract. No backend files changed.
- No push, merge, or rebase performed. Remote CI remains pending until the owner authorizes publishing.

## 2026-10-24 — Remove reassigned UI-2 work (Codex)
- Per the owner's request, removed UI-2 snapshot history implementation, hook state/recording, App wiring, component/tests and E2E history assertions. UI-4 merger metadata and UI-6 accessibility, Playwright infrastructure/recovery coverage, CI, and docs remain.
- No changes to `UniverseCanvas.tsx`; no push, merge, or rebase. Verification after removal is pending.
- Post-removal verification: typecheck passed; Vitest 204/204 across 23 files; production build succeeded with the existing >500 kB warning; Playwright 2/2 passed; diff check passed. E2E now covers merger metadata/responsive layout and recoverable load errors, with no history behavior.
- Renamed the local branch to `frontend/ui-4-6` to reflect the remaining scope; it still tracks the same `origin/main` base and has not been published.

## 2026-10-24 — Publish UI-4/UI-6 handoff branch (Codex)
- After the owner's approval, published `frontend/ui-4-6` to `origin/frontend/ui-4-6` at `df13b6e`. The branch contains the retained UI-4/UI-6 work and the UI-2 removal; no merge or PR creation was performed.
- Updated STATUS, HANDOFF, and TASKS to reflect the published branch and its review state. Existing verification evidence is recorded above; no new tests were run for this documentation-only update.

## 2026-10-24 — Complete remaining UI-4/UI-6 work (Codex)
- Created local `frontend/ui-4-6-completion` from the published `frontend/ui-4-6` branch. Added event-result selection using only the active API body IDs; the existing canvas selection highlight and Body Inspector are reused. No UI-0-owned scene/asset files or backend/API contracts changed.
- Added Playwright coverage for keyboard operation at 390 px, backend disconnection/recovery, and an attached frame-pacing profile at 1/16/64 bodies. On this Windows Chrome 156 run at 1440x900 with GPU disabled, median frame intervals were 33.4/50.0/99.9 ms. These are headless software frame-pacing measurements, not hardware GPU performance claims.
- Verification: typecheck passed; Vitest 206/206 (23 files); build passed with existing >500 kB chunk warning; Playwright 5/5; `git diff --check` passed. No push, PR, or merge performed. Real-hardware profiling and UI-0 coordination remain future integration work.

## 2026-10-24 — Consolidate UI-4/UI-6 branch (Codex)
- Per owner clarification, fast-forwarded the completed UI-4/UI-6 work into the existing `frontend/ui-4-6` branch so the deliverable remains on one branch. The redundant `frontend/ui-4-6-completion` branch is retired; no merge into `main` or PR was performed.
- Updated STATUS, HANDOFF, TASKS, and this worklog to point to the consolidated branch.

## 2026-10-24 — Simulation Lab / Experiment 01, M1: universe registry (Claude Sonnet 5.5)
- Baseline on `0237757` before changes: pytest 265, tsc clean, vitest 203 (23 files), build OK. `origin/main` unchanged at `d5220f9`.
- Added `backend/universes.py` (registry, activation epoch, commit guards, role rules), `errors.py` (coded errors), `lab_models.py`, `api_universes.py`; `SimulationService` gained `revision`, `guard=` (checked at lock entry and before publish, rolled back on refusal), cancel flag, `last_failure`, `kind`/`catalogueEntryId`. Legacy routes act on `uni-default` through `get_legacy_guard`.
- Tests +48 (313 total). Exact-shape assertions updated for the two new Body fields: `test_api.py::test_create_and_retrieve_body`, `::test_si_field_names_in_response`, `test_api_diagnostics.py::test_existing_fields_are_unchanged_and_diagnostics_is_purely_additive`.
- Deviations: activating the already-active universe is a no-op (no epoch bump) so a repeated click cannot invalidate an in-flight step; CRUD rollback in M1 uses the existing records-based capture (M2 may move it to snapshots).

## 2026-10-24 — Simulation Lab / Experiment 01, M2: snapshots, reset, history, controlled flag (Claude Sonnet 5.5)
- `backend/history.py` (flat-array `HistoryBuffer`, grid/step modes, committed-only reads, generations), `EngineSnapshot` (REBOUND `copy()` + service state), `load_bodies`, `from_snapshot`, `initial_state_digest`, reset-to-initial, audit log + `controlled`; snapshot and history endpoints; `API_CONTRACT.md` updated.
- Tests: pytest 349 (+36). Measured: REBOUND lands on every `k * 86400 s` exactly (`test_grid_history_exact_times`), and continuation after restore through the service path (chunking + grid targets) is bit-identical (`test_snapshot_restore_bitwise_continuation`), so the plan's fallback wording was not needed.
- Deviations: CRUD/reset/restore rollback uses a private `sim.copy()` checkpoint (bitwise) instead of the records rebuild; step mode also records a sample for each committed edit (plan: "one sample per commit"); rolled-back ring trims are not undone.

## 2026-10-24 — Simulation Lab / Experiment 01, M3: Solar System preset (Claude Sonnet 5.5)
- Fetched Horizons vectors once (31 raw files, all `{source: DE441}`) with `scripts/presets/fetch_horizons.py`; re-verified the DE440 GM table and planet mean radii against the live JPL pages (matched the plan), and read the Moon mean radius (1737.4 km) from the JPL satellite parameters page. `.gitattributes` marks the archived data `-text` so the recorded SHA-256 survives CRLF checkouts.
- `backend/presets/loader.py` validates schema, finiteness, source hashes and m = GM/G, then shifts the origin to the barycentre; presets API, preset-created universes (role `preset`, grid history 5 d) and `/provenance`.
- pytest 372 (+23). Measured, all inside thresholds: Horizons agreement 9.137e-07 (1 yr) and 3.921e-06 (2 yr) vs 2e-5; Earth-centre offset 4,890.0 km; Moon-omission difference 234.1 km vs 1,000 km bound; max offset 4,939.6 km; 2-body vs Horizons 11,717 km, 3-body 11,946 km. These reproduce the planning-probe numbers. K+U drift came out exactly 0.0 (bit-equal), so the 1e-12 check is satisfied trivially.

## 2026-10-24 — Simulation Lab / Experiment 01, M4: frontend universes (Claude Sonnet 5.5)
- `api/` gained universe, preset, snapshot and history DTOs with strict parsers, `ApiError.code`, and `ApiClient.scoped(scope)` (every mutation carries `activationEpoch`). `useUniverses` mirrors the backend list/active/epoch and detects loss (missing known ids or an epoch that went backwards). `UniverseWorkspace` (keyed `universeId:activationEpoch`) now holds everything universe-dependent moved verbatim out of `App.tsx`; `App.tsx` keeps the universe list, sidebars and axes/grid. New UI: `UniverseSwitcher`, `PresetPicker`, `SnapshotPanel`, `ConfirmButton` (reset and restore are two-press).
- Existing 203 tests passed unchanged after the extraction (only `test/fixtures.ts` gained the new Body fields and client methods). Totals: tsc clean, vitest 246 (+43, 28 files), build OK.
- Deviations: preset and "new empty universe" creation switch to the new universe (activate: true) so the user sees it; the switcher is blocked only by non-step writes (steps are rolled back by the backend, per plan 7.2).

## 2026-10-24 — Simulation Lab / Experiment 01, M5: catalogue and custom bodies (Claude Sonnet 5.5)
- Verified the previously unconfirmed catalogue values against their sources: Proxima Cen mass 0.1221 ± 0.0022 M☉ and radius 0.141 ± 0.021 R☉ are in the NASA Exoplanet Archive host-star rows (mass: Faria et al. 2022; the radius value is shared with the Anglada-Escudé et al. 2016 row); TRAPPIST-1 0.0898 ± 0.0023 M☉ and 0.1192 ± 0.0013 R☉ are the Agol et al. 2021 row; Sirius A radius 1.7144 ± 0.0090 R☉ is quoted in Bond et al. 2017 (text of the PDF, adopting Davis et al. 2011 interferometry); Betelgeuse abstract and the JPL planet table were re-read. No entry was downgraded to `illustrative` or dropped.
- `backend/catalogue.py`, `catalogue_data.json` (built by `scripts/catalogue/build_catalogue.py`), `GET /api/v1/catalogue`; body `kind`/`catalogueEntryId` validated (unknown values 422). Frontend: `CataloguePanel` (collapsed by default), type selector in the create form and inspector, physical-radius caption, "Pause to edit" lock on the inspector while Play runs, catalogue prefill that starts the body at rest.
- Tests: pytest 391 (+19), vitest 264 (+18), tsc clean, build OK. Star materials (emissive by kind) are done in M6 with the renderer work.

## 2026-10-24 — Simulation Lab / Experiment 01, M6: UI-0 renderer boundary (Claude Sonnet 5.5)
- `frontend/src/render/contract.ts` (`PositionSample`, `TrajectoryInput`, no imports), `sim/trajectory.ts` (`decimate`, `buildPolylines`, `toSceneSamples`, pure), `components/canvas/TrajectoryLayer.tsx` (drei `Line`: active solid, reference dashed and muted, split at `segment` changes), `bodyMaterial.ts` (stars emissive by `kind`). `UniverseCanvas.tsx` gained exactly one prop (`trajectories`) and one conditional mount; `SceneBody` carries `kind`. A source-level test pins the prop list, so a second prop fails the suite.
- vitest 275 (+11), tsc clean, build OK. `TrajectoryLayer` itself is WebGL and is checked in the browser journey (M10). `vite-env.d.ts` was added for `import.meta.glob` in the static boundary test (no new dependency).

## 2026-10-24 — Simulation Lab / Experiment 01, M7: UI-2 history timeline and replay (Claude Sonnet 5.5)
- `sim/history/{historyModel,useHistory,useHistoryNavigation,pathSelection}.ts`, `HistoryTimeline`, "Show paths" in `ViewPanel`, `historyView` mode in `ControlPanel`/`DiagnosticsPanel`, workspace wiring. `UniverseCanvas.tsx` and `App.tsx` are untouched by this milestone (verified with `git diff`), and a static test keeps history modules free of canvas imports.
- vitest 322 (+47, 36 files), tsc clean, build OK; a mutation check (dropping the pause-on-enter wiring) fails `entering history pauses play and disables edits`. ARCHITECTURE.md gained the UI-0, UI-2 and Universes sections.
- Deviations: `useHistory(client, revision)` takes the scope from `client.scope` instead of a separate argument; the live inspector is hidden (not just blocked) while a recorded sample is viewed, so live values are never shown beside historical positions.

## 2026-10-24 — Simulation Lab / Experiment 01, M8: Orbit Lab backend and validation (Claude Sonnet 5.5)
- `backend/orbit_lab.py`, `orbit_lab_systems.json`, `api_orbit_lab.py`; baseline/modified roles, derived-from-initial-snapshot runs, audit/controlled flag, comparison, initial differences. `tests/validation/kepler_reference.py` (independent; checked against closed forms and RK4) and `test_experiment01.py`.
- pytest 488 (+97). Measured vs thresholds (full table in `context/EXPERIMENT_01_PROTOCOL.md`): engine vs Kepler worst 2.9e-2 m (2.3e-13 a) vs 1e-10 a; K+U drift <= 1.1e-15 and |L| drift <= 5.6e-16 vs 1e-12; period error <= 8.2e-15 vs 1e-6; ordering and apsides as predicted. These reproduce the planning-probe values (e.g. 1.4 cm / 2.9 cm / 3.3 cm, 6.7e-16).
- **Spec discrepancy found, not edited:** EXPERIMENT_01_SPEC section 4.2 says the modified run's barycentre drift is "about 0.6 km" over the window and "about 10^-7" of the position differences; 9.2 mm/s x 730 d is ~580 km (~6e-6 to 6e-5 of the separations). The mechanism and 9 mm/s are right; the test asserts the measured value and the protocol records the slip for the owner.
- Deviations: experiments are kept in an `OrbitLab` object bound to the current registry (`get_orbit_lab()` rebinds when the registry changes, which is how the test fixture isolates them); `comparison` returns at most the 731-sample window while `commonSampleCount` counts only what is returned.

## 2026-10-24 — Simulation Lab / Experiment 01, M9: Orbit Lab frontend (Claude Sonnet 5.5)
- DTOs/parsers/client for systems, experiments, modified runs, initial differences, comparison and provenance; `useOrbitLab` (experiments + actions; success only after the backend answered), `useComparison` (stale answers dropped, last comparison kept on failure), `useProvenance`; `OrbitLabPanel` (inspect baseline and EMB velocity, factor radios with an explicit "preview, nothing created yet", create/recreate with confirmation, modification record, initial-state check, run navigation, delete), `ComparisonPanel` (both times, mismatch banner, window progress, inline-SVG separation chart with labelled axes, common-sample slider), `RunBadge`. Both runs' EMB paths reach the renderer through the UI-0 `trajectories` input (active solid, other run dashed, from separate caches keyed by universe and generation). The baseline's body edits and snapshots are locked in the UI as well as refused by the backend.
- vitest 369 (+47, 39 files), tsc clean, build OK.
- Deviations: `App.tsx` gained a few lines (the Orbit Lab hook and three props) although the plan keeps it fixed after M4: experiments span two universes and their actions refresh the universe list that App owns. The panel lists existing experiments (with Open baseline and Delete) whenever the active universe is not part of one, so an experiment is reachable after a reload and deletable from the sandbox.

## 2026-10-24 — Simulation Lab / Experiment 01, M10: hardening, live smoke, browser journey (Claude Sonnet 5.5)
- `tests/smoke/test_live_server.py` now launches real uvicorn processes and adds `test_universe_isolation_over_http`, `test_history_over_http`, `test_orbit_lab_journey_over_http` and `test_restart_loses_universes_and_default_is_recreated` (a real kill and restart on the same port). pytest 492, vitest 372, tsc clean, build OK.
- Browser journey (plan 14.13) run on ports 8011/5183 in the built-in browser with real clicks plus DOM/API reads; evidence in STATUS.md. Two defects found and fixed: the speed slider reset on every universe switch (App now owns it) and the Orbit Lab panel claiming "no system" while loading. One test added per fix.
- Plan 17.3 review: every row maps to a passing test (Orbit Lab: `test_disallowed_*`, `test_experiment_creation_fails_cleanly_on_bad_preset`, `failed modified-run creation shows error and no success state`, `no success before backend confirmation`; universes: M1/M4 tests; snapshots: `test_failed_restore_leaves_state` + `SnapshotPanel` error test; comparison: `test_comparison_incomplete_reported`; history: `history fetch failure keeps cache and marks stale`; restart: smoke + `useUniverses` notice tests).

## 2026-10-24 — Simulation Lab / Experiment 01, M11: TRAPPIST-1 gate (Claude Sonnet 5.5)
- Outcome: **excluded**, no code committed. Conversion built and verified (linear ephemeris to 0.1 min with negligible masses; with masses on and omega shifted by pi relative to the direct reading, all 21 simulated transits agree with the authors' published model within 0.0009 d), but the plan's gate "first 3 transits of each planet within 0.0035 d of the *observed* times" fails at 0.0134 d (planet g, first transit) and 0.0047 d (planet d), and the authors' own model fails it by the same amounts (0.0138 d, 0.0046 d). Per plan section 19.5 the failed gate is not a blocker; the tolerance was not changed. Details, numbers and the alternative-gate option for the owner are in `context/PRESETS.md`; scripts and archived inputs are in the session notes folder (`trappist1-investigation/`).

## 2026-10-24 — Simulation Lab / Experiment 01, M12: documentation and PR (Claude Sonnet 5.5)
- Updated `API_CONTRACT.md` (universes, snapshots, history, presets, catalogue, Orbit Lab, written with each endpoint), `ARCHITECTURE.md` (UI-0, UI-2, universes, module layout, limits), `DECISIONS.md` (D-025 to D-028), `STATUS.md` (verification, scientific values, journey, section 20 checklist), `TASKS.md`, `HANDOFF.md`, `README.md`, `PRESETS.md`, `EXPERIMENT_01_PROTOCOL.md`. Final fresh runs: pytest 492 passed, tsc clean, vitest 372 passed (39 files), build OK. My backend (:8011) and Vite (:5183) were stopped.
- Observed on origin: a branch `frontend/ui-4-6-completion` appeared during the work; it is not mine and was not touched or used.

## 2026-10-24 — Finalisation sprint (Claude Sonnet 5.5)
- Corrected `EXPERIMENT_01_SPEC.md` section 4.2 (barycentre drift about 580 km, not 0.6 km; the 9 mm/s figure unchanged) and aligned `EXPERIMENT_01_PROTOCOL.md` and D-028; the existing validation test already pinned the measured value.
- Added `frontend/e2e/experiment01.e2e.mjs` and `npm run e2e` (dev-only `playwright-core` 1.64.1; the cached Playwright Chromium could not be launched from its virtualised folder, so the script falls back to an installed Chrome or Edge): 11 steps, three consecutive passes. T-010 closed for the Experiment 01 critical path; not wired into CI.
- Fresh runs: pytest 492, vitest 372, tsc clean, build OK, e2e 11/11. PR #14 CI was green before this sprint; no reviews or comments.

## 2026-10-24 — Collision & particle engine: planning only (Claude Opus 5.5)
- Branch `planning/collision-particle-engine` (worktree `Playing God collision-particle-planning`) from `f2c2da3` (`feature/moons-system`; contains all of `main` `7148556`). Docs only; no production code or tests changed; no other worktree touched.
- Added `COLLISION_ENGINE_PLAN.md`, `COLLISION_REQUIREMENT_TRACEABILITY.md`, `COLLISION_SCIENTIFIC_MODELS.md`, `COLLISION_RISK_REGISTER.md`, `COLLISION_SONNET_EXECUTION_GUIDE.md` and a verbatim copy of the owner's specification at `specs/COLLISION_PARTICLE_ENGINE_SPEC.md`.
- Baseline at `f2c2da3`: pytest 567 passed (1 warning); tsc clean; vitest 433 passed (46 files); build OK; Playwright 7 failed only because no browser binaries are installed on this machine (CI installs them).
- Planning probes (scratchpad, REBOUND 5.2.2): `stop()` inside `collision_resolve` returns cleanly; an unresolved overlap re-triggers ~15k callbacks per 0.5 s; `sim.add` inside the callback hung (>5 min); deferred resolution outside the callback conserved mass and momentum exactly; step(1e5 s) 0.034/0.121/0.339 s at N = 50/100/200.
- Open: owner decisions DQ-1..DQ-14 (risk register §3); scientific checkpoint CP-SCI-1 (LS12 worked-example discrepancy, b_crit check value, unverified Genda 2012 / BA99 / HH11 constants). Nothing implemented.

## 2026-10-24 — Collision engine planning: owner decisions recorded (Claude Opus 5.5)
- Owner approved DQ-1 (a), DQ-2 (a), DQ-12 (a), DQ-14 (d) and a mandatory LS12 scientific gate; recorded as `DECISIONS.md` D-033 and propagated to the plan, traceability (new "Owner-decision constraints" table), risk register (status column; new risks R-23 to R-25), scientific models (§6a gate: UD-1 5.3 vs ≈3.35 J/kg, UD-2 b_crit 0.66 vs 0.683) and the Sonnet guide.
- Plan changes caused by the decisions: Stage 4 split into 4a (all universes legacy) and 4b (sandbox default `outcome-v1` after review, CP-4b) with `tests/impact/test_mode_defaults.py`; a legacy-exactness re-run of the existing merger scenarios in `outcome-v1`; no spin state for material-less bodies (Stage 2); Stage 3 may build only non-disputed parts before the human CP-SCI-1 sign-off; Stage 9 adds visual-only pause/seek tests; Stage 11 is the only stage that may move presets and Orbit Lab off legacy; CP-5 needs the named human reviewer. Stage 0 now appends the architecture decision as D-034. No new dependency.
- Interpretation for the owner to confirm or overturn: the startup sandbox `uni-default` counts as a new sandbox universe. Docs only; nothing implemented.
- Owner confirmed the interpretation: `uni-default` counts as a new sandbox (D-033 addendum); plan, guide and traceability updated, `test_mode_defaults.py` must cover it.

## 2026-10-24 — Collision engine implementation, Stage 0 (Claude Sonnet 5.5)
- Owner instruction: implement the approved plan autonomously, stage by stage, no push/merge/deploy. Verified `263a15e` on `planning/collision-particle-engine` (docs only on top of `f2c2da3`); baseline in a new worktree: pytest 567 passed, vitest 433, build OK. Worktree `C:/Aarit/Projects/Playing God collision-implementation`, branch `collision/stage-0-contracts` from `263a15e`. The other worktrees and the planning branch were not touched.
- Internal design review (single-agent, labelled as such; no external reviewer): split the contracts into `serialization.py` / `config.py` / `contracts.py` to avoid an import cycle; strict readers; `Vec3` as `{x,y,z}` like the API; `tracked_fragment_min_mass_fraction` left null because DQ-6 is open (no invented default); `VisualOnlyEffect` without any mass field (DQ-12).
- Results: 133 new tests pass (round trip of every contract incl. a completeness check that every contract class has a factory, rejection of NaN/inf/negative mass/non-unit quaternion/bad layer sums/unknown keys/unknown schema version, SHA-256 vectors typed from hashlib on literal strings, `DEFAULT_SANDBOX_MODE` pinned, import-boundary tests). Full suite 700 passed.
- Sequencing note recorded in D-034: the guide's one-stage-per-session rule is superseded for session scope by the owner's instruction; all stage prerequisites and stop conditions still apply.

## 2026-10-24 — Collision engine implementation, Stage 1: deferred resolution (Claude Sonnet 5.5) — CP-1 REVIEW PACKAGE
- Branch `collision/stage-1-deferred-resolution` (stacked on `collision/stage-0-contracts` `bb61e8d`). Internal design review (single agent, labelled as such): keep REBOUND `line` detection; callback records + `stop()`; resolution between `integrate` calls; `legacy-merge` stays the inline resolver so the Stage 4a legacy-exactness comparison is meaningful; `outcome-v1` = deferred engine.
- Golden values: captured BEFORE touching `simulation.py` from the unchanged code (18 scenarios: P-003 setups with fixed ids + 6 scenarios of the M0 sweep, seed 12345), reproducible byte for byte across two runs, embedded as literals in `tests/impact/test_deferred_equivalence.py`. After refactoring `MergeResolver` to call `merge_pair` the capture was byte-identical again.
- Defects found while building (both fixed or recorded): (1) REBOUND resets `sim.dt` to 0.001 after a stopped `integrate`; without restoring it the second merge of a chain was detected at 2.1811 s instead of 2.2833 s (legacy). Fixed: the recorder stores `sim.dt`, the engine restores it. (2) A dict-key collision in `_capture` (`records`) that broke rollback was caught by the existing suite and fixed. (3) LEGACY DEFECT: with three or more contacts in one detection pass the legacy resolver merges bodies that do not touch (ring of 6: centres 12.94 m apart, contact distance 11.30 m; ring of 12: 14.09 m vs 11.30 m). Left as is in `legacy-merge`.
- **Equivalence table** (deferred vs golden; `rel` = worst relative difference of simulationTimeS, resultMassKg, relativeSpeedMPerS, kineticEnergyLostJ):
  | Scenario | events | result |
  |---|---|---|
  | kepler_merge, probe x2, extreme_ratio, equal_mass_tie, fast_impact, sweep x6 | 1 / 1 each | identical (rel 0; final state <= 2e-16) |
  | four_chain | 3 / 3 | identical (rel 0) after the dt fix |
  | five_pairs | 5 / 5 | identical as a set (rel 0); numbered in a different order |
  | ring4 | 3 / 3 | rel <= 1.3e-16; a mirror-image pair merges first (tie in contact time broken by id) |
  | homologous10 | 9 / 9 | first 7 events rel 0; the last two are simultaneous: the intermediate remnant differs (3.27e7 vs 2.59e7 kg), the final remnant is identical |
  | ring6, ring12 | 5 / 5, 11 / 11 | DIFFERENT by design: legacy merges non-touching bodies at t = 9.0217 s (ring6) and 8.1294 s (ring12); the deferred engine merges those bodies when they touch, at 9.1675 s (ring6) and 8.5317 s (ring12). Mass, momentum and the final remnant agree. |
- Existing suite on the deferred engine (scratch plugin, not committed): 566 passed / 1 failed of 567; the failure `test_resolver_exception_fails_step_and_rolls_back` patches `svc._resolver._on_merge`, a hook of the legacy resolver the deferred path does not use. Default legacy run: 800 passed.
- Latency (best of 5, same machine, collision-free step(1e5 s), star + N-1 orbiting bodies): N=50 legacy 0.0115 s / new 0.0103 s; N=100 0.0353 / 0.0352; N=200 0.1450 / 0.1344. The planning probe P5 (0.034 / 0.121 / 0.339 s) was a different machine and setup; the comparison that matters is same-machine legacy vs new.
- Insertion-order determinism (20 orders of four pairs): identity, order and masses identical; detection times spread 1.9e-3 s of 4.85 s in BOTH modes (IAS15 step grid vs round-off).
- CP-1 decisions requested: (a) accept the evidence so Stage 2 may begin; (b) for the legacy defect keep `legacy-merge` exact (recommended, D-033) or fix it. Not done in Stage 1 (by plan): post-apply overlap check (Stage 4), records API (Stage 8), rotation/material in the capture (Stage 2).

## 2026-10-24 — CP-1 accepted (owner, in chat)
- The owner accepted the Stage 1 CP-1 evidence and authorised Stage 2 (see D-036). Legacy defect D-035 stays unfixed in `legacy-merge`. CP-SCI-1, DQ-7/8/9 and all later gates are unchanged. Stage 2 started on `collision/stage-2-materials-spin` (from `c6d2643`).

## 2026-10-24 — Collision engine implementation, Stage 2: materials, spin, orientation (Claude Sonnet 5.5)
- Branch `collision/stage-2-materials-spin` from `b4a7134` (CP-1 acceptance record). Internal design review (single agent): new body fields are omitted when unset so DQ-2 holds literally; a spin state needs a sourced moment of inertia; diagnostics version stays 1 (strict frontend parser) with an optional additive key; registry contains only cited numbers; legacy merge of bodies with the new state books I*omega into the existing ledger.
- Evidence: pinned digests (solar-system, moons preset, fixed-id Kepler universe) computed on the code before any edit and asserted unchanged; plain-body JSON key set unchanged; trajectories bit-identical with and without spin/material; quaternion unit after 1e6 incremental updates (<= 1e-12); fixed site returns after n periods (1e-9); south-pole latitude -90 +/- 1e-6 deg; tables restored through checkpoint (guard refused at the commit point), failed step, snapshot restore, reset, derive.
- Bugs caught by tests while building: variable shadowing in the geometry (`b`), a git-grep based boundary test that ignored untracked files (now `--untracked`).
- Note: the stage-1 latency test failed once under CPU load and passed on rerun (it compares two timings; run it on an idle machine).
- Not shipped on purpose: earth-like, icy-rock, gas-giant-core and molten profiles (planning marks their numbers [VERIFY]); no equation-of-state or thermal field (no v1 model needs one; rows M-PROP-4/5 stay MISS).

## 2026-10-24 — Resume: verification and provisional decisions (Claude Sonnet 5.5)
- Verified the reported commits: bb61e8d, 9299ec2, c6d2643, b4a7134, e4a9b3c, e2f5430 are a linear chain on 263a15e; the implementation worktree was clean at e2f5430; the other three worktrees (feature/moons-system f2c2da3, body-render-metadata 2aa6686, planning 263a15e) were clean and untouched; tests/impact 302 passed on this HEAD.
- Owner instructions recorded as D-038 (provisional UD-1/UD-2, NOT a sign-off), D-039 (DQ-7), D-040 (DQ-8), D-041 (DQ-9), D-042 (diagnostics deviation). Gate handling: no signature fabricated; Stage 4b/default activation stays separately gated.
- A fetch sub-agent (model-assisted) read part of the LS12 text; its findings are summarised in COLLISION_SCIENTIFIC_MODELS.md 6b with their limits.

## 2026-10-24 — Collision engine, Stage 3: outcome models and selector (Claude Sonnet 5.5)
- Branch `collision/stage-3-models` (from e2f5430 + decision commit a1d6085). Internal design review (single agent). Provisional equations as recorded in the notes (D-038); two fetch sub-agent reads (model-assisted) of the LS12 and Genda papers: Genda eq. 16 coefficients are verbatim and match the recollection; LS12 eqs. 5, 6, 15, 23, 28 appear verbatim; eq. 44, beta and the worked examples were not seen.
- Tests: reference values typed with provenance (reference_values.py, authored by the implementer; no independent re-derivation yet); UD-1/UD-2 tests state the open difference instead of asserting agreement; regime ordering is asserted from the model (monotone sequence), mass is conserved in every outcome, c* ratio scales the threshold exactly, small-body disruption is Unsupported, gas bodies never reach the rigid model, extension model passes through.
- A scenario-builder sign error (projectile placed before contact) was caught by the cratering normal-speed test and fixed.

## 2026-10-24 — Collision engine, Stage 4a: atomic application and conservation (Claude Sonnet 5.5)
- Resumed from the Stage 0-2 chain (verified), recorded D-038..D-042, built Stage 3 (commit 893a2b9), then Stage 4a. Systematic review instead of one-off fixes: a 1,008-point grid over mass ratio x impact parameter x speed x spin exposed (1) phantom round-off debris in the hit-and-run spec, (2) a compact-sphere self-gravity credit for parcels that invented energy, (3) a tiny remnant absorbing all angular momentum (absurd rotational energy), (4) a dead end when the fallback merge is the same invalid geometry, (5) a hit-and-run separation too small for the debris reach. All fixed at the cause; no tolerance was relaxed.
- REBOUND defect: the 1,000-event sweep produced a particle name that read as None or garbage; reduced to plain REBOUND and fixed by `add_named_particle` (D-044). Initial failures reported honestly: the sweep failure was not reproducible between runs because body ids are random uuids and ids order tie-breaks (seeded to reproduce).
- Timing: the Stage 1 latency test failed once at N=50 (9 ms vs 15 ms, no code change on that path) and passed on rerun; made more robust (9 repeats, 6 ms slack).
- CP-4b is a human review point: the evidence is this entry, D-043 and the Stage 4a traceability rows.

## 2026-10-24 — Collision engine, Stage 4b: default mode for new sandboxes (Claude Sonnet 5.5)
- Branch `collision/stage-4b-default-mode` (from `collision/stage-4a-application`). The owner accepted the Stage 4a implementation evidence (D-045); this is not a scientific sign-off and CP-SCI-1 stays provisional and unsigned.
- Change: one constant flipped plus explicit `LEGACY_MERGE_CONFIG` for presets and Orbit Lab (`backend/api_universes.py`, `backend/orbit_lab.py`, `backend/simulation.py`, `backend/impact/config.py`). New `tests/impact/test_mode_defaults.py` (11 tests).
- Initial full run after the flip: 16 failures, all tests that pinned the legacy default or exercised the legacy resolver on a default-constructed service (2 contract tests, 9 golden/equivalence tests, 3 detection tests, 1 engine test, 1 `_resolver` test). Each was fixed by making the legacy intent explicit (`LEGACY_MERGE_CONFIG`) or by updating the default contract; no assertion was weakened. Only 1 of the ~570 pre-existing tests outside `tests/impact/` needed a change, so the old suite now runs on the new path for default universes.
- Evidence: 1092 backend (1081 + 11 new) / 449 vitest / tsc clean / build OK. Playwright not run (browsers missing locally).

## 2026-10-24 — Collision engine, Stage 5: fragments and bounded debris (Claude Sonnet 5.5)
- Branch `collision/stage-5-fragments` (from `collision/stage-4b-default-mode`). Recorded D-046 (DQ-4), D-047 (DQ-5), D-048 (DQ-6 refined) and D-049 first; cratering stays Unsupported because no HH11 source is documented; the ejection multiplier stays a registered provisional parameter.
- Built `backend/impact/fragments.py` (pure), integrated in the applier/engine (budgets by body cap and counts) and the service (fragment bodies, metadata).
- Initial failures, reported: (1) a head-on pair failed the system angular-momentum assertion at ~3e14 against an effective reference of 1 (rounding of the ring terms; reference corrected, tolerance unchanged, D-049); (2) super-catastrophic disruption: closing momentum on a very light remnant gave 14 km/s, rejected by the result checks and falling back to a merge: closure spread over all bodies; (3) neighbouring parcels re-collided inside the step: unbound-pair rule in the ring radius; (4) a ZeroDivisionError with zero parcel budget; (5) a 1-ulp excess of the largest fragment over the cap (clamped); (6) the replay test compared names that are never reused (rewritten, same strength).
- Evidence: 1278 backend (1092 + 186 new) / 449 vitest / tsc clean / build OK. Playwright not run (browsers missing locally).
