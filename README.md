# PLAYING GOD

Interactive, browser-based 3D gravitational universe sandbox (inspired by Universe Sandbox), built for a 36-hour hackathon. The Python backend owns the authoritative physics state; the React/Three.js frontend renders it.

**Status:** working integrated app: FastAPI backend with REBOUND/IAS15 physics, collision/merger handling and diagnostics, and a React/Three.js frontend with body creation and 3D placement, selection and camera focus, an event history, system diagnostics, and optional axes and grid overlays. **Simulation Lab and Experiment 01** add independent universes you can switch between, a validated Solar System preset (JPL Horizons and DE440), a sourced body catalogue, custom stars and planets, snapshots, a recorded-history timeline with replay and path display, and Orbit Lab (an immutable baseline against a velocity-scaled run, compared against an independent Kepler reference). See `context/STATUS.md` for what is verified and what is not.

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

## Using it
The universe starts empty: press **Add your first body** (or **Add body…**), fill in SI values or use **Choose position in 3D** and click in the scene. Click a body to select it (inspector opens on the right), double-click to focus the camera on it, click empty space to dismiss. **Play / Pause / Step Forward** advance the backend simulation; **Reset Universe** clears it. **Axes** and **Grid** (View section) are off by default; the grid is shown automatically while placing a body. The left sidebar holds the event history (mergers) and system diagnostics. Right after creating a body an **Undo** button is offered for a few seconds.

### Simulation Lab and Experiment 01
- **Universes:** the right sidebar lists them; only the active one advances, and each keeps its exact time when you leave it. **Load as new universe** creates the Solar System at J2000.0 without touching anything else. Universes live in backend memory (they are lost when the backend restarts, and the app says so).
- **History:** the left sidebar's History panel scrubs and replays what the backend recorded (nothing is interpolated); **Show paths** draws recorded paths. **Snapshots** save and restore a universe (restore and Reset ask for confirmation).
- **Body catalogue:** nine sourced entries (Sun, Proxima Centauri, TRAPPIST-1, Sirius A, Betelgeuse, Earth, Mars, Jupiter, Neptune) with value, uncertainty, source and basis; estimated values are flagged. A catalogue entry only prefills the create form.
- **Orbit Lab:** "Start Experiment 01" creates the baseline (Sun + Earth-Moon barycentre), you choose a speed factor (preview first), create the modified run, advance each run with the normal controls, switch between them, and read the comparison (`context/EXPERIMENT_01_PROTOCOL.md`).

## Test
```bash
python -m pytest                # from repo root, venv active: unit, API, stress, validation, spike, live-server smoke
cd frontend && npm run typecheck && npm test && npm run build   # tsc, vitest, production build
```
CI (`.github/workflows/ci.yml`) runs exactly these on every push to `main` and every pull request. `tests/smoke/` starts a real uvicorn and drives the API over HTTP (API-only; there is no automated browser test). A step is cut off after `PG_STEP_TIME_LIMIT_S` seconds (default 10) with HTTP 503 and rolled back. Reads never wait for a running step; a write that cannot get the simulation lock in time answers 503 "busy" (`context/API_CONTRACT.md`, D-021). A backend started from older code keeps its old behaviour: restart it after pulling (universes are in memory and are lost on restart). The scientific validation (`tests/validation`: Solar System against JPL Horizons, the Moon-omission measurement, Experiment 01 against an independent Kepler reference) prints its measured values with `python -m pytest tests/validation -q -s`; they are recorded in `context/PRESETS.md` and `context/EXPERIMENT_01_PROTOCOL.md`. Preset and catalogue data are committed (`backend/presets/`, `backend/catalogue_data.json`); the developer scripts that rebuild them (`scripts/`) need the network, the application and the tests do not.
The M0 physics spike tests (`tests/spike/`) need REBOUND and skip themselves without it: `pip install -r backend/experiments/requirements.txt`. Results and decision: `context/PHYSICS_SPIKE.md`.

## License
PLAYING GOD is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`); see [LICENSE](LICENSE). This is the team's project decision (D-009 in `context/DECISIONS.md`), made because the physics engine dependency is GPL-licensed; it is not legal advice.

The physics engine is **[REBOUND](https://github.com/hannorein/rebound)** (GPL-3.0-only, Hanno Rein et al.), listed in `backend/requirements.txt` and used by the app (IAS15 with a custom collision/merger layer, D-008). Third-party licenses and notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Context workflow (humans and AI models)
Shared project memory lives in `context/`. Before any AI-assisted session read, in order: `HANDOFF.md`, `STATUS.md`, `TASKS.md`, then relevant parts of `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`. At the end of a session update STATUS, TASKS, WORKLOG, HANDOFF (and DECISIONS if needed). Full protocol: `context/AI_WORKFLOW.md`. Team rules: `context/TEAM_WORKFLOW.md`. Physics evidence and limits: `context/PHYSICS_SPIKE.md`. System layout: `context/ARCHITECTURE.md`.
