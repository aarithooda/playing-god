# Architecture
Sections are labelled **[Implemented]** or **[Proposed]**. Last rewritten 2026-10-24 (M5), after the UI integration series.

## Repository structure [Implemented]
```
README.md  LICENSE  THIRD_PARTY_NOTICES.md  pytest.ini  .github/workflows/ci.yml
context/    shared project memory (see AI_WORKFLOW.md)
backend/    FastAPI app: main.py, models.py, simulation.py, collisions.py, diagnostics.py; experiments/ = M0 spike (evidence only, not imported)
frontend/   Vite + React 18 + TypeScript app (src/App.tsx owns the UI state; src/api, src/sim, src/components)
tests/      pytest: API, service, stress, step guard, stall resilience, diagnostics; validation/ (independent physics checks); spike/; smoke/ (live uvicorn over HTTP)
```

## Backend [Implemented]
- `SimulationService` (`simulation.py`) owns the single authoritative REBOUND simulation (IAS15 with the GLOBAL step criterion, D-011; `collision="line"`; SI units, D-007; right-handed Cartesian, D-010). Bodies are identified by REBOUND particle `name`, never by index. Mergers are perfectly inelastic (`collisions.py`); `diagnostics.py` computes the system diagnostics (D-013).
- A step is **transactional**: state is captured first and restored if the engine raises, a resolver callback fails, a value turns non-finite, or the wall-clock budget (`PG_STEP_TIME_LIMIT_S`, default 10 s, checked between chunks and through REBOUND's heartbeat, D-012) runs out (HTTP 503).
- **Concurrency (D-021):** one lock serializes every mutation and step. Reads (`/healthz`, `/state`, `/events`) never wait for it and return the last *committed* state; a mutation that cannot get the lock within the step budget + 5 s answers 503 "busy" and changes nothing.
- The server never advances time by itself; Play is a client loop of bounded `POST /step` requests. State is in memory, single process, lost on restart. Endpoints and error shapes: `API_CONTRACT.md`.

## Frontend [Implemented]
**State ownership.** `App.tsx` is the single owner of UI state: selection, focus request and the focused body id, placement mode and preview, sidebar open/closed (`SidebarState`), the user's Axes/Grid choices, the display transform and the frame epoch. Server state lives only in `useSimulation` (latest authoritative snapshot, events, load/health/error state); there is no frontend physics.

**Data path.** `api/client.ts` (typed client; every request has a timeout: reads 8 s, writes and steps 35 s, so nothing waits forever) -> `api/parse.ts` (strict DTO parsing) -> `sim/useSimulation.ts` (one FIFO request queue so responses apply in order; Play steps strictly sequentially and stops on the first failure; a step with an unknown outcome is followed by a re-read of the committed state) -> `sim/viewModel.ts` (view/scene bodies). Connection health (`/healthz`) and simulation loading are separate states.

**Render transform** (`sim/renderTransform.ts`, display only): scene = (x, z, -y) / metersPerUnit, so the physics x-y plane is the horizontal ground plane and +z is up. Positions are scaled uniformly; radii use a log display size; the scale is refitted only when the set of bodies changes through a user action (load, create, delete, reset, Fit view) and then held fixed while the simulation runs. `sim/framing.ts` pulls the default camera back just enough that the fitted scene is not hidden under a sidebar on narrow windows.

**Layout** (`components/ui/layout.ts`, `Sidebar.tsx`, `theme.ts`): a full-bleed canvas under two solid sidebars (left: Event History + System diagnostics; right: Controls, View, Body Inspector; 320 px open, 40 px rail). The scene is centred in the free area between them by shifting the camera projection with `setViewOffset` (the canvas is never resized), so picking, placement and focus use the same projection. Below 1100 px window width only one sidebar is open. Everything that floats over the scene (wordmark with connection status, errors, first-use prompt, placement hint, undo notice, view legend) lives in the free-area container.

**Interaction contract.**
- Single click selects (thin constant-width outline, `CelestialBody`); double click focuses (eased move, fixed 25% screen height, same view direction), after which the camera follows the body (`sim/focusTracking.ts`) until the user pans, the scene refits or the body disappears; the inspector shows a Focused badge meanwhile.
- A click on empty canvas dismisses the inspector (R3F `onPointerMissed`, left click only, drags excluded). Clicks on panels never reach the canvas.
- "Choose position in 3D" previews a size-matched sphere on a camera-facing plane (scroll = depth); one click creates exactly one body at that point, with a live SI x/y/z readout, and Esc cancels. Any create offers a 10 s Undo that deletes that body and is withdrawn as soon as simulated time moves.
- Axes and Grid are independent, off by default; the grid is also shown while placing (`gridVisible = userGrid || placementMode`) without changing the user's choice.
- Starfield (`StarfieldShell`) keeps a stable apparent size when zoomed out; bodies keep at least 3 px on screen (`bodyDisplayScale`). Both are display-only.
- Event History remains merger-only (the only event type in API v1) and displays the API's estimated contact time as an estimate and booked spin as bookkeeping, not rotation dynamics.

## Dependencies [Implemented]
| Dependency | Status |
|---|---|
| FastAPI, uvicorn, pydantic, pytest, httpx | used (`backend/requirements.txt`) |
| REBOUND 5.2.x | used by the app (`backend/requirements.txt`), GPL-3.0-only; accepted with a custom collision layer (D-008); the project is GPL-3.0-only (D-009) |
| React 18, Vite 5, TypeScript 5, Vitest + Testing Library | used |
| three 0.186, @react-three/fiber 8, @react-three/drei 9.122 (Stars, OrbitControls, Outlines, Grid, Html) | used |

## Testing and CI [Implemented]
CI (`.github/workflows/ci.yml`) runs backend `pytest`, frontend `tsc`, `vitest`, `vite build`, and a Playwright browser journey using a stubbed API on every push to `main` and every PR. The Playwright journey verifies UI interaction/recovery and responsive sidebars, not backend integration or WebGL pixels. The 3D components (`CelestialBody`, `CameraRig`, overlays) have no unit tests because jsdom has no WebGL; their pure logic is extracted into `sim/*` and tested.

## Known limitations
- A single native `integrate` call that never reaches REBOUND's heartbeat cannot be interrupted in-process (would need a worker process).
- The history panel lists backend merger events only; creation, edits and deletes are not logged (separate decision pending).
- Sidebar-aware framing happens when the scene is (re)fitted; opening a sidebar afterwards does not re-frame (use Fit view).
- Brief features not implemented: checkpoint save/restore (only studied in M0.6) and approximate tidal deformation; the diagnostics panel has no baseline/drift indicators.
- Physics limitations and approximations: `API_CONTRACT.md` ("Physics limitations") and `PHYSICS_SPIKE.md`.
