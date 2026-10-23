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
