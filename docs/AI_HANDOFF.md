# Playing God — handoff for an engineering agent

Written 2026-11-16 at commit `62e96df` on branch `claude/clever-curie-d7sf4k`. Purpose: an engineer or AI agent who has never
seen this repository or the conversations that produced it can read this file and continue development safely. Every path, class,
function and route named here was checked against the code at that commit; if the code and this file disagree, the code wins and
this file should be corrected.

**Read in this order:** this file → [`ENGINEERING_STATUS.md`](ENGINEERING_STATUS.md) §15 (what was verified, exact counts) →
[`SPACE_MISSION_DESIGN.md`](SPACE_MISSION_DESIGN.md) (physics, equations, validation) → [`ARCHITECTURE.md`](ARCHITECTURE.md) →
[`../context/DECISIONS.md`](../context/DECISIONS.md) D-070 and D-071 → [`../context/API_CONTRACT.md`](../context/API_CONTRACT.md).
Files under `context/` other than `DECISIONS.md`, `API_CONTRACT.md` and `PRESETS.md` are historical logs and are partly stale; where
they disagree with `docs/`, `docs/` is newer.

---

## 1. Product vision

Playing God is an interactive universe sandbox in the browser for people interested in serious scientific simulation and space
exploration. It is not a school-level toy. The owner defined four pillars, to be developed **sequentially**, each one a natural
extension of the same simulation rather than a separate application:

| # | Pillar | What it means | State |
|---|---|---|---|
| 1 | **Universe Sandbox** | Create celestial bodies, build systems, change physical parameters, simulate gravity, watch the universe evolve | Exists (the foundation; must be preserved) |
| 2 | **Space Mission Design** | Create spacecraft, place them in orbit, design manoeuvres, plan lunar and interplanetary missions, simulate trajectories | Delivered in PR #27 for planet → moon missions; interplanetary missions are not implemented (section 2) |
| 3 | **Scientific Exploration** | Understand the mathematics and physics behind the simulation: inspect equations and calculations, experiment with parameters, understand why outcomes occur | **Not started. Recommended next phase (section 21)** |
| 4 | **AI Universe Assistant** | Control the universe through natural language: create objects, configure simulations, design and execute missions through validated commands | Not started. Explicitly out of scope until the owner says otherwise |

Standing requirements from the owner that apply to all future work:
- **One simulation.** The backend owns every physical quantity. Never add a second, disconnected simulation or a frontend integrator.
- **Scientific integrity.** Use established methods, validate against independent references, document every assumption and limit,
  never fake a feature. A capability is described as *implemented and verified*, *implemented but partially verified*, *not
  implemented* or *blocked*; do not overstate.
- **Tests.** Do not weaken, delete or skip existing tests to obtain a pass. Do not claim a result for a test that was not run.
  Distinguish pre-existing failures from new ones.
- **Scope.** Work on the pillar asked for. No unrelated refactors.
- **Git.** Do not merge pull requests, delete the checkpoint branch, force-push or rewrite history unless the owner asks. Review and
  merging are the owner's.

## 2. Current implementation status

| Area | Status |
|---|---|
| N-body gravity (REBOUND IAS15), body CRUD, step / play / reset, diagnostics, events | Implemented and verified (pre-existing) |
| Multiple universes, presets (Solar System with and without moons, Saturn Ring World, Earth–Moon), snapshots, recorded history, Orbit Lab (Experiment 01) | Implemented and verified (pre-existing; Earth–Moon preset is new) |
| Spacecraft as simulation entities; orbits from classical elements; impulsive and finite burns | Implemented and verified |
| Mission workflow (draft → proposal → committed → flown → judged) | Implemented and verified |
| Earth → Moon transfer and lunar orbit insertion | Implemented and verified in the `earth-moon-j2000` preset (backend tests, independent references, real-backend browser journey) |
| The same mission in the 21-body `solar-system-moons-j2000` preset | Implemented, **partially verified** (worked when driven by a script; no automated test, never driven through the UI) |
| Collision policy: stop at first contact, in every universe | Implemented and verified (D-071) |
| Merging, fragments, debris, collision outcomes | **Dormant**: code kept and tested, unreachable from the application (section 14) |
| IAS15 step-collapse guard | Implemented and verified (section 15) |
| Interplanetary transfers, plane changes, mid-course corrections, landing, rendezvous, atmosphere, J2 | Not implemented; refused with a reason |
| Tidal deformation; persistence across backend restarts | Not implemented |
| Scientific Exploration pillar; AI Universe Assistant pillar | Not started |

## 3. Repository layout

```
backend/                 Python 3.11, FastAPI, REBOUND 5.2.2. Owns all physics.
  main.py                  app, exception handlers, legacy single-universe routes, /health, /healthz
  simulation.py            SimulationService: one REBOUND simulation per universe (the engine)
  collisions.py            IAS15 selection, StepCollapseGuard, contact-time estimate, MergeResolver (dormant)
  universes.py             UniverseRegistry, Universe, activation epoch, snapshots store
  api_universes.py         universe-scoped routes (CRUD, step, reset, history, snapshots, provenance)
  api_spaceflight.py       spacecraft, manoeuvre and mission routes
  api_presets.py  api_catalogue.py  api_orbit_lab.py  api_collisions.py
  models.py  lab_models.py pydantic request/response models of the core API
  history.py               HistoryBuffer (recorded positions)        diagnostics.py  errors.py  catalogue.py  orbit_lab.py
  spaceflight/             Space Mission Design (sections 7 to 11)
  impact/                  collision-outcome engine (DORMANT, section 14)
  presets/                 loader.py, data/*.json, sources/ (archived JPL Horizons data with SHA-256)
frontend/                React 18, TypeScript, Vite, three.js / @react-three/fiber. Renders; never integrates.
  src/App.tsx              universe list and layout
  src/UniverseWorkspace.tsx  one universe: scene, tool rail, simulation bar, inspector (the composition root)
  src/api/                 client.ts, parse.ts (strict response parsing), types.ts (wire types), errors.ts
  src/sim/                 hooks and pure logic (useSimulation, useUniverses, viewModel, motion/, spaceflight/, collision/, history/)
  src/render/contract.ts   the typed inputs the canvas accepts
  src/components/canvas/   WebGL layers        src/components/ui/  panels
  e2e/                     Playwright specs (stubbed API) and three Node scripts that start a real backend
tests/                   pytest (section 17)
scripts/run_tests.py     the canonical one-command test runner
docs/                    current documentation        context/  decision log, API contract, historical logs
.github/workflows/ci.yml CI: four jobs (section 17)
```

## 4. Backend architecture

**Process model.** One FastAPI process (`backend/main.py`, `app`). All state is in memory and is lost on restart. The server never
advances time by itself: "Play" is the client calling the step route repeatedly.

**Universes.** `UniverseRegistry` (`backend/universes.py`) holds up to `MAX_UNIVERSES = 8` `Universe` objects, each with its own
`SimulationService`. Exactly one is *active*; only the active one accepts mutations. Every mutating route takes
`?activationEpoch=<n>` and is refused (409, code `stale_activation` or `universe_not_active`) if the registry's epoch has moved on,
so a slow client cannot write into a universe it no longer shows. The startup universe is `uni-default` (`DEFAULT_UNIVERSE_ID`), role `sandbox`. Roles: `sandbox`, `preset`,
`baseline`, `modified` (the last two are Orbit Lab runs; a baseline is immutable).

**The engine: `SimulationService`** (`backend/simulation.py`, subclass of `SpaceflightMixin`).
- Holds one `rebound.Simulation` (`self._sim`) plus *side tables* keyed by body id: `_meta` (name, colour, kind, …), `_materials`,
  `_rotations`, `_products`, `_sites`, `_escaped`, and the spaceflight book `_flight`.
- **Locking.** One `threading.RLock`. Mutations and steps take it through `_guard()` (bounded wait, then HTTP 503 "busy"). Reads
  (`snapshot()`, `published()`, `events()`) return the last *published* state without the lock.
- **Mutations are transactional.** `_mutation(guard)` takes a `_checkpoint()`, runs the change, and on any exception calls
  `_rollback()`; on success `_publish()` bumps `revision` and publishes a new immutable state.
- **Steps are transactional.** `step(dt_s)` takes `_capture()`, advances, and on any failure calls `_restore()`. A step that
  exceeds `PG_STEP_TIME_LIMIT_S` (default 10 s) is stopped from REBOUND's heartbeat and raises `StepTimeoutError` (HTTP 503).
- **Snapshots.** `EngineSnapshot` (dataclass) holds a copy of the simulation and of every side table, including `flight`.
  `capture_snapshot()` / `restore_snapshot()` / `reset()` / `from_snapshot()` all go through it.
- **Rule: any new per-universe state must be added to all five places**: `_checkpoint`/`_rollback`, `_capture`/`_restore`,
  `_take_snapshot`/`_apply_snapshot`, `from_snapshot`, and `_init_state`. Missing one produces state that survives a failed step or
  vanishes on reset. `SpaceflightBook` is the model to copy.

**Step flow** (`SimulationService.step` → `_advance` → `_flight_advance` → `_advance_to` → `_flight_integrate`):
1. refuse if `_flight.halt` is set (409 `simulation_halted`);
2. `_capture()`;
3. `_advance(target)`: a pair already touching and closing halts at once (`_flight_touching`); otherwise the step is cut at
   history grid times and (by `_flight_advance`) at manoeuvre node times, so the engine lands exactly on them;
4. `_advance_to` integrates in chunks limited by a curvature criterion (`_chunk_limit`, D-063) and after each chunk asks
   `_flight_halt_contacts()` whether a recorded contact must stop the simulation;
5. `_verify_finite()`, `_flight_evaluate()` (missions are judged), commit guard, history sample, `_publish()`.

**Errors.** `backend/errors.py` `CodedError` and `backend/spaceflight/engine.py` `SpaceflightError` carry `{detail, code}` and an
HTTP status; handlers are registered in `backend/main.py`.

## 5. Frontend architecture

- **Composition root:** `frontend/src/UniverseWorkspace.tsx`. It owns the hooks, builds every input of the canvas, and lays out the
  tool rail (`components/ui/ToolRail.tsx`, tools: create, universes, missions, orbitlab, events, history, diagnostics), the tool
  drawer, the simulation bar (`SimulationBar.tsx`) and the inspector.
- **Data flow:** `api/client.ts` (`ApiClient`, `ScopedClient` per universe, request timeouts) → `api/parse.ts` (every response is
  parsed strictly; an unknown or missing field is an error, not `undefined`) → `sim/useSimulation.ts` (state, play loop, `mutate`;
  every request that touches the simulation goes through one FIFO queue here, so at most one is in flight) → `sim/viewModel.ts`
  (`SimulationView`, `BodyView`, `SceneBody`) → components.
- **Play loop and smooth motion (D-068):** `useSimulation` requests steps ahead of the display; `sim/motion/MotionBuffer.ts`
  interpolates between authoritative states (Hermite, or Kepler about a host body) so bodies move smoothly. The displayed time is
  about one step *behind* the newest backend state by design.
- **The canvas boundary:** `components/canvas/UniverseCanvas.tsx` receives only typed, display-ready inputs declared in
  `render/contract.ts`. `components/canvas/canvasBoundary.test.ts` pins the list of props and forbids canvas files from importing the
  API client or `useSimulation` (it even forbids the word "backend" in those files). A new canvas input is a deliberate, visible
  change to that test.
- **Adding a wire field** means touching, in order: the pydantic model, `api/types.ts`, `api/parse.ts` (+ its test),
  `sim/viewModel.ts`, and the fixtures in `src/test/fixtures.ts` / `src/test/flightFixtures.ts`.

## 6. Simulation engine and REBOUND integration

- **Integrator:** IAS15 (15th-order Gauss–Radau, adaptive), `G = 6.67430e-11`, SI units, `collision = "line"` (a swept test over
  each internal step), fixed `rand_seed`. We did not write the integrator; REBOUND is GPL-3.0, which is why the project is GPL-3.0.
- **Identity:** a body *is* a REBOUND particle whose `name` is its id (`body-<12 hex>`, `craft-<12 hex>`). Always add particles
  with `collisions.add_named_particle` (passing `name=` to `Simulation.add` corrupts names after many add/remove cycles), and look
  them up with `SimulationService._particle(id)` or `dynamics.particle_index` (REBOUND's name hash is stale after removals).
- **Step-size criterion:** `collisions.select_ias15(sim)` picks **GLOBAL** by default and **PRS23** when `has_satellites(sim)` is
  true: a moon-like body, collision debris, or any particle whose name starts with `craft-`. Reason: with a low orbit next to slow
  bodies GLOBAL needs about a million steps per simulated day; PRS23 needs about 600. Call `select_ias15` again after every
  structural or discontinuous change (add/remove a body, an impulsive burn, ignition, cutoff): it also resets IAS15's predictor.
- **Heartbeat:** `SimulationService._heartbeat` runs after every internal step: it records the longest step of the chunk, feeds
  the step-collapse guard (section 15), and stops the integration on cancel or deadline.
- **A lone body** is advanced analytically (`_drift_lone_body`) unless one of its engines is burning.
- **Time is a double in seconds.** At `t ≈ 1e9 s` one ulp is about `1e-7 s`; never compute a short duration as the difference of
  two large times (see `_flight_burn_progress`).
- REBOUND's C source is not vendored. To read it: `pip download rebound==5.2.2 --no-binary :all: --no-deps` and open
  `src/integrator_ias15.c`.

## 7. Spacecraft: data model and lifecycle

**A spacecraft is a particle of the universe's own simulation.** It is not a decorated planet and there is no separate propagator.
Everything the particle does not hold lives in one `SpaceflightBook` per universe (`backend/spaceflight/craft.py`):

| Record (frozen dataclass) | Key fields |
|---|---|
| `Spacecraft` | `id`, `dry_mass_kg`, `propellant_kg`, `propellant_capacity_kg`, `thrust_n`, `isp_s`, `home_body_id`, `created_at_s`; `mass_kg` = dry + propellant |
| `Maneuver` | `epoch_s`, `mode` (`impulsive`/`finite`), `frame` (`vnb`/`inertial`), `reference_body_id`, `dv`, `centered`, `status` (`planned`/`executing`/`executed`/`failed`), burn window `start_s`/`end_s`, `planned_propellant_kg`, execution record, `predicted_state`, `actual_state`, `mission_id`, `role` |
| `Mission` | `craft_id`, `destination_body_id`, `objective`, `status` (`draft`/`planned`/`in_progress`/`completed`/`failed`/`unsupported`), `plan`, `plan_revision`, `plan_fingerprint`, `trajectory`, `plan_nodes`, `committed`, `maneuver_ids`, `checks`, `agreement`, `outcome` |
| `Halt` | `event_id`, `body_ids`, `time_s`, `relative_speed_m_per_s`, `refined` |
| `SpaceflightBook` | dicts `craft`, `maneuvers`, `missions`; `halt`; `seq` (id counter, never reused); `physics_epoch` (bumped when the universe changes in a way a stored plan did not foresee) |

Records are immutable; the book only swaps whole records (`put`, `amend`), so `copy()` is an exact, cheap rollback point.

**Lifecycle** (all in `SpaceflightMixin`, `backend/spaceflight/engine.py`):
- *Create:* `add_spacecraft(SpacecraftCreate)` → state from elements (`_flight_orbit_state`) or a state vector → particle added,
  `Spacecraft` record stored, `kind`/`bodyType` = `"spacecraft"`. Limit `MAX_SPACECRAFT = 32`.
- *Describe:* every published body of kind spacecraft carries `spacecraft: SpacecraftOut` with its osculating `orbit: OrbitOut`
  about the body whose sphere of influence contains it (`orbit_summary` / `orbit_about`). **`orbit_about` runs while a committed
  state is being published and must never raise**; an orbit it cannot describe has `regime: "degenerate"`.
- *Edit:* `update_spacecraft` (dry mass, propellant, thrust, Isp); name, colour, position and velocity through the ordinary body
  route. The body route refuses `massKg`, `kind`, `bodyType`, material and spin for a spacecraft (409).
- *Remove:* the ordinary `delete_body`; `_flight_body_removed` fails its pending nodes and clears a halt that names it.
- *Reference body:* `dynamics.build_hierarchy` assigns each massive body a parent (nearest heavier body whose Hill sphere contains
  it, else the strongest puller) and a Laplace sphere of influence; `Hierarchy.reference_for(position)` returns the innermost body
  whose sphere contains a position. This is **description only**: gravity from every body always acts.

## 8. Orbital mechanics and coordinate conventions

Module `backend/spaceflight/orbits.py` (pure functions, no REBOUND). Details and equations: `SPACE_MISSION_DESIGN.md` §3 and §5.1.

- **Units:** SI everywhere (m, m/s, kg, s, N). Radians inside the backend, degrees in the API (fields ending `Deg`).
- **Frame:** one inertial, right-handed Cartesian frame per universe. Elements are measured from its **x-y plane and x axis**. In the
  J2000 presets that plane is the **ecliptic**, not a planet's equator; bodies have no spin axis, so "equatorial orbit" in the
  planetary sense cannot be expressed. The UI says so next to the inclination field.
- **Elements:** `Elements(a, e, i, raan, argp, nu)`; `a < 0` for a hyperbola; exactly parabolic orbits are refused. Singular cases
  (circular, equatorial) follow Vallado's conventions and are handled in `elements_to_state` / `state_to_elements`.
- **Gravitational parameter:** `mu = G (M_body + m_craft)` for relative two-body quantities.
- **Kepler's equation:** `true_from_mean` is a bracketed Newton iteration for both the elliptic and the hyperbolic case. Do not
  replace it with an unbracketed one (the earlier version overflowed for `e` just above 1).
- **Manoeuvre frame (VNB)** about a reference body: `V` = prograde (unit velocity), `N` = orbit normal (`r × v`), `B = V × N`
  (radial-out for a circular orbit). `vnb_axes`, `vnb_to_inertial`.
- **Sphere of influence** `d (m/M)^(2/5)` and **Hill radius** `d (m/3M)^(1/3)` use the *present* distance `d`, not the semi-major axis.

## 9. Propulsion and manoeuvres

`backend/spaceflight/propulsion.py` (`G0 = 9.80665`, `exhaust_velocity`, `mass_flow`, `delta_v_capacity`, `propellant_for`,
`burn_duration`) and `backend/spaceflight/dynamics.py` (`plan_impulse`, `burn_window`, `ThrustForce`, `ActiveBurn`).

- **Impulsive burn:** at the node time the particle's velocity jumps by the commanded vector and its mass drops by the rocket-
  equation propellant (`_flight_execute`). If the propellant gives less than commanded, it delivers what it can and the node records
  the shortfall. `thrustN` is not used.
- **Finite burn:** `_flight_ignite` computes the window with `burn_window` and marks the node `executing`; `ThrustForce` is
  installed as REBOUND `additional_forces` for each `integrate` call and adds `F / m(t)` along the burn direction, with the analytic
  mass `m(t) = m0 − ṁ (t − t0)` evaluated at IAS15's own sub-step times. `_flight_cutoff` → `_flight_end_burn` books the propellant
  and the delivered delta-v. Ignition and cutoff are integration targets, so a burn does not depend on the user's step size.
- **Scheduling:** `_flight_reschedule(craft_id)` recomputes every planned node's window from the mass predicted at its ignition and
  refuses overlaps and windows in the past (lenient when a node is being *removed*). `_flight_events_due` runs cutoffs, then
  ignitions and impulses that are due, and loops until nothing is due (a burn shorter than the time resolution must be cut off in the
  same pass, or the engine would thrust for the rest of the step).
- **Invariants:** one burn per craft at a time (`_flight_engine_busy`); `ThrustForce` re-resolves particle indices whenever the
  particle count changes inside an integration; a VNB burn whose reference body disappears is shut down and booked as delivered
  (`_flight_check_burns`).
- **Node times** use `_due(when, now)` / `_before(when, now)` (tolerant comparisons). Do not compare node times with `==` or `<`.

## 10. Mission planning and execution pipeline

```
create_mission ──► plan_mission ──────────► commit_mission ──► step() … step() ──► completed | failed
   draft            planned, committed=False   planned, committed=True   in_progress
                    (a PROPOSAL: nothing        (the plan's nodes are    (judged after every
                     scheduled, simulation       ordinary Maneuver        committed step by
                     untouched)                  records now)             missions.evaluate)
                    or unsupported / draft with reasons
```

- **`plan_mission`** (`engine.py`): takes the per-universe `_plan_slot` (one design at a time, else 409 `plan_in_progress`), copies
  the simulation under the lock, **releases the lock**, calls `planner.design_transfer` on the copy (bounded by
  `PG_PLAN_TIME_LIMIT_S`, default 25 s), then stores the plan in a mutation only if `missions.fingerprint` and the craft are
  unchanged (else 409 `plan_outdated`).
- **`commit_mission`**: creates one `Maneuver` per plan node (`role` departure / insertion / observation), reschedules, sets
  `committed`.
- **`missions.evaluate`** (`backend/spaceflight/missions.py`, pure): called by `_flight_evaluate` after every committed step and
  mutation. An **orbit** objective completes only when the actual orbit about the destination is bound, clear of the surface, has
  periapsis and apoapsis within `toleranceM` (default 50 km) of the target, has its apoapsis inside the sphere of influence, and
  has held for one full revolution. A **flyby** completes when, at the observation node, the osculating periapsis is within
  tolerance **and** the craft is actually at that altitude. Reaching the Moon is not success; an executed burn is not success.
- **Plan versus simulation:** at each node the predicted pre-burn state is compared with the actual one
  (`POSITION_AGREEMENT_M = 1000`, `VELOCITY_AGREEMENT_M_PER_S = 1.0`); reported in `agreement`, never by itself a failure.
- **`abort_mission`** removes pending nodes and ends the mission `failed` ("aborted"); **`delete_mission`** removes it.
- **`mission_trajectory`** returns the planned path (a prediction); the flown path is the recorded history.

## 11. Earth–Moon transfer: how the planner works

`backend/spaceflight/planner.py`, entry point `design_transfer(sim, craft_id, craft, craft_ids, request, *, pending_nodes,
time_budget_s, clock, names)` → `PlanResult(status ∈ ok | unsupported | no_solution, reasons, plan, trajectory, nodes)`.

**Supported geometry, checked first:** a near-circular (`e < 0.02`), prograde parking orbit about a body P, well inside
(`r < 0.5 d`) the orbit of the destination D, where D's parent is P. In short: **planet → one of its moons**. Anything else returns
`unsupported` with a sentence saying why (interplanetary, moon → planet, eccentric parking orbit, pending nodes, no propellant).

Steps:
1. **Patched-conic first guess** (`aim`): a transfer ellipse from the parking radius whose apoapsis lies beyond the destination's
   distance by twice the impact parameter of the wanted periapsis (so both pass directions are reachable by timing), or the ellipse
   that reaches the destination's distance in the requested time. Gives the departure delta-v and a phase estimate. Labelled an
   estimate in the plan.
2. **N-body targeting** (`solve`, `fly`): on a private copy of the simulation (collisions off, same burn arithmetic through
   `_Flyer`), the departure time is varied until the **signed periapsis radius** at the destination equals the target (positive =
   prograde pass, negative = retrograde). Scan outward from the estimate (±40° of parking phase in 2° steps), then Illinois regula
   falsi to 1 m. Universes of more than six particles are bracketed on a reduced model (craft, origin, destination, the origin's
   ancestors) and refined on the full one.
3. **Finite burns** (`calibrate`): the delta-v and the apse line are corrected for gravity loss by flying the burn.
4. **Insertion:** retrograde delta-v at the predicted periapsis from vis-viva about the destination. A flyby gets an observation
   node instead.
5. **`_final_flight`:** the whole plan is flown once more on the full copy to record the predicted state before each burn, the
   predicted orbit over two revolutions, and the sampled trajectory.

Every copy is watched by `_Watch` (the step-collapse guard plus a stop at the time budget); `_integrate` turns a stopped copy into
`PlannerTimeout`, which becomes `no_solution` with the reason "time budget".

**Reference numbers** (Earth–Moon preset, 300 km parking orbit in the Moon's plane → 100 km circular lunar orbit): departure
3115.02 m/s, insertion 815.66 m/s, flight 3.984 days, 6 trial flights; flown result 99.992 × 100.087 km.

## 12. API endpoints and data contracts

Authoritative: `context/API_CONTRACT.md`; models in `backend/models.py`, `backend/lab_models.py`,
`backend/spaceflight/requests.py` (inputs) and `backend/spaceflight/schemas.py` (outputs). Unknown request fields are rejected
(422); non-finite numbers are rejected.

| Group | Routes | Module |
|---|---|---|
| Health | `GET /health`, `GET /healthz` | `backend/main.py` |
| Universes | `GET, POST /api/v1/universes`; `GET, DELETE /api/v1/universes/{id}`; `POST …/activate` | `backend/api_universes.py` |
| State | `GET …/state`, `GET …/events`, `POST …/step`, `POST …/reset`, `GET …/history`, `GET …/provenance` | same |
| Bodies | `POST …/bodies`, `PATCH, DELETE …/bodies/{bodyId}` | same |
| Snapshots | `GET, POST …/snapshots`, `POST …/snapshots/{sid}/restore`, `DELETE …/snapshots/{sid}` | same |
| Spacecraft | `POST …/spacecraft`, `POST …/spacecraft/orbit-preview`, `PATCH …/spacecraft/{craftId}` | `backend/api_spaceflight.py` |
| Manoeuvres | `POST …/spacecraft/{craftId}/maneuvers`, `POST …/maneuvers/preview` (under the craft), `DELETE …/maneuvers/{id}` | same |
| Missions | `POST …/missions`, `POST …/missions/{id}/plan`, `/commit`, `/abort`, `DELETE …/missions/{id}`, `GET …/missions/{id}/trajectory` | same |
| Presets, catalogue | `GET /api/v1/presets`, `GET /api/v1/presets/{id}`, `GET /api/v1/catalogue` | `api_presets.py`, `api_catalogue.py` |
| Orbit Lab | `/api/v1/orbit-lab/systems`, `/experiments…` | `api_orbit_lab.py` |
| Collision records (dormant) | `GET /api/v1/materials`, `…/bodies/{id}/surface`, `…/collisions…` | `api_collisions.py` |
| Legacy single-universe | `/api/v1/simulation/state|step|reset`, `/api/v1/bodies…`, `/api/v1/events` (act on `uni-default`) | `backend/main.py` |

Things a client must know:
- **`SimulationState`** = `{status, simulationTimeS, bodies, diagnostics}` plus, only when present, `spaceflight: {maneuvers,
  missions}` and `halt`. Optional keys are **omitted**, not null.
- **`StepResponse`** adds `advancedS` (may be less than `dtS`), `events`, optional `warnings` (`collision_stopped` when a contact
  stopped the step).
- **Events:** the active application produces `contact` (id `halt-<n>`) and `maneuver` (phase `impulse` / `ignition` / `cutoff`).
  `merger` and `collision` exist in the schema for the dormant modes only.
- **Error codes** (`{detail, code}`): 404 `spacecraft_not_found`, `mission_not_found`, `maneuver_not_found`, `body_not_found`;
  422 `orbit_invalid`, `maneuver_invalid`, `maneuver_in_past`, `maneuver_overlap`; 409 `simulation_halted`, `no_propulsion`,
  `burn_in_progress`, `body_limit`, `spacecraft_limit`, `maneuver_limit`, `mission_limit`, `mission_conflict`, `mission_committed`,
  `mission_over`, `mission_not_planned`, `plan_outdated`, `plan_in_progress`; 503 busy / step timeout.
- **`collisionMode`** on a universe summary is always `"stop-on-contact"`; a request may send only that value.

## 13. Rendering and trajectory visualisation

| Concern | Where |
|---|---|
| What the scene draws for spaceflight (pure function) | `frontend/src/sim/spaceflight/useSpaceflight.ts` → `buildSpaceflightScene(bodies, missions, trajectories, historyCache, showPaths, timeS)` returns a `SpaceflightSceneInput` |
| Conic of an osculating orbit, body-relative recorded path, planned path split per leg | `frontend/src/sim/spaceflight/orbitGeometry.ts` (`conicPoints`, `relativeRecordedPath`, `plannedPaths`) |
| Drawing | `frontend/src/components/canvas/SpaceflightLayer.tsx` (orbits, flown path, dashed planned path in `PLANNED_COLOR = '#c4b5fd'`, arrival label) and `SpacecraftMarker.tsx` (a screen-size diamond with a label, drawn without depth test so it is never hidden) |
| Contract types | `frontend/src/render/contract.ts` (`SpaceflightSceneInput`, `SpacecraftPathInput`, `PlannedTrajectoryInput`, `RelativePoint`) |
| Panels | `frontend/src/components/ui/SpacecraftPanel.tsx`, `ManeuverPanel.tsx`, `MissionPanel.tsx`, `SpacecraftInspector.tsx`, shared pieces in `flightUi.tsx` |
| Stop banner | `UniverseWorkspace.tsx`, `data-testid="halt-banner"` |

Rules that make the pictures correct:
- **Everything is drawn relative to a body**: a point is "present position of body X + stored offset". That keeps a lunar orbit a
  closed curve around the moving Moon and keeps a low orbit out of single-precision trouble in scene coordinates.
- **Three different lines, never mixed:** the *present orbit* is a conic computed from backend elements (two-body, instantaneous);
  the *flown path* is recorded history (what happened); the *planned path* is the planner's prediction (dashed, violet).
- Spacecraft get **no inertial trail** from the ordinary trajectory layer; `UniverseWorkspace.tsx` filters them out of `pathIds`.
- The mission preset (`MISSION_PRESET_ID = "earth-moon-j2000"`) opens framed whole and at 1,000 s per step.

## 14. Collision policy and the dormant collision implementation

**Policy (owner decision D-071): every collision stops the simulation.** When any two bodies touch, in any universe:
1. the whole system is put back to the instant of first contact (`refine_contact`), so the pair touches and does not overlap;
2. a `contact` event is recorded and the state carries `halt`;
3. further steps are refused (409 `simulation_halted`) until the user removes or edits one of the two, restores a snapshot or
   resets;
4. nothing else: no merge, no fragments, no debris, no record, no energy dissipated.

Implementation: `CollisionConfig.mode` (`backend/impact/config.py`) defaults to `DEFAULT_MODE = "stop-on-contact"`;
`SimulationService.DEFAULT_CONFIG = STOP_ON_CONTACT_CONFIG`; presets (`api_universes.create_preset_universe`), Orbit Lab
(`orbit_lab.py`) and API-created universes construct it explicitly. The halt logic is in `spaceflight/engine.py`:
`_flight_halt_contacts`, `_flight_halt_on`, `_flight_touching`, `_flight_stops`. Tests: `tests/test_collision_policy.py`,
`tests/impact/test_mode_defaults.py`, `tests/spaceflight/test_collision_stop.py`, `frontend/e2e/collision.real-backend.e2e.mjs`.

**Dormant, kept on purpose** (do not delete without the owner's decision, do not reconnect without it either):
- `backend/impact/` (the collision-outcome engine: merge, hit-and-run, fragments, debris parcels, materials, spin; about 4,300 lines)
  and `MergeResolver` in `backend/collisions.py` (the older immediate merge).
- Reachable only by naming `LEGACY_MERGE_CONFIG` or `OUTCOME_V1_CONFIG` (both in `backend/simulation.py`) in code.
- 858 tests in `tests/impact/` plus 67 cases elsewhere marked `@pytest.mark.dormant_collisions`. For a marked test,
  `tests/conftest.py` sets `SimulationService.DEFAULT_CONFIG` to `OUTCOME_V1_CONFIG`, the default those tests were written for.
- Frontend: `components/ui/CollisionInspector.tsx`, `components/canvas/CollisionEffectsLayer.tsx`, `DebrisParticles.tsx`,
  `SurfaceMarks.tsx`, `sim/collision/`. They render only for `collision` events, which nothing produces now.
- `tests/impact/test_contracts.py` enforces that only an allow-list of modules imports `backend.impact`. `backend/spaceflight/`
  is not on it and must stay off it (the halt code reaches `refine_contact` through `backend.simulation`, lazily).

## 15. The integrator step-collapse guard

**Symptom it fixes.** A universe using PRS23 (any universe with a spacecraft or moons) could not advance past a configuration
where a body's acceleration passes exactly through zero: two bodies closing head-on along the line through a third, or three
masses on a line. The step ran into the time limit and was rolled back, every time.

**Root cause** (REBOUND `src/integrator_ias15.c`): PRS23 steps with the smallest per-particle timescale
`tau² = 2|a|² / (|j|² + |a||s|)`. Near a zero of the acceleration with non-zero jerk, `tau` is simply the time left until the zero,
so every step covers about a quarter of the remaining time and the zero is never reached; the step shrinks without bound.

**Fix** (`backend/collisions.py`): `StepCollapseGuard` (`arm` before an integration, `beat` from the heartbeat after every
internal step, `release` after). When `|dt_last_done| < collapse_threshold(sim)` it sets the criterion to GLOBAL for
`GLOBAL_STEPS_AFTER_COLLAPSE = 32` steps, then back to PRS23. The threshold is `COLLAPSE_SAFETY = 1e-3` times the fastest
conceivable crossing of the smallest contact distance, and at least `COLLAPSE_TIME_ULPS = 64` ulp of the time variable.

**Why it is safe, and what must stay true:**
- Every step is still one a valid IAS15 error criterion asked for. No minimum step is imposed (REBOUND's `min_dt` was rejected for
  that reason). Do not replace the guard with a floor or a larger timeout.
- Above the threshold the guard does nothing, so existing trajectories are bit-identical. `svc._step_guard.fallbacks` counts
  hand-overs; it is 0 on the reference lunar mission, and a test asserts that.
- The planner's copies carry their own guard through `planner._Watch`.
- The step time limit remains the last line of defence. `tests/test_step_guard.py::test_watchdog_stops_a_genuinely_stalled_engine_
  and_rolls_back` disables the guard on purpose to have a stall for the watchdog to stop.

Tests: `tests/spaceflight/test_step_collapse.py` (reproduces the collapse on plain REBOUND, then through the application).

## 16. Architectural decisions that matter most

Full log: `context/DECISIONS.md` (append-only; D-001 … D-071). The ones to know before changing anything:

| Decision | Content |
|---|---|
| D-007, D-008, D-010 | REBOUND IAS15, SI units, one inertial right-handed frame, backend owns the state |
| D-021 | Reads never wait for a step; writes get 503 "busy" after a bounded wait |
| D-030 | Systems with moons use the PRS23 step criterion |
| D-053 | The canvas boundary: typed display inputs only (`render/contract.ts`, `canvasBoundary.test.ts`) |
| D-063 | Collision detection chunks steps by a curvature criterion |
| D-068 | Smooth playback: look-ahead steps drawn through an interpolating motion buffer |
| D-069 | The collision-engine repair checkpoint; collision physics paused |
| **D-070** | **Space Mission Design.** Spacecraft are particles of the universe's own simulation; a `SpaceflightBook` of immutable records copied with every checkpoint; impulsive burns at exact integration targets and finite burns as `additional_forces` with analytic mass; PRS23 for universes with a spacecraft; planner = patched-conic first guess + N-body shooting on a private copy, deliberately narrow; missions judged on the actual state; no integrator in the browser |
| **D-071** | **Owner decision.** Stop-on-contact for every universe; merge and outcome engines dormant, not deleted; the PRS23 step collapse root-caused and fixed with `StepCollapseGuard`; PR #27 retargeted to the checkpoint branch |

## 17. Tests: architecture, commands, expected results

**Prerequisites:** Python **3.11** (`.python-version`), Node **20** (`.nvmrc`), `npm ci` (never `npm install`).

```bash
# install (repository root)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -c backend/constraints.txt
cd frontend && npm ci && npx playwright install chromium && cd ..

# run the application (two terminals)
uvicorn backend.main:app --reload --port 8000        # GET http://127.0.0.1:8000/health
cd frontend && npm run dev                           # http://localhost:5173 (proxies /api and /healthz)

# everything required, in order, stopping at the first failure
python scripts/run_tests.py                          # add --extended for the three real-backend browser journeys

# the same checks one by one
python -m pytest                                     # backend: about 3.5 minutes
cd frontend
npm run typecheck && npm test && npm run build       # tsc, Vitest, production build
npm run test:e2e                                     # Playwright with a stubbed API (starts Vite on :5178)
npm run e2e:mission                                  # real backend :8014 + Vite :5186: the Earth-to-Moon journey
npm run e2e:collision                                # real backend :8012 + Vite :5184: a collision stops the simulation
npm run e2e                                          # Experiment 01 journey: KNOWN TO FAIL, see section 18
```

Targeted backend runs:
```bash
python -m pytest tests/spaceflight tests/validation/test_spaceflight_validation.py -s   # -s prints measured validation numbers
python -m pytest tests/test_collision_policy.py tests/spaceflight/test_step_collapse.py
python -m pytest -m dormant_collisions                                                   # the dormant merge/outcome behaviour
```

Environment variables: `PG_STEP_TIME_LIMIT_S` (default 10), `PG_PLAN_TIME_LIMIT_S` (default 25), `BACKEND_URL` (Vite proxy
target), `PW_CHROMIUM_PATH` (Playwright specs) and `E2E_CHROMIUM` (the three journeys) to point at an installed Chromium when
Playwright's pinned one is missing, `E2E_PYTHON`, `E2E_BACKEND_PORT`, `E2E_VITE_PORT`, `PG_UPDATE_EVIDENCE=1` (refresh committed
screenshots on purpose).

**Expected results at `62e96df`** (measured locally and identical in CI):

| Check | Expected |
|---|---|
| `python -m pytest` | **1724 passed, 2 xfailed** (1726 collected) |
| `npm run typecheck` | no output, exit 0 |
| `npm test` | **762 passed** in 76 files |
| `npm run build` | succeeds; a ">500 kB chunk" warning is normal |
| `npm run test:e2e` | **20 passed** |
| `npm run e2e:mission` | 9 `PASS` lines, then `ALL PASSED` |
| `npm run e2e:collision` | 10 `PASS` lines, then `ALL PASSED` |

`scripts/run_tests.py` checks the environment first and **refuses to run with a Node major other than 20**; on another Node, run
the commands one by one (they pass on Node 22).

**Where the tests are:**

| Subject | Location |
|---|---|
| Orbital mechanics (pure) | `tests/spaceflight/test_orbits.py` (36), `test_propulsion.py` (12) |
| Spacecraft and manoeuvres in the engine | `tests/spaceflight/test_engine_spacecraft.py` (49) |
| Missions and the planner | `tests/spaceflight/test_missions.py` (25) |
| Spaceflight API | `tests/spaceflight/test_api_spaceflight.py` (8) |
| Stop-on-contact | `tests/test_collision_policy.py` (17), `tests/spaceflight/test_collision_stop.py` (12), `tests/impact/test_mode_defaults.py` (20) |
| Regression tests for the defects an independent review found | `tests/spaceflight/test_review_fixes.py` (91) |
| Step-collapse guard | `tests/spaceflight/test_step_collapse.py` (8) |
| Scientific validation V1–V8 against independent references | `tests/validation/test_spaceflight_validation.py` (8) |
| Shared helpers | `tests/spaceflight/helpers.py` (`earth_service`, `earth_moon_service`, `add_craft`, `node`, `rel`) |
| Dormant collision engine | `tests/impact/` (858) and marker `dormant_collisions` (67 cases in 15 files) |
| Engine, API, presets, history, snapshots, Orbit Lab | `tests/test_*.py`, `tests/validation/`, `tests/smoke/test_live_server.py` (starts a real uvicorn) |
| Frontend unit and component tests | `frontend/src/**/*.test.ts(x)`; spaceflight: `sim/spaceflight/*.test.ts`, `api/parse.spaceflight.test.ts`, `components/ui/missionDesign.test.tsx`, `sim/useSimulation.halt.test.tsx` |
| Browser, stubbed API | `frontend/e2e/*.spec.ts` (mission design: `mission-design.spec.ts`) |
| Browser, real backend | `frontend/e2e/mission.real-backend.e2e.mjs`, `collision.real-backend.e2e.mjs`, `experiment01.e2e.mjs` |

**CI** (`.github/workflows/ci.yml`, on every pull request and on pushes to `main`): `Backend (pytest)`, `Frontend (tsc, vitest,
build)`, `Browser E2E (Playwright)`, `Mission journey (real backend, browser)`. All four were green on `62e96df`.

**Conventions for new tests:** expected values come from closed forms or an independent implementation, never from the code under
test; tolerances are derived and stated; a test must not depend on machine speed (inject a clock, as
`test_the_time_budget_also_covers_the_work_before_the_first_trial_flight` does); body ids are random per engine, so never assert
an id or an ordering that depends on one.

## 18. Known limitations and technical debt

**These are not regressions. Do not "fix" them by accident, and do not report them as new.**

| Item | Detail |
|---|---|
| Intermittent test in dormant code | `tests/impact/test_product_materials.py::test_a_parcel_hitting_a_same_material_spinning_body_keeps_the_bodys_material_and_spin_and_links_the_event` fails in roughly one run in ten, also on the untouched checkpoint `75abe67`. Cause: body ids are random and seed the debris realisation; sometimes the targeted parcel meets another fragment first and the test requires exactly one event. Proposed fix (not applied; owner's decision): select the event that involves both the hunter and the parcel instead of requiring a single parcel event. It can turn the backend CI job red by itself. |
| Experiment 01 browser journey | `npm run e2e` fails at "timed out waiting for the reference path to add pixels" on `main` too (ENGINEERING_STATUS §13). Not part of CI. Cause not established. |
| Gravity-only model | No atmosphere or drag, no J2, no radiation pressure, no relativity, no tides. A low orbit never decays and its plane never precesses. |
| Inclination reference | The simulation's x-y plane (ecliptic in presets), not a planet's equator. |
| Earth–Moon preset has no Sun | Measured: the Sun moves a lunar arrival by about 317 km. A plan made there is a plan for that two-body universe. |
| One transfer geometry | Planet parking orbit → that planet's moon. No plane change, no mid-course correction, no return leg. Transfers faster than the fastest ellipse (about two days to the Moon) are refused. |
| Manoeuvre preview | Two-body about the reference body (labelled so in the UI); mission plans are N-body. |
| Mission design in the full Solar System presets | Verified by script only. |
| Collisions | A collision only stops the simulation; the simulator cannot show what a collision does. |
| Visual verification | Headless software WebGL screenshots only; never checked on a GPU or by eye on a display. |
| Persistence | None. A backend restart loses every universe. |
| Planner copies | Collisions are off in the planner's copies, so two bodies that would touch in the live universe can pass through each other's centre there; such a design ends at its time budget with that reason. |
| Step-collapse threshold | Rests on a physical bound and on the suites staying bit-identical, not on a proof. If a healthy system ever stepped below it the cost would be speed, not accuracy. |
| Dormant code | About 4,300 lines of collision engine and its tests are carried but unused. Owner decision open: delete or keep. |
| `scripts/run_tests.py` | Requires Node 20 exactly. |
| Stale documents | `context/HANDOFF.md`, `STATUS.md`, `TASKS.md`, `WORKLOG.md` and the collision plans describe earlier phases. |
| Collision-effect timing (M2 of D-069) | In dormant code now; documented there. |
| Bundle size | The production build is one chunk above 500 kB. |

## 19. Git state and merge sequence

| Item | Value |
|---|---|
| Repository | `aarithooda/playing-god` (GitHub, public), default branch `main` |
| `main` | `df7c435` (merge of PR #26, smooth playback) |
| Checkpoint | `checkpoint/collision-engine-repair-2026-10-28` at `75abe67` = `main` + one commit (collision-engine repair, D-069). **Not merged into `main`. Must not be deleted.** |
| Feature branch | `claude/clever-curie-d7sf4k` = the checkpoint + the mission-design commits listed below + the commit that adds this file |
| Pull request | **#27**, <https://github.com/aarithooda/playing-god/pull/27>, open, **base `checkpoint/collision-engine-repair-2026-10-28`**, head `claude/clever-curie-d7sf4k`, not merged, CI green |

Commits on the feature branch after the checkpoint, oldest first:
`56cb6fb` backend feature · `d92200d` backend tests · `2209267` frontend wire layer · `afdee7b` mission design UI · `f715d76`
real-backend journey · `29bf056` frontend tests · `0c1b99a` docs, runner, CI job · `bfb4d1e` fixes for the independent review ·
`359a828`, `bd7fb87` docs · `5542fc1` test fix · `6e6ad7b` stop-on-contact everywhere and the step-collapse guard · `62e96df` docs
(D-071) · then this handoff document.

**Merge sequence (the owner's actions, not an agent's):**
1. Review and merge PR #27 into the checkpoint branch. That moves the checkpoint branch forward; if the checkpoint must stay a
   fixed marker, tag `75abe67` first.
2. Open a pull request from the checkpoint branch to `main` (it will carry D-069 and the mission-design work together) and merge
   it when ready. Nothing in this repository depends on that order being fast.
3. Start the next phase from the result on a new feature branch.

An agent continuing before step 1 is done should branch from `claude/clever-curie-d7sf4k`, not from `main`: `main` has neither
the checkpoint nor the mission-design work.

## 20. Before you modify a subsystem

| If you are changing… | Read first | Then run |
|---|---|---|
| Orbital maths | `backend/spaceflight/orbits.py`, `SPACE_MISSION_DESIGN.md` §3, §5.1 | `tests/spaceflight/test_orbits.py`, `tests/validation/test_spaceflight_validation.py` |
| Burns | `backend/spaceflight/dynamics.py`, `propulsion.py`, `engine.py` from `_flight_execute` to `_flight_advance` | `test_engine_spacecraft.py`, `test_review_fixes.py`, V3 and V4 of the validation file |
| The planner | `backend/spaceflight/planner.py` whole, `SPACE_MISSION_DESIGN.md` §5.6 | `test_missions.py`, V5–V8, `npm run e2e:mission` |
| Mission rules | `backend/spaceflight/missions.py` | `test_missions.py`, `test_review_fixes.py` |
| Engine state, steps, snapshots | `backend/simulation.py` (`_init_state`, `_checkpoint`, `_capture`, `_take_snapshot`, `step`, `_advance_to`) | `tests/test_simulation_service.py`, `test_snapshots.py`, `test_step_guard.py`, then everything |
| Collision handling | Section 14 of this file, `engine.py` `_flight_halt_*`, `backend/impact/config.py` | `tests/test_collision_policy.py`, `tests/impact/test_mode_defaults.py`, `npm run e2e:collision` |
| Integrator selection or the guard | `backend/collisions.py` top half, Section 15 | `tests/spaceflight/test_step_collapse.py`, `tests/test_step_guard.py`, `tests/validation/test_preset_moons.py`, then everything |
| An API field | The pydantic model, `frontend/src/api/types.ts`, `parse.ts`, `viewModel.ts`, fixtures | `parse*.test.ts`, the API tests, `npm run typecheck` |
| The canvas | `frontend/src/render/contract.ts`, `components/canvas/canvasBoundary.test.ts` | `npm test`, `npm run test:e2e` |
| Mission UI | `UniverseWorkspace.tsx`, `components/ui/MissionPanel.tsx`, `flightUi.tsx`, `sim/spaceflight/useSpaceflight.ts` | `missionDesign.test.tsx`, `e2e/mission-design.spec.ts`, `npm run e2e:mission` |
| A preset | `backend/presets/loader.py`, `context/PRESETS.md` | `tests/test_presets_api.py`, `tests/validation/test_preset_*.py` |

**Assumptions that must not be violated:**
1. The backend is the only integrator. The frontend draws conics from backend elements and never propagates a state.
2. A spacecraft is a particle of the universe's simulation. No second propagator for the "real" trajectory.
3. Planned, flown and present-orbit lines are three different things and are never presented as one another.
4. A mission is judged on the simulated state, never on the fact that a burn executed.
5. A collision stops the simulation and changes nothing else. Do not reconnect merging or fragmentation without the owner.
6. Every per-universe state lives in a table that is copied by checkpoint, capture, snapshot and reset.
7. Anything the planner predicts is flown with the same burn code as the engine (`_Flyer` uses `plan_impulse`, `burn_window`,
   `ThrustForce`), so plan and flight cannot drift apart by construction.
8. `orbit_about` and every other function on the publish path must not raise.
9. Published state is immutable; mutation results are built under the lock (`_flight_mission_now`), not read back afterwards.
10. `backend/spaceflight/` does not import `backend.impact`; canvas files do not import the API client.
11. Unsupported requests are refused with a reason. Nothing is approximated silently.

## 21. Recommended next phase: Scientific Exploration (pillar 3)

The owner's definition: understanding the mathematics and physics behind the simulation; inspecting equations and calculations;
experimenting with physical parameters; understanding why simulated outcomes occur. Nothing of this pillar is implemented. What
follows is a recommendation, not a decision; confirm scope with the owner before building.

**What already exists to build on** (so the pillar extends the simulation instead of standing beside it):
- `backend/diagnostics.py`: total mass, momentum, kinetic and potential energy, angular momentum, published with every state.
- `OrbitOut` on every spacecraft: the full set of osculating elements, energies, periods, speeds and the sphere of influence.
- Mission `plan`: patched-conic and Hohmann reference figures next to the N-body result, and per-node `agreement`.
- `backend/history.py` and `GET …/history`: recorded positions over time.
- Orbit Lab (`backend/orbit_lab.py`, `frontend/src/components/ui/OrbitLabPanel.tsx`, `ComparisonPanel.tsx`): a baseline and a
  modified run compared against an independent Kepler reference. It is the existing pattern for "change one parameter and see why
  the outcome differs".
- `docs/SPACE_MISSION_DESIGN.md` §5: the equations as implemented, already written down.

**Suggested first increments, smallest first:**
1. *Show the calculation.* For a quantity the UI already displays (orbital period, vis-viva speed, burn propellant, sphere of
   influence), expose the formula, the inputs with units and the substituted numbers. Compute the breakdown in the backend, next to
   the value, so the explanation and the number cannot disagree.
2. *Conservation over time.* Plot energy, momentum and angular momentum against simulated time from recorded history, with the
   expected behaviour stated (conserved under gravity; a burn changes them by a known amount).
3. *Why did this happen.* For a finished mission, lay out the chain: plan → each burn's predicted and actual state → the orbit
   checks, with the numbers already in `agreement`, `checks` and `outcome`.
4. *Parameter experiments.* Generalise the Orbit Lab pattern beyond Experiment 01: fork a universe, change one parameter, compare.

**Constraints to carry over:** every explanation must come from the same numbers the simulation uses; anything two-body must be
labelled as such next to N-body results; no new integrator; validate the new numbers against independent references; and do not
start the AI assistant pillar.

## 22. Context that lives outside the repository

- **Pull request #27** carries a description with the same verification tables as `ENGINEERING_STATUS.md` §15 and one comment
  explaining the intermittent test of section 18 with the proposed one-line fix.
- **Screenshots** of the mission journey are committed in `docs/evidence/space-mission-design/`.
- **The independent review** that found fifteen backend defects was done with throw-away reproduction scripts that are not in the
  repository; each fixed defect is reproduced by a test in `tests/spaceflight/test_review_fixes.py`, whose docstrings quote the
  finding.
- **The owner's task briefs** are not in the repository. Their durable content is in section 1 of this file, in D-070 and D-071,
  and in the definition of the four pillars above.
- **Open owner decisions:** delete or keep the dormant collision code; apply or not the fix for the intermittent test; when to
  merge PR #27 and bring the checkpoint to `main`; the scope of pillar 3.
