# Decisions (append-only)
Entry format: Date · Decision · Context/reason · Alternatives · Consequences · Status (proposed/accepted/rejected/superseded). Never record a tentative idea as accepted.

## D-001 — Backend owns authoritative simulation state
- Date: 2026-10-23
- Decision: The Python backend holds the only authoritative physics state; the frontend renders it and sends actions.
- Reason: Single source of truth; testable physics; no divergent simulations.
- Alternatives: Simulate in the browser (JS) — rejected for validation and engine reasons.
- Consequences: Needs an efficient state-sync API.
- Status: accepted

## D-002 — Stack: React + TS + Vite + Three.js frontend, FastAPI backend
- Date: 2026-10-23
- Reason: Team skills and hackathon speed.
- Alternatives: none evaluated.
- Consequences: Vite dev proxy `/api` -> backend :8000 (implemented). Three.js not yet installed.
- Status: accepted

## D-003 — Physics engine (REBOUND) selection
- Date: 2026-10-23
- Decision: Evaluate REBOUND in a feasibility spike before committing (integration, collisions, checkpoints, performance, licensing).
- Alternatives: custom integrator; other N-body libraries.
- Consequences: No engine dependency until the spike concludes.
- Status: accepted via D-008 (spike complete 2026-10-23)

## D-004 — Team workflow (branches, PRs, file ownership)
- Date: 2026-10-23
- Decision: Follow `TEAM_WORKFLOW.md`: topic branches, PRs with one cross-area reviewer, `main` always runnable, append-only shared logs, one editor per file.
- Reason: four people on different AI accounts must avoid conflicting edits.
- Alternatives: everyone commits directly to `main` — rejected as risky for a 36-hour build.
- Consequences: needs collaborator access (T-005).
- Status: proposed (accept once all four collaborators confirm)

## D-005 — Repository is public
- Date: 2026-10-23
- Decision: `aarithooda/playing-god` is public so teammates can clone it.
- Reason: simplest collaboration access. Note that push access still requires collaborator invites.
- Consequences: never commit secrets; M0 license review must consider publishing implications.
- Status: accepted

## D-006 — Provisional M0 recommendation: REBOUND with a custom collision layer
- Date: 2026-10-23
- Decision: Provisionally use REBOUND for gravity/integration/checkpoints, with our own merger logic, de-duplication of collision callbacks, id mapping, and resolver re-registration after restore; prefer `'line'` collision detection over `'direct'`.
- Reason: see Results in `PHYSICS_SPIKE.md` (E4 direct misses fast collisions; line caught all tested; E5 merger and E7 restore pass).
- Alternatives: in-house core (fallback); built-in `"merge"` only (conserves mass/momentum but gives no diagnostics and depends on 'direct' detection).
- Consequences: GPL-3.0-only license must be reviewed before release. Untested items are listed in `PHYSICS_SPIKE.md`.
- Status: superseded by D-008 (kept for history)

## D-007 — SI units project-wide
- Date: 2026-10-23
- Decision: Position m, velocity m/s, mass kg, time s, radius m, energy J, angular momentum kg·m²/s; G = 6.67430e-11 m³ kg⁻¹ s⁻². Code, tests, docs and API contracts use SI (API fields carry the unit, e.g. `massKg`, `radiusM`).
- Reason: team decision (project lead, 2026-10-23); unambiguous for physics review and for the API.
- Alternatives: dimensionless/code units (rejected: hides unit errors), AU–solar-mass–year (rejected: awkward for small bodies).
- Consequences (verified): REBOUND's `sim.units` sets G = 6.67408e-11 (3.3e-5 lower), so `sim.G` must be set explicitly; times and dt are seconds; WHFast dt in seconds; doubles resolve ~3e-5 m at 1 AU. Coordinate convention: D-010.
- Status: accepted

## D-008 — Physics engine: REBOUND with a custom collision/merger layer
- Date: 2026-10-23
- Decision (recommended GO WITH CUSTOM COLLISION LAYER): use REBOUND for gravity, integration and checkpoints with IAS15 (not WHFast), `collision = "line"`, a fixed `rand_seed`, our own resolver that merges (heavier body keeps its `name`, COM state, volume-conserving radius, heat and spin ledgers, contact-time estimate, exception capture) and re-selects IAS15 after each merge, body identity by `name` never by array index, resolver re-registration after every restore, a step cap so that a_rel·dt²/8 ≪ contact distance, and no state in which two centres coincide. Supersedes D-006.
- Reason: evidence in `PHYSICS_SPIKE.md` (88 tests passed on 2026-10-23): gravity and conservation excellent; `direct` detection misses fast collisions; `line` had 0 errors in 144 swept scenarios and every analytic and independent fixture; bitwise checkpoint reproducibility; all observed failure modes F1–F11 have a tested mitigation or an avoidable trigger.
- Alternatives: plain GO with built-in `merge`/`direct`/WHFast (rejected: tunnelling, momentum error, random order, no diagnostics or ids); NO-GO and an in-house engine (kept as fallback; the layer and tests carry over).
- Consequences: `line` reliability is evidence, not proof (one seed, limited curvature; see untested list); the IAS15 warning after a merge with capped chunks (F10) is unresolved; the energy loss and orbital angular momentum of mergers exist only as bookkeeping ledgers; GPL-3.0-only (D-009).
- Status: accepted (team decision 2026-10-23, recorded by the project lead after review of `PHYSICS_SPIKE.md`). Limitations stay documented there and are open work for later milestones: `line` reliability is evidence not proof, strongly curved paths, tree modes, many simultaneous collisions, IAS15 warning F10. REBOUND is added to the app's dependencies only by the next engine-integration milestone (P-001), not by M0.

## D-009 — License: GPL-3.0-only for PLAYING GOD
- Date: 2026-10-23
- Decision: PLAYING GOD is licensed under GPL-3.0-only (top-level `LICENSE`, GPL v3 text as shipped with REBOUND 5.2.2), consistent with the GPL-3.0-only REBOUND dependency. Third-party licenses and notices are kept in `THIRD_PARTY_NOTICES.md` and must be preserved when redistributing. This is the team's project decision, not legal advice.
- Reason: REBOUND declares GPL-3.0-only (installed package metadata); distributing a combined work carries GPL-3.0 obligations; releasing the whole project under the same license is the simplest compatible choice. Other dependencies checked on 2026-10-23 declare MIT, BSD, Apache-2.0, PSF-2.0 or MPL-2.0 (certifi, transitive), all generally GPL-3.0-compatible.
- Alternatives: hosted-only demo without releasing source (rejected as the default); replacing REBOUND (kept as fallback in `PHYSICS_SPIKE.md`).
- Consequences: contributors license their contributions under GPL-3.0-only; re-check dependency licenses when adding packages (Three.js is not installed yet); each new dependency is added to `THIRD_PARTY_NOTICES.md`.
- Status: accepted

## D-010 — Coordinate convention: right-handed Cartesian
- Date: 2026-10-23
- Decision: the agreed right-handed Cartesian system (x, y, z) in metres in one inertial frame; velocities in m/s in the same axes; angular-momentum vectors follow the right-hand rule (e.g. r x v). The API and the Three.js scene must map to it explicitly (Three.js is also right-handed; document any axis permutation used for display).
- Reason: team decision (project lead, 2026-10-23); consistent with the cross products used in the merger ledgers and the API contract fields `positionM` / `velocityMPerS`.
- Alternatives: none recorded. The choice of origin (e.g. barycentric) is left to the scenario definition; no origin is mandated.
- Status: accepted

## D-011 — IAS15 uses the GLOBAL step-size criterion
- Date: 2026-10-24
- Decision: every (re-)selection of IAS15 goes through `backend/collisions.py::select_ias15`, which sets `adaptive_mode = "global"` (REBOUND's default is PRS23).
- Reason: with PRS23, `integrate` never returns when a body's net force cancels by symmetry (3 or 5 equal masses at rest on a line, 3x3 grid): the middle body's acceleration is round-off noise (~1e-29) and dt collapses to ~1e-18 s. Observed in pure REBOUND 5.2.2 and in the live backend (it wedged the process and its lock). GLOBAL completed every symmetric layout tried in ~10 steps; `min_dt`, INDIVIDUAL and AARSETH85 did not fix it.
- Consequences: numerics differ slightly from the M0/validation runs (orbit closure error ~3.6e-14 of a instead of ~1e-15; detection timestamps move by one internal step). All 204 tests pass; two fixture tolerances in `tests/validation/` were restated from first principles. Confirmed by Vaibhav (see Status).
- Status: accepted 2026-10-24 (Vaibhav, physics reviewer, as relayed by the project lead in the session request; the implementation, tests and evidence are unchanged). Implementation: `backend/collisions.py::select_ias15`, `backend/simulation.py` (heartbeat is part of D-012); tests: `tests/test_step_guard.py`, `tests/test_stress_p003.py`.

## D-012 — Wall-clock budget per step, HTTP 503
- Date: 2026-10-24
- Decision: a step exceeding `PG_STEP_TIME_LIMIT_S` (default 10 s) is stopped (between chunks and via REBOUND's heartbeat), rolled back through the existing transactional path and answered 503. Event ids of the rolled-back step are restored.
- Reason: a hung engine holds the service lock forever; N=200 with dtS=1e7 takes >10 s. A failed step must never leave state partly advanced.
- Consequences: a new error status for the frontend (already handled as a generic non-OK response); rollback rebuilds the engine, so replays use a different internal step grid. 10 s is a judgement call and configurable.
- Status: accepted 2026-10-24 (Vaibhav, as relayed by the project lead). Implementation: `SimulationService.step/_advance/_heartbeat/_restore` and the 503 handler in `backend/main.py`; tests: `tests/test_step_guard.py` (state, time, events, event ids and ledgers restored; service continues; real stall stopped; HTTP 503), `tests/test_events_endpoint.py`.

## D-013 — System diagnostics embedded in the state response
- Date: 2026-10-24
- Decision: `SimulationState.diagnostics` carries total mass, total momentum, kinetic energy, potential energy (point-mass, zero at infinity), angular momentum about the fixed origin, and the total booked merger spin, in SI, version 1. Undefined values are JSON `null`, never NaN/Infinity. Pure function `backend/diagnostics.py::compute_diagnostics`, called from `SimulationService._snapshot`; no caching.
- Reason: embedding makes diagnostics atomic with `bodies` (one lock hold, one particle read) without a revision counter; the frontend parser ignores unknown keys. A separate endpoint was rejected because two requests cannot be made consistent. Measured 3.7 ms at N=200.
- Consequences: six exact-shape test assertions changed. K+U is not conserved across mergers and orbital L is only conserved together with booked spin; clients re-baseline on events, edits and reset. Deferred: centre of mass, per-body fields, energy-loss ledger, orbital elements, conservation epoch.
- Status: **accepted 2026-10-24.** Reviews (per `TEAM_WORKFLOW.md`): independent physics review by Vaibhav approved (one P3, `potentialEnergyJ` for an unusable `g`, fixed in `8405ac2`); the frontend owner, Nikhil, approved consuming `diagnostics` and suggested `Literal[1]` for `version` (adopted). Merged via PR #1 (`d2352b0`, backend) and PR #2 (`3ca349e`, frontend data path: types, strict parser, view model; no UI). Implementation: `backend/diagnostics.py`, `SimulationService._snapshot`, `backend/models.py::Diagnostics`; tests: `tests/test_diagnostics_physics.py`, `tests/test_diagnostics_service.py`, `tests/test_api_diagnostics.py`, `frontend/src/api/parse.test.ts`.
