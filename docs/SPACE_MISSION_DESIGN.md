# Space Mission Design

The second pillar of Playing God: spacecraft that fly inside the same N-body simulation as the planets and moons, with orbits set
from classical elements, manoeuvres that change the simulated state, and missions that are designed, shown as a proposal, flown, and
judged on what the simulation actually did.

This document is the reference for the feature: how to use it, how it is built, the physics and its assumptions, what was verified
and to what tolerance, and what is not implemented. Decision record: D-070 in [`context/DECISIONS.md`](../context/DECISIONS.md).
Endpoint contract: the "Space Mission Design" section of [`context/API_CONTRACT.md`](../context/API_CONTRACT.md).

**Maturity.** Implemented and verified for the cases listed in section 7. The supported mission is deliberately narrow (one
transfer geometry, section 5.6); everything outside it is refused with a reason rather than approximated. The simulation is point-mass
Newtonian gravity: no atmosphere, no oblateness (J2), no solar radiation pressure, no attitude dynamics.

## 1. Using it

Open the **Missions** tool in the left rail. It has three sections: Spacecraft, Manoeuvres and Missions.

1. **Create a spacecraft.** "New spacecraft…" asks for a name, dry mass, propellant, thrust and specific impulse, and an orbit about a
   body of the universe: periapsis altitude (or semi-major axis), eccentricity, inclination, longitude of the ascending node,
   argument of periapsis and true anomaly, or "match the plane of" another body (useful for a lunar transfer: the parking orbit is
   placed in the Moon's orbit plane). The form shows a **preview computed by the backend** (speed, period, periapsis and apoapsis
   altitudes, warnings such as "periapsis is below the surface") before anything is created.
2. **Inspect it.** Selecting a spacecraft opens the Spacecraft Inspector: the body it is orbiting now, altitude, speed, the osculating
   elements about that body, masses, propellant gauge, remaining delta-v, and its manoeuvre nodes. In the scene a spacecraft is a
   diamond marker with a label (never a sphere), with its present orbit drawn about the body it is orbiting.
3. **Plan a manoeuvre.** Choose when (now, after a delay, at the next periapsis or apoapsis, or at a time), the components
   (prograde / normal / radial-out, in m/s; negative values are retrograde / anti-normal / radial-in), and the mode: **impulsive** or
   **finite** (constant thrust for the duration the rocket equation gives). The panel previews the orbit after the burn, the
   propellant it needs and whether the craft has it. "Burn now" / "Add node" schedules it; the simulation executes it when its time
   comes, and the node then shows what was delivered.
4. **Design a mission.** "New mission…" picks the spacecraft, the destination and the objective (an orbit of given periapsis and
   apoapsis altitude, prograde or retrograde, or a flyby at a given altitude). "Design transfer" asks the backend for a plan. The
   result is a **proposal**: delta-v per burn, propellant, flight time, the predicted orbit, and a dashed violet path in the scene.
   Nothing is scheduled and the simulation is untouched.
5. **Fly it.** "Commit plan" schedules the plan's burns as ordinary manoeuvre nodes. Press Play (or "Run the simulation"). The
   mission status moves through *Planned · scheduled*, *In progress* (departure burn, coasting, insertion burn, in the destination's
   orbit), and ends *Completed* or *Failed*, with the list of conditions that were checked on the actual state and the measured
   difference between the plan and the simulation at each burn.

The preset **Earth and Moon: mission design** (Universes drawer) is the reference scenario: Earth and the Moon at J2000.0 from
archived JPL Horizons data, with the stop-on-contact collision policy.

Screenshots of this journey, taken by the automated browser test against the real backend, are in
[`docs/evidence/space-mission-design/`](evidence/space-mission-design/).

## 2. Architecture

```
backend/spaceflight/
  orbits.py       two-body mathematics (pure functions, no REBOUND): elements <-> state, Kepler's equation, vis-viva, Hohmann, SOI, VNB
  propulsion.py   rocket equation, exhaust velocity, mass flow, burn duration
  craft.py        the records: Spacecraft, Maneuver, Mission, Halt, and SpaceflightBook (one per universe)
  dynamics.py     burns on a REBOUND simulation (impulse arithmetic, the finite-thrust force), body hierarchy and spheres of influence
  planner.py      transfer design: patched-conic first guess, then N-body shooting on a private copy of the universe
  missions.py     mission state machine: judges a mission on the actual simulated state
  engine.py       SpaceflightMixin: the part of SimulationService that owns spacecraft, nodes, missions and the collision halt
  schemas.py requests.py   response and request models
backend/api_spaceflight.py  routes under /api/v1/universes/{id}
frontend/src/sim/spaceflight/        formatting, conic geometry, the scene description, the useSpaceflight hook
frontend/src/components/canvas/      SpacecraftMarker, SpaceflightLayer (orbits, flown path, planned path)
frontend/src/components/ui/          SpacecraftPanel, ManeuverPanel, MissionPanel, SpacecraftInspector
```

**One simulation.** A spacecraft is a particle of the universe's own REBOUND simulation, named `craft-<12 hex>`, integrated by the
same IAS15 integrator in the same `integrate` call as every other body. There is no second propagator for the "real" trajectory: what
the user watches, what the mission is judged on, and what the planner predicted all come from N-body integration of the same
system. Its gravitational mass is dry mass + propellant (it pulls on the planets as any particle does; the effect is negligible but
not removed).

**A spacecraft is not a planet.** In the data model a body with `kind: "spacecraft"` / `bodyType: "spacecraft"` always carries a
`spacecraft` object (dry mass, propellant, thrust, specific impulse, remaining delta-v, the body it is orbiting, osculating
elements), and the two are validated together (a planet cannot carry it; a spacecraft cannot lack it). Its mass can only be changed
through its dry mass and propellant. In the UI it has its own marker, inspector, list and tool.

**The spaceflight book.** Everything the simulation does not hold as a particle (propellant split, engine, manoeuvre nodes,
missions, the halt) lives in one `SpaceflightBook` per universe, made of immutable records. The engine copies it wherever it copies
its other side tables: the transactional capture of every step (so a failed or timed-out step restores it), every mutation
checkpoint, snapshots, reset, and the replay digest. Pause, resume, step size, reset, snapshots and universe switching therefore
need no special handling.

**Burn scheduling.** A step is split at every pending node time: the engine integrates exactly to the node, executes it, and
continues. An impulsive node changes the particle's velocity and mass at that instant. A finite burn installs a thrust force from
ignition to cut-off (section 5.4); both ends are integration targets, so a burn does not depend on the step size the user chose, and
it continues across steps. A zero delta-v node is an observation: the engine lands on it and records the state.

**Planning does not block the simulation.** `plan_mission` copies the REBOUND simulation under the engine lock, releases the lock,
designs the transfer on the copy (bounded by `PG_PLAN_TIME_LIMIT_S`, default 25 s), then stores the plan only if the universe has not
changed in the meantime (otherwise 409 `plan_outdated`). One design runs at a time per universe (409 `plan_in_progress`), and a
departure may be asked for at most two revolutions of the destination ahead, so no request can occupy a worker for long.

**Frontend.** The frontend still has no integrator. Orbits are drawn as conics from the elements the backend reports; the flown path
is the recorded positions; the planned path is the planner's samples (`GET .../missions/{id}/trajectory`). All three are drawn
**relative to a body** (the present position of the body plus the recorded offset), so a lunar orbit stays a closed curve around the
moving Moon instead of a spiral, and a low orbit is not lost in single-precision scene coordinates. The canvas receives one new
prop, `spaceflight` (types in `frontend/src/render/contract.ts`).

## 3. Conventions

- **Units:** SI in every field and every function (m, m/s, kg, s, N); angles are radians inside the backend and degrees in the API
  (`...Deg`). `g0 = 9.80665 m/s²` (exact, by definition). `G = 6.67430e-11` (the simulation's value).
- **Frame:** the simulation's one inertial, right-handed Cartesian frame. Orbital elements are measured from its **x-y plane and x
  axis**. In the J2000 presets that plane is the **ecliptic**, not a planet's equator: an "inclination 51.6°" orbit about Earth is
  inclined to the ecliptic. The UI says so next to the field.
- **Elements:** semi-major axis `a` (negative for a hyperbola), eccentricity `e`, inclination `i` ∈ [0, π], longitude of the
  ascending node `Ω`, argument of periapsis `ω`, true anomaly `ν`. Singular cases follow Vallado's conventions: equatorial orbit
  `Ω = 0` and `ω` measured from x; circular orbit `ω = 0` and `ν` measured from the node (or from x if also equatorial). Exactly
  parabolic orbits (`e = 1`) are refused.
- **Manoeuvre frame (VNB) about a reference body:** `V = v̂` (prograde), `N = ĥ = (r × v)/|r × v|` (orbit normal), `B = V × N`
  (radial-out for a circular orbit; in general perpendicular to the velocity in the orbit plane, pointing away from the body).
- **Reference body of a craft:** the innermost body whose sphere of influence contains it (section 5.5), computed from the present
  state at every read. It is a description, not a dynamical switch: gravity from every body always acts.

## 4. API and state

Routes (all under `/api/v1/universes/{id}`; mutations take the usual `?activationEpoch=` guard):

| Route | Purpose |
|---|---|
| `POST /spacecraft` | create (orbit from elements, or a state vector) → 201 `{body, warnings}` |
| `POST /spacecraft/orbit-preview` | what an orbit request would give; creates nothing |
| `PATCH /spacecraft/{craftId}` | dry mass, propellant, thrust, specific impulse |
| `POST /spacecraft/{craftId}/maneuvers` | schedule a manoeuvre node → 201 |
| `POST /spacecraft/{craftId}/maneuvers/preview` | the orbit after a manoeuvre (two-body about the reference body); changes nothing |
| `DELETE /maneuvers/{id}` | remove a pending node |
| `POST /missions` · `POST /missions/{id}/plan` · `/commit` · `/abort` · `DELETE /missions/{id}` | mission workflow |
| `GET /missions/{id}/trajectory` | the planned path (samples relative to origin and destination) |

`SimulationState` gains two optional keys, absent when there is nothing to say: `spaceflight` (`maneuvers`, `missions`) and `halt`.
Events gain `maneuver` (a node executed or failed) and `contact` (the simulation stopped at a collision). A step that stops at a
contact carries the warning `collision_stopped`. Error codes are listed in `context/API_CONTRACT.md`.

## 5. Physics

### 5.1 Two-body relations (`orbits.py`)
With `μ = G(M + m)`:
- circular speed `v = √(μ/r)`; escape speed `√(2μ/r)`; vis-viva `v² = μ(2/r − 1/a)`; period `T = 2π√(a³/μ)`;
- elements → state through the perifocal frame: `r = p/(1 + e cos ν)`, `p = a(1 − e²)`,
  `r_pf = r(cos ν, sin ν, 0)`, `v_pf = √(μ/p)(−sin ν, e + cos ν, 0)`, rotated by `R3(−Ω) R1(−i) R3(−ω)`;
- state → elements from `h = r × v`, the node vector `n = ẑ × h` and the eccentricity vector `e = (v × h)/μ − r̂`;
- Kepler's equation `M = E − e sin E` (Newton iteration with a bisection safeguard) and its hyperbolic form `M = e sinh H − H`;
- Hohmann transfer between circular radii `r1`, `r2`: `a_t = (r1 + r2)/2`, `Δv1 = √(μ/r1)(√(2r2/(r1 + r2)) − 1)`,
  `Δv2 = √(μ/r2)(1 − √(2r1/(r1 + r2)))`, time `π√(a_t³/μ)`.

### 5.2 Propulsion (`propulsion.py`)
Exhaust velocity `v_e = Isp · g0`; mass flow `ṁ = F/v_e`; Tsiolkovsky `Δv = v_e ln(m0/m1)`, so a burn of `Δv` from mass `m0` uses
`m0(1 − e^(−Δv/v_e))` of propellant. A craft with `Isp = 0` has no engine and cannot manoeuvre; a finite burn also needs `F > 0`.

### 5.3 Impulsive burn
At the node time the craft's velocity changes by the commanded vector and its mass drops by the rocket-equation propellant. If the
propellant on board gives less than the commanded delta-v, the burn delivers what it can, in the commanded direction, and the node is
marked failed with the shortfall. An impulsive burn is the standard idealisation of a burn much shorter than the orbital period; it
is not a claim that the engine has infinite thrust, and the craft's `thrustN` is not used by it.

### 5.4 Finite burn
From ignition `t0` to cut-off, the force `F` along the burn direction is added to the craft in REBOUND's force evaluation
(`additional_forces`). The mass is the analytic `m(t) = m0 − ṁ(t − t0)`, evaluated at the integrator's own sub-step times, so the
acceleration `F/m(t)` is integrated to IAS15's precision with no fixed sub-stepping and no separate mass integration. The direction
is either fixed in inertial space or follows the craft's VNB frame about its reference body (recomputed at every force evaluation;
the integrator is told the force is velocity dependent). The duration is the one that delivers the commanded delta-v:
`Δt = m0(1 − e^(−Δv/v_e))/ṁ`, shortened if the propellant runs out. A centred burn starts `Δt/2` before the node. Thrust, mass flow,
specific impulse and mass are therefore consistent by construction: the propellant used is exactly `ṁ Δt` and the delivered delta-v
is exactly `v_e ln(m0/m1)`. The exhaust is not simulated: thrust is an external force, and the system's total momentum changes by the
impulse delivered. One burn per craft at a time: overlapping nodes are refused when scheduled, and a node that comes due while the
engine is still burning for another fails. If the reference body of a VNB burn stops existing during the burn (it merged into
another body), the engine is shut down at that moment and the node fails with the propellant and delta-v it actually delivered.

### 5.5 Hierarchy and spheres of influence (`dynamics.py`)
A body's parent is the nearest heavier body whose Hill sphere `r_H = d (m/3M)^(1/3)` contains it (so the Moon belongs to the Earth
although the Sun pulls harder on it); failing that, the heavier body that attracts it most. Its sphere of influence is Laplace's
`r_SOI = d (m/M)^(2/5)`, with `d` the present distance to the parent. These are used for **description and decision only**: which
body an orbit is reported about, when a mission is "in the destination's sphere of influence", and the first guess of the planner.
They never switch gravity on or off.

### 5.6 Transfer design (`planner.py`)
Supported geometry, checked before any computation: the craft is in a near-circular (`e < 0.02`), prograde parking orbit about a
body P, well inside (`r < 0.5 d`) the orbit of the destination D, and D's parent is P. In short: **planet → its moon** (Earth →
Moon; Jupiter → Ganymede; ...). Anything else (interplanetary, moon → planet, between moons, from an eccentric orbit, to the body
already being orbited) returns `unsupported` with the reason.

1. **Patched-conic estimate** (labelled as an estimate in the plan). A transfer ellipse from the parking radius whose apoapsis lies
   beyond the destination's distance by twice the wanted hyperbolic impact parameter (so the craft passes on the side that gives the
   requested prograde or retrograde orbit), or, if a flight time is requested, the ellipse that reaches the destination's distance in
   that time. This gives the departure delta-v and an estimate of where on the parking orbit to burn.
2. **N-body targeting.** On a private copy of the universe's REBOUND simulation (collisions off, same burn code as the live
   engine), the departure time is varied until the **signed periapsis radius** at the destination equals the target (positive for a
   prograde pass, negative for retrograde). The planner scans outward from the estimate (±40° of parking-orbit phase in 2° steps) for
   a sign change, then closes with regula falsi (Illinois) to 1 m. Each trial is a full N-body flight. In universes of more than six
   bodies the bracketing uses a reduced model (craft, origin, destination and the origin's ancestors) and the refinement uses the full
   system.
3. **Finite burns.** If the craft's engine makes the departure burn long, the delta-v and the apse line are corrected for gravity
   loss by re-flying with the finite burn until the same periapsis is reached.
4. **Insertion.** At the predicted periapsis the retrograde delta-v is the difference between the arrival speed and the speed of the
   target orbit at its periapsis (vis-viva about the destination). A flyby has no insertion; it has an observation node at periapsis.
5. **Prediction.** The whole plan is flown once more on the copy, for two revolutions of the target orbit, to record the predicted
   path and the predicted state before each burn. Those predicted states are what the simulation is later compared against.

The plan states its model (`n-body-shooting`), the patched-conic and Hohmann reference figures beside the N-body ones, the number of
trial flights, and any warnings (for example: propellant does not cover the plan).

### 5.7 Mission status (`missions.py`)
Evaluated after every committed step, on the craft's actual state:
- **Completed (orbit):** the orbit about the destination is bound, clear of the surface, its periapsis and apoapsis are within the
  objective's tolerance (default 50 km) of the target, its apoapsis is inside the destination's sphere of influence, and all of
  this has held for one full revolution since the insertion burn. Reaching the Moon is not success; neither is a burn that was
  merely executed.
- **Completed (flyby):** at the observation node (the planned time of closest approach) the osculating periapsis about the
  destination is within tolerance of the target altitude **and** the craft is at that altitude. Being aimed correctly but early or
  late is a failure.
- **Failed:** a burn of the mission failed (out of propellant, craft removed), the craft collided, the craft left the destination's
  sphere of influence unbound after the insertion, the orbit that resulted does not meet the conditions, or the user aborted.
- **Plan-versus-simulation agreement:** at each node, the distance between the planned and the actual pre-burn state, against
  explicit tolerances of **1 km** and **1 m/s**. Exceeding them is reported on the mission; it does not by itself fail it (the
  outcome is always judged on the actual orbit).
- A committed plan whose universe is edited before departure (a body added, removed or changed) is flagged as outdated.

### 5.8 Numerical method
IAS15 (Rein & Spiegel 2015): 15th-order Gauss-Radau with adaptive steps. With a spacecraft in low orbit next to slow planets,
REBOUND's default global step criterion collapses the step (measured: about a million steps for one simulated day); the engine
therefore selects the PRS23 criterion (Pham, Rein & Spiegel 2023) for any universe that holds a spacecraft, as it already did for
universes with moons. Burn boundaries restart the integrator's predictor.

## 6. Collision policy of this phase

When two bodies touch: **stop, report, keep a consistent state.** Implemented as a third per-universe collision mode,
`stop-on-contact`, and additionally enforced for **every contact that involves a spacecraft, in every mode** (a spacecraft is never
merged into a planet or fed to the collision-outcome models).

- The whole system is put back to the instant of first contact (the existing contact refinement), so the stored state is one
  consistent instant of the simulation, not a mixture.
- A `contact` event is recorded (who, when, relative speed) and the state carries `halt`. The UI shows a banner and disables Play.
- Further steps are refused (409 `simulation_halted`) until the user resets, restores a snapshot, or removes or edits one of the two
  bodies. A halt cannot be left by stepping while the bodies still overlap.
- No fragments, debris, craters or effects are produced. `backend/impact/` is not modified by this work apart from the mode name.

**What uses it.** The mission preset uses `stop-on-contact` for all bodies. Existing universes keep their existing modes for
collisions between celestial bodies (sandbox: `outcome-v1`; other presets and Orbit Lab: `legacy-merge`), because existing tests and
decisions (D-045, D-060, D-067) pin that behaviour and this task forbids weakening them. Making stop-on-contact the default for
every universe is a one-line policy change plus the corresponding test updates; it is left to the owner (D-070).

## 7. Verification

All figures below are measured by the test suite on this branch (`tests/validation/test_spaceflight_validation.py`, run with the
application's own engine unless stated). The independent references are written in the tests themselves: closed-form two-body
results, a separate Kepler propagator, and a fixed-step RK4 integrator that shares no code with REBOUND.

| # | Check | Reference | Result | Tolerance asserted |
|---|---|---|---|---|
| V1 | 400 km circular Earth orbit: speed, period, closure | `√(μ/r)`, `2π√(a³/μ)` | 7672.594 m/s, 5544.865 s; returns to start within 1e-3 m after one period | 1e-12 relative; 1e-3 m |
| V2 | Unforced eccentric orbit (e = 0.74), 100 revolutions | independent Kepler propagation | worst position error 8.1e-5 m; energy drift 1e-15 | 1 m; 1e-12 |
| V3 | Hohmann transfer 400 km → 35,786 km, impulsive | closed form | Δv 2427.652 and 1467.572 m/s; final `a − r` = 0.000 m, e = 0 | 50 m on `a`; e < 1e-5; masses 1e-12 relative |
| V4 | Finite burn, 139.2 s, tangential | independent RK4 with variable mass | 6.8e-8 m, 5.5e-11 m/s | 1e-2 m; 1e-5 m/s |
| V5 | Earth → Moon plan (preset, 300 km parking → 100 km lunar orbit) | patched-conic ranges | departure 3115.02 m/s, insertion 815.66 m/s, flight 3.984 d | departure within 1e-4 of the Hohmann figure to the aimed apoapsis; 3.05–3.2 km/s; 0.75–0.9 km/s; 3.5–5.5 d; predicted periapsis altitude within 1 m |
| V6 | Translunar coast, 2.96 d, 353,574 km | independent RK4 three-body | 0.08 m (the RK4's own step-halving error: 1.19 m) | 100 m (reference self-convergence < 20 m) |
| V7 | Plan vs simulation, and the outcome | the plan's predicted states; orbit recomputed from state vectors | departure 3.4e-9 m / 3.7e-12 m/s; insertion 3.0e-5 m / 1.8e-8 m/s; actual lunar orbit 99.992 × 100.087 km, e = 2.6e-5, period 7067.7 s; five more revolutions stay within 99.996–100.081 km | test: 1e-2 m and 1e-5 m/s at each node, altitudes ±500 m, later revolutions 99–101 km; product tolerance: 1 km, 1 m/s, ±50 km |
| V8 | The same departure flown with the Sun present | – | closest approach 2155 km from the Moon's centre instead of 1837 km | reported, not a pass/fail on accuracy |

Reading these honestly:
- V1–V4 and V6 show the propagation and the burn arithmetic agree with independent calculations to far better than any user-visible
  quantity. They validate **this code**, not the fidelity of the model to the real Solar System.
- V7's plan/simulation agreement is tiny because the planner and the simulation integrate the same system with the same integrator.
  It demonstrates that the plan shown is the trajectory flown, not that either matches reality.
- V8 is the model limitation in numbers: the mission preset has no Sun, and the Sun moves a lunar arrival by about 300 km. A plan
  designed in the Earth-Moon preset is not a plan for the full Solar System. Planned **in** the 21-body
  `solar-system-moons-j2000` preset, the same mission also completes (script check, not in the test suite and not through the UI:
  plan 1.2 s, departure 3115.40 m/s, insertion 817.40 m/s, orbit 99.98 × 100.09 km).
- The published figures for real lunar missions (translunar injection about 3.1 km/s, lunar orbit insertion about 0.8–0.9 km/s,
  three to four days) are consistent with V5; that is a plausibility check, not a validation against flight data.

Other automated tests: `tests/spaceflight/` (orbits, propulsion, engine integration, collision stop, missions, API) and the frontend
suites (`frontend/src/sim/spaceflight/*.test.ts`, `src/api/parse.spaceflight.test.ts`, `src/components/ui/missionDesign.test.tsx`,
`src/sim/useSimulation.halt.test.tsx`, `e2e/mission-design.spec.ts`). The end-to-end journey
`frontend/e2e/mission.real-backend.e2e.mjs` (`npm run e2e:mission`) starts the real backend and the real UI in a browser and performs
the whole workflow of section 1, recomputing the final lunar orbit from the state vectors the API returns; it then sends a spacecraft
into the Earth and checks the halt. Counts and results of the last full run are in `docs/ENGINEERING_STATUS.md` §15.

## 8. Assumptions and limitations

- **Gravity only, point masses.** No atmosphere or drag (a 200 km orbit never decays), no J2 (no nodal regression: a real 51.6°
  orbit's plane precesses about 5° per day; here it does not), no solar radiation pressure, no relativity, no tides.
- **The reference plane is the simulation's x-y plane** (the ecliptic in the presets), not the central body's equator. Bodies have no
  spin axis in this model, so "equatorial" and "polar" orbits in the planetary sense cannot be specified.
- **Surfaces are spheres** of the body's radius; "impact" means the centre-to-centre distance reached the sum of the radii. A
  spacecraft has a nominal radius of 5 m.
- **Engine model:** constant thrust and specific impulse, instant start and stop, perfect pointing, no throttling, no staging, no
  ullage or boil-off, one engine. Impulsive burns ignore thrust.
- **Transfer planner:** only the geometry of section 5.6; one departure burn and one insertion burn; no plane change (the parking
  orbit should be in or near the destination's orbit plane: "match the plane of" does this; an inclined parking orbit is handled by
  the N-body targeting only as far as a solution exists within the scan); no mid-course corrections; no free-return, low-energy or
  multi-revolution transfers; no launch from the surface; no landing; no rendezvous or docking; no return leg.
- **Planning time** is bounded (25 s by default); a plan that cannot be found in time returns `no_solution` with the reason. Transfers
  faster than the fastest ellipse from the parking orbit (about two days to the Moon from low Earth orbit) would need a hyperbolic
  departure and are refused. A requested flight time is the two-body time to the destination's distance; the planned flight is a few
  per cent shorter because the destination's gravity speeds up the last leg.
- **Integrator step criterion.** Universes with a spacecraft use IAS15's PRS23 step criterion (section 5.8). That criterion has a
  known weakness that the default one does not: when the net force on a body passes exactly through zero (measured: two small bodies
  closing head-on along one line next to a planet), the internal step collapses and the application's step time limit ends the step
  (HTTP 503, state rolled back, nothing corrupted, but that universe cannot advance past the configuration). The same exposure
  already exists for universes with moons. Not fixed here; the alternative criterion is unusable with a low orbit.
- **Manoeuvre preview** in the Manoeuvre panel is two-body about the reference body (labelled so); the mission plan is N-body.
- **Spheres of influence** use the present distance instead of the semi-major axis, and are descriptive only.
- **Limits:** 32 spacecraft, 64 pending nodes and 16 missions per universe.
- **Persistence:** as for the rest of the application, state lives in backend memory and is lost on restart.
- **Collision policy:** see section 6 for which universes stop on contact between celestial bodies.

## 8a. Independent review

After implementation the backend diff was reviewed by a second, independent pass that had not written the code, with instructions
to look for real defects and to reproduce them. It reported fifteen findings; nine were reproduced with scripts. Thirteen are fixed and
one is reduced (previews still wait for a running step, but being refused is no longer recorded as a failure of the universe),
each with a regression test that reproduces the original failure (`tests/spaceflight/test_review_fixes.py`); one (the PRS23 step
collapse above) is documented as a limitation. The most serious were: a finite burn with almost no propellant left kept thrusting
for the rest of the step; a merger of two unrelated bodies during a burn (legacy-merge universes) redirected the thrust to a
bystander body; the planner's time budget did not cover a far-future departure; and a state could be committed and then fail to
publish for an almost-radial hyperbolic orbit. None affected the validated Earth → Moon scenario (its numbers are unchanged), but
all were reachable through the API.

## 9. Not implemented

Interplanetary and other transfer geometries; atmospheric flight, aerobraking and re-entry; J2 and other perturbation models;
low-thrust (spiral) trajectory design; attitude dynamics; multiple stages or engines; constellation tools; launch windows and
porkchop plots; landing and surface operations; rendezvous; automatic trajectory correction. Asking for any transfer outside the
supported geometry returns `unsupported`; none of these is approximated silently.
