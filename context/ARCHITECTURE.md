# Architecture
Sections are labelled **[Implemented]** or **[Proposed]**.

## Repository structure [Implemented]
```
README.md  .gitignore  .env.example  pytest.ini
context/    shared project memory (see AI_WORKFLOW.md)
backend/    FastAPI app (main.py, requirements.txt); experiments/ = M0 spike (throwaway)
frontend/   Vite + React + TS app (src/main.tsx, src/App.tsx)
tests/      pytest tests (test_health.py); tests/spike/ = M0 REBOUND tests
```
No physics/collision/events/checkpoint modules exist; add them only when a feature needs them.

## Responsibilities
- **Backend [Implemented: skeleton only]**: FastAPI app (`main.py`, `models.py`, `store.py`) with `/health`, `/healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies` (in-memory store, no physics; see `API_CONTRACT.md`) and CORS for `FRONTEND_ORIGIN` (default `http://localhost:5173`). **[Proposed]** It will own the authoritative simulation state, integration, collisions, events and checkpoints.
- **Frontend [Implemented: placeholder only]**: React page showing "PLAYING GOD" and the backend health. Vite proxies `/api/*` to `http://127.0.0.1:8000` (prefix stripped). **[Proposed]** It will render backend state with Three.js and send user actions.

## Simulation data flow [Proposed]
User action → frontend → API call → backend mutates/steps authoritative state → backend returns/streams a state snapshot plus events → frontend renders. The frontend must not simulate a second universe.

## API / data-contract principles [Proposed]
JSON over HTTP (WebSocket/streaming to be decided); explicit units in schema/field names; contracts recorded in DECISIONS.md; Pydantic models as the source of truth for schemas.

## Dependencies and status
| Dependency | Status |
|---|---|
| FastAPI, uvicorn, pytest, httpx | installed, used |
| React 18, Vite 5, TypeScript 5 | installed, used |
| Three.js | **not installed** (add with first 3D feature) |
| REBOUND 5.2.2 | installed locally for the M0 experiment only (`backend/experiments/requirements.txt`); NOT in `backend/requirements.txt`, not used by the app; GPL-3.0-only (D-009 open); accepted with a custom collision layer (D-008); GPL-3.0-only, project licensed GPL-3.0-only (D-009) |

## Physics engine integration constraints [Accepted in D-008; not yet implemented in the app]
SI units with `sim.G = 6.67430e-11` set explicitly (D-007); right-handed Cartesian coordinates (D-010). IAS15 integrator (WHFast is unsafe near collisions); `collision = "line"`; fixed `rand_seed`; own resolver that merges, books heat and spin ledgers, re-selects IAS15 after each merge and never raises; bodies identified by `name`, never by array index; resolver re-registered and ledgers rebuilt after every checkpoint restore; stepping in frame-sized chunks capped so that a_rel·dt²/8 ≪ contact distance; REBOUND reports collisions only at step ends (event time is estimated by us); the API must expose merge/collision events with the ledgers. See `PHYSICS_SPIKE.md`.

## Known limitations
No simulation, API limited to the endpoints marked ✅ in `API_CONTRACT.md`, no frontend tests, no CI, units/coordinates undecided. Engine choice awaits the feasibility spike.
