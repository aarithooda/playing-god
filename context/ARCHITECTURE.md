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
- **Backend [Implemented]**: FastAPI app (`main.py`, `models.py`) over `simulation.py` (`SimulationService`: one persistent REBOUND/IAS15 simulation owning the authoritative state, body-id ↔ particle `name` mapping, transactional chunked steps, events) and `collisions.py` (`line` detection + perfectly inelastic merger layer). Endpoints: health, state, body CRUD, step, reset, events (`API_CONTRACT.md`). In-memory, single process, CORS for `FRONTEND_ORIGIN` (default `http://localhost:5173`). The server never runs by itself; Play = client loop of bounded `step` calls. `backend/experiments/` is evidence code and is not imported by the app.
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
| REBOUND 5.2.2 | installed locally for the M0 experiment only (`backend/experiments/requirements.txt`); NOT in `backend/requirements.txt`, not used by the app; GPL-3.0-only; accepted with a custom collision layer (D-008); the project is licensed GPL-3.0-only (D-009) |

## Physics engine integration constraints [Accepted in D-008; not yet implemented in the app]
SI units with `sim.G = 6.67430e-11` set explicitly (D-007); right-handed Cartesian coordinates (D-010). IAS15 integrator (WHFast is unsafe near collisions); `collision = "line"`; fixed `rand_seed`; own resolver that merges, books heat and spin ledgers, re-selects IAS15 after each merge and never raises; bodies identified by `name`, never by array index; resolver re-registered and ledgers rebuilt after every checkpoint restore; stepping in frame-sized chunks capped so that a_rel·dt²/8 ≪ contact distance; REBOUND reports collisions only at step ends (event time is estimated by us); the API exposes merge events, and `diagnostics` (D-013) exposes the booked-spin total; the energy-loss ledger `heat_J` stays server-private (no potential-energy-jump ledger exists in production, unlike the spike). See `PHYSICS_SPIKE.md`.

## Known limitations
No simulation, API limited to the endpoints marked ✅ in `API_CONTRACT.md`, no frontend tests, no CI. Units (SI, D-007) and coordinates (D-010) are decided; the engine (D-008) is chosen but not yet integrated (P-001). Collision-detection and convergence limitations: `PHYSICS_SPIKE.md`.
