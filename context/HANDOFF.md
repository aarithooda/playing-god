# Handoff (latest — rewrite at end of each session)

**Date:** 2026-10-23 · **By:** Claude Sonnet 5.5 for the project lead

1. **Project:** PLAYING GOD — browser 3D gravitational sandbox (React/TS/Vite/Three.js frontend, FastAPI backend, backend owns physics state). See `PROJECT_BRIEF.md`.
2. **Current state:** Minimal skeleton plus an M0 REBOUND spike (experiment code, not application code). Public repo https://github.com/aarithooda/playing-god; collaborators added. See `STATUS.md`.
3. **Last completed milestone:** T-000 plus docs (`ad4bd59` on `main`). The M0 first evidence pass is run but **uncommitted and unreviewed**.
4. **In progress:** M0 — provisional recommendation GO WITH A CUSTOM COLLISION LAYER (D-006, proposed). Evidence and caveats: `PHYSICS_SPIKE.md` Results.
5. **Do first:** review the diff; Vaibhav re-derives expected values and re-runs `pytest tests/spike`; agree units/tolerances (M0.1); decide on the GPL-3.0-only license; then M0.8 go/no-go. Then cover the untested items listed in `PHYSICS_SPIKE.md`.
6. **Relevant files:** `context/PHYSICS_SPIKE.md`, `context/TASKS.md`, `backend/experiments/rebound_spike.py`, `tests/spike/test_rebound_spike.py`.
7. **Commands:** `pip install -r backend/experiments/requirements.txt`; `python -m backend.experiments.rebound_spike`; `pytest` (15 passed on 2026-10-23); `cd frontend && npm run build`.
8. **Do not change without investigation:** backend-owns-state (D-001). Do not add REBOUND to `backend/requirements.txt` or build app features on it until D-003 is accepted. Do not tune test tolerances to force passes.
9. **Uncommitted changes / failures:** all M0 files and doc edits are uncommitted pending review; no failing tests. Warnings: Starlette/httpx deprecation; REBOUND restore warning (expected, tested).

**Addendum (API contract v1, uncommitted):** `context/API_CONTRACT.md` + minimal FastAPI API (`backend/models.py`, `store.py`, `main.py`, `tests/test_api.py`) implement healthz/state/create-body only. Next: (a) frontend owner fixes Vite proxy (strips `/api`, backend serves `/api/v1/...`); (b) spike owner repairs 11 failing `tests/spike` tests (`rebound_spike.py` refactor); (c) implement PATCH/DELETE bodies (T-007). Update the contract in the same change.

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

**Date:** 2026-10-23 · **By:** Codex

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See `PROJECT_BRIEF.md`.
2. **Repository:** Context was fetched from origin before edits. Docs-only context commits are pushed to `main` (latest `bca9ab0`); the existing uncommitted `frontend/package.json` esbuild allowScripts edit is intentionally preserved and excluded.
3. **GitHub CLI:** Installed version 2.103.0 at `C:\Program Files\GitHub CLI\gh.exe`; authenticated as `biscuitfab`. `gh auth setup-git` was applied; Git fetch and push succeeded.
4. **Independent physics review:** Branch `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains `context/INDEPENDENT_PHYSICS_REVIEW.md` and its independent calculator. No PR was opened.
5. **M0:** no simulation implementation/engine verification. M0.1 and M0.2/M0.3 experiments remain open. The review is an analytical reference only; compare it with the teammate derivation and agree M0.1 before engine runs.
6. **Next:** review the pushed validation branch, agree conventions/tolerances, then run prescribed M0 fixtures. D-003 remains proposed.
