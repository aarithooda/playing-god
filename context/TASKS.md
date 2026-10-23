# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

## NEXT ACTION
**Vaibhav and the project lead:** read the Results in `PHYSICS_SPIKE.md`, re-run `pytest tests/spike`, independently re-derive E1/E4/E5 expected values (M0.2), agree units/tolerances (M0.1), review the license (M0.7), then decide (M0.8). Experiment code is uncommitted until reviewed.

## M0 — Physics Engine Feasibility Spike
- **Priority:** highest · **Status:** in progress (first evidence pass done by AI 2026-10-23; awaiting joint review) · **Owners:** project lead + Vaibhav
- **Depends on:** T-000 (done). **Blocks:** T-003, all simulation features, engine dependency in `requirements.txt`.
- **Required decision at completion:** explicit go/no-go on REBOUND recorded in `DECISIONS.md` (D-003), with results table, agreed jointly.
- Plan and experiments: `PHYSICS_SPIKE.md`. Neither person builds a separate full engine.

| ID | Subtask | Owner | Status | Depends | Done when |
|---|---|---|---|---|---|
| M0.1 | Agree units, coordinate frame, tolerances, initial conditions for E1–E8 | lead + Vaibhav | todo (experiments used tentative G=1 code units; tolerances not jointly agreed) | — | Recorded in `DECISIONS.md` as proposed then accepted |
| M0.2 | Derive expected results and numeric acceptance criteria for E1–E2, E5 | Vaibhav | todo (AI-derived values used in tests; need independent re-derivation) | M0.1 | Hand-derived values in `PHYSICS_SPIKE.md`, matching tests |
| M0.3 | REBOUND install and two-body harness (E1, E2) | lead | in progress: run, orbit tests passed; awaiting review | M0.1 | Harness in `backend/experiments/`, `tests/spike/`; results in `PHYSICS_SPIKE.md` |
| M0.4 | Collision detection study (E3, E4) | Vaibhav (with lead) | in progress: run; direct misses fast collisions, line caught all; awaiting review; tree modes untested | M0.3 | Observed behavior and mitigation recorded |
| M0.5 | Merger and diagnostics (E5, E6) | Vaibhav + lead | in progress: run; mass/momentum conserved, diagnostics match; awaiting independent re-check | M0.2, M0.4 | Conservation within tolerance; independently re-checked |
| M0.6 | Checkpoint save/restore (E7) | lead | in progress: run; bitwise identical; resolver must be re-set; awaiting review | M0.3 | Restored run matches uninterrupted run; uncaptured state listed |
| M0.7 | Performance (E8) and license review | lead | in progress: timings recorded; license read = GPL-3.0-only; team decision on implications open | M0.3 | Timings table; license decision recorded |
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
| T-006 | API contract v1 + minimal API (healthz, state, create body) | high | done (uncommitted) | lead | — | `API_CONTRACT.md`; 30 API/health tests pass |
| T-007 | Implement planned endpoints (PATCH/DELETE bodies first), then start/pause/step/reset/events | high | todo | backend dev | T-006; sim endpoints need D-003 | Contract rows flip to ✅ with tests |
| T-008 | Resolve Vite `/api` rewrite vs `/api/v1` backend paths; fix 11 failing spike tests | high | todo | frontend owner / spike owner | T-006 | Frontend reaches `/api/v1/simulation/state`; full `pytest` green |
