# PLAYING GOD

Interactive, browser-based 3D gravitational universe sandbox (inspired by Universe Sandbox), built for a 36-hour hackathon. The Python backend owns the authoritative physics state; the React/Three.js frontend renders it.

**Maturity (read this first):** a working integrated prototype, post-hackathon. The integrator is [REBOUND](https://github.com/hannorein/rebound) (IAS15); we did not write it. The custom collision engine (`backend/impact/`) is **scientifically provisional and has not been independently reviewed; cratering is unsupported**. Ring World ring grains, reference orbits, the main-belt sample and collision effects are **visual only** (not simulated). Tidal deformation is **not implemented**. All state lives in backend memory and is lost on restart. The 2026-10-26 preset regression (KD-1) is fixed; see [docs/ENGINEERING_STATUS.md](docs/ENGINEERING_STATUS.md).

**Where to look:** [docs/ENGINEERING_STATUS.md](docs/ENGINEERING_STATUS.md) (what works, what was tested, defects, validation status), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), [context/DECISIONS.md](context/DECISIONS.md) (decision log).

**Stack:** Python 3.11, FastAPI, REBOUND 5.2.x (backend); React 18, TypeScript, Vite, three.js / @react-three/fiber (frontend); pytest, Vitest, Playwright; GitHub Actions CI.

**Features:** FastAPI backend with REBOUND/IAS15 physics, two collision modes (legacy merge; provisional outcome models with fragments, spin and materials), diagnostics; React/Three.js frontend with body creation and 3D placement, selection and focus, event history, axes/grid, light/dark theme. **Simulation Lab and Experiment 01** add independent universes you can switch between, Solar System presets (JPL Horizons and DE440, with or without moons, and the Saturn Ring World), a sourced body catalogue, custom stars and planets, snapshots, a recorded-history timeline with replay and path display, and Orbit Lab (an immutable baseline against a velocity-scaled run, compared against an independent Kepler reference).

## Prerequisites
Python **3.11** (the only version tested; declared in `.python-version`, which CI also reads), Node.js **20** (declared in `.nvmrc`, read by CI; `frontend/package.json` `engines` is `>=20 <21`), npm (use `npm ci`, never `npm install`, so `package-lock.json` is honoured), Git. Playwright's Chromium (`npx playwright install chromium`) or an installed Chrome/Chromium in `PW_CHROMIUM_PATH`.

## Install
```bash
# Backend (from repo root)
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; PowerShell: .venv\Scripts\Activate.ps1; Linux/macOS: source .venv/bin/activate
pip install -r backend/requirements.txt -c backend/constraints.txt   # exact tested versions

# Frontend
cd frontend && npm ci   # installs exactly package-lock.json
```

## Run (two terminals)
```bash
# Backend -> http://127.0.0.1:8000  (GET /health)
uvicorn backend.main:app --reload --port 8000

# Frontend -> http://localhost:5173  (proxies /api/* to the backend)
cd frontend && npm run dev
```

## Using it
The workspace keeps the 3D scene in the middle of three surfaces:
- **Tool rail (left):** Add, Universes, Orbit Lab, Events, History and Diagnostics. Each opens one drawer beside the rail; pressing the open tool again (or ×) closes it. The drawer starts open on Add, except on a phone-sized window.
- **Simulation bar (bottom):** Play/Pause, Step Forward, the simulation clock and its state, the step size, Reset (asks for confirmation), then the view controls: Axes, Grid, Show paths, Fit view, Focus selected body, and the Universe/Exploration size views. On a phone the bar takes two rows.
- **Inspector (right):** appears when a body is selected, with its key derived quantities first, then its editable properties.

The universe starts empty: press **Add your first body** (or **Add body…** in the Add drawer), fill in SI values or use **Choose position in 3D** and click in the scene, or pick a catalogue body and click where it goes. Click a body to select it, double-click to focus the camera on it, click empty space to dismiss. **Axes** and **Grid** are off by default; the grid is shown automatically while placing a body. Right after creating a body an **Undo** button is offered for a few seconds. Below 1100 px the drawer and the inspector are never open together; at phone width they cover the scene as sheets.

### Simulation Lab and Experiment 01
- **Universes:** the Universes drawer lists them; only the active one advances, and each keeps its exact time when you leave it. **Load as new universe** creates a preset (the Solar System at J2000.0, with or without major moons) without touching anything else. Snapshots and, for scenes with moons, the body list are in the same drawer. Universes live in backend memory (they are lost when the backend restarts, and the app says so).
- **History:** the History drawer scrubs and replays what the backend recorded (nothing is interpolated); **Show paths** in the bar draws recorded paths. **Snapshots** save and restore a universe (restore and Reset ask for confirmation).
- **Body catalogue:** nine sourced entries (Sun, Proxima Centauri, TRAPPIST-1, Sirius A, Betelgeuse, Earth, Mars, Jupiter, Neptune) with value, uncertainty, source and basis; estimated values are flagged. A catalogue entry only prefills the create form.
- **Orbit Lab:** "Start Experiment 01" creates the baseline (Sun + Earth-Moon barycentre), you choose a speed factor (preview first), create the modified run, advance each run with the normal controls, switch between them, and read the comparison (`context/EXPERIMENT_01_PROTOCOL.md`).

## Test
**Canonical command** (all required checks, in order, stops at the first failure, exit status 0 only if every stage ran and passed):
```bash
python scripts/run_tests.py            # add --install to install the pinned dependencies first, --extended for the real-backend journeys
```
Stages: environment check (Python == `.python-version`, Node major == `.nvmrc`, installed packages == `backend/constraints.txt`, `frontend/node_modules` present) -> backend pytest -> frontend typecheck -> Vitest -> production build -> Playwright E2E (stubbed API) -> check that no tracked file was modified. A stage that cannot start fails with the fix; nothing is skipped silently. `--extended` adds `npm run e2e:collision` and `npm run e2e` (they start their own backend and Vite). Browser tests write screenshots to `frontend/test-results/`; the committed evidence PNGs under `context/evidence/` are refreshed only on purpose with `PG_UPDATE_EVIDENCE=1`. The individual commands below remain valid.
Last full run (2026-10-26, details in `docs/ENGINEERING_STATUS.md`): in a fresh virtualenv built from `backend/requirements.txt` + `backend/constraints.txt` the backend suite is 1422 passed, 0 failed (7.5 min on Windows); frontend typecheck, 583 Vitest tests, build and 16 Playwright tests passed on the preceding baseline.
```bash
python -m pytest                # from repo root, venv active: unit, API, stress, validation, spike, live-server smoke
cd frontend && npm run typecheck && npm test && npm run build && npm run test:e2e   # tsc, vitest, build, Playwright browser journey
```
Collision engine on the real backend (a controlled impact driven through the UI; starts its own backend on :8012 and Vite on :5184): `cd frontend && npm run e2e:collision`. If Playwright's pinned Chromium is missing or unlaunchable (a common first-run failure), set `PW_CHROMIUM_PATH` (Playwright tests) or `E2E_CHROMIUM` (the two scripts) to an installed Chrome/Chromium, or run `npx playwright install chromium`. How to run and evaluate the consolidated collision branch: `context/INTEGRATION_BRANCH.md`.
Optional browser journey for Experiment 01 (needs a local Chrome, Chromium or Edge; starts its own backend on :8011 and Vite on :5183): `cd frontend && npm run e2e`.

CI (`.github/workflows/ci.yml`) runs these checks on every push to `main` and every pull request. Playwright E2E uses a stubbed API to exercise merger-event display, recoverable errors, and responsive behavior; `tests/smoke/` starts a real uvicorn and drives the API over HTTP. A step is cut off after `PG_STEP_TIME_LIMIT_S` seconds (default 10) with HTTP 503 and rolled back. Reads never wait for a running step; a write that cannot get the simulation lock in time answers 503 "busy" (`context/API_CONTRACT.md`, D-021). A backend started from older code keeps its old behaviour: restart it after pulling (the universe is in memory and is lost on restart).
The M0 physics spike tests (`tests/spike/`) need REBOUND and skip themselves without it: `pip install -r backend/experiments/requirements.txt`. Results and decision: `context/PHYSICS_SPIKE.md`.

## License
PLAYING GOD is licensed under the **GNU General Public License v3.0 only** (`GPL-3.0-only`); see [LICENSE](LICENSE). This is the team's project decision (D-009 in `context/DECISIONS.md`), made because the physics engine dependency is GPL-licensed; it is not legal advice.

The physics engine is **[REBOUND](https://github.com/hannorein/rebound)** (GPL-3.0-only, Hanno Rein et al.), listed in `backend/requirements.txt` and used by the app (IAS15 with a custom collision/merger layer, D-008). Third-party licenses and notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Context workflow (humans and AI models)
Start with `docs/ENGINEERING_STATUS.md` (authoritative as of 2026-10-26). Shared project memory lives in `context/` (historical logs, decision records). Before any AI-assisted session read `docs/ENGINEERING_STATUS.md`, then `context/HANDOFF.md`, `STATUS.md`, `TASKS.md` (older, may be stale), then relevant parts of `PROJECT_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`. At the end of a session update STATUS, TASKS, WORKLOG, HANDOFF (and DECISIONS if needed). Full protocol: `context/AI_WORKFLOW.md`. Team rules: `context/TEAM_WORKFLOW.md`. Physics evidence and limits: `context/PHYSICS_SPIKE.md`. System layout: `context/ARCHITECTURE.md`.
