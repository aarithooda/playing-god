# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

## NEXT ACTION
UI integration series (owner-approved plan): M0 done (PR #4); M1 inspector/focus/placement/undo merged (PR #7); M2 panels merged (PR #8); M3 selection outline and focus follow on `integration/m3-selection-focus` (see `STATUS.md`, awaiting review); next M4 axes/grid, M5 docs. Older text follows.

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
| T-010 | Automated browser E2E test | low | todo (only the API-only smoke test exists, `tests/smoke/`) | integration dev | T-004 | Playwright journey in CI |
| T-005 | Collaborators and workflow | high | collaborators added 2026-10-23; workflow confirmation by all four pending | lead | T-000 | All four confirm `TEAM_WORKFLOW.md` |
| T-006 | API contract v1 + minimal API (healthz, state, create body) | high | done (commit `feat: add API contract v1 ...` on the topic branch) | lead | — | `API_CONTRACT.md`; API/health tests pass |
| T-007 | Implement planned endpoints (PATCH/DELETE bodies first), then start/pause/step/reset/events | high | done 2026-10-23: PATCH/DELETE/step/reset/events implemented; start/pause withdrawn (Play = client step loop) | backend dev | T-006; sim endpoints need D-008 | Contract rows flip to ✅ with tests |
| T-008 | Resolve Vite `/api` rewrite vs `/api/v1` backend paths | high | done (frontend proxy forwards unchanged; verified in browser 2026-10-24) | frontend owner | T-006 | Frontend reaches `/api/v1/simulation/state`. (The 11 failing spike tests mentioned earlier are fixed: `pytest` is 88 passed.) |
| T-011 | B1: system diagnostics in the state response (backend `compute_diagnostics`, `diagnostics` field) and frontend data path (types, strict parser, view model) | high | done 2026-10-24 (D-013 accepted; PRs #1 `d2352b0`, #2 `3ca349e`; pytest 259, vitest 69) | lead + Vaibhav (physics review) + Nikhil (consumer) | T-007 | merged with CI green |
| T-012 | B1 UI: system diagnostics panel (units, "about origin" label, `null` as Undefined; drift indicators intentionally omitted) | medium | merged 2026-10-24 (PR #3, `ede80c0`, owner exception D-014); follow-up done in M2: relocated into the left sidebar below Event History | lead (AI session); Nikhil reviews (shared `App.tsx`) | T-011 | panel shown with tests; no frontend physics; vitest 96 |

### Remote branch inventory — 2026-10-23
Fetched and created local tracking refs for `feature/m0-rebound-physics-api` (Aarit) and `codex/3drender` (Nikhil). Their work remains unmerged; branch-local test/status claims are not main verification. See HANDOFF/STATUS for changed files and current tips. M0 task statuses on main remain unchanged pending review/integration.

### Independent production physics review — 2026-10-24
On isolated branch `validation/production-physics-review`, 11 new analytical/reference checks passed against `feature/production-rebound-simulation`; the complete branch suite passed 160 tests with 3 warnings. This does not close P-003: the review recommends additional strongly curved non-radial and three-body cases, connected clusters of >3 simultaneous mergers, seed/order variation, and testing the 2000-chunk cap. See `context/PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`.
