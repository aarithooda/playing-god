## UI-4 / UI-6 handoff (2026-10-24, Codex) — latest
1. All UI-4/UI-6 work is on the single branch `frontend/ui-4-6`, based on agreed `main` `d5220f9`. UI-2 history work remains removed after reassignment to teammate 1.
2. UI-4 now offers a merger-event action to highlight/select the surviving result body when that body is still present in current backend state. It uses existing selection behavior and opens Body Inspector. UI-6 now has keyboard/narrow viewport and disconnection-recovery browser tests, plus an attached rendering frame-pacing profile. No renderer, UI-0 registry/material, view-model, API, or backend files changed.
3. Verified locally: frontend typecheck; Vitest 206/206 across 23 files; build (existing >500 kB warning); Playwright 5/5; diff check. The profile measured 1/16/64 bodies at median 33.4/50.0/99.9 ms per animation frame in Windows headless Chrome with GPU disabled by test config; treat as software frame pacing, not hardware GPU timing. E2E stubs backend responses. Do not merge into `main` without owner approval; real-hardware profiling and UI-0 integration remain follow-ups.
# Handoff (latest — rewrite at end of each session)

## Collision engine, review package for Vaibhav prepared (2026-10-25, Claude Sonnet 5.5) — latest
000000000. **`context/COLLISION_REVIEW_PACKAGE_FOR_VAIBHAV.md`** is the consolidated scientific and technical review package (branch `collision/review-package`). It separates Part B scientific validation (CP-SCI-1: equations, constants, provisional parameters, materials, wave speeds, cratering, visual claims), Part A software correctness, and Part C the Definition-of-Done / CP-5 items, each with file/section, exact claim, evidence, limits and the question to answer; it also lists evidence gaps and documentation discrepancies found (stale scientific-notes header, stale risk R-22, plan/implementation deviations). **Nothing is signed or marked complete**: CP-SCI-1, CP-5 and the Stage 11 reviewer prerequisite are all open; no reviewer is named. No code changed. Next: the owner confirms who reviews (record in `TASKS.md`); the reviewer answers the checklist; Stage 11 and Stage 12 remain gated as before.

## Collision engine, DQ-3 (a) decided; Stage 11 gate CLOSED (2026-10-25, Claude Sonnet 5.5) 
00000000. Branch `collision/stage-11-prep` (stacked on browser-verification). DQ-3 = (a) with five safeguards (D-058). **Stage 11 implementation has NOT started and must not until a qualified reviewer is actually named** (Vaibhav has not confirmed; no alternative is confirmed; none is invented here). Done: `context/STAGE11_SOURCE_INVENTORY.md` (per body: GM, radius with basis, derived mean density; what is missing: composition, structure class, moment of inertia, LS12 parameters, wave speed, cratering; what the reviewer/owner must supply; acceptance tests to write). Without new sources every body would stay without a material or get an incomplete profile marked unsupported. **To proceed:** name the reviewer (record it in `TASKS.md`), supply cited values per body, then Stage 11 runs in bounded increments with the validation baselines captured first. CP-SCI-1 and CP-5 remain pending; Stage 12 cannot be marked complete before its criteria and the CP-5 sign-off. The previous entry below (browser verification) is unchanged.

## Collision engine, browser verification of Stage 9 (2026-10-25, Claude Sonnet 5.5)
0000000. Branch `collision/browser-verification` (stacked on stage-9). `frontend/e2e/collision-effects.spec.ts` now exists and passes (7 tests) in headless Chromium 153 (chrome-headless-shell, revision 1243) with --disable-gpu, i.e. software WebGL, driven by Playwright 1.64.1 against a STUBBED API; not a GPU run, not a headed browser, not Firefox/Safari, not the real backend; evidence screenshots in `context/evidence/stage9-webgl/`; two real rendering defects were found and fixed (D-057). **To run it:** from `frontend/`, either `npx playwright install chromium` (downloads a browser: do this deliberately) or set `PW_CHROMIUM_PATH` to an installed Chromium (here: `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1243\chrome-headless-shell-win64\chrome-headless-shell.exe`), then `npx playwright test e2e/collision-effects.spec.ts`. **Still not verified:** GPU rendering, other browsers, time scale / overlapping events / caps / frame pacing with effects, the real backend end to end. **Waiting on you (nothing started):** DQ-3 (Stage 11, CP-4: annotate presets with sourced materials, option (a) needs every value cited and a reviewer assigned, or (b) presets stay legacy: a recorded skip); the named human reviewer for CP-SCI-1 and CP-5 (none is named in `TASKS.md`; Vaibhav was approached only). Stage 12 follows Stage 11 or its recorded skip. Preparation finding for Stage 11: preset bodies carry only GM and radius from Horizons; no density, composition, structure class or moment of inertia exists in `backend/presets` or its sources, so every material value would be newly sourced.

## Collision engine, Stages 9 and 10 done (2026-10-25, Claude Sonnet 5.5)
000000. Branch `collision/stage-9-visualization` (stacked on stage-8; Stage 10 is on the same branch). CP-3 approved (D-053), DQ-11 (a) (D-054), `visual.py` gap resolved (D-055), choices D-056. Backend: `backend/impact/visual.py` + `GET .../collisions/{id}/visual`, `backend/impact/collision_state.py`. Frontend: UI-0 extension (two optional canvas inputs, orientation when present), `sim/collision/*`. **NOT DONE and must be said:** the renderer layers were never run in a browser (no Playwright browsers, no WebGL check); `e2e/collision-effects.spec.ts` and the Scenario A alignment screenshots do not exist; cross-platform replay tolerance is not implemented; there is no persistence (by decision). **Next:** Stage 11 (sourced material annotation of presets) needs DQ-3 (CP-4) and a named reviewer; Stage 12 (scenarios A-H, performance, DoD audit) needs CP-5 signed by the named human reviewer (DQ-14); CP-SCI-1 is still unsigned and blocks calling any science validated. Before any claim about visuals: run the e2e spec and a manual WebGL check.

## Collision engine, Stage 8 done (2026-10-25, Claude Sonnet 5.5)
00000. Branch `collision/stage-8-records` (stacked on stage-7). Read-only records API (list, detail, replay), `backend/impact/replay.py`, the frontend inspector (`CollisionInspector`, `sim/collision/describe.ts`, `useCollisionInspector`, an "Inspect record" button on collision events). Replay is same-platform bitwise by digest; it never mutates. **Next:** Stage 9 (particle engine and event visualization: `VisualEventDescription`, effects layers) needs CP-3 (human visual review) and DQ-12 timing; Stage 10 (persistence, isolation, determinism hardening, cross-platform tolerances) needs DQ-11. Open scientific dependencies unchanged (CP-SCI-1 unsigned; ejection factor/tracked share provisional; no sourced wave speeds; cratering Unsupported).

## Collision engine, Stage 7 done (2026-10-25, Claude Sonnet 5.5)
0000. Branch `collision/stage-7-lifecycle` (stacked on stage-6). DQ-10 (a) implemented (shortened step + `warnings`), lineage/cascade, classification (`fragmentClass`), escape ledger (`escaped`), PRS23 whenever debris exists (D-051). Frontend parses the new optional fields but shows nothing yet. **Next:** Stage 8 (records API, inspector, replay) needs nothing from the owner; the open scientific dependencies are unchanged (CP-SCI-1 unsigned; ejection factor/tracked share provisional; no sourced wave speeds; cratering Unsupported). Known limits: a removal emits no event; hit-and-run debris is still one parcel; legacy-merge presets cannot show any of this until Stage 11.

## Collision engine, Stage 6 done (2026-10-24, Claude Sonnet 5.5)
000. Branch `collision/stage-6-damage` (stacked on stage-5). Impact sites exist (body-local, bounded, in all state paths) and `GET /api/v1/universes/{uid}/bodies/{id}/surface` serves them. **Every shipped profile is the STATIC fallback: no wave speed has a source** (D-050). The propagation model is implemented and tested with a clearly synthetic profile. Crater size/ejecta extent are unmodelled (cratering Unsupported). **Next gates:** (a) to get a propagating front on a real body, someone must supply a verifiable, applicable wave speed per profile with provenance (basis measured/literature, value, units, assumption); (b) Stage 7 (lifecycle: classification, reaccretion, secondary impacts) needs DQ-10 (cascade control) and builds on the Stage 5 fragments; (c) CP-SCI-1 still unsigned.

## Collision engine, Stage 5 done (2026-10-24, Claude Sonnet 5.5)
00. Branch `collision/stage-5-fragments` (stacked on stage-4b). DQ-4/5/6 decided (D-046..D-048); implementation choices D-049. Disruption/erosion/accretion now produce a remnant, tracked fragments (`frag-<seq>-<k>`) and up to 4 parcels; budgets never drop mass. **Open scientific dependencies (block calling any of this validated):** CP-SCI-1 unsigned; ejection multiplier 1.05-1.10 and the 50 % tracked share are provisional; LS12 beta unverified; cratering Unsupported until an HH11 source is documented. **Next:** Stage 6 (damage/propagation) needs wave-speed sources per profile (missing wave speeds -> static site); Stage 7 (lifecycle, secondary impacts) needs DQ-10 (cascade control). Hit-and-run debris is still the single-parcel placeholder.

## Collision engine, Stage 4b done (2026-10-24, Claude Sonnet 5.5)
0. Branch `collision/stage-4b-default-mode`: new sandboxes and `uni-default` are `outcome-v1`; presets and Orbit Lab stay `legacy-merge` until Stage 11 (D-045). CP-SCI-1 is still provisional and unsigned. Next: Stage 5 needs the owner's DQ-4/5/6 answers (recommended: DQ-4 (a) massive gravitating parcels plus statistical visual samples; DQ-5 (a) keep MAX_BODIES = 200 shared with fragments/parcels; DQ-6 (a) disruption ejection speed as a multiple of the escape speed with the HH11 distribution for cratering and a budget-driven tracked-fragment threshold).

## Collision engine, Stage 4a done (2026-10-24, Claude Sonnet 5.5)
1. Branch `collision/stage-4a-application`. Outcomes are applied only in mode outcome-v1 (opt-in). Read D-043 (placeholders, DQ-13) and D-044 (REBOUND name defect: ALWAYS use `add_named_particle`).
2. Stage 4b (default `outcome-v1` for new sandboxes incl. `uni-default`) is gated by the CP-4b review; Stage 5 needs DQ-4/5/6 (recommended options adopted provisionally in the plan, D-043 for the launch placeholder).

## Collision engine, Stage 3 done (2026-10-24, Claude Sonnet 5.5) — latest
1. Branch `collision/stage-3-models`. The selector and models are pure and not yet called by the engine (Stage 4a).
2. Everything LS12-based is provisional (`backend/impact/models/provisional.py`); human review of D-038 and the open UD-1/UD-2 questions (COLLISION_SCIENTIFIC_MODELS.md 6b) is still welcome and may change outputs.

## Collision engine, Stage 2 done (2026-10-24, Claude Sonnet 5.5) — latest
1. Branch `collision/stage-2-materials-spin` in worktree `C:/Aarit/Projects/Playing God collision-implementation`. D-036 records the CP-1 acceptance; D-037 the Stage 2 choices.
2. STOP before Stage 3: the owner must answer DQ-7 (c* class rule), DQ-8 (gas-giant handling and envelope threshold), DQ-9 (strength regime) and name the human reviewer for CP-SCI-1. No LS12 constant is used by any model.
3. Nothing pushed or merged.

## Collision engine, Stage 1 done — STOPPED AT CP-1 (2026-10-24, Claude Sonnet 5.5) — latest
1. Branch `collision/stage-1-deferred-resolution` in worktree `C:/Aarit/Projects/Playing God collision-implementation`. Review package: the Stage 1 entry of `WORKLOG.md` and D-035. Nothing is pushed or merged.
2. To use the new path in a test: `SimulationService(CollisionConfig(mode="outcome-v1"))`; records via `svc.collision_records()`. No universe uses it yet (Stage 4 step 4b).
3. Do not start Stage 2 before CP-1 is accepted. Stage 3 additionally needs DQ-7/8/9 and a named CP-SCI-1 human reviewer.

## Collision engine implementation (2026-10-24, Claude Sonnet 5.5) — latest
1. Worktree `C:/Aarit/Projects/Playing God collision-implementation`; stacked branches `collision/stage-<n>-<topic>`, each created from the previous stage's tip (nothing may be merged). Stage 0 is on `collision/stage-0-contracts`.
2. Read `COLLISION_SONNET_EXECUTION_GUIDE.md` §1 and the live board at the end of `TASKS.md`. Python: use the main checkout's venv (`../Playing God/.venv/Scripts/python.exe`); frontend deps are installed in this worktree (`npm ci`).
3. Gates: CP-1 after Stage 1; Stage 3 needs DQ-7/8/9 answered and a named CP-SCI-1 human reviewer; CP-SCI-1 (UD-1 5.3 J/kg, UD-2 b_crit 0.66) must be signed off before any disputed LS12 constant is used; Stage 4b flips the sandbox default only after 4a is reviewed (CP-4b).

## Simulation Lab + Experiment 01 (2026-10-24, Claude Sonnet 5.5) — latest
- Implemented M1-M12 on `feature/simulation-lab-experiment-01` (see `STATUS.md` for commits, verification, scientific values, the browser journey and the checklist). One PR to `main`; not merged; no review has happened.
- Where things are: backend `universes.py` (registry, epoch guards), `simulation.py` (per-universe engine: revision, guards, snapshots, history recording, audit), `history.py`, `presets/`, `catalogue.py`, `orbit_lab.py`; frontend `UniverseWorkspace.tsx`, `sim/useUniverses.ts`, `sim/history/`, `sim/useOrbitLab.ts`, `render/contract.ts`; design `EXPERIMENT_01_IMPLEMENTATION_PLAN.md`, results `PRESETS.md` and `EXPERIMENT_01_PROTOCOL.md`, decisions D-025 to D-028.
- Gotchas: universes are in memory only (a restart loses them; the UI says so). Run your own backend/Vite (8011/5183) for checks, never the owner's :8000. `tests/conftest.py` gives every test a fresh registry. Archived Horizons files are marked `-text` in `.gitattributes` because their SHA-256 is verified at load. Reset now means "the initial state" of that universe. The TRAPPIST-1 gate investigation lives in the implementation session's notes folder, not in the repository.
- Open for the owner: TRAPPIST-1 gate (D-027), the spec section 4.2 numeric slip (D-028), product review, then the independent technical review.

## Final handover (2026-10-24, Claude Sonnet 5.5)
1. Read the FINAL HANDOVER section at the top of `STATUS.md`: it has the merged-PR table with SHAs, the teammate-work dispositions, the deleted-branch SHAs, the verification evidence and the Experiment 01 readiness assessment. `ARCHITECTURE.md` is current.
2. Repository state: only `main` remains (local = `origin/main`), plus the tag `archive/frontend-close-body-inspector` (the one unmerged, superseded commit). Verify with `git fetch --all --prune && git branch -a && git tag`.
3. **Running backend caveat:** the owner's backend on :8000 (pid 18780) was started from `25abca3`: it has D-011/D-012 but not D-021, and it holds a real universe (one merged body, t = 2.574e9 s, one merger) that cannot be restored through the API after a restart. It was not restarted. To use D-021 behaviour, restart it from current `main` (`.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`) and accept or re-create the universe (body parameters are in `STATUS.md`).
4. Before Experiment 01: the owner must supply its protocol (it is not in the repo); checkpoints (save/restore) and approximate tidal deformation from the brief are not implemented; browser behaviour has no automated E2E (T-010).
5. Verification recipe for WebGL geometry without trusting screenshots: DOM rects (`getBoundingClientRect`) plus a framebuffer probe (in a double `requestAnimationFrame`, `readPixels` from the canvas context and cluster bright blobs); the pane must be visible (`show_pane preview`) or rAF does not fire. Real-click mapping: probe it with a `pointerdown` listener (CSS px = frame px x innerWidth/800).

## M5 final verification and documentation (2026-10-24, Claude Sonnet 5.5) — latest
1. State of `main` (`f3b0057`) and what is verified: top of `STATUS.md`. System layout and interaction contract: `ARCHITECTURE.md` (rewritten). User-facing usage: `README.md`.
2. This PR adds one fix (`sim/framing.ts`: Fit view keeps the fitted scene inside the free area on narrow windows) plus docs. Commands: `python -m pytest`; `cd frontend && npm run typecheck && npm test && npm run build`; backend `.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; frontend `cd frontend && npm run dev`.
3. **Restart any long-running backend** started before 2026-10-24 evening: it may run pre-D-011/D-012/D-021 code (the universe is in memory and is lost on restart).
4. Open items: T-010 automated browser E2E; the history-system decision (only merger events are listed); Experiment 01 (not started); a worker process if native-integrate hangs ever need interrupting.
5. Verification tip for WebGL: screenshots from the in-app browser pane are device-pixel crops and lag; measure with DOM rects and a framebuffer probe (see `WORKLOG.md`, 2026-10-24 M5).

## Simulation stall investigation (2026-10-24, Claude Sonnet 5.5) — latest
1. The reported stall was a known IAS15 wedge (D-011) hitting a backend process that predates the fix, plus a lock/timeout design that let one stuck step make the whole app unusable. Details: `STATUS.md` (top), `WORKLOG.md`, proposed D-021, `API_CONTRACT.md` ("Concurrency").
2. **Action for the owner:** the old backend (pid 5328, port 8000) is still running and frozen at t = 155344829.88 s. Restart it from the current checkout (`.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8000`; this clears the in-memory universe). The three-Earth state is encoded in `tests/test_stall_resilience.py` (`INCIDENT_BODIES`) if you want to re-create it.
3. PR from branch `fix/simulation-stall-resilience`; not merged; no review or exception recorded. Commands: `python -m pytest`, `cd frontend && npm run typecheck && npm test && npm run build`.

## Remove selected-body ring (2026-10-24, Codex) — latest
1. Removed only the separate white ring mesh from `CelestialBody`; body click selection, inspector opening, double-click focus, and the subtle selected-body emissive highlight remain intact.
2. `npm run build` passed (641 modules); the existing >500 kB chunk warning remains. Tests and browser E2E were not run.
3. Source/context commit `ff372a0` is pushed to `origin/bugfix/body-inspector-close`; branch remains unmerged.

## Keep inspector open on body clicks (2026-10-24, Codex) — latest
1. Direct canvas presses that ray-hit a displayed body are marked before the inspector's document capture handler. Body clicks no longer dismiss the inspector; clicks elsewhere retain click-away dismissal, and drags continue to keep it open for camera orbit.
2. `npm run build` passed (641 modules); existing >500 kB chunk warning remains. Tests and browser E2E were not run.
3. Source commit `336ab26` is pushed to `origin/bugfix/body-inspector-close`; not merged.
## Keep body inspector open during camera drag (2026-10-24, Codex) — latest
1. Outside-pointer dismissal now waits for pointer-up and closes after a 300 ms double-click window only if movement stayed under 6 px. Dragging on the canvas therefore keeps the inspector open while OrbitControls rotates around the focused body; a normal outside click still dismisses it.
2. `npm run build` passed (640 modules); existing >500 kB chunk warning remains. Tests and browser E2E were not run.
3. Source commit `1ac2115` is pushed to `origin/bugfix/body-inspector-close`; not merged.
## Revert universe background zoom changes (2026-10-24, Codex) — latest
1. Restored `UniverseCanvas` to its state at `3e03479`: the original Drei starfield (`radius=300`, `depth=60`, `count=20000`) and no custom maximum zoom-out/body-cloud cap or dynamic far-plane logic.
2. All other fixes present by `3e03479` remain: inspector dismissal, focus framing/animation, body placement and earlier UI behavior.
3. `npm run build` passed (640 modules; existing >500 kB chunk warning). No test suite or browser E2E was run. Reversion commit `41dda60` is pushed to `origin/bugfix/body-inspector-close` at the user's request.
## Dismiss body inspector on outside click (2026-10-24, Codex) — latest
1. The body inspector now closes on pointer-down anywhere outside its panel, while clicks inside the panel and its close button keep their existing behavior.
2. `npm run build` passed with the existing >500 kB bundle warning. Frontend tests and browser E2E were not run.
3. Changes are on `bugfix/body-inspector-close`; to be committed and pushed.

## Consistent on-screen focus size (2026-10-24, Codex) — latest
1. Focus now targets a sphere silhouette occupying 25% of the canvas height. Camera distance is computed from the body's displayed radius and the perspective camera's vertical field of view, so small and large bodies reach the same apparent size.
2. Focus still animates smoothly and returns to the same framing on every focus request. `npm run build` passed with the existing >500 kB bundle warning; no browser E2E or test suite was run.
3. Source commit `2ad5167` is pushed to `origin/bugfix/body-inspector-close`; this branch remains unmerged.

## Slightly increase focus zoom (2026-10-24, Codex) — latest
1. Fixed focus distance changed from 70 to 66 scene units, making focused bodies about 6% larger at the default framing while keeping focus repeatable.
2. Frontend Vitest passed (59/59); `npm run build` passed with the existing >500 kB chunk warning. Browser E2E was not run.
3. Source commit `efbc2ee` is pushed to `origin/bugfix/body-inspector-close`; this branch remains unmerged.

## Fixed-distance focus and 3D create placement (2026-10-24, Codex) — latest
1. Focus now animates to a fixed 70-scene-unit distance, a slight change from default framing. Repeated focus requests cannot progressively zoom in.
2. Create-form 3D placement uses a translucent gray sphere on a camera-facing plane. Wheel depth sensitivity was raised 30%. Clicking computes the same ray-plane point as the preview and immediately creates the body; the scene scale is held for that layout update so the body remains exactly at the preview location. Escape/button cancels.
3. Frontend Vitest 59/59 passed; `npm run build` passed with the existing large-chunk warning. Browser E2E was not run. Follow-up code commit `ad8bdb3` is pushed to `origin/bugfix/body-inspector-close`; not merged.

## Visible body placement and smooth focus (2026-10-24, Codex) — latest
1. On `bugfix/body-inspector-close`, automatic create positions are now checked against both SI collision radii and displayed sphere radii using the post-create `fitTransform`; the search stride accounts for large physical radii. This addresses visually overlapping bodies caused by the renderer's logarithmically exaggerated sizes.
2. Camera focus now eases the camera and OrbitControls target over 0.65 s with smoothstep interpolation. Frontend checks: 57 Vitest tests passed; `npm run build` passed (existing >500 kB chunk warning). No browser E2E run.
3. Code changes are local and still need commit/push. Branch is not merged. See `STATUS.md`, `TASKS.md`, and `WORKLOG.md`.

## Body single-click and double-click focus (2026-10-24, Codex) — latest
1. On `bugfix/body-inspector-close`, single click still selects a body and opens its inspector; double-click additionally focuses the camera on it.
2. Focus recenters OrbitControls and moves 10% closer per request, stopping at 2.5× the body's displayed radius (minimum 1.5 scene units). `npm run build` passed (640 modules; existing >500 kB warning). No test suite run.
3. Both the dynamic body-placement fix and this interaction change are on the same bug-fix branch. Commit `82d0dcb` and its parent are pushed to `origin/bugfix/body-inspector-close`; branch is not merged.
4. See `STATUS.md`, `TASKS.md`, and `WORKLOG.md`.

## Collision-free body creation defaults (2026-10-24, Codex) — latest
1. On `bugfix/body-inspector-close`, the create form now chooses a position outside existing body spheres using their current positions/radii and the requested new radius. It refreshes automatic positions when the body set or radius changes; once the user edits any position coordinate, it preserves that choice and backend overlap errors remain visible.
2. `npm run build` passed (640 modules; existing >500 kB bundle warning). No test suite run. Source commit `526c2a7` is pushed to origin.
3. See `STATUS.md`, `TASKS.md`, and `WORKLOG.md`.

## Close button for selected-body inspector (2026-10-24, Codex) — latest
1. The close-button fix is on `bugfix/body-inspector-close`, based on latest `origin/main`; the commit was copied from `frontend/close-body-inspector`. The older branch remains intact.
2. It adds a compact accessible × button beside the Body Inspector title. It clears `selectedBodyId` and closes the inspector; selecting a body still opens it. No outside-click behavior added.
3. `npm run build` passed (640 modules transformed; existing >500 kB bundle warning). The bugfix branch is not merged.
4. See `STATUS.md`, `TASKS.md`, and `WORKLOG.md`.

## Backend connection restored (2026-10-24, Codex) — latest
1. Frontend showed “connecting to the simulation backend” because the backend process was unresponsive. A clean restart failed with `ModuleNotFoundError: No module named 'rebound'` in this checkout's `.venv`.
2. Installed the declared dependency set with `.venv/Scripts/python.exe -m pip install -r backend/requirements.txt` (REBOUND 5.2.2), then started Uvicorn at `127.0.0.1:8000`.
3. Verified HTTP 200 for backend `/healthz`, `/api/v1/simulation/state`, and matching frontend-proxied `/healthz` and `/api/v1/simulation/state`. State is paused at 0 s with no bodies. Server remains running in this app session; no application source or manifest changed.
4. See `STATUS.md` and `WORKLOG.md`.

## Frontend local dependency recovery (2026-10-24, Codex) — latest
1. The import-analysis error for `@react-three/fiber` came from incomplete local `frontend/node_modules`; both Fiber and Drei were already in `package.json` and `package-lock.json`.
2. Stopped the two Vite processes from this checkout because they held `esbuild.exe`, ran `npm ci` (243 packages), and confirmed `npm run build` succeeds. The frontend is running at `http://localhost:5173/` (HTTP 200).
3. No app source or manifest changed. npm reported 6 audit vulnerabilities (3 moderate, 1 high, 2 critical); no audit fix was applied. See `STATUS.md` and `WORKLOG.md`.

## Local baseline cleanup (2026-10-24, Codex) — latest
1. Fetched `origin/main` at `8f3c37b` and aligned the local `main` checkout to it. Working tree is clean; the previous local-only `frontend/package.json` esbuild allowScripts edit was removed per the user's baseline-only request.
2. Removed local worktrees and branches for `codex/3drender`, `feature/m0-rebound-physics-api`, `m0-collision-validation`, `validation/physics-first-principles`, and `validation/production-physics-review`. Their committed changes are ancestors of `main`.
3. `feature/frontend-api-integration` was verified as fully merged and had no open PR; its remote branch was deleted. `origin` now advertises only `main`.
4. Stopped the old port-5174 Vite server. The port-5173 frontend and port-8000 backend remain running.
5. A separate uncommitted repository `C:\Users\calli\code\playing-god-t3` remains outside the main repo because the filesystem safety policy rejected recursive deletion. It was not modified; see `WORKLOG.md`.

---

## Baseline closed (2026-10-24, Claude Sonnet 5.5) — newest
0. D-011/D-012 and the two validation tolerances are accepted (Vaibhav). Baseline code `b9f1a01`; fresh checks and CI green (STATUS.md). Ready for the next product milestone; backlog items are non-blocking.

### Stabilization session details
1. **State:** `main` pushed, CI green, working tree clean. Numbers and details: top of `STATUS.md`, `WORKLOG.md`.
2. **Branches:** retired local `backup/local-main-2dfc8ac` (its content is commit `0ce89a3`, already in main; old tip recoverable via reflog `2dfc8ac`) and remote `codex/3drender`, `validation/physics-first-principles`, `validation/production-physics-review` (their work was merged into main first: `tests/validation/`, `context/INDEPENDENT_PHYSICS_REVIEW.md`, `context/independent_reference.py`, `context/PRODUCTION_PHYSICS_INDEPENDENT_VALIDATION.md`). `feature/production-rebound-simulation` and `feature/m0-rebound-physics-api` no longer existed locally or on origin at the start (already contained in main). `feature/frontend-api-integration` was kept while its session was active, then retired after integration; see the newer cleanup section above.
3. **Decisions:** D-011 and D-012 accepted; the two restated fixture tolerances in `tests/validation/` accepted (see WORKLOG).
4. **Do next:** code-split the 3D bundle; optional automated browser test (T-010); bump GitHub Actions versions (Node 20 deprecation); decide a policy for `estimatedContactTimeS = null`; latency work if N>=150 matters.
5. **Do not change without investigation:** `select_ias15` (never assign `sim.integrator = "ias15"` directly: re-selecting resets the criterion to the stalling default), the heartbeat watchdog, the lone-body drift.
6. Sections below are history.

---
## Integration session (2026-10-24, Claude Sonnet 5.5)
1. `main` now contains backend + frontend (backend fast-forwarded, frontend merged with a merge commit; history preserved). Older local `main` commit `2dfc8ac` (superseded duplicate of the API commit) is kept on local branch `backup/local-main-2dfc8ac`.
2. Checks and the manual browser journey are recorded at the top of `STATUS.md`. Run commands are there too.
3. Do first: review the two Codex validation branches (`origin/validation/production-physics-review` is based on the production backend and adds tests under `tests/validation/`; not merged, owner not confirmed finished); P-003 stress tests; title/panel overlap at 800x600; code-split the 3D bundle; add CI.
4. Sections below are earlier handoffs; statements like "not pushed/not merged" are historical.

---
## Backend physics session (2026-10-23, Claude Sonnet 5.5) — newest
1. **Branch:** `feature/production-rebound-simulation` (from `feature/m0-rebound-physics-api` + local merge of `origin/main` docs). Not pushed, not merged. The frontend session works in a separate worktree (`Playing God-frontend`).
2. **Implemented:** production engine and API per `API_CONTRACT.md`; 149 tests pass. Details in `STATUS.md` (top section) and `WORKLOG.md`.
3. **Do first:** review/merge; frontend integrates against the contract (step loop, events, 409 handling). Then P-003 stress tests (strongly curved binaries, >3 simultaneous collisions, extreme mass ratios, N≈100–200 latency), a per-step wall-clock guard, and optionally checkpoints.
4. **Do not change without investigation:** `line` detection, seeded `rand_seed`, IAS15 re-selection after any structural change, name-based ids, chunking criterion, transactional rollback. Do not import `backend/experiments` from the app.
5. **Run:** `.venv/Scripts/python.exe -m pytest` (REBOUND is in `backend/requirements.txt`; the repo's `.venv` has it).

---
## Earlier handoff (M0 session; partly superseded by the section above)

**Date:** 2026-10-23 · **By:** Claude Sonnet 5.5 for the project lead

1. **Project:** PLAYING GOD — browser 3D gravitational sandbox (React/TS/Vite/Three.js frontend, FastAPI backend, backend owns physics state). See `PROJECT_BRIEF.md`.
2. **Current state:** production REBOUND/IAS15 backend with merger layer, events, step budget (D-011/D-012) and system diagnostics (D-013), plus the React/Three.js frontend; see `STATUS.md`. Public repo https://github.com/aarithooda/playing-god. See `STATUS.md`.
3. **Last completed milestone:** M0 (physics engine feasibility): decision accepted, **GO WITH CUSTOM COLLISION LAYER** (D-008); SI units (D-007), right-handed Cartesian (D-010), GPL-3.0-only (D-009). API milestone (contract v1 + minimal endpoints) integrated. All on branch `feature/m0-rebound-physics-api`.
4. **In progress:** nothing. The topic branch was rebased on the latest `origin/main` and pushed (normal push); `main` is untouched. Awaiting review/merge.
5. **Do first:** review/merge the branch into `main` via PR; compare `origin/validation/physics-first-principles` (independent review) with `PHYSICS_SPIKE.md`; then start P-001 (production collision layer) following the layer spec; keep P-002..P-004 in view.
6. **Relevant files:** `context/PHYSICS_SPIKE.md`, `context/DECISIONS.md` (D-007, D-008, D-009), `context/TASKS.md`, `backend/experiments/rebound_spike.py`, `backend/experiments/collision_spike.py`, `tests/spike/test_si_gravity_orbits.py`, `tests/spike/test_collisions_mergers.py`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `context/INDEPENDENT_PHYSICS_REVIEW.md` (only on the unmerged branch).
7. **Commands:** `pip install -r backend/experiments/requirements.txt`; `pytest` (88 passed on 2026-10-23); `python -m backend.experiments.rebound_spike`; `python -m backend.experiments.collision_spike`; frontend: `cd frontend && npm run build`.
8. **Do not change without investigation:** backend-owns-state (D-001); SI units and G = 6.67430e-11 set explicitly (D-007). D-008 is accepted, but REBOUND is still not in `backend/requirements.txt` and the app must not import `backend/experiments`: the production integration is the next milestone (P-001). Do not use WHFast where bodies can collide, do not return 0 from a collision resolver, do not index bodies by array position, and do not loosen test tolerances to force passes (tests named `*known_failure*` / `*limitation*` pin observed REBOUND behaviour: if they fail, REBOUND changed — read the report first). `sep 20012` in the WHFast radial failure hangs the process: do not add it to tests.
9. **Uncommitted changes / failures:** none (working tree clean after the push). Warnings: Starlette/httpx deprecation; IAS15 non-convergence RuntimeWarning after a merge with capped chunks (F10, unresolved); REBOUND restore warning (expected).

**API addendum (from the earlier API session):** `context/API_CONTRACT.md` + `backend/{models,store,main}.py` + `tests/test_api.py` implement healthz/state/create-body only. Remaining: frontend owner fixes the Vite proxy (it strips `/api`, backend serves `/api/v1/...`, T-008); implement PATCH/DELETE bodies (T-007); simulation endpoints wait for D-008. Update the contract in the same change.

## Remote sync notes (Codex, 2026-10-23; historical, kept from origin/main)
Statements below were written before the M0 evidence existed (for example 'no engine verification'); the sections above are authoritative.

**Date:** 2026-10-23 · **By:** Codex

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See `PROJECT_BRIEF.md`.
2. **Repository:** Context was fetched from origin before edits. Docs-only context commits are pushed to `main` (latest `bca9ab0`); the existing uncommitted `frontend/package.json` esbuild allowScripts edit is intentionally preserved and excluded.
3. **GitHub CLI:** Installed version 2.103.0 at `C:\Program Files\GitHub CLI\gh.exe`; authenticated as `biscuitfab`. `gh auth setup-git` was applied; Git fetch and push succeeded.
4. **Independent physics review:** Branch `validation/physics-first-principles` commit `a6540f0` is pushed and tracks origin. It contains `context/INDEPENDENT_PHYSICS_REVIEW.md` and its independent calculator. No PR was opened.
5. **M0:** no simulation implementation/engine verification. M0.1 and M0.2/M0.3 experiments remain open. The review is an analytical reference only; compare it with the teammate derivation and agree M0.1 before engine runs.
6. **Next:** review the pushed validation branch, agree conventions/tolerances, then run prescribed M0 fixtures. D-003 remains proposed.

_(origin/main side of the merge, kept as history:)_

1. **Project:** PLAYING GOD — browser 3D Newtonian gravity sandbox; backend will own authoritative state. See PROJECT_BRIEF.md.
2. **Current checkout:** main is aligned with origin/main at fac831b; only the existing uncommitted frontend/package.json esbuild allowScripts change remains. It was preserved.
3. **Remote branches fetched:** feature/m0-rebound-physics-api (Aarit, head 14af4f4, six branch-only commits and one main-only context commit) and codex/3drender (Nikhil, head 397e563, one branch-only commit and five main-only commits). Local tracking refs and separate worktrees were created at exact remote heads; existing checkouts and branch tips were not moved, merged, rebased, or reset.
4. **What they contain:** Aarit branch adds API/body state, REBOUND M0 experiments and tests, license/third-party notices, and updated M0 decisions/results. Its own STATUS says 88 pytest cases and frontend build passed; this session did not rerun them. Nikhil branch adds the 3D canvas, camera controls, and UI shell.
5. **Worktrees:** C:\Users\calli\code\playing-god-feature-m0-rebound-physics-api and C:\Users\calli\code\playing-god-codex-3drender are clean and track their respective origin branches.
6. **PR state:** GitHub reports no open PRs; neither branch has been integrated into main.
7. **Independent physics review:** validation/physics-first-principles remains pushed at a6540f0; no PR opened.
8. **Next:** review the topic branches and choose integration order. Rebase codex/3drender on current main before opening its PR; keep the Aarit feature branch as pushed until review. Do not treat its branch-local status as main status before merge.
