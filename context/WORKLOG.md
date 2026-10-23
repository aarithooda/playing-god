# Worklog (chronological; append new entries at the bottom)

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
