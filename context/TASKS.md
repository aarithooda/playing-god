# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

## NEXT ACTION
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
| P-003 | Stress the untested items (strongly curved paths, tree/linetree, >3 simultaneous bodies, many collisions per step, tangency policy, extreme mass ratios) | medium | todo | Vaibhav | M0.4 | results appended to `PHYSICS_SPIKE.md` |
| P-004 | Understand the IAS15 non-convergence RuntimeWarning after a merge with capped chunks (F10) | medium | partly: no IAS15 non-convergence warning in any production test (run with -W error::RuntimeWarning); cause of the spike warning not isolated; production logs any REBOUND warning | lead | P-001 | explained and either fixed or documented |
| P-005 | License and third-party notices | high | done: GPL-3.0-only, `LICENSE`, `THIRD_PARTY_NOTICES.md` (re-check when dependencies change; add Three.js) | project lead | M0.7 | D-009 accepted |

## Other tasks
| ID | Description | Priority | Status | Owner | Depends | Done when |
|---|---|---|---|---|---|---|
| T-000 | Initialize repo, skeleton, context files | high | done | lead | — | Health test passes, frontend renders, baseline committed |
| T-001 | Physics-engine feasibility spike | — | superseded by M0 | — | — | — |
| T-002 | GitHub remote and push baseline | high | done | lead | T-000 | `main` tracks `origin/main` (repo is public) |
| T-003 | Decide units and coordinate conventions | high | done (SI D-007, right-handed Cartesian D-010; origin chosen per scenario) | lead, Vaibhav | M0.1 | recorded in DECISIONS.md |
| T-004 | Add CI (pytest + frontend build) | medium | todo | integration dev | T-000 | CI green on main |
| T-005 | Collaborators and workflow | high | collaborators added 2026-10-23; workflow confirmation by all four pending | lead | T-000 | All four confirm `TEAM_WORKFLOW.md` |
| T-006 | API contract v1 + minimal API (healthz, state, create body) | high | done (commit `feat: add API contract v1 ...` on the topic branch) | lead | — | `API_CONTRACT.md`; API/health tests pass |
| T-007 | Implement planned endpoints (PATCH/DELETE bodies first), then start/pause/step/reset/events | high | done 2026-10-23: PATCH/DELETE/step/reset/events implemented; start/pause withdrawn (Play = client step loop) | backend dev | T-006; sim endpoints need D-008 | Contract rows flip to ✅ with tests |
| T-008 | Resolve Vite `/api` rewrite vs `/api/v1` backend paths | high | done (frontend proxy forwards unchanged; verified in browser 2026-10-24) | frontend owner | T-006 | Frontend reaches `/api/v1/simulation/state`. (The 11 failing spike tests mentioned earlier are fixed: `pytest` is 88 passed.) |

### Remote branch inventory — 2026-10-23
Fetched and created local tracking refs for `feature/m0-rebound-physics-api` (Aarit) and `codex/3drender` (Nikhil). Their work remains unmerged; branch-local test/status claims are not main verification. See HANDOFF/STATUS for changed files and current tips. M0 task statuses on main remain unchanged pending review/integration.
