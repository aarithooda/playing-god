# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

## NEXT ACTION
**Collision & particle engine implementation in progress** (owner instruction 2026-10-24; nothing pushed, merged or deployed). Live board: the table at the end of this file. Stage 0 done on `collision/stage-0-contracts`; Stage 1 next. Gates that will stop the chain: CP-1 (after Stage 1), DQ-7/8/9 and a named CP-SCI-1 human reviewer (Stage 3), CP-SCI-1 sign-off + DQ-13 (Stage 4).

**Simulation Lab + Experiment 01 implemented** on `feature/simulation-lab-experiment-01` (T-015; one PR to `main`, not merged). Next: the owner's product review of the PR, then the independent technical review (OD-6); then merge by the owner. Open owner decisions: whether to approve an alternative gate for TRAPPIST-1 (D-027) and whether to correct the barycentre-drift sentence in `EXPERIMENT_01_SPEC.md` section 4.2 (D-028). Older text follows.

UI integration series M0-M5 **complete and merged** (PRs #4, #7, #8, #9, #11, #12; stall fix #10); repository handed over, see the FINAL HANDOVER section at the top of `STATUS.md`. Next: the owner defines and starts Experiment 01 (not defined in the repo, not started). Open items: T-010 browser E2E, the history-system decision, checkpoints/tidal (brief features not implemented).

UI foundation (integration/ui-foundation):
UI integration M0-M5 is merged. UI-2 history work was reassigned to teammate 1 and removed from `frontend/ui-4-6`. Completed UI-4/UI-6 work is consolidated on `frontend/ui-4-6`; see top of `STATUS.md`. The headless frame-pacing profile is not a hardware benchmark; coordinate any renderer optimization with UI-0. Experiment 01 remains undefined.

B1 diagnostics merged (2026-10-24, T-011; top of `STATUS.md`). Next product step: T-012, the diagnostics panel (frontend owner). Older text follows.

Stabilized baseline (2026-10-24): see the top of `STATUS.md`. D-011/D-012 accepted; milestone closed. Local frontend dependency and backend connection recovery are complete (details in `STATUS.md`); no application dependency manifest change was needed. Non-blocking backlog: browser E2E (T-010), larger-N performance, tree modes, three-body reference, bundle code-splitting, Node 20 Actions notice. Next: product milestone. Older text below is history.

Stabilized baseline (2026-10-24): see the top of `STATUS.md`. D-011/D-012 accepted; UI fixes (inspector close button and body-click and drag-safe outside-click dismissal, visible collision-free auto-placement, immediate 3D placement creation, focus framing to 25% of canvas height, selected-body ring removal) are on `bugfix/body-inspector-close`, not merged. Frontend build passes; browser E2E remains non-blocking backlog (T-010). Local frontend dependency and backend connection recovery are complete. No dependency manifest change was needed. Other backlog: larger-N performance, tree modes, three-body reference, bundle code-splitting, Node 20 Actions notice. Next: product milestone. Older text below is history.

Review/merge `feature/production-rebound-simulation` (production engine done: P-001, P-002 and T-007 implemented; P-004 explained). Then compare `origin/validation/physics-first-principles`; frontend integrates against `API_CONTRACT.md`. Older text follows: start **P-001** (production collision/merger layer, spec in `PHYSICS_SPIKE.md`). Vaibhav: independent re-check of the energy/angular-momentum accounting and the P-003 stress tests.

## M0 — Physics Engine Feasibility Spike
- **Priority:** highest · **Status:** done: decision accepted (D-008, 2026-10-23); independent re-checks continue under M0.2/M0.5 · **Owners:** project lead + Vaibhav
- **Depends on:** T-000 (done). **Blocks:** T-003, all simulation features, engine dependency in `backend/requirements.txt`.
- **Required decision at completion:** explicit go/no-go on REBOUND recorded in `DECISIONS.md` (D-008; D-003 closes with it), agreed jointly.
- Plan, results, decision and conditions: `PHYSICS_SPIKE.md`. Neither person builds a separate full engine.

| ID | Subtask | Owner | Status | Depends | Done when |
|---|---|---|---|---|---|
| M0.1 | Agree units, coordinate frame, tolerances, initial conditions | lead + Vaibhav | **done**: SI (D-007), right-handed Cartesian (D-010); tolerances derived per class in `PHYSICS_SPIKE.md` and test docstrings | — | D-007 accepted; tolerance table confirmed by both |
| M0.2 | Independent expected results and acceptance criteria | Vaibhav | in progress: independent reference exists on unmerged branch `validation/physics-first-principles`; spike cross-checks its fixtures (all 6 agree) | M0.1 | Branch merged or its values copied; both sets agree |
| M0.3 | REBOUND install and two-body harness | lead | **evidence complete**, awaiting review | M0.1 | review recorded |
| M0.4 | Collision detection study (modes, tunnelling, timestep refinement, sweep) | Vaibhav (with lead) | **evidence complete**: `direct` misses fast collisions, `line` 0 errors in 144 swept scenarios; awaiting review | M0.3 | review recorded; untested items accepted or scheduled (P-003) |
| M0.5 | Merger and diagnostics (mass, momentum, KE, angular momentum, multi-collision) | Vaibhav + lead | **evidence complete**; awaiting independent re-check of the energy/angular-momentum accounting | M0.2, M0.4 | re-check recorded |
| M0.6 | Checkpoint save/restore, including collisions after restore | lead | **evidence complete**: bitwise identical; resolver must be re-registered | M0.3 | review recorded |
| M0.7 | Performance and license review | lead | **done**: performance recorded; project license GPL-3.0-only (D-009) | M0.3 | D-009 accepted |
| M0.8 | Joint go/no-go | lead + Vaibhav | **done**: GO WITH CUSTOM COLLISION LAYER accepted (D-008) | M0.2–M0.7 | D-008 accepted, D-003 closed |

## Next milestone (D-008 accepted; not started)
| ID | Description | Priority | Status | Owner | Depends | Done when |
|---|---|---|---|---|---|---|
| P-001 | Production collision/merger layer per the spec in `PHYSICS_SPIKE.md` (IAS15, `line`, seeded, name ids, ledgers, reset after merge, re-register after restore) | high | done (backend/collisions.py + backend/simulation.py; tests/test_simulation_service.py) | lead | D-008 | spike tests ported against the production module; no spike code imported by the app |
| P-002 | Step-cap policy: integrate in frame chunks with a_rel·dt²/8 ≪ contact distance | high | done (chunking in SimulationService._advance; curvature + radial-infall tests) | lead | P-001 | test with curved close encounters passes |
| P-003 | Stress the untested items (strongly curved paths, tree/linetree, >3 simultaneous bodies, many collisions per step, tangency policy, extreme mass ratios) | medium | done 2026-10-24 except tree/linetree modes (not used by the app) and a high-resolution three-body reference: `tests/test_stress_p003.py` (16 tests), results in `PHYSICS_SPIKE.md` | stabilization session | M0.4 | results appended to `PHYSICS_SPIKE.md` |
| P-004 | Understand the IAS15 non-convergence RuntimeWarning after a merge with capped chunks (F10) | medium | done 2026-10-24: cause = a lone remnant has zero acceleration so IAS15's convergence test is 0/0; fixed in production by exact drift, pinned by `tests/test_step_guard.py`; spike tests ignore only that message | lead | P-001 | explained and either fixed or documented |
| P-005 | License and third-party notices | high | done: GPL-3.0-only, `LICENSE`, `THIRD_PARTY_NOTICES.md` (re-check when dependencies change; add Three.js) | project lead | M0.7 | D-009 accepted |

## Other tasks
| ID | Description | Priority | Status | Owner | Depends | Done when |
|---|---|---|---|---|---|---|
| T-000 | Initialize repo, skeleton, context files | high | done | lead | — | Health test passes, frontend renders, baseline committed |
| T-001 | Physics-engine feasibility spike | — | superseded by M0 | — | — | — |
| T-002 | GitHub remote and push baseline | high | done | lead | T-000 | `main` tracks `origin/main` (repo is public) |
| T-003 | Decide units and coordinate conventions | high | done (SI D-007, right-handed Cartesian D-010; origin chosen per scenario) | lead, Vaibhav | M0.1 | recorded in DECISIONS.md |
| T-004 | Add CI (pytest + frontend build) | medium | done 2026-10-24: `.github/workflows/ci.yml` (pytest, tsc, vitest, build), green on main | integration dev | T-000 | CI green on main |
| T-009 | Per-step wall-clock budget and engine-stall protection | high | done 2026-10-24 (D-011, D-012 accepted; HTTP 503) | stabilization session | — | stalled or slow steps roll back |
| T-010 | Automated browser E2E test | low | **closed for the Experiment 01 critical path 2026-10-24**: `frontend/e2e/experiment01.e2e.mjs` (`npm run e2e`, playwright-core, 11 steps, real Chrome 155). Not in CI (opt-in); the rest of the app remains covered by vitest and the manual journey | integration dev | T-004 | Playwright journey in CI (optional follow-up) |
| T-005 | Collaborators and workflow | high | collaborators added 2026-10-23; workflow confirmation by all four pending | lead | T-000 | All four confirm `TEAM_WORKFLOW.md` |
| T-006 | API contract v1 + minimal API (healthz, state, create body) | high | done (commit `feat: add API contract v1 ...` on the topic branch) | lead | — | `API_CONTRACT.md`; API/health tests pass |
| T-007 | Implement planned endpoints (PATCH/DELETE bodies first), then start/pause/step/reset/events | high | done 2026-10-23: PATCH/DELETE/step/reset/events implemented; start/pause withdrawn (Play = client step loop) | backend dev | T-006; sim endpoints need D-008 | Contract rows flip to ✅ with tests |
| T-008 | Resolve Vite `/api` rewrite vs `/api/v1` backend paths | high | done (frontend proxy forwards unchanged; verified in browser 2026-10-24) | frontend owner | T-006 | Frontend reaches `/api/v1/simulation/state`. (The 11 failing spike tests mentioned earlier are fixed: `pytest` is 88 passed.) |
| T-011 | B1: system diagnostics in the state response (backend `compute_diagnostics`, `diagnostics` field) and frontend data path (types, strict parser, view model) | high | done 2026-10-24 (D-013 accepted; PRs #1 `d2352b0`, #2 `3ca349e`; pytest 259, vitest 69) | lead + Vaibhav (physics review) + Nikhil (consumer) | T-007 | merged with CI green |
| T-012 | B1 UI: system diagnostics panel (units, "about origin" label, `null` as Undefined; drift indicators intentionally omitted) | medium | merged 2026-10-24 (PR #3, `ede80c0`, owner exception D-014); follow-up done in M2: relocated into the left sidebar below Event History | lead (AI session); Nikhil reviews (shared `App.tsx`) | T-011 | panel shown with tests; no frontend physics; vitest 96 |

| T-013 | Simulation stall resilience: lock-free committed reads, bounded mutation waits (503 busy), API client timeouts, recoverable load error, resync after unknown-outcome step | high | implemented 2026-10-24 on `fix/simulation-stall-resilience`, PR #10, D-021 accepted by the owner (no independent review) | AI session; owner decides merge | T-007, D-011, D-012 | tests in `tests/test_stall_resilience.py`, `api/client.test.ts`, hook/App tests; limitation: a native integrate that never reaches the heartbeat is not interruptible in-process |

| T-014 | UI integration series: inspector/focus/placement (M1), sidebars/layout (M2), outline and focus follow (M3), axes and grid (M4), final verification and docs (M5) | high | M1-M5 merged 2026-10-24 (PRs #7, #8, #9, #11, #12) | AI session; owner decided merges (D-018, D-019, D-020, D-022, D-023: no independent review) | T-012 | acceptance checklist in `STATUS.md` |
| T-015 | Simulation Lab (independent universes, epoch-guarded active-only mutation, snapshots/reset, Solar System preset, sourced catalogue, custom stars/planets, UI-0 renderer boundary, UI-2 history timeline and replay) and Experiment 01 (Orbit Lab: immutable baseline, velocity-scaled modified run, comparison, independent Kepler validation) | high | implemented 2026-10-24 on `feature/simulation-lab-experiment-01` (M1-M12; M11 TRAPPIST-1 excluded, D-027); pytest 492, vitest 372, scientific values and browser journey in `STATUS.md` | AI session; owner reviews product behaviour, independent technical review follows (OD-6) | T-014 | PR merged by the owner after both reviews; D-025 to D-028 accepted |


### Remote branch inventory — 2026-10-23
Fetched and created local tracking refs for `feature/m0-rebound-physics-api` (Aarit) and `codex/3drender` (Nikhil). Their work remains unmerged; branch-local test/status claims are not main verification. See HANDOFF/STATUS for changed files and current tips. M0 task statuses on main remain unchanged pending review/integration.

### Independent production physics review — 2026-10-24
On isolated branch `validation/production-physics-review`, 11 new analytical/reference checks passed against `feature/production-rebound-simulation`; the complete branch suite passed 160 tests with 3 warnings. This does not close P-003: the review recommends additional strongly curved non-radial and three-body cases, connected clusters of >3 simultaneous mergers, seed/order variation, and testing the 2000-chunk cap. See `context/PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`.

<!-- COLLISION-BOARD:START -->
### Collision & particle engine — implementation board (live; updated at every stage boundary)
Branch chain (stacked, nothing pushed or merged): see `WORKLOG.md`. Status: `[ ]` not started · `[-]` in progress · `[x]` completed and verified · `[!]` blocked / awaiting human approval. Per-requirement detail: `COLLISION_REQUIREMENT_TRACEABILITY.md`.

| Stage | Status | Deliverable | Depends on | Acceptance | Tests | Commit |
|---|---|---|---|---|---|---|
| 0 Governance, contracts, configuration | [-] all checks green, committing | backend/impact/{serialization,config,contracts}.py; tests/impact/test_contracts.py; D-034; docs | D-033 | pytest 567 + new green; vitest 433; build OK; no import of backend.impact outside the package; DEFAULT_SANDBOX_MODE legacy-merge | tests/impact/test_contracts.py |  |
| 1 Deferred resolution, impact capture, event identity (legacy outcome only) | [ ]  | detection, geometry, records, engine, models/{base,perfect_merge}; simulation.py wiring behind mode outcome-v1 | 0 | 567 existing tests unchanged; golden equivalence <= 1e-12 (CP-1 if an internal-step shift appears); geometry/determinism tests; latency +10% | test_deferred_equivalence, test_geometry, test_detection |  |
| 2 Materials, spin, orientation | [ ]  | materials, rotation, profiles JSON, GET /materials, side tables, diagnostics v2 | 1 + CP-1 accepted | REG green; digests of existing presets unchanged; material-less bodies get no spin state | test_materials, test_rotation |  |
| 3 Outcome models and selector (pure) | [ ]  | ls12, cratering, envelope, selector, reference_values | 0; DQ-7/8/9 answered; named CP-SCI-1 human reviewer | reference reproductions; UD-1 and UD-2 resolved; CP-SCI-1 signed off | test_ls12, test_cratering, test_envelope, test_selector |  |
| 4a Atomic application and conservation (all universes legacy) | [ ]  | applier, conservation, Event union, frontend parse | 1-3, CP-1, CP-SCI-1, DQ-13 | scenario per outcome class; conservation; legacy exactness in outcome-v1 | test_applier, test_conservation |  |
| 4b Default switch: new sandboxes outcome-v1 (CP-4b) | [ ]  | config constant, universe creation paths | 4a green + reviewed | test_mode_defaults incl. fresh uni-default; presets/Orbit Lab legacy | test_mode_defaults |  |
| 5 Fragmentation and bounded debris | [ ]  | fragments.py, parcels, budgets | 4; DQ-4/5/6 (CP-2) | sum exactness, power law, no overlap, determinism, overflow | test_fragments |  |
| 6 Localized damage and propagation | [ ]  | damage.py, surface route | 2, 4 (5) | south-pole fixture | test_damage |  |
| 7 Debris lifecycle, reaccretion, secondary impacts | [ ]  | lifecycle.py, escape ledger | 5, 6; DQ-10 | bound/escape, child events, cascade limit, Scenario E | test_lifecycle |  |
| 8 Records API, inspection, replay | [ ]  | collisions routes, inspector UI | 7 | every 10.2 field; replay digest identical | test_records, vitest describe |  |
| 9 Particle engine and event visualization | [ ]  | render contract, effects layers | 8; CP-3 | timeline tests; boundary test; e2e stub | vitest effectTimeline etc. |  |
| 10 Persistence, isolation, determinism hardening | [ ]  | CollisionState serialisation, derive | 9 (or 8); DQ-11 | restore bitwise; isolation | test_persistence, test_isolation |  |
| 11 Sourced material annotation of presets (DQ-3) | [ ]  | preset data + loader | DQ-3 = yes | validation trajectories bit-identical | tests/validation additions |  |
| 12 Scenarios A-H, performance, Definition of Done | [ ]  | e2e scenarios, performance, DoD audit | 0-10 (+11) | every traceability row VERIFIED; CP-5 human sign-off | test_scenarios_e2e, test_performance |  |
<!-- COLLISION-BOARD:END -->
