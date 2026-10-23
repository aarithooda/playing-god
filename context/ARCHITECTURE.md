# Architecture
Sections are labelled **[Implemented]** or **[Proposed]**.

## Repository structure [Implemented]
```
README.md  .gitignore  .env.example  pytest.ini
context/    shared project memory (see AI_WORKFLOW.md)
backend/    FastAPI app (main.py, requirements.txt)
frontend/   Vite + React + TS app (src/main.tsx, src/App.tsx)
tests/      pytest tests (test_health.py)
```
No physics/collision/events/checkpoint modules exist; add them only when a feature needs them.

## Responsibilities
- **Backend [Implemented: skeleton only]**: FastAPI app with `GET /health` and CORS for `FRONTEND_ORIGIN` (default `http://localhost:5173`). **[Proposed]** It will own the authoritative simulation state, integration, collisions, events and checkpoints.
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
| REBOUND | **not installed**; suitability unverified |

## Known limitations
No simulation, no API beyond `/health`, no frontend tests, no CI, units/coordinates undecided. Engine choice awaits the feasibility spike.
