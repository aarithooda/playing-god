# Integration branch `integration/collision-engine`

Purpose: one locally checkable branch that contains current `main`, the complete collision engine (Stages 0-12) and the moons work, wired to the real frontend, so the combined system can be started and evaluated without assembling several branches. **Nothing was pushed, merged into `main`, opened as a PR or deployed.** Written 2026-10-25 (Claude Sonnet 5.5).

## 1. What is on the branch

- **Base:** `main` = `7148556` (merge of PR #15, `integration/ui-foundation`; `origin/main` is the same commit).
- **Merge 1, `3ebd881`:** `feature/moons-system` @ `f2c2da3` (5 commits: `050efcc`, `f3742ea`, `29e7bd3`, `a7b0277`, `f2c2da3`) = Solar System preset with 10 major moons as real bodies, moon rendering/selection, physical body sizes. It is on `origin` but was **not on `main`**; it is included because the task requires moon systems to keep working and the collision work touches the same preset, loader and frontend files.
- **Merge 2, `85ec678`:** `collision/stage-11-12` @ `941f0b6` (44 commits on `main`). The collision branches are one linear stack, so this one merge carries all of them: `planning/collision-particle-engine` (`263a15e`), `collision/stage-0-contracts` (`bb61e8d`) .. `stage-8-records` (`ffae9f2`), `stage-9-visualization` (`330790e`, includes Stage 10), `browser-verification` (`0c27a16`), `stage-11-prep` (`ed5c8a2`), `review-package` (`87aaf61`), then Stage 11 (`63a22a7`), Stage 12 (`ec5e688`) and the D-062 traceability re-audit (`941f0b6`). Full ancestry: `git log --oneline --graph integration/collision-engine`.
- **Conflicts:** none. Both merges were textually clean (checked beforehand with `git merge-tree`); 60 files are touched by both sides (for example `backend/simulation.py`, `backend/presets/loader.py`, `frontend/src/UniverseWorkspace.tsx`, `canvasBoundary.test.ts`) and were auto-merged. Semantic correctness of the combination is what the tests below check.
- **Not included:** `feature/body-render-metadata` (already an ancestor of `main`, nothing new). Original branches, the four worktrees and their contents are untouched. The worktree `collision-implementation` still has two **uncommitted** regenerated screenshots (`context/evidence/stage9-webgl/mark-*.png`); they are test output, left where they are, and are not on this branch (the committed versions are).
- **Integration changes (the only code changes after the merges):**
  1. `frontend/src/components/ui/CollisionInspector.tsx`: **defect found by the real-backend run.** A real disruption produces several debris parcels with identical text, which made the inspector list use duplicate React keys (console error; risk of dropped/duplicated rows). Keys now include the index. Regression test added in `collisionInspector.test.tsx` (fails without the fix, passes with it).
  2. `frontend/e2e/collision.real-backend.e2e.mjs` + script `npm run e2e:collision`: the first end-to-end test of the collision path against the **real backend** (the earlier collision browser spec uses a stubbed API).
  3. Documentation (this file and the status/task/handoff/worklog entries, README test section, API contract heading).
  No backend code, API shape or DTO had to change: the frontend client, parsers and UI already matched the backend (routes under `/api/v1/universes/{uid}/collisions[...]`, `/visual`, `/replay` are reachable from the UI: event list "Inspect record" -> `CollisionInspector`; `useCollisionEffects` -> `CollisionEffectsLayer`, `DebrisParticles`, `SurfaceMarks`).

## 2. Install and run

Requirements: Python 3.11+, Node 20+, npm, git. No GPU is required (the app and tests use software WebGL where no GPU exists); a real GPU only improves frame rate. No new dependencies were added. No environment variables are needed: the frontend dev server proxies `/api` and `/healthz` to `http://127.0.0.1:8000`; set `BACKEND_URL` (shell or `frontend/.env`) if the backend runs elsewhere. When the backend is down the UI shows "Backend: disconnected" and recoverable errors (covered by `events-and-recovery.spec.ts`).

```bash
git checkout integration/collision-engine
python -m venv .venv
source .venv/Scripts/activate        # Windows Git Bash; PowerShell: .venv\Scripts\Activate.ps1; Linux/macOS: source .venv/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm ci && cd ..

# terminal 1 (repo root, venv active)
uvicorn backend.main:app --port 8000
# terminal 2
cd frontend && npm run dev            # http://localhost:5173
```

State is in backend memory only (OD-5: no disk persistence); restarting the backend loses every universe.

## 3. Reproduce a collision by hand

The default sandbox universe (`uni-default`) uses collision mode `outcome-v1`. Presets and Orbit Lab runs stay `legacy-merge` (documented; Stage 11 added material annotations but did not change the preset mode), so **a preset will only ever produce the old `merger` event; use the sandbox for collision effects.** Bodies need a `material` (for example `{"profileId":"silicate-rock"}`); a body without one resolves as the legacy merger.

The controlled impact used by the automated test (rock on rock, head-on, 3 x mutual escape speed at contact; mT = 1e22 kg, mP = 5e21 kg, rT = 1e6 m, rP = rT (mP/mT)^(1/3), R = rT + rP, vEsc = sqrt(2 G (mT + mP) / R), d0 = 4 R, vC = 3 vEsc, vStart = sqrt(vC^2 - 2 G (mT + mP) (1/R - 1/d0))): target at the origin at rest; projectile at (d0, 0, 0) with velocity (-vStart, 0, 0). Create both with `POST /api/v1/universes/uni-default/bodies?activationEpoch=<n>` (`activationEpoch` from `GET /api/v1/universes`), open the UI, set Sim Speed to about 10^3.5 s, press **Step Forward** (one or two steps), then expand the left sidebar: a `collision` event appears with **Inspect record**; the inspector shows the provisional caveat and **Replay (dry run)**. Observed result on the author's machine: outcome `partial_accretion`, impact 3172 m/s, 20 created bodies (16 fragments, 4 debris parcels, all identical), mass conserved to 1e-12. Scenarios A-H of the specification are driven in `tests/impact/test_scenarios_e2e.py`.

## 4. Test commands and results (this branch, 2026-10-25, Windows 11, Python 3.11.7, Node 24.18.0, REBOUND 5.2.2, no GPU)

| Check | Command | Result |
|---|---|---|
| Backend regression suite | `.venv/Scripts/python -m pytest -q` | **1399 passed**, 1 warning (httpx deprecation), 478 s. An earlier run with `-x` stopped at `tests/impact/test_performance_stage1.py::...[200]` (0.340 s vs allowed 0.317 s) while vitest and Playwright were running concurrently; the same file passes alone (3 passed) and the complete rerun passed. Treat the timing test as load-sensitive. |
| TypeScript | `cd frontend && npm run typecheck` | clean |
| Frontend unit/component | `npm test` | see section 5 (final run after the fix) |
| Production build | `npm run build` | see section 5 (existing >500 kB chunk warning) |
| Playwright, stubbed API (collision effects incl. WebGL alignment, recovery, moons, frame pacing) | `PW_CHROMIUM_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe' npx playwright test` | 14 passed before the fix; see section 5 for the final run. **Stubbed API: this is not proof of real-backend behaviour.** |
| **Real backend + real UI collision journey** | `E2E_CHROMIUM=<chrome path> npm run e2e:collision` (starts its own backend :8012 and Vite :5184) | **ALL PASSED** (10 steps). First run found the duplicate-key defect above; passes after the fix. |
| Experiment 01 journey (real backend, independent universes, Orbit Lab) | `npm run e2e` | **not run** on this branch (pre-existing, unchanged by this work) |
| Live-server API smoke | `tests/smoke/test_live_server.py` | ran as part of the backend suite (passed) |

Environment note: Playwright 1.64.1 expects Chromium revision 1248; only revision 1243 is cached here and its `chrome.exe` cannot be launched (access denied). Setting `PW_CHROMIUM_PATH` to the installed Google Chrome 155/156 works; `playwright install chromium` is the alternative. All browser runs were headless with software WebGL (SwiftShader) - **no GPU run, no headed run, no Firefox/Safari.**

What the real-backend journey checks (`frontend/e2e/collision.real-backend.e2e.mjs`): bodies with materials created over the API in `uni-default`; the UI loads them; UI **Step Forward** advances through the real API until the backend emits a `collision` event (`hasVisual`, mass residual <= 1e-12, momentum residual <= 1e-9); the post-event body set matches `removed/surviving/created` ids and total mass equals the initial mass (bodies and diagnostics); the collision list, record detail and `/visual` description are served; the effect marker is rendered by the frontend from the backend's description; the UI lists the event and opens the inspector with the provisional caveat; UI-requested dry-run replay returns `reproduced: true`, `mutatesState: false` and leaves state and revision unchanged; three more UI steps continue the simulation with mass conserved; a second, collision-free universe steps without events and does not touch the first universe's record; reset empties the universe (as documented) and clears its records; no browser console errors and no failed requests. It does **not** check pixels of the debris/marks against a real-backend result (that remains with the stubbed spec's alignment test), moons, snapshots/restore, time controls other than Step Forward, or camera focus. Those paths are covered only by the unit/stubbed suites above.

## 5. Final frontend run after the fix

Run after the CollisionInspector fix, on the final tree: `npm run typecheck` clean; `npm test` **51 files / 503 tests passed**; `npm run build` succeeded (existing >500 kB chunk warning); `npx playwright test` (with `PW_CHROMIUM_PATH` = Google Chrome) **14 passed**; `npm run e2e:collision` **ALL PASSED**. Backend: 1399 passed (run before the frontend-only fix; no backend file changed after it).

## 6. Known limitations and open items (unchanged, stated honestly)

- **Governance (D-059):** CP-SCI-1 and CP-5 are *waived for continued development only*, **not signed**; the outcome models are provisional and not independently scientifically validated. Wording to use: "owner-accepted, not independently validated". No human sign-off was recorded or invented here.
- **Stage 12 stays `[-]` (not complete).** `context/STAGE12_DOD_AUDIT.md` lists unmet criteria: DOD-2 (75 traceability rows still PART), frame pacing with effects not measured, browser scenario G, GPU run. This branch adds one real-backend (software-WebGL) run; it does not close those.
- UD-1 and UD-2 discrepancies, provisional parameters, unsupported regimes (cratering Unsupported, no sourced wave speeds: static impact sites only, only 8 cited moment-of-inertia values) are unchanged and remain labelled in the UI and API.
- Presets and Orbit Lab stay `legacy-merge`. Collision effects therefore need the sandbox.
- Same-platform replay only (digest-based); **no cross-platform determinism claim**. No persistence by decision (OD-5).
- A real disruption currently emits 16 fragments and 4 identical debris parcels for the scenario above; whether that is physically sensible is a CP-SCI-1 question, not verified here.
- Performance on this machine (software WebGL, 64 bodies, no effects) was median 117 ms/frame; effect-heavy performance is unmeasured.
- `context/API_CONTRACT.md`'s section "Planned: collision engine" is a stale heading: the implemented parts are documented in the sections after it (Stages 4a-9).

## 7. Test plan for a stronger machine

1. Install and start as in section 2; confirm `GET http://127.0.0.1:8000/healthz` and the UI shows "Backend: connected".
2. `python -m pytest -q` (expect 1399 passed; if `test_performance_stage1` fails, rerun it alone before reading anything into it) and `cd frontend && npm run typecheck && npm test && npm run build`.
3. `cd frontend && E2E_CHROMIUM=<chrome> npm run e2e:collision`, then `npx playwright test` (set `PW_CHROMIUM_PATH` or run `npx playwright install chromium`). Also `npm run e2e` (Experiment 01) once, as it was not run here.
4. Manually, in a **headed** browser with a GPU: reproduce section 3, watch the flash, ejecta samples and surface marks; pause/play/seek behaviour of the effect (DQ-12); open the inspector and replay. Try scenarios B-D from `tests/impact/scenarios.py` (gas-envelope target, hit-and-run b = 0.7 at 1.5 vEsc, 8 vEsc disruption) by changing the numbers in section 3.
5. Performance: with the effect visible, record frame pacing (`frontend/e2e/rendering-profile.spec.ts` for the baseline; extend it with an active collision to measure effects) at 1/16/64 bodies; note GPU, browser and resolution. Step cost at N = 100/200: `tests/impact/test_performance.py`.
6. Load the Solar System with moons preset and check selection, focus, size modes and that no collision effects are expected (legacy-merge).
7. Record failures and the machine description in `WORKLOG.md`; do not mark Stage 12 complete from a green run.
