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
- Status: proposed

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
