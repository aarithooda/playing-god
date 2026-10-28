# Architecture (current state, verified against the code on 2026-10-26)

This is the short, current overview. The per-stage detail, rationale and history are in [`context/ARCHITECTURE.md`](../context/ARCHITECTURE.md),
the endpoint contract in [`context/API_CONTRACT.md`](../context/API_CONTRACT.md), and the decision log in
[`context/DECISIONS.md`](../context/DECISIONS.md). What works and what does not: [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md).

## Directory map

```
backend/            FastAPI + REBOUND (Python 3.11)
  main.py             app, legacy single-simulation routes (/api/v1/bodies, /simulation/*), /health, /healthz, error handlers
  api_universes.py    universe-scoped routes: CRUD, step, reset, history, snapshots, provenance; create_preset_universe
  api_presets.py  api_catalogue.py  api_orbit_lab.py  api_collisions.py   other routers
  simulation.py       SimulationService: one authoritative REBOUND simulation per universe (1,159 lines)
  collisions.py       legacy merge resolver (MergeResolver), IAS15 selection helpers
  universes.py        UniverseRegistry: independent engines, active-only mutation guarded by an activation epoch
  history.py          recorded positions (step/grid modes, capped); orbit_lab.py (baseline vs modified run)
  models.py lab_models.py   pydantic request/response schemas; errors.py coded errors; diagnostics.py conserved quantities
  impact/             custom collision engine (below)
  presets/            loader, data/*.json presets, sources/ archived JPL Horizons + reference-orbit data with SHA-256
frontend/           Vite + React 18 + TypeScript + three / @react-three/fiber
  src/App.tsx         universe list + layout;  src/UniverseWorkspace.tsx  one universe (scene, tool rail, bar, inspector)
  src/api/            client.ts (timeouts, scoped client), parse.ts (strict response parsing), types.ts
  src/sim/            hooks and pure logic: useSimulation (play loop), useUniverses, useOrbitLab, viewModel, placement, framing,
                      ringWorld/ringDisturb, referenceOrbits, collision/ (effect descriptions), history/
  src/components/canvas/   WebGL layers (bodies, trajectories, starfield, ring grains, reference orbits, collision effects)
  src/components/ui/       panels (create body, inspector, history, diagnostics, orbit lab, events, collision inspector)
  e2e/                Playwright specs (stubbed API) and two Node scripts that start a real backend
tests/              pytest: unit, API, stress, validation/ (independent physics), smoke/ (live uvicorn), impact/ (collision engine), spike/
scripts/            developer-only data builders (Horizons, catalogue, textures); the runtime never uses the network
context/            historical project memory: decisions, status logs, collision plans/audits (see ENGINEERING_STATUS.md §1 for authority)
```

## Boundaries and state ownership

- **The backend owns every physical quantity.** The frontend has no integrator; every displayed position comes from a state or step
  response (`frontend/src/sim/useSimulation.ts` header). The browser proxies `/api` and `/healthz` to the backend (`vite.config.ts`,
  `BACKEND_URL`, default `http://127.0.0.1:8000`).
- **Units**: SI throughout, right-handed Cartesian, positions in metres. The frontend converts to scene units in `renderTransform.ts`.
- **Mapping bodies to visuals**: each backend body carries `bodyType`, `assetKey`, `colorHex`, `primaryId` (render metadata contract:
  `context/BODY_RENDER_METADATA.md`); `viewModel.ts` turns state into scene bodies, `CelestialBody.tsx` draws them. Radius shown
  depends on the size mode (physical vs exploration) - a display choice.
- **State lifetime**: universes, snapshots, experiments and history live in backend process memory (OD-5); restart loses them.
- **Concurrency**: one lock per engine serialises mutations and steps; reads (`/state`, `/events`, `/healthz`) return the last committed
  state without waiting. A step is transactional: state is captured first and restored on failure or when the wall-clock budget
  (`PG_STEP_TIME_LIMIT_S`, default 10 s) is exceeded (HTTP 503). The server never advances time on its own: Play is a client loop.

## Physics engine

`SimulationService` wraps a `rebound.Simulation` per universe. Verified in code (`simulation.py`): integrator **IAS15** (re-selected after
every structural edit so no stale predictor state survives), `G = 6.67430e-11` set explicitly after `units`, `collision = "line"`, fixed
`rand_seed`, SI units. IAS15 chooses its own adaptive internal steps; the service additionally chunks a requested step and checks a
curvature criterion on the *internal* steps for collision detection (D-063). The integrator is REBOUND; we did not write it.
A lone body is advanced analytically because IAS15's convergence test divides by a zero acceleration.

## Collision pipeline

Two per-universe modes (`backend/impact/config.py`): **`legacy-merge`** (REBOUND callback merges immediately, `collisions.py`) and
**`outcome-v1`** (the callback only *records* contacts; `CollisionEngine` resolves them between `integrate` calls).
`outcome-v1` lifecycle (docstring of `backend/impact/engine.py`): detected → captured (frozen `ImpactState`, state refined to the
contact time in `contact.py`) → classified (`selector.py`: model + reasons) → realised (pure `CollisionResult` + conservation report)
→ validated (whole result, before mutation) → applied atomically (`applier.py`) → recorded (`records.py`).
A pair where either body has no material profile resolves with the exact legacy merge. A failed outcome gets one fallback attempt (a
labelled perfect merge); if that also fails the step is rolled back (HTTP 500 `collision_unresolvable`), state unchanged. Models live in
`impact/models/` (`ls12` impact scaling, `envelope`, `cratering`, `perfect_merge`, `provisional`), with materials in
`material_profiles.json`, spin in `rotation.py`, fragment parcels with deterministic seeding in `fragments.py`, and a versioned
`CollisionState` serialisation (`collision_state.py`). Every record carries fidelity labels; **cratering is Unsupported**, and the
scientific content is **provisional** (D-038, D-059).

## Multi-universe model

`UniverseRegistry` (`universes.py`) holds up to 8 independent `Universe` objects, each with its own `SimulationService`. Exactly one is
active; every activation increments an epoch, and each mutation carries the epoch it was issued under plus a `CommitGuard` that is
re-validated under the registry lock before commit, so a request overtaken by a switch (even A→B→A) cannot touch the wrong universe.
Roles: `sandbox`, `preset`, `baseline`, `modified` (the baseline is immutable). Snapshots (≤10 per universe) and recorded history are per universe.

## Presets, Orbit Lab, catalogue

`backend/presets/loader.py` loads `data/*.json` (`solar-system-j2000`, `solar-system-moons-j2000`, `saturn-particle-rings`, plus
`body-materials.json` annotations); masses/states derive from archived JPL Horizons/DE440 data. Orbit Lab runs an immutable baseline
(Sun + Earth-Moon barycentre) against a velocity-scaled run and compares both with an independent Kepler propagator
(`tests/validation/kepler_reference.py`). The catalogue (`catalogue_data.json`) prefills the create form only.

## Physical vs visual-only

| Physical (backend, REBOUND / collision engine) | Visual only (frontend; never sent to the backend) |
|---|---|
| bodies, masses, radii, positions, velocities, merges and collision outcomes, history, diagnostics | Ring World ring grains (massless, shader drift, "swallowed/flung" reactions to intruders); reference orbits, outer-body markers and the 10,000-asteroid main-belt sample (D-064); collision flash/debris/surface marks; starfield and galaxy backdrop; trajectory lines drawn from recorded history; per-frame interpolation between released backend states (`sim/motion/`) |

Tidal deformation is **not implemented** anywhere.

## Frontend data flow

`useSimulation` keeps the latest released authoritative state plus transient UI state. All simulation requests go through one FIFO
queue (one in flight, responses applied in order, every request has a timeout). `parse.ts` validates every response strictly before it
reaches components.

**Smooth motion (D-068)** has two halves with one job each. *Producing*: while Play is on, the backend computes up to
`LOOKAHEAD_STEPS = 3` steps ahead and the hook releases the finished states at a steady `tickMs` cadence. *Drawing*: every released
state is fed to a `MotionBuffer` (`sim/motion/`), and a `MotionDriver` inside the canvas evaluates it once per animation frame,
interpolating between the two released states that bracket the displayed time (Hermite for short arcs, Kepler propagation for long ones,
satellites relative to their host). Nothing is extrapolated past a released state, no second integrator exists, and drawing never
requests anything from the backend. `sim` (clock, inspector, diagnostics) is the latest released state, never an interpolated one.

*Sources of truth.* **Displayed time** is owned by `MotionBuffer` (`displayTime`, anchored per push, frozen by `hold`). **The planet** is
drawn from `MotionBuffer.sample(wall)` (the driver, priority -100); that call also records the frame's wall time (`drawWallMs`) and the
simulation time shown (`lastShownS`). **The orbit trail** has two parts that must meet: the *recorded line*, built by React from the trail
recorder's points (`trail.ts`, dense along the same interpolation, one piece per at most `TRAIL_PIECE_RAD`, only for bodies whose trail is
drawn) up to a cut time (`segmentStartS`, held in React state), plus the *head*, rebuilt every frame by `trailHead` at `drawWallMs` (so
at the planet's instant). React re-renders a few frames after the displayed segment changes, so the drawn recorded line can be stale;
the head therefore starts at the recorded line's LAST DRAWN point (`drawnCutRef`, the cut of the last committed render) and carries the
recorder points up to the displayed segment's start, then the interpolated path to the planet. The head's last point is the planet's
drawn position by construction (same instant, same interpolation). The recorder records every released segment from its START for each
drawn body that is present at both ends: a body with no trail ending at that start (not drawn when the recorder last started, e.g. created
a moment before its trajectory existed, or just added to the drawn set) starts there, so its first segment is never left out; only a body
new in the step or cut by a collision starts at the step's end.

*Pause.* The PRESS of the Pause control freezes the picture (`SimulationBar` calls `onPause(event.timeStamp)` on `pointerdown`; the click
that ends the press, which lands on the Play control now in the same place, is swallowed; keyboard activation still pauses through
`onClick`). The browser runs the handler only after the frame it was drawing when the button went down, so the freeze is defined by the
press time, not the handler time: `pause(pressedAtMs)` calls `motion.hold(now, pressedAtMs)`, which freezes the last frame whose drawing
finished before the press (`MotionBuffer.frameDrawn` is called after every render; the last `FRAME_MEMORY` frames and the segments they show
are kept), and takes back a Play-loop release committed after the press (the clock keeps the time on screen then). A frame finished after
the press but before the handler is replaced on the next frame. While held, `heldFrameWallMs` is the frozen frame's draw time:
`TrajectoryLayer` keeps the last few builds of the recorded line mounted and shows, per frame, the newest (playing) or exactly the build the
frozen frame showed, chosen once per pause, so a rebuild while paused, or one computed just before the press, is not shown. A hold while already held (Resume pressed, no
state yet; the loop's effect cleanup) changes nothing. `stepOnce()` also holds synchronously, and a `pausedRef` stops the loop's tick and
fetches at once. Steps already
computed (look-ahead) and the one in flight are still pushed into the buffer, flagged `hold`, which buffers and records their trail points
without touching the displayed time, `sim` or the pace, and trim no trail point (outside a pause the recorder drops only points before the
oldest segment that may still be drawn). The buffer drops only segments the displayed time has completely passed (never the one on screen),
and at a state's exact time it stays in the segment ending there, so held states cannot change the frame or the trail's cut, however many arrive. *Resume* pushes the next state normally: the display
starts from the frozen time (no jump, no crawl: the pause is not measured as an arrival gap) and moves at the normal pace through the held
states (`MAX_BACKLOG_STEPS` leaves room for them; the paced speed does not race to catch up).

*Invalidation.* A load, edit, create, delete, reset or restore is a discontinuity: the buffer flushes and the trail recorder restarts from
the new state, so no point from before it is drawn (a stale cut newer than the new segment start contributes nothing); every mutation bumps
a generation counter, so a look-ahead step fetched before it is not shown after it (its events are still recorded); bodies named by a
step's collision events are not interpolated across that step and restart their trail; a removed body loses its trail. The buffer is
bounded (`MAX_BUFFERED_STATES`, trimmed only behind the displayed time). A universe switch builds a new hook instance (keyed by universe
and activation epoch), hence a new buffer and recorder. The recorded history view bypasses the buffer and the head. The orbit-trail
smoothing on the `animations` branch is a separate, unmerged graphics concern.

## Key decisions (see `context/DECISIONS.md`)

D-007 SI units; D-008 REBOUND + own merger layer; D-009 GPL-3.0-only (REBOUND is GPL); D-011 IAS15 with global criterion;
D-021 lock-free reads and bounded waits; D-025 one engine per universe; D-033/D-034 collision engine design and modes;
D-045 sandbox defaults to `outcome-v1` (presets originally pinned to `legacy-merge` - see D-065); D-059 proceed on provisional
science; D-063 contact state at the contact time; D-064 display-only reference orbits. Consolidation records: D-065, D-066.
