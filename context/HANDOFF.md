# Handoff (latest — rewrite at end of each session)

## Backend connection restored (2026-10-24, Codex) — latest
1. Frontend showed “connecting to the simulation backend” because the backend process was unresponsive. A clean restart failed with `ModuleNotFoundError: No module named 'rebound'` in this checkout's `.venv`.
2. Installed the declared dependency set with `.venv/Scripts/python.exe -m pip install -r backend/requirements.txt` (REBOUND 5.2.2), then started Uvicorn at `127.0.0.1:8000`.
3. Verified HTTP 200 for backend `/healthz`, `/api/v1/simulation/state`, and matching frontend-proxied `/healthz` and `/api/v1/simulation/state`. State is paused at 0 s with no bodies. Server remains running in this app session; no application source or manifest changed.
4. See `STATUS.md` and `WORKLOG.md`.

## Frontend local dependency recovery (2026-10-24, Codex) — latest
1. The import-analysis error for `@react-three/fiber` came from incomplete local `frontend/node_modules`; both Fiber and Drei were already in `package.json` and `package-lock.json`.
2. Stopped the two Vite processes from this checkout because they held `esbuild.exe`, ran `npm ci` (243 packages), and confirmed `npm run build` succeeds. The frontend is running at `http://localhost:5173/` (HTTP 200).
3. No app source or manifest changed. npm reported 6 audit vulnerabilities (3 moderate, 1 high, 2 critical); no audit fix was applied. See `STATUS.md` and `WORKLOG.md`.

## Local baseline cleanup (2026-10-24, Codex) — latest
1. Fetched `origin/main` at `8f3c37b` and aligned the local `main` checkout to it. Working tree is clean; the previous local-only `frontend/package.json` esbuild allowScripts edit was removed per the user's baseline-only request.
2. Removed local worktrees and branches for `codex/3drender`, `feature/m0-rebound-physics-api`, `m0-collision-validation`, `validation/physics-first-principles`, and `validation/production-physics-review`. Their committed changes are ancestors of `main`.
3. `feature/frontend-api-integration` was verified as fully merged and had no open PR; its remote branch was deleted. `origin` now advertises only `main`.
4. Stopped the old port-5174 Vite server. The port-5173 frontend and port-8000 backend remain running.
5. A separate uncommitted repository `C:\Users\calli\code\playing-god-t3` remains outside the main repo because the filesystem safety policy rejected recursive deletion. It was not modified; see `WORKLOG.md`.

---

## Baseline closed (2026-10-24, Claude Sonnet 5.5) — newest
0. D-011/D-012 and the two validation tolerances are accepted (Vaibhav). Baseline code `b9f1a01`; fresh checks and CI green (STATUS.md). Ready for the next product milestone; backlog items are non-blocking.

### Stabilization session details
1. **State:** `main` pushed, CI green, working tree clean. Numbers and details: top of `STATUS.md`, `WORKLOG.md`.
2. **Branches:** retired local `backup/local-main-2dfc8ac` (its content is commit `0ce89a3`, already in main; old tip recoverable via reflog `2dfc8ac`) and remote `codex/3drender`, `validation/physics-first-principles`, `validation/production-physics-review` (their work was merged into main first: `tests/validation/`, `context/INDEPENDENT_PHYSICS_REVIEW.md`, `context/independent_reference.py`, `context/PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`). `feature/production-rebound-simulation` and `feature/m0-rebound-physics-api` no longer existed locally or on origin at the start (already contained in main). `feature/frontend-api-integration` was kept while its session was active, then retired after integration; see the newer cleanup section above.
3. **Decisions:** D-011 and D-012 accepted; the two restated fixture tolerances in `tests/validation/` accepted (see WORKLOG).
4. **Do next:** code-split the 3D bundle; optional automated browser test (T-010); bump GitHub Actions versions (Node 20 deprecation); decide a policy for `estimatedContactTimeS = null`; latency work if N>=150 matters.
5. **Do not change without investigation:** `select_ias15` (never assign `sim.integrator = "ias15"` directly: re-selecting resets the criterion to the stalling default), the heartbeat watchdog, the lone-body drift.
6. Sections below are history.

---
## Integration session (2026-10-24, Claude Sonnet 5.5)
1. `main` now contains backend + frontend (backend fast-forwarded, frontend merged with a merge commit; history preserved). Older local `main` commit `2dfc8ac` (superseded duplicate of the API commit) is kept on local branch `backup/local-main-2dfc8ac`.
2. Checks and the manual browser journey are recorded at the top of `STATUS.md`. Run commands are there too.
3. Do first: review the two Codex validation branches (`origin/validation/production-physics-review` is based on the production backend and adds tests under `tests/validation/`; not merged, owner not confirmed finished); P-003 stress tests; title/panel overlap at 800x600; code-split the 3D bundle; add CI.
4. Sections below are earlier handoffs; statements like "not pushed/not merged" are historical.

---
## Backend physics session (2026-10-23, Claude Sonnet 5.5) — newest
1. **Branch:** `feature/production-rebound-simulation` (from `feature/m0-rebound-physics-api` + local merge of `origin/main` docs). Not pushed, not merged. The frontend session works in a separate worktree (`Playing God-frontend`).
2. **Implemented:** production engine and API per `API_CONTRACT.md`; 149 tests pass. Details in `STATUS.md` (top section) and `WORKLOG.md`.
3. **Do first:** review/merge; frontend integrates against the contract (step loop, events, 409 handling). Then P-003 stress tests (strongly curved binaries, >3 simultaneous collisions, extreme mass ratios, N≈100–200 latency), a per-step wall-clock guard, and optionally checkpoints.
4. **Do not change without investigation:** `line` detection, seeded `rand_seed`, IAS15 re-selection after any structural change, name-based ids, chunking criterion, transactional rollback. Do not import `backend/experiments` from the app.
5. **Run:** `.venv/Scripts/python.exe -m pytest` (REBOUND is in `backend/requirements.txt`; the repo's `.venv` has it).

---
## Earlier handoff (M0 session; partly superseded by the section above)

**Date:** 2026-10-23 · **By:** Claude Sonnet 5.5 for the project lead

1. **Project:** PLAYING GOD — browser 3D gravitational sandbox (React/TS/Vite/Three.js frontend, FastAPI backend, backend owns physics state). See `PROJECT_BRIEF.md`.
2. **Current state:** production REBOUND/IAS15 backend with merger layer, events, step budget (D-011/D-012) and system diagnostics (D-013), plus the React/Three.js frontend; see `STATUS.md`. Public repo https://github.com/aarithooda/playing-god. See `STATUS.md`.
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

_(origin/main side of the merge, kept as history:)_

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See PROJECT_BRIEF.md.
2. **Current checkout:** main is aligned with origin/main at fac831b; only the existing uncommitted frontend/package.json esbuild allowScripts change remains. It was preserved.
3. **Remote branches fetched:** feature/m0-rebound-physics-api (Aarit, head 14af4f4, six branch-only commits and one main-only context commit) and codex/3drender (Nikhil, head 397e563, one branch-only commit and five main-only commits). Local tracking refs and separate worktrees were created at exact remote heads; existing checkouts and branch tips were not moved, merged, rebased, or reset.
4. **What they contain:** Aarit branch adds API/body state, REBOUND M0 experiments and tests, license/third-party notices, and updated M0 decisions/results. Its own STATUS says 88 pytest cases and frontend build passed; this session did not rerun them. Nikhil branch adds the 3D canvas, camera controls, and UI shell.
5. **Worktrees:** C:\Users\calli\code\playing-god-feature-m0-rebound-physics-api and C:\Users\calli\code\playing-god-codex-3drender are clean and track their respective origin branches.
6. **PR state:** GitHub reports no open PRs; neither branch has been integrated into main.
7. **Independent physics review:** validation/physics-first-principles remains pushed at a6540f0; no PR opened.
8. **Next:** review the topic branches and choose integration order. Rebase codex/3drender on current main before opening its PR; keep the Aarit feature branch as pushed until review. Do not treat its branch-local status as main status before merge.
