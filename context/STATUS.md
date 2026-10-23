# Status
_Concise authoritative snapshot. Update after every meaningful session._

- **Phase:** M0 complete (engine decision accepted); integration branch `feature/m0-rebound-physics-api` pushed for review. Next milestone: production engine integration (P-001).
- **Decisions (accepted 2026-10-23):** D-008 **GO WITH CUSTOM COLLISION LAYER** (REBOUND + IAS15 + `line` detection + our own merger layer; evidence, failure modes and limitations in `PHYSICS_SPIKE.md`); D-007 SI units with explicit G; D-010 right-handed Cartesian; D-009 project license GPL-3.0-only (`LICENSE`, `THIRD_PARTY_NOTICES.md`; project decision, not legal advice).
- **Units:** SI project-wide (D-007): m, m/s, kg, s, J, kg·m²/s, G = 6.67430e-11. REBOUND's own SI constant (6.67408e-11) is overridden.
- **Git:** work is on branch `feature/m0-rebound-physics-api` (API commit + M0 spike + license + docs, rebased on the latest `origin/main`, pushed with a normal push; `main` untouched). Branch `origin/validation/physics-first-principles` (independent physics review) is still unmerged.
- **Tests (run 2026-10-23):** `pytest` -> **88 passed, 3 warnings** (1 health + 29 API + 58 spike; ~9 s; run twice, identical). Spike tests need REBOUND 5.2.2 (`backend/experiments/requirements.txt`, installed only in the local `.venv`) and skip without it. `npm run build` re-run 2026-10-23: OK.
- **Works:** backend `/health`, `/healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies` (in-memory, no physics); Vite page; API contract v1 (`API_CONTRACT.md`).
- **M0 findings in one line each:** orbits conserve E, L to ≤1e-12 (IAS15); `direct` detection misses fast collisions (50/50 sweep collisions, 91% of fast phases), `line` had 0 errors in 144 swept scenarios (evidence, not proof); merger conserves mass/momentum to 1e-12 but kinetic+potential energy and orbital angular momentum are not conserved (booked in ledgers); checkpoint restore is bitwise identical but the resolver must be re-registered; WHFast is unsafe near collisions; collision order is random unless `rand_seed` is fixed; IAS15 needs a reset after a merge.
- **Not implemented:** the simulation itself (no REBOUND in the app, no events, no checkpoints endpoint, no tidal model, no Three.js scene).
- **Known risks:** see `PHYSICS_SPIKE.md` (untested: strongly curved paths, tree modes, many simultaneous collisions, scale; IAS15 warning after a merge with capped chunks); no frontend tests or CI; Vite proxy strips `/api` while the backend serves `/api/v1` (T-008); workflow confirmation by all four collaborators pending (T-005).
- **GitHub:** public repo https://github.com/aarithooda/playing-god ; collaborators added 2026-10-23.
- **Next:** review/merge the topic branch, then P-001 (production collision layer in the app) and the follow-ups P-002..P-004.

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

- **Phase:** M0 physics-engine feasibility spike; implementation still pre-simulation.
- **GitHub:** CLI 2.103.0 installed and authenticated as `biscuitfab`; Git credential setup succeeded. `main` context is pushed through `bca9ab0`.
- **Review branch:** `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains an independent analytical report and standard-library calculator; no PR opened.
- **Uncommitted main change:** `frontend/package.json` esbuild allowScripts edit; preserved and excluded from commits.
- **Not verified:** no REBOUND engine run, checkpoint experiment, collision implementation, or M0 go/no-go.
- **Tasks:** M0.1 agreement and M0.2/M0.3 experiments remain open; the independent report is a comparison reference, not a task closure.
- **Next milestone:** compare derivations, agree M0.1 units/conventions/tolerances, then run M0 fixtures.
