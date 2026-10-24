# Architecture
Sections are labelled **[Implemented]** or **[Proposed]**. Last rewritten 2026-10-24 (M5, after the UI integration series); extended the same day for Simulation Lab and Experiment 01.

## Repository structure [Implemented]
```
README.md  LICENSE  THIRD_PARTY_NOTICES.md  pytest.ini  .github/workflows/ci.yml
context/    shared project memory (see AI_WORKFLOW.md)
backend/    FastAPI app: main.py, models.py, simulation.py (per-universe engine), universes.py (registry), history.py, orbit_lab.py (+ orbit_lab_systems.json), catalogue.py (+ catalogue_data.json), presets/ (loader, archived Horizons sources, derived data), api_*.py routers, collisions.py, diagnostics.py, errors.py; experiments/ = M0 spike (evidence only, not imported)
frontend/   Vite + React 18 + TypeScript app (src/App.tsx owns the universe list and the layout; src/UniverseWorkspace.tsx owns one universe; src/api, src/sim (+ sim/history), src/render, src/components)
scripts/    developer-only data builders (presets/fetch_horizons.py, catalogue/build_catalogue.py); the runtime never uses the network
tests/      pytest: API, service, universes, snapshots, history, catalogue, presets, Orbit Lab, stress, step guard, stall resilience, diagnostics; validation/ (independent physics: Solar System vs Horizons, Moon omission, Experiment 01 vs an independent Kepler reference); spike/; smoke/ (real uvicorn over HTTP, including a kill and restart)
```

## Backend [Implemented]
- `SimulationService` (`simulation.py`) owns the single authoritative REBOUND simulation (IAS15 with the GLOBAL step criterion, D-011; `collision="line"`; SI units, D-007; right-handed Cartesian, D-010). Bodies are identified by REBOUND particle `name`, never by index. Mergers are perfectly inelastic (`collisions.py`); `diagnostics.py` computes the system diagnostics (D-013).
- A step is **transactional**: state is captured first and restored if the engine raises, a resolver callback fails, a value turns non-finite, or the wall-clock budget (`PG_STEP_TIME_LIMIT_S`, default 10 s, checked between chunks and through REBOUND's heartbeat, D-012) runs out (HTTP 503).
- **Concurrency (D-021):** one lock serializes every mutation and step. Reads (`/healthz`, `/state`, `/events`) never wait for it and return the last *committed* state; a mutation that cannot get the lock within the step budget + 5 s answers 503 "busy" and changes nothing.
- The server never advances time by itself; Play is a client loop of bounded `POST /step` requests. State is in memory, single process, lost on restart. Endpoints and error shapes: `API_CONTRACT.md`.
- **One engine per universe (D-025):** the sections "Universes", "Simulation history, UI-2" and the Orbit Lab notes below describe the registry, the activation epoch, snapshots/reset, recorded history, presets, the catalogue and the baseline/modified roles. The legacy single-simulation routes act on the default universe.

## Frontend [Implemented]
**State ownership.** `App.tsx` owns what outlives a universe: the list of universes and the active one (`useUniverses`), the Orbit Lab experiments (`useOrbitLab`), the catalogue, the sidebars (`SidebarState`), the user's Axes/Grid choices and the simulation speed. `UniverseWorkspace.tsx` owns everything about the active universe: selection, focus request and the focused body id, placement mode, the display transform and frame epoch, history, the panels and the canvas. It is mounted with the key `universeId:activationEpoch`, so a switch discards every client task of the old universe. Server state lives only in `useSimulation` (latest authoritative snapshot, events, load/health/error state); there is no frontend physics.

**Data path.** `api/client.ts` (typed client; every request has a timeout: reads 8 s, writes and steps 35 s, so nothing waits forever) -> `api/parse.ts` (strict DTO parsing) -> `sim/useSimulation.ts` (one FIFO request queue so responses apply in order; Play steps strictly sequentially and stops on the first failure; a step with an unknown outcome is followed by a re-read of the committed state) -> `sim/viewModel.ts` (view/scene bodies). Connection health (`/healthz`) and simulation loading are separate states.

**Render transform** (`sim/renderTransform.ts`, display only): scene = (x, z, -y) / metersPerUnit, so the physics x-y plane is the horizontal ground plane and +z is up. Positions are scaled uniformly; radii use a log display size; the scale is refitted only when the set of bodies changes through a user action (load, create, delete, reset, Fit view) and then held fixed while the simulation runs. `sim/framing.ts` pulls the default camera back just enough that the fitted scene is not hidden under a sidebar on narrow windows.

**Layout** (`components/ui/layout.ts`, `Sidebar.tsx`, `theme.ts`): a full-bleed canvas under two solid sidebars (left: Event History + System diagnostics; right: Controls, View, Body Inspector; 320 px open, 40 px rail). The scene is centred in the free area between them by shifting the camera projection with `setViewOffset` (the canvas is never resized), so picking, placement and focus use the same projection. Below 1100 px window width only one sidebar is open. Everything that floats over the scene (wordmark with connection status, errors, first-use prompt, placement hint, undo notice, view legend) lives in the free-area container.

**Interaction contract.**
- Single click selects (thin constant-width outline, `CelestialBody`); double click focuses (eased move, fixed 25% screen height, same view direction), after which the camera follows the body (`sim/focusTracking.ts`) until the user pans, the scene refits or the body disappears; the inspector shows a Focused badge meanwhile.
- A click on empty canvas dismisses the inspector (R3F `onPointerMissed`, left click only, drags excluded). Clicks on panels never reach the canvas.
- "Choose position in 3D" previews a size-matched sphere on a camera-facing plane (scroll = depth); one click creates exactly one body at that point, with a live SI x/y/z readout, and Esc cancels. Any create offers a 10 s Undo that deletes that body and is withdrawn as soon as simulated time moves.
- Axes and Grid are independent, off by default; the grid is also shown while placing (`gridVisible = userGrid || placementMode`) without changing the user's choice.
- The Simulation panel carries the responsive View toolbar beside playback controls: independent Axes/Grid toggles, Overview (fit all bodies), and Focus selected. The view-control contract feeds the same overlay state to the toolbar and scene; compact widths shorten visible labels while retaining accessible names.
- Starfield (`StarfieldShell`) keeps a stable apparent size when zoomed out; bodies keep at least 3 px on screen (`bodyDisplayScale`). Both are display-only.
- Event History remains merger-only (the only event type in API v1), displays estimated contact time as an estimate and booked spin as bookkeeping, and can select the surviving result body while it remains in current backend state. The existing canvas selection highlight and inspector are reused.

## Renderer integration boundary, UI-0 [Implemented]
The 3D canvas consumes only defined inputs: bodies in display form (`SceneBody`), view options, and `trajectories?: readonly TrajectoryInput[]` (`frontend/src/render/contract.ts`). It owns every visual choice (displayed size, minimum on-screen size, materials, colours, camera, starfield); no feature changes the renderer except through these inputs. `UniverseCanvas` gained exactly one prop, `trajectories`, and one conditional mount (`TrajectoryLayer`); `components/canvas/canvasBoundary.test.ts` pins the prop list. Trajectories are SI samples (`PositionSample`) converted with the same `RenderTransform` as the bodies; the layer splits a path wherever `segment` changes, draws `active` solid and `reference` dashed and muted, and thins long paths with `sim/trajectory.ts#decimate` (keeps segment ends). Paths never affect framing or focus. Stars render emissive by `Body.kind` (`bodyMaterial.ts`); no textures or models exist. The physical radius (`radiusM`, collisions) and the displayed size are distinct: the display size is never sent to or returned by the API, and the UI labels `radiusM` as the physical radius. "UI-1" is named by the owner but specified nowhere; nothing implements it.

## Simulation history, UI-2 [Implemented]
Backend: each universe's engine records positions into a `HistoryBuffer` (`backend/history.py`) in `grid` mode (presets, Orbit Lab: a sample at exactly k x interval, capped; recording stops and `truncated` is set) or `step` mode (sandbox: one sample per committed change, a ring that drops the oldest). History is committed state: readers see only committed samples, a failed or cancelled step rolls it back, snapshots carry it, reset and restore give it a new `generation`. `GET /api/v1/universes/{uid}/history` serves it incrementally without waiting for a step.
Frontend (renderer-independent; the modules under `sim/history/` and `HistoryTimeline` must not import canvas components, checked by a test): `historyModel.ts` (pure) holds a `HistoryCache` for exactly one (universe, generation), records gaps, never interpolates, retains at most 20,000 samples; `useHistory` fetches incrementally on each `revision` change and keeps the cache, marked stale, when a fetch fails; `useHistoryNavigation` seeks, steps and replays over recorded samples only, pauses Play on entry, and returns to live when the generation or universe changes. `UniverseWorkspace` maps the viewed frame to scene bodies through the existing display path (so viewing history needs no canvas change) and passes `trajectoryOf(...)` paths to the UI-0 `trajectories` input ("Show paths": the selected body, or all bodies when there are at most 20). While a sample is viewed, Step, Reset, Add body, snapshot actions and the live inspector are off; Play returns to live first. Diagnostics are not recorded per sample and are never reconstructed: the panel says it shows the live state.

## Universes [Implemented]
`backend/universes.py`: a `UniverseRegistry` owns one `SimulationService` engine per universe (own REBOUND simulation, merger resolver, ledgers, events, history, snapshots). Exactly one universe is active; every activation increments an activation epoch. Mutations carry the epoch they were issued under and a commit guard that the engine runs after taking its lock and again immediately before committing, so a stale or late request (including A to B to A) is refused or rolled back and can never change the wrong universe; activation cancels the outgoing universe's running step. Reads work on any universe. Universes live in memory only. The frontend mounts one `UniverseWorkspace` keyed `universeId:activationEpoch`; `useUniverses` mirrors the backend's list and adopts its active universe and epoch when they differ. See `API_CONTRACT.md` ("Universes") and `DECISIONS.md` (D-025 onward).

## Dependencies [Implemented]
| Dependency | Status |
|---|---|
| FastAPI, uvicorn, pydantic, pytest, httpx | used (`backend/requirements.txt`) |
| REBOUND 5.2.x | used by the app (`backend/requirements.txt`), GPL-3.0-only; accepted with a custom collision layer (D-008); the project is GPL-3.0-only (D-009) |
| React 18, Vite 5, TypeScript 5, Vitest + Testing Library | used |
| three 0.186, @react-three/fiber 8, @react-three/drei 9.122 (Stars, OrbitControls, Outlines, Grid, Html) | used |

## Testing and CI [Implemented]
CI (`.github/workflows/ci.yml`) runs backend `pytest`, frontend `tsc`, `vitest`, `vite build`, and Playwright browser journeys using a stubbed API on every push to `main` and every PR. Browser coverage includes merger result selection, keyboard operation, narrow layout, error recovery, and a frame-pacing profile at 1/16/64 bodies. The profile uses the configured headless browser with GPU disabled and is not hardware GPU timing. Browser journeys do not replace backend integration or WebGL pixel tests. The 3D components (`CelestialBody`, `CameraRig`, overlays) have no unit tests because jsdom has no WebGL; their pure logic is extracted into `sim/*` and tested.

## Known limitations
- A single native `integrate` call that never reaches REBOUND's heartbeat cannot be interrupted in-process (would need a worker process).
- Event History lists backend merger events only; creation, edits and deletes are not logged as events (Orbit Lab's modified run keeps its own audit log).
- Universes, snapshots, experiments and history live in backend memory and are lost on restart (OD-5); the UI says so after a restart. Bit-identical continuation after a restore holds within one process only.
- History is capped (200,000 positions per universe; grid mode stops recording at the cap, step mode drops the oldest) and the client keeps at most 20,000 samples.
- Experiment 01 is a two-body model (Sun + Earth-Moon barycentre): not a forecast of Earth's real position.
- Sidebar-aware framing happens when the scene is (re)fitted; opening a sidebar afterwards does not re-frame (use Fit view).
- Brief features not implemented: approximate tidal deformation; the diagnostics panel has no baseline/drift indicators and diagnostics are not recorded per history sample. Persistence across restarts, TRAPPIST-1 (D-027) and "UI-1" (unspecified) are not implemented.
- Physics limitations and approximations: `API_CONTRACT.md` ("Physics limitations") and `PHYSICS_SPIKE.md`.

## Collision & particle engine (D-033, D-034)
Plan: `COLLISION_ENGINE_PLAN.md`; requirements: `specs/COLLISION_PARTICLE_ENGINE_SPEC.md`; models: `COLLISION_SCIENTIFIC_MODELS.md`.

### Contracts and configuration [Implemented, Stage 0]
- `backend/impact/serialization.py`: strict typed frozen dataclass base (`Contract`), canonical JSON (`canonical_json`) and SHA-256 digest (`canonical_digest`).
- `backend/impact/config.py`: `CollisionConfig` (mode, seed, budgets, tolerances), `CollisionTolerances`, `DEFAULT_SANDBOX_MODE = "legacy-merge"`.
- `backend/impact/contracts.py`: every schema of plan section 4 (materials, rotation, impact state, collision input/outcome/result, conservation report, collision event and record, visual event description, fidelity labels). Data only; no physics, no REBOUND.
- Nothing outside `backend/impact/` imports this package yet (tests assert it); simulation behaviour is unchanged.

### Everything below is [Proposed] (not implemented)
- Deferred resolution: the REBOUND callback only records contacts and stops integration; `CollisionEngine.resolve_batch` runs between `integrate` calls (Stage 1).
- Pure outcome models (`models/`), selector, fragments, damage, lifecycle, conservation, applier, records, visual description (Stages 3-8); frontend collision effects behind two new optional UI-0 inputs (Stage 9).
- Modes: `legacy-merge` (today's behaviour bit-for-bit) and `outcome-v1`; all universes stay `legacy-merge` until Stage 4 step 4b; presets and Orbit Lab stay `legacy-merge` until Stage 11.
- Hydrodynamics/SPH remains out of scope; the `OutcomeModel` protocol is the future solver adapter.
