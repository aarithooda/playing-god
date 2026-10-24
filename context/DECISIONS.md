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

## D-014 — One-time owner exception: PR #3 merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). PR #3 (T-012 system diagnostics panel, branch `frontend/t012-diagnostics-panel`) is merged by project-owner decision **without** a recorded independent review. This is not a claim that an outside review occurred: GitHub shows no review on the PR. The only outside feedback is Nikhil's PR comment (2026-10-23), which reports a layout problem (below) and says the diagnostics component and data work "looks separate from that layout concern"; it is not an approval.
- Reason: unblock the planned integration of the team's independently developed UI work (Nikhil's sidebar layout, then the other UI branches) before Experiment 01.
- Conditions: CI must pass on the exact PR head being merged (checked immediately before merging; the head is `c736da3` plus the docs-only commit that records this decision, no code differs); normal GitHub merge commit; no direct push to `main`, no force-push. Local results at `c736da3`: pytest 259, tsc clean, vitest 96, build OK.
- Known issue deferred: the panel is mounted bottom-left (`absolute`, `bottom: 20px; left: 20px`) against the older layout and overlaps the full-height Event History sidebar in Nikhil's `panel` layout (`origin/panel`, not merged). **It must be resolved when that layout is integrated:** move `DiagnosticsPanel` into the left sidebar's scrollable content below Event History (an `inSidebar` prop like `EventTimeline`'s), remove the obsolete bottom-left mount, and add a test for the new placement.
- Scope: this decision applies to PR #3 only. It does not change, waive or weaken the review requirement for any other or future PR; `TEAM_WORKFLOW.md` is unchanged and contains no waiver.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-015 — One-time owner exception: PR #5 merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). PR #5 (starfield zoom stability and minimum on-screen body size, branch `frontend/starfield-zoom-stability`) is merged by project-owner decision **without** a recorded independent review. **No independent review was recorded**: GitHub shows no review or approval on the PR, and none occurred. The only checks are the author's own (an AI session working for the owner), the owner's manual visual verification in the browser, and CI.
- Scope of the change (frontend only): a `StarfieldShell` that scales drei's `<Stars>` shell uniformly with camera distance beyond 700 scene units (with star point-size compensation and a larger `camera.far`), and a display-only minimum 3 px on-screen radius for celestial bodies. Physics, backend, API, camera controls and body positions are untouched.
- Reason: the owner wants the zoom fix on `main` before the remaining UI branches are integrated one at a time.
- Conditions: CI (backend pytest and frontend tsc/vitest/build) must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push. The code is commit `7445312`; the PR head is that commit plus the docs-only commit that records this decision (no code differs). Local results at `7445312`: pytest 259 passed (isolated venv), tsc clean, vitest 117, build OK.
- Scope of the exception: **PR #5 only.** It does not change, waive or weaken the review requirement for any other or future PR (including the remaining UI branches); `TEAM_WORKFLOW.md` is unchanged and contains no waiver. It does not extend or renew D-014, which covered PR #3 only.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.


## D-016 — One-time owner exception: docs PR #6 merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). PR #6 (docs only: the `context/STATUS.md` and `context/WORKLOG.md` entries recording the merge of PR #5, branch `docs/starfield-zoom-merged`) is merged by project-owner decision **without** a recorded independent review. **No independent review was recorded**: GitHub shows no review or approval on the PR, and none occurred.
- Reason: record the confirmed PR #5 merge on `main` so project status is accurate before the remaining UI branches are integrated.
- Conditions: documentation only, no code; CI must pass on the exact PR head being merged, checked immediately before merging (head `0347d0a` plus the docs-only commit that records this decision); normal GitHub merge commit; no direct push to `main`, no force-push.
- Scope of the exception: **PR #6 only.** It does not extend D-014 (PR #3) or D-015 (PR #5), and it does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-017 — One-time owner exception: docs PR #4 merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). PR #4 (docs only: `context/STATUS.md`, `TASKS.md` and `WORKLOG.md` entries recording the T-012 merge, branch `docs/t012-merged`) is merged by project-owner decision **without** a recorded independent review. **No independent review was recorded**: GitHub shows no review or approval on the PR, and none occurred.
- Authorization: the project owner (Aarit) stated in chat that, as the only person currently implementing and integrating, they authorize proceeding with the UI integration series without waiting for teammate reviews, with each exception recorded here one PR at a time. This entry covers PR #4 only.
- Reason: PR #4 conflicted with `main` in `STATUS.md` and `WORKLOG.md`; reconciling it first (milestone M0) keeps later integration PRs from re-resolving the same documentation conflicts.
- What was done: `origin/main` (`7f9aea0`) was merged into `docs/t012-merged` with a normal merge commit (no force-push, no rewrite); in the two conflicts every entry from both sides was kept (the starfield zoom-stability entries stay on top, the T-012 "MERGED" rewrite replaces the stale "PR open" heading, and the D-014 worklog entry precedes the starfield worklog entry). The PR's own diff against `main` stays documentation only.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push.
- Scope of the exception: **PR #4 only.** It does not extend D-014, D-015 or D-016, and it does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged. Later integration PRs get their own entries.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-018 — One-time owner exception: M1 integration PR merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). The M1 integration PR (branch `integration/m1-inspector-placement`: `origin/bugfix/body-inspector-close` merged onto `main`, plus the dismissal rework, coordinate readout and undo) is merged by project-owner decision **without** a recorded independent review. **No independent review was recorded or occurred.**
- Authorization: the project owner (Aarit) stated in chat that they are currently the only person implementing and integrating, and authorized proceeding without waiting for teammate reviews, recording each exception here one PR at a time. This entry covers the M1 PR only.
- Evidence instead of review (author's own checks, not independent): `tsc` clean, `vitest` 138 passed, `npm run build` OK, backend `pytest` 259 passed, a manual real-browser pass (details in `STATUS.md`), and GitHub CI on the exact head.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push; teammate commits preserved (merge, not rewrite).
- Scope of the exception: **the M1 PR only.** It does not extend D-014 to D-017 and does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-019 — One-time owner exception: M2 integration PR merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). The M2 integration PR (branch `integration/m2-panels`: `origin/panel` merged onto `main`, plus the sidebar/layout rebuild, the view-offset centring, the diagnostics relocation and the first-use state) is merged by project-owner decision **without** a recorded independent review. **No independent review was recorded or occurred.** (Nikhil authored the `panel` commits; this is not a review by him.)
- Authorization: the project owner (Aarit), as the only person currently implementing and integrating, authorized proceeding without waiting for teammate reviews, recording each exception one PR at a time. This entry covers the M2 PR only.
- Evidence instead of review (author's own checks, not independent): `tsc` clean, `vitest` 156 passed, `npm run build` OK, backend `pytest` 259 passed, a manual real-browser pass (details in `STATUS.md`), and GitHub CI on the exact head.
- Closes the follow-up deferred in D-014: `DiagnosticsPanel` now lives in the left sidebar below Event History and the bottom-left mount is gone.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push; teammate commits preserved (merge, not rewrite).
- Scope of the exception: **the M2 PR only.** It does not extend D-014 to D-018 and does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-020 — One-time owner exception: M3 selection/focus PR merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). The M3 PR (branch `integration/m3-selection-focus`: thin selection outline, camera follow of the focused body, Focused badge) may be merged by project-owner decision **without** a recorded independent review. **No independent review was recorded or occurred**, and the implementing AI session did not review its own PR.
- Authorization: the project owner (Aarit), as the only person currently implementing and integrating, authorized proceeding without waiting for teammate reviews, with each exception recorded one PR at a time. This entry covers the M3 PR only and takes effect only if the owner merges it.
- Evidence instead of review (author's own checks, not independent): `tsc` clean, `vitest` 165 passed, `npm run build` OK, backend `pytest` 259 passed, a manual real-browser pass (details and gaps in `STATUS.md`), and GitHub CI on the exact head.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push.
- Scope of the exception: **the M3 PR only.** It does not extend D-014 to D-019 and does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-021 — Reads never wait for a running step; mutations wait a bounded time (HTTP 503 "busy")
- Date: 2026-10-24
- Status: **accepted 2026-10-24 by the project owner (Aarit)**, who verified the change and directed the merge of PR #10. **No independent review occurred**: this is a one-PR-only owner exception for PR #10, it does not extend any earlier exception and does not weaken the review requirement for any other PR. (D-020 is reserved by the open M3 PR #9; this entry deliberately took the next number.)
- Decision: `SimulationService.snapshot()` and `events()` no longer take the simulation lock; `snapshot()` returns a copy of the last committed state, published at the end of every successful mutation or step. Every mutation and step takes the lock through `_guard()`, waiting at most `lock_wait_s` (default: step budget + 5 s) and then raising `SimulationBusyError`, answered as HTTP 503 with `Retry-After`. Frontend side: every API request has a timeout (reads 8 s, writes and steps 35 s) and ends in `ApiError("timeout")` instead of never settling; a step whose outcome is unknown (timeout, network error) is followed by a re-read of the committed state, never a guess.
- Reason: on 2026-10-24 a stuck `integrate` held the lock, every `GET /state` queued behind it forever while `/healthz` (lock-free) kept saying "connected", and the UI sat on "Connecting to the simulation backend…" with no way out (no request timeouts, one FIFO request queue). Evidence: `context/WORKLOG.md`. The numerical cause itself (D-011, D-012) was already fixed on `main`; this removes the amplification that turned one stuck step into an unusable application.
- Consequences: a read during a step shows the pre-step state (equivalent to "the read happened before the step"); no API shape change. Mutations during a long step fail visibly with 503 instead of hanging. Not solved: a native call that never reaches the heartbeat still cannot be stopped in-process (would need a worker process); recorded as a limitation.

## D-022 — One-time owner exception: M4 axes/grid PR merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). The M4 PR (branch `integration/m4-axes-grid`: independent Axes and Grid view toggles, the temporary placement grid, the units legend) may be merged by project-owner decision **without** a recorded independent review. **No independent review was recorded or occurred**, and the implementing AI session did not review its own PR.
- Authorization: the project owner (Aarit), as the only person currently implementing and integrating, authorized proceeding without waiting for teammate reviews, with each exception recorded one PR at a time. This entry covers the M4 PR only and takes effect only if the owner merges it.
- Evidence instead of review (author's own checks, not independent): `tsc` clean, `vitest` 198 passed, `npm run build` OK, backend `pytest` 265 passed, a manual real-browser pass (details and gaps in `STATUS.md`), and GitHub CI on the exact head.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push.
- Scope of the exception: **the M4 PR only.** It does not extend D-014 to D-021 and does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-023 — One-time owner exception: M5 final-integration PR merged without the normal independent review
- Date: 2026-10-24
- Decision: **a documented, one-PR-only exception to `TEAM_WORKFLOW.md`** ("Pull requests need one reviewer from another area and passing tests"). The M5 PR (branch `integration/m5-final-docs`: the narrow-window framing fix in `sim/framing.ts`, the rewritten `ARCHITECTURE.md`, README and status documents) may be merged by project-owner decision **without** a recorded independent review. **No independent review was recorded or occurred**, and the implementing AI session did not review its own PR.
- Authorization: the project owner (Aarit), as the only person currently implementing and integrating, authorized proceeding without waiting for teammate reviews, with each exception recorded one PR at a time. This entry covers the M5 PR only and takes effect only if the owner merges it.
- Evidence instead of review (author's own checks, not independent): `tsc` clean, `vitest` 203 passed, `npm run build` OK, backend `pytest` 265 passed, a manual real-browser journey (details and gaps in `STATUS.md`), and GitHub CI on the exact head.
- Conditions: CI must pass on the exact PR head being merged, checked immediately before merging; normal GitHub merge commit; no direct push to `main`, no force-push.
- Scope of the exception: **the M5 PR only.** It does not extend D-014 to D-022 and does not change, waive or weaken the review requirement for any other or future PR. `TEAM_WORKFLOW.md` is unchanged.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-024 — Owner authorization for the closing integration, and a one-time exception for its docs PR
- Date: 2026-10-24
- Decision: (a) On 2026-10-24 the project owner (Aarit) explicitly authorized, in chat ("Autonomous Final Integration, M5 Completion, and Repository Handover"), the AI session to create and merge PRs, resolve ordinary conflicts and delete verified merged branches **without asking again**, while forbidding force-pushes, history rewrites, bypassing CI or branch protection, falsifying reviews, discarding unmerged work and losing user data. Under that authorization the session merged PR #12 (the M5 PR, which D-023 already covers as an owner exception) with a pinned-head normal merge commit after CI passed, and performed the branch cleanup recorded in `STATUS.md`. (b) The handover docs PR (#13, docs only, branch `docs/final-handover`) is merged under a **one-PR-only owner exception** to `TEAM_WORKFLOW.md`'s independent-review rule. **No independent review was recorded or occurred for either PR**, and the implementing AI session did not review its own PR.
- Scope: this exception covers PR #13 only. It does not extend D-014 to D-023, does not change or weaken the review requirement for any other or future PR, and does not authorize anything beyond the closing integration described above. The authorization in (a) is not a standing one: later work needs the owner's instructions again. `TEAM_WORKFLOW.md` is unchanged.
- Evidence instead of review (author's own checks): fresh `pytest` 265 passed, `tsc` clean, `vitest` 203 passed, build OK and GitHub CI success on the merged `main`; the PR changes documentation only.
- Status: accepted 2026-10-24 by the project owner (Aarit), as a one-time exception.

## D-025 — Simulation Lab architecture (independent universes, epoch guards, recorded history, renderer boundary)
- Date: 2026-10-24
- Status: **owner-approved scope** (specs `context/specs/SIMULATION_LAB_SPEC.md` Draft 0.2 + amendment 1 and `EXPERIMENT_01_SPEC.md` Draft 0.3 + amendment 1; design in `context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md`); implemented on `feature/simulation-lab-experiment-01`. The technical choices below are the plan's A1-A16, **engineering defaults** adopted by the implementer under OD-4, not owner decisions of their own. The physics configuration decisions D-007, D-008, D-010, D-011, D-012 and D-021 are unchanged.
- Decision: (A1) one `SimulationService` engine per universe, owned by a `UniverseRegistry`; a universe id alone is never independence. (A2) every mutation echoes the **activation epoch** it was issued under; the engine re-checks it under its lock on entry and again immediately before commit, so a stale or late request (including A to B to A) is refused or rolled back. (A3) activation cancels the outgoing universe's running step and never integrates. (A4) only the active universe can be mutated; reads work on any universe. (A5) snapshots are `rebound.Simulation.copy()` plus the service state, in memory only. (A6) reset restores a per-universe immutable initial snapshot. (A7) loading a preset always creates a new universe. (A8) the Orbit Lab modified run is derived from the baseline's *initial* snapshot. (A9) the backend records and serves history and computes comparisons. (A10) the legacy routes act on `uni-default` and answer 409 `universe_not_active` while another universe is active. (A11) the frontend mounts one `UniverseWorkspace` keyed `universeId:activationEpoch`. (A12) no persistence (OD-5). (A13) preset data are archived and checked in; the runtime never uses the network. (A14) Experiment 01 uses Sun + Earth-Moon barycentre, not Earth's centre. (A15) history has two modes, `grid` (exact k x interval samples) and `step` (one per committed change, a ring). (A16) the renderer gains exactly one input, `trajectories` (UI-0).
- Semantic changes recorded here and in `API_CONTRACT.md`: **reset means "the initial state"** of that universe (empty for a sandbox, so the default universe behaves as before); body ids are unique per universe (preset bodies have stable ids such as `body-earth`); `Body` gained `kind` and `catalogueEntryId`; every universe response carries a `revision`.
- Guarantee of a restore (measured, `tests/test_snapshots.py::test_snapshot_restore_bitwise_continuation`): within one backend process, the same sequence of steps after a restore gives a **bit-identical** state and history. Not claimed across restarts, machines, OS or REBOUND versions.
- Evidence: `context/STATUS.md` (Simulation Lab section), `context/EXPERIMENT_01_PROTOCOL.md`, `context/PRESETS.md`.

## D-026 — Owner decisions OD-1 to OD-6, UI-2 and UI-0 (recorded as accepted by the owner, 2026-10-24)
- Date: 2026-10-24
- Status: **accepted by the project owner** as recorded in the two specs; this entry only restates them so the code, the specs and the decision log agree. They are not the implementer's decisions.
- OD-1: the Solar System preset is required and sufficient; any further preset only if sourced and validated to the same standard; Kepler-90 removed; TRAPPIST-1 gated (see D-027). OD-2: a catalogue of 5 stars and 4 planets with value, source, uncertainty and basis; estimated values disclosed. OD-3: the scientific question is confirmed; Sun + Earth-Moon barycentre, J2000.0, speed factors 0.90/0.95/1.05/1.10, a 730-day window with daily samples, Moon consequences documented. OD-4: the implementer works autonomously within scope; the baseline is an immutable reference; uncontrolled changes to the modified run are identifiable. OD-5: no persistence across restarts; in-process semantics are tested. OD-6: the owner reviews product behaviour; an independent technical review follows the PR; the implementer never merges. UI-2: Nikhil's history proposal accepted with the constraints of spec section 8.1 (backend-recorded, bounded, partitioned, missing data shown as missing). UI-0: the renderer integration boundary of spec section 8.2. "UI-1" is named by the owner but specified nowhere; nothing implements it.
- Branching: one feature branch and one PR (no separate docs PR).

## D-027 — TRAPPIST-1 preset excluded: the plan's validation gate is not met (decision for the owner pending)
- Date: 2026-10-24
- Status: **applied under the owner's rule** (OD-1: included only if it passes its gate; otherwise excluded and documented). Whether to approve a different gate is **open for the owner**.
- Finding: the conversion of the Agol et al. 2021 elements was built and verified; it reproduces the authors' published best-fit transit times within 0.0009 d for all 21 first-three transits per planet. The gate as written (first 3 transits of each planet within 0.0035 d of the *observed* times) fails at 0.0134 d, and the authors' own model fails the same transits by the same amounts (observational scatter, a 3.5-sigma outlier for planet g). No tolerance was loosened and no other gate was substituted. Details: `context/PRESETS.md`.
- Option for the owner: a gate against the published model times (for example 0.002 d) with observed residuals shown as information; that needs an owner decision and about one session of work (the verified scripts are in the implementation session's notes folder).

## D-028 — Implementation deviations from the plan (recorded, none changes a requirement)
- Date: 2026-10-24
- Status: engineering deviations recorded by the implementer under OD-4 / plan section 19.5; the full list with reasons is in `WORKLOG.md` per milestone.
- Deviations: activating the already-active universe is a no-op (no epoch change); CRUD, reset and restore roll back from a private `sim.copy()` checkpoint (bitwise) rather than the records rebuild, which still serves failed steps; step-mode history also records a sample for each committed edit; the history hook takes its scope from the scoped client; `App.tsx` gained the Orbit Lab hook and a few props in M9 because experiments span two universes and refresh the universe list that App owns, and it owns the simulation speed so it survives a switch; the Orbit Lab panel also lists existing experiments (open and delete) when the active universe is not part of one; the comparison returns at most the 731-sample window.
- **Specification discrepancy reported, not edited:** `EXPERIMENT_01_SPEC.md` section 4.2 says the modified run's barycentre drift is "about 0.6 km" over the window and "about 10^-7" of the position differences; 9.2 mm/s over 730 d is about 580 km (about 6e-6 to 6e-5 of the separations). The mechanism and the 9 mm/s figure are right; the sentence has a 1000x unit slip. The test asserts the measured value (`EXPERIMENT_01_PROTOCOL.md`).
