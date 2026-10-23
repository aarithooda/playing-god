# Handoff (latest — rewrite at end of each session)

**Date:** 2026-10-23 · **By:** Claude Sonnet 5.5 for the project lead

1. **Project:** PLAYING GOD — browser 3D gravitational sandbox (React/TS/Vite/Three.js frontend, FastAPI backend, backend owns physics state). See `PROJECT_BRIEF.md`.
2. **Current state:** Minimal runnable skeleton only (placeholder page, `GET /health`, one passing test). No simulation. See `STATUS.md`.
3. **Last completed milestone:** T-000 repository initialization, baseline committed on `main` locally.
4. **In progress:** nothing. **GitHub push is NOT done**: `gh` CLI is not installed on this machine and there is no remote. 
5. **Do first:** (a) T-002 — install `gh` (`winget install GitHub.cli`), `gh auth login`, then `gh repo create playing-god --private --source . --remote origin --push`; or create the repo on github.com and `git remote add origin <url> && git push -u origin main`. (b) Then T-001, the physics-engine feasibility spike.
6. **Relevant files:** `context/*`, `backend/main.py`, `frontend/vite.config.ts`, `frontend/src/App.tsx`, `tests/test_health.py`.
7. **Commands:** `pytest` (root, venv active); `cd frontend && npm run build`; run services per `README.md`.
8. **Do not change without investigation:** the backend-owns-state rule (D-001); do not add REBOUND or any engine until the T-001 spike is concluded (D-003 is only proposed).
9. **Uncommitted changes / failures:** none after the baseline commit; no known failures. Minor: esbuild postinstall warning from npm; Starlette/httpx deprecation warning in pytest.
