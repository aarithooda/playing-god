# PLAYING GOD frontend

React + TypeScript + Vite + React Three Fiber. The backend owns all physical state; the frontend only
displays it and sends commands. There is no local integrator and no mock data in production code
(fixtures live in `src/test/` and are only imported by tests).

## Run

```
npm install
npm run dev        # http://localhost:5173, proxies /api and /healthz to the backend
npm test           # vitest (jsdom)
npm run typecheck
npm run build
```

The dev proxy forwards `/api/*` and `/healthz` **unchanged** to `http://127.0.0.1:8000` (override with
`BACKEND_URL`). The backend serves `/api/v1/...` and `/healthz` itself, so no prefix is stripped.

## Layout

- `src/api/` typed client (`client.ts`), wire types and request bounds (`types.ts`), response validation
  (`parse.ts`), errors (`errors.ts`).
- `src/sim/` view model (`viewModel.ts`), render transform (`renderTransform.ts`), form validation
  (`validation.ts`), display formatting (`format.ts`), and `useSimulation.ts` (state sync hook).
- `src/components/` scene (`canvas/`) and overlay panels (`ui/`).

## Units and render conventions

- API and inspector values are SI: `massKg`, `radiusM` (metres, not km), `positionM` (m),
  `velocityMPerS` (m/s), `simulationTimeS` (s). Inputs accept plain or exponent notation (`1.5e11`).
- Render transform (`renderTransform.ts`, display only, never sent to the API):
  - position: `scene = (x, z, -y) / metersPerUnit` (proper rotation; physics x-y plane becomes the
    horizontal plane, physics +z is up).
  - `metersPerUnit` is fitted (1/2/5 x 10^n) so the farthest coordinate is <= 40 units when the set of
    bodies changes by a user action (load, create, delete, reset, "Fit view"), then held fixed.
  - radius: logarithmic display size, `0.3 + 0.45 * (log10(radiusM) - 3)` clamped to 0.3..6 scene
    units. This is a visual exaggeration, independent of `metersPerUnit`; the inspector shows true `radiusM`.

## Simulation control semantics

- Step: one `POST /api/v1/simulation/step` with `dtS = 10^speedExp` seconds (speed slider, 1e2..1e7, within the
  backend's 1e-6..1e8 bound).
- Play: repeated bounded steps, strictly sequential (next request after the previous response plus 150 ms).
  Pause stops scheduling; an in-flight step finishes and is applied. All requests go through one FIFO queue.
- Play does not call `/simulation/start`; the backend's `status` stays `paused` and the frontend drives time.
  (Per the contract, `step` returns 409 while the backend status is `running`.)
- Reset: `POST /simulation/reset`, then re-reads events.

## Known contract notes

- `context/API_CONTRACT.md` on the backend branch still lists PATCH/DELETE/step/reset/events as "planned";
  the frontend follows `backend/models.py` (`StepResponse`, `Event`, `EventList`) from backend commit
  `8d7ab36` (`feature/production-rebound-simulation`).
- Request bounds in `src/api/types.ts` (`LIMITS`) mirror `backend/models.py`; the server stays authoritative.
