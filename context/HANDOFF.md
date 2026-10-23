# Handoff (latest — rewrite at end of each session)

## Integration session (2026-10-24, Claude Sonnet 5.5) — newest
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

_(origin/main side of the merge, kept as history:)_

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See PROJECT_BRIEF.md.
2. **Current checkout:** main is aligned with origin/main at fac831b; only the existing uncommitted frontend/package.json esbuild allowScripts change remains. It was preserved.
3. **Remote branches fetched:** feature/m0-rebound-physics-api (Aarit, head 14af4f4, six branch-only commits and one main-only context commit) and codex/3drender (Nikhil, head 397e563, one branch-only commit and five main-only commits). Local tracking refs and separate worktrees were created at exact remote heads; existing checkouts and branch tips were not moved, merged, rebased, or reset.
4. **What they contain:** Aarit branch adds API/body state, REBOUND M0 experiments and tests, license/third-party notices, and updated M0 decisions/results. Its own STATUS says 88 pytest cases and frontend build passed; this session did not rerun them. Nikhil branch adds the 3D canvas, camera controls, and UI shell.
5. **Worktrees:** C:\Users\calli\code\playing-god-feature-m0-rebound-physics-api and C:\Users\calli\code\playing-god-codex-3drender are clean and track their respective origin branches.
6. **PR state:** GitHub reports no open PRs; neither branch has been integrated into main.
7. **Independent physics review:** validation/physics-first-principles remains pushed at a6540f0; no PR opened.
8. **Next:** review the topic branches and choose integration order. Rebase codex/3drender on current main before opening its PR; keep the Aarit feature branch as pushed until review. Do not treat its branch-local status as main status before merge.
