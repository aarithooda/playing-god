# Tasks
Status: todo / in progress / blocked / done. Keep tasks small and independently testable.

| ID | Description | Priority | Status | Owner | Depends | Done when |
|---|---|---|---|---|---|---|
| T-000 | Initialize repo, skeleton, context files | high | done | lead | — | Health test passes, frontend renders, baseline committed |
| T-001 | Physics-engine feasibility spike (REBOUND vs alternatives): install, 2-body orbit, collision handling, checkpoint save/restore, performance, licensing | high | todo | lead | T-000 | Written findings + accepted/rejected entry in DECISIONS.md; energy-conservation check on a 2-body orbit |
| T-002 | GitHub remote: install/authenticate `gh` (or create repo manually) and push baseline | high | todo | lead | T-000 | `git remote -v` shows origin; `main` tracks `origin/main` |
| T-003 | Decide units and coordinate conventions | high | todo | lead, Vaibhav | T-001 | Accepted entry in DECISIONS.md |
| T-004 | Add CI (pytest + frontend build) | medium | todo | integration dev | T-000 | CI green on main |
