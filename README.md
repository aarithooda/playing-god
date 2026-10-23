# PLAYING GOD

Interactive, browser-based 3D gravitational universe sandbox (inspired by Universe Sandbox), built for a 36-hour hackathon. The Python backend owns the authoritative physics state; the React/Three.js frontend renders it.

**Status:** placeholder page, in-memory API v1 (no physics yet) and a completed physics-engine feasibility spike (M0). See `context/STATUS.md`.

## Prerequisites
Node.js 20+, npm, Python 3.11+, Git.

## Install
```bash
# Backend (from repo root)
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; PowerShell: .venv\Scripts\Activate.ps1; Linux/macOS: source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
cd frontend && npm install
```

## Run (two terminals)
```bash
# Backend -> http://127.0.0.1:8000  (GET /health)
uvicorn backend.main:app --reload --port 8000

# Frontend -> http://localhost:5173  (proxies /api/* to the backend)
cd frontend && npm run dev
```

## Test
```bash
pytest                          # from repo root, venv active
cd frontend && npm run build    # type-check + production build
```
The M0 physics spike tests (`tests/spike/`) need REBOUND and skip themselves without it: `pip install -r backend/experiments/requirements.txt`. Results and decision: `context/PHYSICS_SPIKE.md`.

## License
PLAYING GOD is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`); see [LICENSE](LICENSE). This is the team's project decision (D-009 in `context/DECISIONS.md`), made because the physics engine dependency is GPL-licensed; it is not legal advice.

The physics engine candidate is **[REBOUND](https://github.com/hannorein/rebound)** (GPL-3.0-only, Hanno Rein et al.), currently used only by the M0 spike under `backend/experiments/` (`pip install -r backend/experiments/requirements.txt`). Third-party licenses and notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Context workflow (humans and AI models)
Shared project memory lives in `context/`. Before any AI-assisted session read, in order: `HANDOFF.md`, `STATUS.md`, `TASKS.md`, then relevant parts of `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`. At the end of a session update STATUS, TASKS, WORKLOG, HANDOFF (and DECISIONS if needed). Full protocol: `context/AI_WORKFLOW.md`. Team rules: `context/TEAM_WORKFLOW.md`. Current milestone (M0, physics-engine feasibility spike): `context/PHYSICS_SPIKE.md`.
