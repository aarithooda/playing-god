# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

## NEXT ACTION
Start **M0** (below): read `PHYSICS_SPIKE.md`, agree units/conventions (M0.1), then run M0.2 and M0.3 in parallel on separate branches.

## M0 — Physics Engine Feasibility Spike
- **Priority:** highest · **Status:** todo (nothing started) · **Owners:** project lead + Vaibhav
- **Depends on:** T-000 (done). **Blocks:** T-003, all simulation features, engine dependency in `requirements.txt`.
- **Required decision at completion:** explicit go/no-go on REBOUND recorded in `DECISIONS.md` (D-003), with results table, agreed jointly.
- Plan and experiments: `PHYSICS_SPIKE.md`. Neither person builds a separate full engine.

| ID | Subtask | Owner | Status | Depends | Done when |
|---|---|---|---|---|---|
| M0.1 | Agree units, coordinate frame, tolerances, initial conditions for E1–E8 | lead + Vaibhav | todo | — | Recorded in `DECISIONS.md` as proposed→accepted before experiments run |
| M0.2 | Derive expected results and numeric acceptance criteria for E1–E2, E5 (orbit period, E/L conservation, merger mass/momentum/KE loss) | Vaibhav | todo | M0.1 | Hand-derived values in `PHYSICS_SPIKE.md` before any run |
| M0.3 | Install REBOUND in a venv; run minimal two-body harness (E1, E2); document state, integrator, time-step API | lead | todo | M0.1 | Harness in `tests/spike/`; raw results appended; versions recorded |
| M0.4 | Collision detection study: detection modes, resolution options, tunnelling threshold (E3, E4) | Vaibhav (with lead) | todo | M0.3 | Observed behavior and mitigation recorded; no claims from docs alone |
| M0.5 | Merger via callback/built-in; verify mass, momentum conservation and diagnostics (E5, E6) | Vaibhav + lead | todo | M0.2, M0.4 | Conservation within agreed tolerance; diagnostics match hand calc; independently re-checked |
| M0.6 | Checkpoint save/restore and reproducibility (E7) | lead | todo | M0.3 | Restored run matches uninterrupted run within tolerance; uncaptured state listed |
| M0.7 | Performance (E8) and license review | lead | todo | M0.3 | Timings table; license summarized with distribution implications |
| M0.8 | Joint review of all results and go/no-go (or fallback decision) | lead + Vaibhav | todo | M0.2–M0.7 | D-003 updated to accepted/rejected; STATUS/HANDOFF updated |

## Other tasks
| ID | Description | Priority | Status | Owner | Depends | Done when |
|---|---|---|---|---|---|---|
| T-000 | Initialize repo, skeleton, context files | high | done | lead | — | Health test passes, frontend renders, baseline committed |
| T-001 | Physics-engine feasibility spike | — | superseded by M0 | — | — | — |
| T-002 | GitHub remote and push baseline | high | done | lead | T-000 | `main` tracks `origin/main` (repo is public) |
| T-003 | Decide units and coordinate conventions (finalized after M0.1) | high | todo | lead, Vaibhav | M0.1 | Accepted entry in DECISIONS.md |
| T-004 | Add CI (pytest + frontend build) | medium | todo | integration dev | T-000 | CI green on main |
| T-005 | Invite teammates as collaborators; agree branch/PR rules from `TEAM_WORKFLOW.md` | high | todo | lead | T-000 | All four can push branches; workflow confirmed by everyone |

### Independent reference note — 2026-10-23
The first-principles SI derivation and analytic fixture values are recorded in `context/INDEPENDENT_PHYSICS_REVIEW.md`, with an engine-independent calculator at `context/independent_reference.py`. This is a review artifact, not completion of M0.2: M0.1 conventions/tolerances and team cross-review remain prerequisites; no REBOUND results are implied.
