# Simulation Lab + Experiment 01 — Implementation Plan (implementation handoff)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (single implementer on one branch) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Simulation Lab and Experiment 01 end to end on one branch.
- **Simulation Lab:** independent backend-owned universes; active-only advancement; in-memory snapshots, restore and reset; a validated Solar System preset (TRAPPIST-1 only if it passes its gate); a sourced body catalogue; custom stars and planets; a renderer integration boundary (UI-0); a backend-recorded simulation history with timeline and replay (UI-2).
- **Orbit Lab / Experiment 01:** an immutable baseline against a velocity-scaled modified run, compared on a fixed backend timeline and validated against an independent analytic reference.

**Architecture:**
- **Backend.** A `UniverseRegistry` owns one `SimulationService` engine per universe. Each engine has its own lock, REBOUND simulation, merger resolver, ledgers, events, history and snapshots.
  - Only the active universe can be mutated.
  - Every mutation echoes the activation epoch it was issued under. The engine re-checks the epoch under its lock on entry and again immediately before commit, so a stale or late request can never change the wrong universe.
- **Frontend.** Layout state stays in `App`. One `UniverseWorkspace` is mounted per universe, keyed by `universeId:activationEpoch`, so a switch discards every client task of the old universe.
- **Renderer.** It receives only defined inputs (UI-0). The history model (UI-2) is renderer-independent.

**Tech stack:** FastAPI + Pydantic v2 + REBOUND 5.2.2 (IAS15 GLOBAL, `line` collisions), Python 3.11. React 18 + TypeScript 5 + Vite 5 + three 0.186 / R3F 8 / drei 9. pytest; vitest + Testing Library.

**Authoritative documents** (read all three before changing anything; the specs outrank this plan):
- `context/specs/SIMULATION_LAB_SPEC.md` (Draft 0.2 + amendment 1)
- `context/specs/EXPERIMENT_01_SPEC.md` (Draft 0.3 + amendment 1)
- this plan

**Branch:** `feature/simulation-lab-experiment-01`, based on `main` @ `d5220f93b25a93d08ae4fd3f7754fe7811710045`. It already contains the planning commit `d09a997` and the handoff-finalization commit that follows it. There is no separate documentation PR. The owner decided that the specs, plan and implementation travel together in one PR.

**Status:** final handoff revision, 2026-10-24, by the planning architect (Claude Opus 5.5). It contains no implementation and no review of any implementation.

## Global constraints
- SI units in every API field and test. G = 6.67430e-11 m³ kg⁻¹ s⁻² (D-007). One right-handed inertial Cartesian frame (D-010).
- The engine configuration does not change: IAS15 GLOBAL (D-011), wall-clock budget (D-012), `line` collisions and `rand_seed = 12345` (D-008), lock-free reads (D-021).
- The backend is authoritative for physical state and integration (D-001). The frontend never integrates, extrapolates or predicts positions.
- History is recorded from backend-produced states only.
- No new runtime dependency: no database, no worker process, no E2E framework, no numpy requirement.
- Data files are committed. The runtime never uses the network.
- Universes are in memory only (OD-5).
- Never invent astronomical values, epochs or citations. Every value carries a source and a basis label.
- Never loosen a test or tolerance to make it pass. Investigate and report.
- Git rules:
  - Work only on `feature/simulation-lab-experiment-01`.
  - Never commit to `main`, force-push, rewrite history, merge your own PR, or create a second implementation branch.
  - Never restore or use the deleted `feature/grid-axis` (or any branch other than `main` and this one).
  - Never touch the owner's backend on port 8000.

## Review focus
These are failure modes that no single task's tests fully exercise. Each one is pinned by the test named here.
1. **Switch with a step in flight, then switch back (A→B→A).** The old A step must never commit. Pinned by `test_aba_switch_rejects_old_epoch` (M1).
2. **History mixing.** Positions from a different universe, a pre-reset or pre-restore generation, or the other Orbit Lab run must never appear in one timeline. Pinned by `history cache never mixes universes or generations` (M7) and `test_history_generation_changes_on_reset_and_restore` (M2).
3. **Backend restart while the UI is open.** The UI must show a "universes were lost" notice, never stale state presented as current. Pinned by `useUniverses resyncs after universe-lost and shows notice` (M4).
4. **Edit the modified run, then reset it.** The run becomes uncontrolled, then controlled again, and the audit log keeps the edit. Pinned by `test_modified_edit_marks_uncontrolled_and_reset_restores_controlled` (M8).
5. **Comparison before the modified run advances, or at differing times.** The response must say so explicitly, never return an empty success. Pinned by `test_comparison_incomplete_reported` (M8) and `comparison flags different simulation times` (M9).
6. **A history fetch fails during Play.** The cache keeps what it has, shows "may be incomplete", and never interpolates. Pinned by `history fetch failure keeps cache and marks stale` (M7).

---

## 1. Executive summary
- **Verified start:** `main` = `origin/main` = `d5220f9`. There is one in-memory `SimulationService` (`backend/simulation.py:368`). No universe, snapshot, preset, catalogue, history or experiment concept exists. The only "history" today is the merger event log (`GET /api/v1/events`, last 1000) shown by `EventTimeline`.
- **Isolation:** per-universe engine objects, plus an activation epoch checked twice under the engine lock. Switching cancels the outgoing in-flight step, and the commit check rolls it back.
- **Snapshots:** `rebound.Simulation.copy()` plus deep copies of service state.
  - Planning probe: bit-identical continuation within one process, unverified through the service path (§15.0).
  - Reset restores each universe's immutable initial snapshot.
- **History (UI-2):** the backend records positions per universe, in `grid` mode (exact times k·Δ) or `step` mode (each committed step end).
  - It is bounded, partitioned by universe and generation, and stored in snapshots.
  - The frontend has a renderer-independent history model, hooks and a timeline/replay control.
- **Renderer boundary (UI-0):** the canvas gains one input, `trajectories`. Everything else reaches it through the existing `bodies` and view props. Display size and physical radius are kept distinct.
- **Presets (OD-1):**
  - The Solar System at J2000 is required (Horizons vectors + DE440 GM).
  - TRAPPIST-1 is optional and gated (M11).
  - Kepler-90 is removed.
- **Catalogue (OD-2):** 5 stars and 4 planets. Each property has a value, uncertainty, source and basis.
- **Experiment 01 (OD-3):**
  - Model: Sun + Earth–Moon barycentre (EMB) at J2000.
  - Control: speed factors {0.90, 0.95, 1.05, 1.10}.
  - Timeline: 730 days, sampled daily on an exact grid.
  - Check: independent Kepler reference, tolerance 1e-10·a.
  - The consequences of omitting the Moon are measured and documented, not assumed negligible.
- **Delivery:**
  - Required: M1–M10 and M12.
  - Optional and gated: M11 (TRAPPIST-1).
  - One PR to `main`. The implementer never merges (OD-6).

## 2. Starting state and audit findings

### 2.1 Repository state verified 2026-10-24 (handoff revision)
| Item | Value |
|---|---|
| `main` = `origin/main` | `d5220f93b25a93d08ae4fd3f7754fe7811710045` (merge of PR #13). Unchanged since the specs were written. |
| Remote heads | `main` only. `origin/feature/grid-axis` was deleted by the owner; `git fetch --prune` removed the stale local ref. It must not be restored or used. |
| Local branches | `main`; `feature/simulation-lab-experiment-01` |
| Planning commit | `d09a997` (three documents only) on top of `d5220f9`. The local branch `docs/simulation-lab-plan` that first held it was deleted after the feature branch was created at it (fully merged; never pushed). |
| Tags | `archive/frontend-close-body-inspector` |
| Open PRs | none |
| Worktrees | the main checkout only |
| REBOUND / Python (`.venv`) | 5.2.2 / 3.11.7 |
| Baseline tests on `d5220f9` (planning session) | pytest **265 passed**, 1 warning; `tsc` clean; vitest **203 passed** (23 files); `npm run build` **not run by planning** (re-run in Task 0.3) |

**Operational caveat (unchanged):** the owner's backend on :8000 may run old code and holds an unrestorable universe. Use your own ports (backend :8011, Vite :5183).

### 2.2 Backend audit (verified in code)
- **Engine:** `SimulationService` (`backend/simulation.py`). `_new_sim` sets units m/s/kg, G = 6.67430e-11 after `units`, `rand_seed` 12345, IAS15 GLOBAL via `collisions.select_ias15`, `collision="line"`, `MergeResolver.resolve` and `_heartbeat`.
- **Body identity and metadata:** body id = particle `name` (`body-<12 hex>`). `_meta` holds (name, colorHex) in creation order. `MergeResolver` holds `heat_J` and `spin`.
- **Time:** only `step(dt_s)` advances time (`_advance`: 1 % curvature chunks, at most 2000 chunks, heartbeat deadline). Play is a client loop (`frontend/src/sim/useSimulation.ts:213-232`).
- **Transactions:** `_capture` → advance → `_restore` on failure. Restore is a records rebuild and is not bitwise (D-012). Failures map to 500; timeouts to 503.
- **Concurrency:** one `RLock`. Mutations go through `_guard()`, which waits a bounded time and then returns 503 busy. Reads return `_published` without taking the lock (D-021).
- **Reset:** empties the universe at t = 0. Event ids keep counting.
- **Not supported today:** universes, activation, snapshots, presets, catalogue, body kind, position history, experiments.
- **API today:** `GET /healthz`, `GET /api/v1/simulation/state`, `POST /api/v1/bodies`, `PATCH|DELETE /api/v1/bodies/{id}`, `POST /api/v1/simulation/step`, `POST /api/v1/simulation/reset`, `GET /api/v1/events` (`context/API_CONTRACT.md`). Every endpoint in §12 that is not in this list is new and must be added to `API_CONTRACT.md` in the same commit that adds it.

### 2.3 Frontend audit (verified in code)
- **Data flow:** `App.tsx` owns UI state and calls `useSimulation(client)` once.
- **`useSimulation`:** one FIFO queue and a Play loop. Every `setState` is guarded by `mounted.current`, which is why remounting drops late responses.
- **`api/client.ts`:** fixed paths. Timeouts are 8 s for reads and 35 s for writes. `api/parse.ts` reads known keys only, so additive fields are safe.
- **Renderer:**
  - `UniverseCanvas` props: `bodies: SceneBody[]`, selection, focus, `frameEpoch`, placement, insets, `transform`, `showAxes` and `showGrid`.
  - Child components: `CameraRig`, `ViewportInset`, `CelestialBody`, `StarfieldShell` and `ViewOverlays`.
  - Display size comes from `displayRadiusUnits(radiusM)` in `renderTransform.ts` (logarithmic, clamped 0.3–6 scene units), separate from the physical `radiusM`. The minimum on-screen size comes from `bodyVisibility.ts`.
- **Panels:** `ControlPanel`, `BodyInspector` (Apply is allowed while playing today), `BodyFields`, `validation.ts`, `EventTimeline`, `DiagnosticsPanel`, `ViewPanel`, `Sidebar` / `layout.ts`.

### 2.4 Tests and CI (verified)
- **Backend:** `python -m pytest -q` (`pytest.ini`: `testpaths = tests`, `pythonpath = .`, `error::RuntimeWarning`).
- **Frontend:** `npm run typecheck`, `npm test`, `npm run build`.
- **CI** (`.github/workflows/ci.yml`) runs all of the above on pushes to `main` and on PRs.
- **Browser:** there is no browser E2E framework (T-010). The implementing session may use Playwright MCP or the in-app browser for a scripted manual journey.

### 2.5 UI-0 / UI-1 / UI-2 provenance
- UI-0, UI-1 and UI-2 are **not defined anywhere in the repository or its history**. The only trace is a merge message on the deleted, accidental branch ("feature/ui1-ui3-only"), which must not be used.
- **UI-2** is defined by Nikhil's proposal as accepted by the owner (SL spec §8.1). Its implementation is §11B / M7.
- **UI-0** is defined in this plan as the minimum renderer integration boundary the owner described (SL spec §8.2). Its implementation is §11A / M6.
- **UI-1** has no specification. Nothing in this branch implements "UI-1". If the owner later supplies it, it is new scope.

## 3. Requirement → file → test traceability matrix
`fe/` = `frontend/src/`. Every listed test is created in the milestone (MS) shown.

### 3.1 Simulation Lab
| Req | Requirement | Files | Tests | MS |
|---|---|---|---|---|
| SL-1 | Extend the existing app; backend authoritative; no frontend IDs over shared state | `backend/universes.py`, `backend/simulation.py`, `fe/App.tsx`, `fe/UniverseWorkspace.tsx` | `test_two_universes_hold_different_states`, `test_derived_engine_shares_no_mutable_objects`; full suites | M1, M4 |
| SL-3 | An id is not independence | `backend/universes.py` | `test_two_universes_hold_different_states` (asserts `is not` on sim, resolver, meta, history) | M1 |
| SL-4.1a | Clear navigation; active universe identifiable | `fe/components/ui/UniverseSwitcher.tsx` | `shows active universe name and role` | M4 |
| SL-4.1b | Leaving stops advancement and retains state; no background advance | `backend/simulation.py`, `backend/universes.py` | `test_switch_during_step_rolls_back_outgoing_step`, `test_step_active_leaves_other_bitwise_unchanged` | M1 |
| SL-4.1c | Returning resumes at the exact instant | same | `test_return_resumes_exact_instant` | M1 |
| SL-4.2 | Lifecycle, active-only, concurrency, stale and invalid requests, failure, cleanup | `backend/universes.py`, `backend/errors.py`, `backend/api_universes.py` | `test_mutation_on_inactive_universe_rejected[*]`, `test_stale_epoch_rejected`, `test_aba_switch_rejects_old_epoch`, `test_concurrent_steps_serialized`, `test_expected_revision_rejects_duplicate`, `test_stuck_universe_does_not_block_other_universe`, `test_delete_active_rejected`, `test_delete_then_404_with_deleted_detail`, `test_universe_limit`, `test_last_failure_recorded_and_cleared`, `test_legacy_routes_target_default_and_refuse_when_inactive`, `test_reset_waits_or_busy_during_step`, `test_edit_between_steps_is_atomic`, `test_activation_does_no_integration` | M1 |
| SL-4.3 | In-memory only; loss is detected after a restart | `fe/sim/useUniverses.ts` | `useUniverses resyncs after universe-lost and shows notice`; smoke `test_restart_loses_universes_and_default_is_recreated` | M4, M10 |
| SL-5.1/5.4 | Solar System preset with full provenance; validation standard | `backend/presets/loader.py`, `backend/presets/data/solar-system-j2000.json`, `backend/presets/sources/horizons/*`, `scripts/presets/fetch_horizons.py`, `context/PRESETS.md` | `test_solar_raw_to_si_exact`, `test_solar_masses_from_de440_gm`, `test_solar_barycentre_shift_zero_momentum`, `test_solar_against_horizons_1y_2y`, `test_solar_bodies_exact_set`, `test_solar_provenance_complete`, `test_preset_invalid_file_creates_nothing`, `test_presets_list_marks_unavailable` | M3 |
| SL-5.2 | TRAPPIST-1 gated; Kepler-90 removed | `backend/presets/data/trappist-1-agol2021.json` (M11 only) | `test_trappist_*` (M11), `test_presets_list_has_no_kepler90` | M3, M11 |
| SL-5.3 | Loading creates a new universe; nothing is replaced silently | `backend/api_universes.py`, `fe/components/ui/PresetPicker.tsx` | `test_preset_load_creates_new_universe_and_leaves_others`, `loading a preset creates a new universe and does not delete the current one` | M3, M4 |
| SL-6.1/6.2 | Approved catalogue with provenance; copies only; entries, assets and presets kept distinct | `backend/catalogue.py`, `backend/catalogue_data.json`, `fe/components/ui/CataloguePanel.tsx` | `test_catalogue_entries_and_provenance`, `test_catalogue_is_immutable`, `shows estimated badge and uncertainty`, `labels colour as display only`, `catalogue entry prefills form without mutating the catalogue` | M5 |
| SL-6.3 | No moons; consequences documented and measured | `context/PRESETS.md`, `tests/validation/test_moon_omission.py` | `test_solar_bodies_exact_set`, `test_emb_point_mass_vs_three_body_bounded`, `test_emb_offset_from_earth_centre_recorded` | M3 |
| SL-7 | Custom stars and planets; validation; pause-to-edit; cancel | `backend/models.py` (`kind`), `fe/components/ui/{ControlPanel,BodyFields,BodyInspector}.tsx`, `fe/sim/validation.ts` | `test_body_kind_defaults_and_roundtrip`, `test_edit_between_steps_is_atomic`, `create star sends kind star`, `apply disabled while playing with explanation`, `revert leaves confirmed values`, `invalid mass shows field error and sends nothing`, `server 409 detail shown verbatim` | M1, M5 |
| SL-7 / §8.2 | Physical radius vs displayed size | `fe/components/ui/BodyInspector.tsx`, `fe/components/canvas/CelestialBody.tsx` | `inspector labels physical radius and states display size is exaggerated` | M5, M6 |
| SL-8 | Controls target an explicit universe; status reported honestly | `fe/api/client.ts` (`scoped`), `fe/components/ui/SnapshotPanel.tsx` | `scoped client sends activationEpoch on every mutation`, `SnapshotPanel.test.tsx` | M4 |
| SL-8.1 (UI-2) | Backend-recorded, bounded, partitioned history; timeline and replay; missing data shown as missing | `backend/history.py`, `backend/simulation.py`, `fe/sim/history/*`, `fe/components/ui/HistoryTimeline.tsx` | §11B test list | M2, M7 |
| SL-8.2 (UI-0) | Renderer integration boundary | `fe/render/contract.ts`, `fe/components/canvas/{UniverseCanvas,TrajectoryLayer}.tsx`, `fe/sim/trajectory.ts` | §11A test list | M6 |
| SL-9.1 | Snapshot contract (in-memory) | `backend/simulation.py` (`EngineSnapshot`) | `test_snapshot_restore_physical_state_exact`, `test_snapshot_restore_bitwise_continuation`, `test_restore_preserves_engine_configuration`, `test_failed_restore_leaves_state`, `test_event_ids_not_reused_after_restore`, `test_snapshot_of_one_universe_cannot_restore_another` | M2 |
| SL-9.2 | Reset targets one universe; destructive actions confirmed | `backend/simulation.py`, `fe/components/ui/ConfirmButton.tsx` | `test_reset_restores_initial_snapshot_only_target`, `test_reset_default_sandbox_is_empty_like_before`, `reset and restore require confirmation` | M2, M4 |
| SL-9.3 | Independent copies | `SimulationService.from_snapshot` | `test_derived_engine_shares_no_mutable_objects`, `test_modified_ops_leave_baseline_bitwise` | M2, M8 |
| SL-10 | Orbit Lab: immutable baseline; uncontrolled changes identifiable | `backend/orbit_lab.py`, `fe/components/ui/{OrbitLabPanel,RunBadge}.tsx` | M8 and M9 lists | M8, M9 |
| SL-11/12 | UX priorities; NFRs (no background integration, direct isolation tests, no weakened tests) | all | `test_activation_does_no_integration`; browser journey §14.13 | all |
| SL-13 | Acceptance criteria | — | §20 | — |

### 3.2 Experiment 01
| Req | Requirement | Files | Tests | MS |
|---|---|---|---|---|
| E01-1/2 | Real backend gravity; the velocity effect separable from other effects | `backend/orbit_lab.py` | `test_comparison_common_grid_and_separation`, `test_initial_differences_only_selected_velocity`, `test_sample_grids_identical` | M8 |
| E01-3 | Learning objectives; model limits visible | `fe/components/ui/OrbitLabPanel.tsx`, `context/EXPERIMENT_01_PROTOCOL.md` | `shows two-body model limitation note` | M9, M12 |
| E01-4.1 | Immutable baseline | `backend/universes.py`, `backend/orbit_lab.py` | `test_baseline_rejects_edits`, `test_baseline_rejects_snapshot_and_restore`, `test_baseline_reset_restores_initial` | M8 |
| E01-4.2 | Derived run; one variable; recorded; uncontrolled changes identifiable | `backend/orbit_lab.py`, `backend/simulation.py` | `test_modified_derived_from_initial_not_current`, `test_speed_factor_preserves_direction`, `test_modified_edit_marks_uncontrolled_and_reset_restores_controlled`, `test_cosmetic_edit_keeps_controlled`, `test_snapshot_carries_controlled_flag` | M2, M8 |
| E01-4.3 | Isolation | M1 + `backend/orbit_lab.py` | `test_modified_ops_leave_baseline_bitwise` + M1 tests | M1, M8 |
| E01-5 | Sun + EMB at J2000 from the Solar data; Moon-omission consequences | `backend/orbit_lab_systems.json`, `backend/orbit_lab.py` | `test_exp01_system_bodies_and_sources`, `test_exp01_initial_state_from_horizons_exact`, `test_exp01_two_body_barycentre_zero_momentum`, `test_emb_point_mass_vs_three_body_bounded` | M3, M8 |
| E01-6 | Factor set; preview before creation; backend validation | `backend/orbit_lab.py`, `fe/components/ui/OrbitLabPanel.tsx` | `test_disallowed_factor_or_body_rejected_without_change[*]`, `preview shows baseline and modified speed before creation` | M8, M9 |
| E01-7 | 12-step workflow; active-run identity | `OrbitLabPanel.tsx`, `RunBadge.tsx` | `run badge distinguishes baseline and modified`; browser journey | M9, M10 |
| E01-8 | 730 d daily grid; five outputs; differing times flagged; display never mutates | `backend/history.py`, `backend/orbit_lab.py`, `fe/components/ui/ComparisonPanel.tsx`, `fe/components/canvas/TrajectoryLayer.tsx` | `test_grid_history_exact_times`, `test_comparison_common_grid_and_separation`, `test_comparison_incomplete_reported`, `comparison flags different simulation times`, `comparison never calls mutating endpoints`, `orbit lab passes both runs as trajectories with roles` | M2, M6, M8, M9 |
| E01-9 | Validation table | `tests/validation/kepler_reference.py`, `tests/validation/test_experiment01.py` | `test_exp01_matches_kepler_reference[f]`, `test_exp01_qualitative_ordering`, `test_exp01_period_matches_vis_viva[f]`, `test_exp01_energy_and_angular_momentum_drift[f]` | M8 |
| E01-10 | Reset of one run only; snapshot contract; reproducibility | `backend/simulation.py`, `backend/orbit_lab.py` | `test_experiment_repeatable_digests`, `test_experiment_bitwise_repeatable_trajectories`, `test_reset_modified_only` | M2, M8 |
| E01-11 | Error cases | §17.3 | §17.3 tests | M8–M10 |
| E01-14 | One modification; no moons; no extra physics | `backend/orbit_lab.py` | `test_only_one_modification_kind` | M8 |

## 4. Gaps
| Area | Today | Needed |
|---|---|---|
| Ownership | `_service` singleton | Registry with per-universe engines |
| Advancement | lock + budget | Epoch eligibility |
| Snapshots | records rebuild on failure only | `copy()`-based snapshots |
| Reset | empty | Initial snapshot per universe |
| History | merger event log only | Position history (UI-2) |
| Renderer inputs | `bodies` + view props | `trajectories` input (UI-0) |
| Data | user input only | Sourced preset and catalogue |
| Experiment | none | Orbit Lab |

## 5. Architecture and decisions

### 5.1 Backend modules
| File | Responsibility |
|---|---|
| `backend/simulation.py` (modify) | `SimulationService` becomes the per-universe engine. Adds revision, a `guard=` parameter, a cancel flag, an initial snapshot, snapshot/restore, `load_bodies`, history recording via `HistoryBuffer`, the controlled flag and an audit log. Physics unchanged. |
| `backend/history.py` (new) | `HistoryBuffer`: `grid` / `step` modes, `array('d')` storage, retention, segments, generation, per-body metadata, pages |
| `backend/universes.py` (new) | `Universe`, `UniverseRegistry`, `get_registry()`, `DEFAULT_UNIVERSE_ID = "uni-default"`; legacy `get_service()` returns the default universe's engine |
| `backend/errors.py` (new) | Coded conflicts and new exceptions (§12.1) |
| `backend/lab_models.py` (new) | Pydantic models (§12) |
| `backend/api_universes.py`, `backend/api_orbit_lab.py` (new) | Routers |
| `backend/presets/{__init__,loader}.py`, `backend/presets/data/`, `backend/presets/sources/` (new) | Preset data and validation |
| `backend/catalogue.py`, `backend/catalogue_data.json` (new) | Catalogue |
| `backend/orbit_lab.py`, `backend/orbit_lab_systems.json` (new) | Experiments |
| `backend/main.py` (modify) | Routers; legacy guard; coded-error handler |
| `scripts/presets/fetch_horizons.py` (new, dev-only) | Regenerates source and derived data |

### 5.2 Frontend modules and ownership
| File | Owner milestone | Responsibility |
|---|---|---|
| `fe/api/{types,parse,client}.ts` | M4 (extended in M5–M9) | DTOs, strict parsers, `scoped()` |
| `fe/sim/useUniverses.ts`, `fe/UniverseWorkspace.tsx` | M4 | Universe list, scope, keyed workspace (moves universe-dependent UI out of `App.tsx`) |
| `fe/App.tsx` | M4 only (later milestones add no lines except what M6 strictly needs, if any) | Layout state, switcher, keyed workspace |
| `fe/sim/useSimulation.ts` | M4 | `ScopedClient`; `onScopeInvalid`; `onBusyWriteChange`; reports `revision` |
| `fe/render/contract.ts`, `fe/components/canvas/TrajectoryLayer.tsx`, `fe/sim/trajectory.ts`, `fe/components/canvas/UniverseCanvas.tsx` (one new prop) | **M6 (UI-0) only** | Renderer inputs |
| `fe/sim/history/{historyModel,useHistory,useHistoryNavigation}.ts`, `fe/components/ui/HistoryTimeline.tsx` | **M7 (UI-2)** | History model, hooks, controls. **Must not import from `components/canvas/*` or modify `UniverseCanvas.tsx`.** |
| `fe/components/ui/{UniverseSwitcher,PresetPicker,SnapshotPanel,ConfirmButton}.tsx` | M4 | — |
| `fe/components/ui/CataloguePanel.tsx` | M5 | — |
| `fe/components/ui/{OrbitLabPanel,ComparisonPanel,RunBadge}.tsx`, `fe/sim/useOrbitLab.ts` | M9 | — |

### 5.3 Decisions and rejected alternatives
| # | Decision | Rejected alternative and why |
|---|---|---|
| A1 | One engine instance per universe | Frontend IDs (forbidden by the spec); one REBOUND sim (shared state); one process each (unneeded infrastructure) |
| A2 | Activation epoch, checked at entry and at commit | An id alone fails the A→B→A race |
| A3 | Activation cancels the outgoing step; the commit check rolls it back | Waiting would let a stuck run block switching; committing late is background advancement |
| A4 | Only the active universe can be mutated; reads work on any universe | Editing inactive universes multiplies the stale-target cases |
| A5 | Snapshots via `Simulation.copy()` plus service state | Particle records only is not a checkpoint; disk persistence is excluded (OD-5) |
| A6 | Immutable initial snapshot; reset restores it | A second load path |
| A7 | Preset load always creates a new universe | An implicit replace silently destroys state |
| A8 | Modified run derived from the baseline's initial snapshot | Deriving from the current state makes the start depend on progress |
| A9 | The backend records history and computes comparisons | Frontend recording misses steps made by other tabs or before a reload, and is not authoritative |
| A10 | Legacy endpoints are bound to `uni-default` | Removing them breaks ~100 tests; binding them to "active" lets an old request misdirect |
| A11 | Keyed workspace remount | Hand-written generation counters |
| A12 | In-memory only (OD-5) | — |
| A13 | Offline data scripts; committed sources | Live network at runtime |
| A14 | Sun + EMB two-body for Experiment 01 | Sun + Earth-centre (≈110× worse vs. the ephemeris); full system (no analytic reference) |
| A15 | Two history modes: `grid` (presets, Orbit Lab) and `step` (sandbox) | Grid only (sandbox time scales vary from seconds to years); step only (no common timeline for comparison) |
| A16 | The renderer gains one input (`trajectories`); historical frames reuse the existing `bodies` prop | History coupled into the canvas; a parallel canvas |

### 5.4 Data flow
- **Step:** `ControlPanel.onStep` → `useSimulation.doStep` → `ScopedClient.step(dtS)` → `POST /api/v1/universes/{id}/step?activationEpoch=E` → `registry.guard_for` → `engine.step(dtS, guard)` (lock; guard; advance and record history; guard; publish or roll back) → parse → `applySim` (only if the workspace is still mounted). A revision change triggers `useHistory.refresh()`, which calls `GET …/history?generation=G&fromIndex=N`.
- **History view:** `useHistoryNavigation` → `HistoryFrame` → the workspace maps it to `SceneBody[]` → the existing `bodies` prop.
- **Paths:** `historyModel.trajectoryOf` → `TrajectoryInput[]` → the `trajectories` prop → `TrajectoryLayer`.

## 6. Universe isolation and active-only advancement

### 6.1 Identity and limits
- `universeId` is `uni-<12 hex>`. The default universe `uni-default` (role `sandbox`, empty) is active at startup with epoch 1.
- `Universe` fields: `id`, `name` (1–64 characters), `role ∈ {sandbox, preset, baseline, modified}`, `preset_id`, `experiment_id`, `provenance`, `engine`, `created_at`, `snapshots`, `deleted`.
- **Limits (technical defaults, chosen for a bounded worst case):**
  - `MAX_UNIVERSES = 8`;
  - `MAX_SNAPSHOTS_PER_UNIVERSE = 10`;
  - `MAX_HISTORY_POINTS = 200_000` body-position records per universe (`array('d')`, 24 B each ≈ 4.8 MB);
  - worst case ≈ 8 × 11 × 4.8 MB ≈ 420 MB.
- Body ids are unique per universe. Preset and system bodies use stable ids (`body-sun`, `body-mercury`, …, `body-earth` for the EMB). Derived runs keep the baseline's ids. User-created bodies use `body-<12 hex>`.

### 6.2 Registry and lock order
- The registry holds `_lock`, `_universes`, `_deleted_ids`, `_active_id` and `_epoch`. `_epoch` increases by 1 on every activation.
- A universe is eligible to advance when it is active, not deleted, and the request's `activationEpoch == _epoch`.
- **Lock order:** an engine lock may be held while briefly taking the registry lock. The registry lock is never held while waiting for an engine lock.

### 6.3 CommitGuard
`guard_for(universe_id, activation_epoch, expected_revision=None) -> CommitGuard` validates immediately and returns a closure that re-validates under the registry lock.

Every engine mutator takes `guard=None` and calls it at two points: right after acquiring the engine lock, and immediately before publishing. A failure at the second point restores the pre-mutation state:
- steps use the existing `_capture` / `_restore`;
- CRUD, reset and restore use an `EngineSnapshot` taken at entry.

`guard=None` keeps the current behaviour for existing direct-service tests.

### 6.4 Activation
`activate(uid)` runs under the registry lock only:
1. Return 404 if the universe is unknown or deleted.
2. Cancel the previous universe: `previous.engine.request_cancel()`.
3. Set `_active_id`, then `_epoch += 1`.
4. Clear the new universe's cancel flag: `new.engine.clear_cancel()`.

It returns `{activeUniverseId, activationEpoch, previous: {universeId, simulationTimeS, revision} | null}`. It never integrates (`test_activation_does_no_integration`).

### 6.5 Cancellation
- `_heartbeat` stops `integrate` when the deadline passes **or** the cancel flag is set.
- `_check_deadline` raises `StepCancelled` first when the cancel flag is set.
- `step` then rolls back and the API answers 409 `deactivated_during_step`.
- If the engine stalls natively and the heartbeat never runs, the commit guard still blocks the commit when `integrate` returns.

### 6.6 Targeting
- Mutations: `…/universes/{uid}/…?activationEpoch=<int>[&expectedRevision=<int>]`. A missing epoch → 422. Reads take no epoch.
- Role rules (§11.3) are enforced before the engine is called.

## 7. Lifecycle, concurrency and failure semantics

### 7.1 States
- Per universe: `idle` ↔ `mutating`, plus `deleted`. The `active` flag is held by the registry.
- `status` is computed by a non-blocking lock probe.
- `lastFailure: {kind ∈ step_failed|step_timeout|deactivated_during_step|busy|restore_failed, message, atSimulationTimeS, atIso} | null` is set on a failed mutation and cleared by the next success.
- `revision` increases by 1 on every committed change and is present in every response.

| From | Event | To | Effect |
|---|---|---|---|
| idle, active | valid mutation | mutating → idle | commit; revision +1 |
| mutating | universe deactivated | idle | rollback; 409 `deactivated_during_step` |
| mutating | engine error / non-finite value / budget exceeded | idle | rollback; 500/503; `lastFailure` set |
| idle, inactive | any mutation | idle | 409 `universe_not_active` |
| not active | delete | deleted | removed; straggler commits are blocked |
| active | delete | — | 409 `active_universe_delete` |

### 7.2 Races
| Race | Behaviour | Test |
|---|---|---|
| Switch A→B while A steps | The switch returns immediately; A's step is cancelled or blocked at commit, rolled back, and answered 409 | `test_switch_during_step_rolls_back_outgoing_step` |
| Pause during a step | Client-only; the in-flight step commits | existing Play tests |
| Reset during a step | Bounded wait, or 503 busy | `test_reset_waits_or_busy_during_step` |
| Two simultaneous steps | Serialized; with `expectedRevision` the second gets 409 `stale_revision` | `test_concurrent_steps_serialized`, `test_expected_revision_rejects_duplicate` |
| Edit while running | UI disables Apply during Play; backend applies edits atomically between steps | `test_edit_between_steps_is_atomic`, `apply disabled while playing with explanation` |
| Inactive, deleted or stale target | 409 / 404 / 409; no change | M1 tests |
| Stuck integration | Other universes unaffected; switching still works | `test_stuck_universe_does_not_block_other_universe` |
| Lost client state | `GET /universes` supplies the scope | `useUniverses loads active scope on start` |
| A→B→A with an old request | 409 at entry, or rollback at commit | `test_aba_switch_rejects_old_epoch` |
| Pending write during a switch | Switcher disabled until it settles | `switcher disabled while a write is pending` |
| History fetch in flight during a switch | Workspace remounts and the late page is dropped | `history page from old workspace is ignored` |

### 7.3 Restart and cleanup
- A restart loses everything, and a fresh `uni-default` is created. The client gets 404 and shows "The backend restarted; universes held in memory were lost."
- Deletion is always explicit. There is no automatic garbage collection.

## 8. Snapshots, reset and restoration

### 8.1 EngineSnapshot
**Contents:**
- `sim` (taken with `copy()`; never integrated itself);
- `meta` (id → name, colour, kind);
- `events`, `heat_J` and `spin` (copies);
- `history` (a `HistoryBuffer` copy, including its generation);
- `controlled` and `first_uncontrolled_at_s`;
- `simulation_time_s`, `revision` and `digest`.

**Excluded:**
- `event_seq`, which is monotonic;
- the append-only audit log.

**Restore:**
1. Set `sim = snap.sim.copy()`.
2. Re-register `collision_resolve` with a new resolver holding the restored ledgers, and re-register `heartbeat`.
3. Set the history generation to `snapshot generation + a new unique value`, so client caches are invalidated (§11B.3).

### 8.2 Guarantees and limits of in-memory REBOUND copies
1. **Exact physical state:** bodies (ids, order, names, colours, kinds, masses, radii, positions, velocities), simulation time, events, ledgers, history and controlled status.
2. **Bit-identical continuation:** holds within the same backend process, REBOUND build and machine, provided the same `dtS` sequence follows. It must be proven by `test_snapshot_restore_bitwise_continuation` **through the service path** (chunking + history targets). The planning probe tested REBOUND directly only.
3. **Not guaranteed:**
   - survival of a restart;
   - equality across processes, machines, OS or REBOUND versions;
   - Python callbacks, which are not part of the copy (hence re-registration);
   - memory beyond the caps.
4. **If the bitwise test fails on a platform:** document "numerically equivalent continuation" with the measured difference, which the spec permits, and report it.

Step-failure rollback is unchanged (records-based, D-012).

### 8.3 Initial snapshot, reset, digest
- `load_bodies(bodies, *, history_mode, sample_interval_s)` is only allowed at N = 0 and t = 0. It adds the bodies in order, records history sample 0, captures the initial snapshot, sets revision to 1 and publishes.
- An empty sandbox captures its initial snapshot in `__init__`.
- `reset` restores the initial snapshot and increments revision; history returns to sample 0 with a new generation. For `uni-default` this is today's reset.
- `initial_state_digest` is SHA-256 over canonical JSON of:
  - per body: `[id, name, kind, m.hex(), r.hex(), x…vz .hex()]`;
  - `t.hex()`, `G.hex()`, integrator, adaptive mode, collision mode, `rand_seed`, `history_mode` and `sample_interval_s`.
  Colour is excluded.

### 8.4 Derived engines
`from_snapshot(snap, *, transform=None, history_mode, sample_interval_s)` builds a new engine from `snap.sim.copy()`, applies `transform`, then captures its own initial snapshot and history sample 0. It shares no mutable objects with the source (`test_derived_engine_shares_no_mutable_objects`).

## 9. Presets (OD-1)
Common rules for all presets:
- SI units.
- m = GM/G, so the source GM is reproduced exactly.
- The origin is the barycentre of the included bodies.
- t = 0 is the epoch.
- Every value carries a `basis ∈ {measured, nominal, derived, assumed}` and its sources.
- History mode is `grid`, with an interval chosen per preset.

### 9.1 Solar System `solar-system-j2000` (required)
- **Source:** Horizons API `https://ssd.jpl.nasa.gov/api/horizons.api` with `EPHEM_TYPE=VECTORS`, `CENTER='500@0'`, `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`, `VEC_TABLE=2`, `VEC_CORR=NONE`, `OUT_UNITS=KM-S`, `TIME_TYPE=TDB`, `CSV_FORMAT=YES`, `OBJ_DATA=NO`.
  - Every target reported "source: DE441" in planning. Record the actual value per target.
  - `TLIST` values: 2451545.0 (initial state); 2451910.25 and 2452275.5 (validation truth).
  - Also fetch targets 399 and 301 at 2451545.0 for the Moon-omission validation.
- **Epoch:** J2000.0 = JD 2451545.0 TDB.
- **Frame:** ecliptic and mean equinox of J2000.0. Its x-y plane is the renderer's ground plane.
- **Bodies:** 10 → `body-sun`; 199; 299; 3 → `body-earth` (displayed as "Earth (Earth–Moon barycentre)"); 4, 5, 6, 7, 8 as system barycentres.
- **GM values (DE440, JPL SSD astro_par; Park et al. 2021), km³/s²:**
  - Mercury 22031.868551; Venus 324858.592000
  - EMB = 398600.435507 + 4902.800118
  - Mars system 42828.375816; Jupiter system 126712764.100000; Saturn system 37940584.841800; Uranus system 5794556.400000; Neptune system 6836527.100580
  - GM☉ = 1.32712440041279419e20 m³/s²
- **Radii:** JPL planetary physical parameters, mean radius (Archinal et al. 2018): Earth 6371.0084 km (used for the EMB, `assumed`), Mars 3389.50 km, Jupiter 69911 km, Neptune 24622 km. Take the other planets from the same page. Sun: 6.957e8 m (IAU 2015 nominal).
- **History:** `grid`, `sample_interval_s = 432000` (5 d). With 9 bodies this gives ≈22 000 samples ≈ 300 yr before truncation.
- **Omitted:** dwarf planets, asteroids, comets, separate moons, GR, solar oblateness, non-gravitational forces. Moon consequences are covered in §9.4.
- **Validation:** §15.1.
- **Files:** `scripts/presets/fetch_horizons.py` writes:
  - `backend/presets/sources/horizons/<id>_<jd>.txt` (raw text);
  - `retrieved.json` (UTC time and the source line per target);
  - `backend/presets/data/solar-system-j2000.json` (derived SI values + provenance + SHA-256 of each source file).

  There is no fallback data. If Horizons is unreachable, stop (§19.5).

### 9.2 TRAPPIST-1 (M11, optional, gated)
- **Sources:** Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022; `github.com/ericagol/TRAPPIST1_Spitzer` (MIT): `data/elements_noprior_students.txt` and `data/T1_timings_20191203.txt`.
- Transcribe values from the tables and files only.
- **Epoch:** BJD_TDB 2457257.93115525 (confirm from the Table 2 caption).
- **Gate:** §15.2. If it fails, exclude the preset and document why. This is not a blocker.

### 9.3 Kepler-90: removed
Only planets g and h have measured masses (Shaw et al. 2025, arXiv:2507.13588). Record this in `PRESETS.md` and `DECISIONS.md`. Pinned by `test_presets_list_has_no_kepler90`.

### 9.4 Moon omission: consequences and validation tasks
Planning-probe measurements, all to be reproduced by committed tests:
- **EMB offset:** the EMB is up to ≈4,940 km from Earth's centre (4,890 km at J2000).
  - Task: `test_emb_offset_from_earth_centre_recorded` computes it from the committed Horizons 399/301/3 files, asserts it is below Earth's mean radius, and records the value in `PRESETS.md`.
- **Point mass vs three bodies:** over 730.5 d, treating Earth + Moon as one point mass changes the EMB heliocentric path by ≤ ≈234 km, compared with a Sun + Earth + Moon three-body run from the same data.
  - Task: `test_emb_point_mass_vs_three_body_bounded` runs both models in the app engine (dtS 21 600 s), asserts the maximum difference is ≤ 1,000 km (a 4× margin over the probe), and records the measured value.
  - Rationale: the test detects a regression or a modelling error. It does not claim irrelevance.
- **Ephemeris comparison:** including the Moon does not reduce the deviation from the ephemeris (the probe found 11,946 km with the Moon vs 11,717 km without at 2 yr), because the omitted planets dominate. Record the value only; do not assert it.
- **Documentation:** in `PRESETS.md` and the protocol, and in a one-line UI note: positions are barycentres; Moon dynamics, tides, eclipses and lunar perturbations are absent; and a real velocity change would act on two bodies.

### 9.5 Failed or missing data at runtime
- The loader validates the schema, finiteness, bounds and source hashes.
- A preset that fails is listed with `available: false, unavailableReason`.
- Creating a universe from it returns 500 `preset_invalid` and creates nothing.

## 10. Catalogue and custom bodies (OD-2)

### 10.1 Model
```
CatalogueEntry = { id, name, kind: "star"|"planet",
  properties: { massKg: Property, radiusM: Property },
  visual: { colorHex, note: "display only, not a physical property" }, notes }
Property = { value (SI), uncertainty: {minus, plus} | {range: [lo, hi]} | null,
  basis: "measured"|"nominal"|"estimated"|"illustrative",
  sourceValue: str (as published, with its unit), conversion: str, sources: [{citation, url, retrieved}] }
```
- M☉ is converted with the IAU 2015 nominal GM☉ᴺ = 1.3271244e20 m³/s², divided by G.
- R☉ is converted with the nominal R☉ᴺ = 6.957e8 m.

### 10.2 Approved entries (transcribe from the source; confirm each value)
| Entry | Mass (as published) | Radius (as published) | Basis | Source | Planning verification |
|---|---|---|---|---|---|
| Sun | GM☉ 1.32712440041279419e20 m³/s² | 6.957e8 m | measured (GM) / nominal (R) | JPL astro_par; IAU 2015 B3 (Mamajek et al., arXiv:1510.07674) | verbatim |
| Proxima Centauri | 0.1221 ± 0.0022 M☉ | 0.141 ± 0.021 R☉ | measured | NASA Exoplanet Archive overview: cite the specific reference row | values seen; row attribution unverified |
| TRAPPIST-1 | 0.0898 ± 0.0023 M☉ | 0.1192 ± 0.0013 R☉ | measured | Agol et al. 2021, Table 7 (mass attributed to Mann et al.) | **model-extracted: verify** |
| Sirius A | 2.063 ± 0.023 M☉ | 1.7144 ± 0.0090 R☉ | measured | Bond et al. 2017, doi:10.3847/1538-4357/aa6af8 | mass verbatim; **radius model-extracted: verify** |
| Betelgeuse | 16.5–19 M☉ (range; value = midpoint 17.75, disclosed) | 764 (+116/−62) R☉ | **estimated** | Joyce et al. 2020, doi:10.3847/1538-4357/abb8db | verbatim (abstract) |
| Earth | 5.97217 ± 0.00028 ×10²⁴ kg | 6371.0084 ± 0.0001 km | measured | JPL planetary physical parameters | verbatim |
| Mars | 0.641691 ± 0.000030 ×10²⁴ kg | 3389.50 ± 0.2 km | measured | same | verbatim |
| Jupiter | 1898.125 ± 0.088 ×10²⁴ kg | 69911 ± 6 km | measured | same | verbatim |
| Neptune | 102.4092 ± 0.0048 ×10²⁴ kg | 24622 ± 19 km | measured | same | verbatim |

- If a value cannot be confirmed, mark it `illustrative` or drop the entry, and report which.
- The panel shows uncertainty, "Estimated" and "Illustrative" badges, and the notes "Colour is a display choice" and "Catalogue entries are single bodies, not validated systems."

### 10.3 Creation, editing, radius distinction
- **Add from catalogue** pre-fills the existing create form. Position and velocity come from the user or from placement. The created body carries `catalogueEntryId` as provenance only.
- **`Body.kind`:** `"star"|"planet"`, default `"planet"`, patchable. Stars render emissive; this is a renderer-owned material choice (§11A).
- **Radius:** the inspector shows the physical `radiusM`, labelled "physical radius (collisions)", with the note "displayed size is exaggerated for visibility". Display size remains `displayRadiusUnits` and is never sent to the API.

| Concern | Rule |
|---|---|
| Validation | Existing bounds plus the `kind` enum; the backend validates independently |
| Lifecycle | The universe must be active with a valid epoch. A baseline rejects edits (409). The UI says "Pause to edit". Editing is disabled in history view. |
| Modified-run edits | A physical change appends an `AuditEntry` and sets `controlled = false` and `first_uncontrolled_at_s`. Changing name, colour or kind is logged but keeps the run controlled. |
| Cancel | Sends nothing |
| Errors | Field errors inline; server detail and `code` shown verbatim |

## 11. Orbit Lab and the Experiment 01 protocol (OD-3, OD-4)

### 11.1 System
```json
{"id": "exp01-sun-emb-j2000", "name": "Sun + Earth–Moon barycentre (J2000)",
 "presetId": "solar-system-j2000", "bodyIds": ["body-sun", "body-earth"],
 "recentre": "included-barycentre", "selectableBodyIds": ["body-earth"],
 "speedFactors": [0.90, 0.95, 1.05, 1.10],
 "observationWindowS": 63072000.0, "historyMode": "grid", "sampleIntervalS": 86400.0}
```
The system is built from the Solar preset's archived data and GM values, then re-centred.

### 11.2 Workflow (spec §7)
| Step | Behaviour |
|---|---|
| 1 | `GET /orbit-lab/systems` |
| 2 | `POST /orbit-lab/experiments {systemId}` creates the baseline (role `baseline`), activates it and records history on the grid. The panel shows bodies, epoch, frame, units, model note and digest. |
| 3–4 | Show `body-earth`'s initial velocity components and speed (m/s, km/s) from the initial snapshot. |
| 5 | Radio buttons over the factors, with a client-side preview labelled "preview". |
| 6 | `POST …/modified-run {bodyId, speedFactor, replaceExisting}`. The backend checks the factor exactly, derives from the baseline's initial snapshot with v′ = f·v, and creates a `modified` universe that is not activated. It records provenance: `{baselineUniverseId, baselineInitialDigest, bodyId, originalVelocityMPerS, modifiedVelocityMPerS, speedFactor, units, createdAtIso}`. An existing run without `replaceExisting` → 409 `modified_run_exists`. |
| 7 | `GET …/initial-differences` returns exactly one entry and `configEqual: true`. |
| 8–9 | Existing controls on the active run; run badges call `activate`. |
| 10 | `GET …/comparison?bodyId=body-earth` feeds the panel, plus both runs' histories as trajectories (§11A). |
| 11 | Reset applies to the active run only (with confirmation). To recreate, send `replaceExisting=true` (with confirmation; the old run must be inactive). |
| 12 | Repeating gives the same digests. |

### 11.3 Role rules (enforced in `backend/universes.py`)
| Operation | sandbox / preset | baseline | modified |
|---|---|---|---|
| step, reset | ✓ (active) | ✓ (active) | ✓ (active) |
| body CRUD | ✓ | ✗ `baseline_protected` | ✓ (audited; may flip `controlled`) |
| snapshots | ✓ | ✗ `baseline_protected` | ✓ (restore brings back the captured `controlled`) |
| delete universe | ✓ (inactive) | only via `DELETE /orbit-lab/experiments/{eid}` | via replace or experiment delete |

## 11A. UI-0 renderer integration boundary (M6)
**Purpose:** define how features hand data to the renderer, so that history (UI-2), Orbit Lab and later renderer work do not each modify the canvas.

**Contract (`fe/render/contract.ts`):**
```ts
/** SI-unit position sample produced from backend state; the renderer converts to scene units. */
export interface PositionSample { simulationTimeS: number; positionM: Vec3; segment: number }
export interface TrajectoryInput {
  key: string;            // `${universeId}:${generation}:${bodyId}`; stable React key, never reused across universes
  universeId: string; bodyId: string;
  role: "active" | "reference";   // reference = the other Orbit Lab run
  colorHex: string;
  samples: readonly PositionSample[];  // ascending time; a segment change means "do not connect"
}
```
**Rules:**
1. `UniverseCanvas` gains **one** prop: `trajectories?: readonly TrajectoryInput[]` (default none). It mounts `TrajectoryLayer`, which converts samples with `toScenePosition` and the current `RenderTransform`. It draws `active` trajectories solid and `reference` trajectories dashed and muted, and never connects across a `segment` change. No other canvas prop is added in this branch.
2. Historical frames reach the canvas through the **existing** `bodies` prop (the workspace maps them with `toSceneBody`), so viewing history needs no canvas change.
3. The renderer owns every visual choice: `displayRadiusUnits`, the minimum on-screen size (`bodyVisibility.ts`), the starfield, materials (stars emissive by `kind`) and the camera. Features never set them.
4. Camera behaviour is unchanged. Trajectories do **not** affect `fitTransform` or focus. Switching universes refits through the existing `layoutEpoch` path (workspace remount).
5. Rendering metrics (`starfieldScale`, `bodyVisibility`, framing) are unchanged; no test thresholds change.
6. Assets: no textures or models are added. Visual properties come only from `Body.kind`, `colorHex` and the catalogue `visual` block.
7. Decimation: `fe/sim/trajectory.ts` has `decimate(samples, maxPoints = 5000)`. It is a pure stride over samples that keeps segment boundaries and the last point, and is used by `TrajectoryLayer`.

**Tests:**
- `trajectory.ts converts SI samples with toScenePosition`;
- `decimate keeps segment boundaries, first and last points and at most maxPoints`;
- `TrajectoryLayer splits polylines at segment changes` (pure geometry helper tested; the WebGL component is checked in the browser journey);
- `canvas renders without trajectories exactly as before` (existing tests unchanged);
- `inspector labels physical radius and states display size is exaggerated`.

**Out of scope:** "UI-1" (unspecified), new camera modes, new rendering metrics.

## 11B. UI-2 simulation history (M2 backend, M7 frontend)
**Origin:** Nikhil's UI-2 proposal, accepted by the owner with constraints (SL spec §8.1). Sonnet implements it. Nikhil reviews the design and the result (§19.7).

### 11B.1 Backend history (`backend/history.py`, recorded by the engine)
- **Modes:**
  - `grid`: presets and Orbit Lab. `_advance` treats every k·Δ (computed as `k * Δ`) inside a step as an integration target and records the state after landing on it.
  - `step`: sandbox and the default universe. One sample is recorded at the end of each committed step.
- **Sample contents:** `index` (monotonic within a generation), `simulationTimeS`, `segment`, and the position of every existing body.
- **Segments:** `segment` increases on any physical edit, add, delete, or merger, so paths are never drawn across a discontinuity.
- **Metadata:** per-body `{name, colorHex, radiusM, kind}` is kept for every body that appears in the history, including bodies that later merged away.
- **Storage:** `array('d')` per coordinate plus a time array, capped at `MAX_HISTORY_POINTS = 200_000` positions per universe.
  - `grid` mode: when the cap is reached, recording stops and `truncated = true` is set. This keeps comparability from t = 0.
  - `step` mode: a ring buffer that drops the oldest samples and reports `droppedBefore`.
- **Lifecycle:**
  - History is committed state: published on commit, rolled back with a failed step, copied into snapshots.
  - `reset` returns to sample 0 with a new `generation`, as does `restore` (the snapshot's history, new `generation`).
  - Each universe has its own buffer. Switching never touches history.
- **Grid times:** `test_grid_history_exact_times` asserts that times equal `k*Δ` exactly and that the engine lands on each target. If REBOUND does not land exactly, key samples on `k`, record the actual time, and document it.

### 11B.2 History API
`GET /api/v1/universes/{uid}/history?generation=<int?>&fromIndex=<int=0>&bodyIds=<csv?>&limit=<int ≤ 5000>` returns:
```
{ universeId, mode: "grid"|"step", sampleIntervalS: float|null, generation, firstIndex, nextIndex,
  droppedBefore, truncated, samples: [{index, simulationTimeS, segment, positionsM: {bodyId: [x,y,z]}}],
  bodies: {bodyId: {name, colorHex, radiusM, kind}} }
```
- If `generation` is missing or differs from the current one, the response starts at `firstIndex` with the new generation.
- The endpoint is a lock-free read of the published buffer.
- It is added to `API_CONTRACT.md` in M2.

### 11B.3 Frontend history model (`fe/sim/history/historyModel.ts`; pure, no React, no canvas imports)
- `type HistoryCache = {universeId, generation, mode, sampleIntervalS, samples: HistorySample[], bodies, firstIndex, droppedBefore, truncated, gaps: number[]}`
- `applyHistoryPage(cache | null, page) -> HistoryCache`:
  - a universe or generation change replaces the cache;
  - a page whose `firstIndex` exceeds the cache's next index records a gap and never interpolates;
  - client retention `MAX_CLIENT_SAMPLES = 20000` drops the oldest samples and sets `droppedBefore`.
- `frameAt(cache, index) -> HistoryFrame {universeId, generation, index, simulationTimeS, bodies: [{id, positionM, meta}]}`. Bodies absent at that sample are omitted.
- `trajectoryOf(cache, bodyId, role) -> TrajectoryInput` (UI-0 contract type).

### 11B.4 Hooks
- `useHistory(client: ScopedClient, scope, revision) -> {cache, status: "idle"|"loading"|"stale"|"error", error, refresh}`:
  - fetches incrementally whenever `revision` changes;
  - on failure, keeps the cache and sets `stale` with the message;
  - retries on the next revision change or on manual `refresh`;
  - lives inside the keyed workspace, so it is partitioned per universe and epoch.
- `useHistoryNavigation(cache, {onEnter}) -> {mode: "live"|"history", index, replaying, rate, seek(i), stepBy(±n), replay(rate), stopReplay(), returnToLive()}`:
  - entering history pauses Play (via `onEnter`);
  - replay advances over **recorded samples only**, at a display rate of 1, 2, 5 or 10 samples per tick;
  - a new generation forces `returnToLive`.

### 11B.5 Controls (`fe/components/ui/HistoryTimeline.tsx`; placed by `UniverseWorkspace` in the left sidebar under Event History, so `App.tsx` is not touched)
- Slider over the cached sample indices.
- Buttons: ◀ / ▶ step, Replay / Stop, rate, Return to live.
- Labels: "t = … (sample i of n)" and "Live: t = …".
- Banners:
  - "Viewing recorded history — the simulation is not advancing";
  - "History may be incomplete: <reason>" (on stale, gaps or truncation);
  - "Oldest samples discarded" (on `droppedBefore`).
- Event markers: merger events from the universe's `/events`, placed at `simulationTimeS`.
- Diagnostics show "live state only" while viewing history. Diagnostics are not recorded per sample and are never reconstructed.
- While viewing history, Step, Play, edits, placement and snapshot restore are disabled. Pressing Play returns to live first.
- A "Show paths" toggle in `ViewPanel` passes `trajectoryOf(...)` for the selected body, or for all bodies if N ≤ 20, to the UI-0 `trajectories` prop.

### 11B.6 Orbit Lab use
Both runs' histories are fetched as separate caches, keyed by universe id. The active run's cache is `role: "active"` and the other run's is `"reference"`. They are never merged into one cache.

### 11B.7 Tests
Backend (M2):
- `test_grid_history_exact_times`
- `test_step_history_one_sample_per_commit`
- `test_history_rolled_back_on_failed_step`
- `test_history_in_snapshot_and_restored`
- `test_history_generation_changes_on_reset_and_restore`
- `test_history_grid_truncates_at_cap`
- `test_history_step_ring_drops_oldest`
- `test_history_segments_increment_on_edit_and_merger`
- `test_history_keeps_metadata_of_merged_bodies`
- `test_history_endpoint_generation_mismatch_returns_from_start`
- `test_history_isolated_between_universes`

Frontend (M7):
- `history cache never mixes universes or generations`
- `applyHistoryPage records gaps and never interpolates`
- `client retention drops oldest and flags it`
- `frameAt omits bodies absent at that sample`
- `history fetch failure keeps cache and marks stale`
- `history page from old workspace is ignored`
- `entering history pauses play and disables edits`
- `replay advances over recorded samples only`
- `return to live after new generation`
- `HistoryTimeline shows live and viewed times and incomplete banner`
- `history modules do not import canvas components` (static import check)

## 12. API and data model

### 12.1 Error contract
Existing error shapes are unchanged. Coded errors add `"code"`.

| HTTP | Codes |
|---|---|
| 404 | `universe_not_found` (detail says "deleted"), `snapshot_not_found`, `experiment_not_found`, `preset_not_found`, `system_not_found` |
| 409 | `universe_not_active`, `stale_activation`, `stale_revision`, `deactivated_during_step`, `baseline_protected`, `active_universe_delete`, `universe_limit`, `snapshot_limit`, `modified_run_exists`, `experiment_has_active_run`; existing overlap / body-limit errors keep having no code |
| 422 | existing shape; also a missing epoch, a disallowed factor or body, extra fields |
| 500 | `preset_invalid`, `restore_failed`; existing step failure |
| 503 | existing timeout / busy |

### 12.2 Endpoints (✅ = exists today; everything else is new in the milestone shown)
| Method & path | MS | Notes |
|---|---|---|
| GET `/api/v1/universes`; POST `/api/v1/universes` `{name?, source: {kind:"empty"}\|{kind:"preset", presetId}, activate=false}`; GET/DELETE `/api/v1/universes/{uid}`; POST `…/{uid}/activate` | M1 (preset source in M3) | — |
| GET `…/{uid}/state`, `…/{uid}/events` | M1 | `UniverseState` = SimulationState + `universeId`, `revision` |
| POST `…/bodies`, PATCH/DELETE `…/bodies/{bid}`, POST `…/step`, `…/reset` (`?activationEpoch&expectedRevision?`) | M1 | Body gains `kind`, `catalogueEntryId` |
| GET/POST `…/snapshots`; POST `…/snapshots/{sid}/restore?activationEpoch`; DELETE `…/snapshots/{sid}` | M2 | — |
| GET `…/{uid}/history` | M2 | §11B.2 |
| GET `/api/v1/presets`, `/api/v1/presets/{pid}` | M3 | — |
| GET `/api/v1/catalogue` | M5 | — |
| GET `/api/v1/orbit-lab/systems`; POST `/api/v1/orbit-lab/experiments`; GET/DELETE `…/{eid}`; POST `…/{eid}/modified-run`; GET `…/{eid}/initial-differences`, `…/{eid}/comparison?bodyId=` | M8 | — |
| ✅ legacy `/api/v1/simulation/state\|step\|reset`, `/api/v1/bodies…`, `/api/v1/events`, `/healthz` | — | Unchanged; operate on `uni-default`; mutations → 409 `universe_not_active` when it is inactive |

**Models:**
- `UniverseSummary = {id, name, role, presetId, experimentId, active, simulationTimeS, bodyCount, revision, status, lastFailure, createdAtIso, epochLabel, historyMode}`
- `UniverseProvenance = {sourceKind, presetId, presetDataVersion, epoch, frame, origin, units, initialStateDigest, derivedFrom, modification, controlled, firstUncontrolledAtS, audit}`
- `ComparisonDto = {bodyId, sampleIntervalS, baseline: {universeId, simulationTimeS, sampleCount}, modified: {…}, commonSampleCount, timesS, baselinePositionM, modifiedPositionM, separationM, observationWindowS, windowCompleteBoth, complete, issues, controlled, firstUncontrolledAtS, modification}`. `issues` covers: no modified run; not advanced yet; missing body; truncation; uncontrolled since t; grid mismatch (asserted impossible).

## 13. Milestones
Order and dependencies: M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → (M11 optional) → M12.
- Each milestone ends with the full suites green and one or more coherent commits.
- Re-run `python -m pytest -q` after every backend milestone, and the full frontend trio after every frontend milestone.

### Task 0: Preparation
- [ ] 0.1 `git fetch --all --prune`; `git switch feature/simulation-lab-experiment-01`; `git pull --ff-only`.
  - Verify the merge base with `origin/main` is `d5220f9`, or that `origin/main` has moved (if so, see §19.5 item 2).
  - Verify that the three documents are present.
- [ ] 0.2 Read both specs and this plan in full. Re-read `HANDOFF.md`, `STATUS.md`, `API_CONTRACT.md`, `ARCHITECTURE.md` and `DECISIONS.md`.
- [ ] 0.3 Run the baseline: `python -m pytest -q`, `npm run typecheck`, `npm test`, `npm run build`. Record the actual output in `WORKLOG.md`.
- [ ] 0.4 Post the short milestone/checkpoint plan (§19.3) and continue.

### M1: Universe registry, isolation, active-only mutation (backend)
- **Create:** `backend/universes.py`, `backend/errors.py`, `backend/lab_models.py`, `backend/api_universes.py`, `tests/conftest.py` (fixture `registry`: a fresh `UniverseRegistry()` overriding `get_registry`), `tests/test_universe_registry.py`, `tests/test_api_universes.py`, `tests/test_universe_concurrency.py`.
- **Modify:** `backend/simulation.py` (revision, guard, cancel, `StepCancelled`), `backend/main.py`, `backend/models.py` (`kind`, `catalogueEntryId`).
- **Interfaces produced:**
  - `SimulationService.revision`, `request_cancel()`, `clear_cancel()`;
  - `guard=` on `step`, `add_body`, `update_body`, `delete_body`, `reset`;
  - `UniverseRegistry(engine_factory=SimulationService)` with `.create(name, role, engine=None, provenance=None, preset_id=None, experiment_id=None, activate=False)`, `.get`, `.list`, `.delete`, `.activate`, `.guard_for`, `.active_id`, `.epoch`;
  - `get_registry()`, `get_legacy_guard()`.
- **Tests:** the M1 tests in §3. Concurrency tests reuse the `BlockedStep` pattern from `tests/test_stall_resilience.py`.
- **Exact-shape assertions** that now see `kind` / `catalogueEntryId`: update them to the documented shape only, and list each one in the commit body.
- **Commit:** `feat(backend): universe registry with active-only, epoch-guarded mutations`
- **Risks:** global-registry leakage between tests (mitigation: the fixture); lock order (mitigation: §6.2 plus the stuck-universe test).

### M2: Snapshots, reset, history recording, controlled flag (backend)
- **Create:** `backend/history.py`, `tests/test_snapshots.py`, `tests/test_history.py`.
- **Modify:** `backend/simulation.py`, `backend/lab_models.py`, `backend/api_universes.py`, `context/API_CONTRACT.md` (snapshots, history).
- **Interfaces produced:**
  - `EngineSnapshot`;
  - `InitialBody(id, name, kind, massKg, radiusM, positionM, velocityMPerS, colorHex, basis, sources)`;
  - `load_bodies`, `capture_snapshot`, `restore_snapshot(snap, *, guard=None)`, `initial_snapshot`, `from_snapshot`, `initial_state_digest`;
  - `HistoryBuffer(mode, sample_interval_s, max_points)` with `.record(t, positions, meta)`, `.page(generation, from_index, body_ids, limit)`, `.copy()`, `.new_generation()`, `.bump_segment()`;
  - `controlled`, `audit`.
- **Tests:** the snapshot tests (§3 SL-9.x) and the backend history tests (§11B.7). `test_snapshot_restore_bitwise_continuation` runs through `SimulationService.step` with history enabled and compares with `==`.
- **Commit:** `feat(backend): snapshots, initial-state reset and recorded history`

### M3: Solar System preset, loader, Moon-omission validation
- **Create:** `scripts/presets/fetch_horizons.py`, `backend/presets/{__init__,loader}.py`, `backend/presets/data/solar-system-j2000.json`, `backend/presets/sources/horizons/*`, `context/PRESETS.md`, `tests/validation/test_preset_solar_system.py`, `tests/validation/test_moon_omission.py`, `tests/test_presets_api.py`.
- **Modify:** `backend/api_universes.py`, `THIRD_PARTY_NOTICES.md` (data attributions).
- **Interfaces produced:** `load_preset(preset_id) -> LoadedPreset{summary, provenance, bodies}`, `list_presets()`, `PresetDataError`.
- **Steps:**
  1. Run the script once (network) and commit its outputs.
  2. Write the M3 tests in §3, plus `test_emb_point_mass_vs_three_body_bounded` and `test_emb_offset_from_earth_centre_recorded`.
- **Commits:** `data: Solar System J2000 preset from JPL Horizons and DE440`; `feat(backend): preset loader and endpoints`

### M4: Frontend universes, navigation, presets, snapshots
- **Create:** `fe/sim/useUniverses.ts`, `fe/UniverseWorkspace.tsx`, `fe/components/ui/{UniverseSwitcher,PresetPicker,SnapshotPanel,ConfirmButton}.tsx`, and tests.
- **Modify:** `fe/api/{types,parse,client}.ts`, `fe/sim/useSimulation.ts`, `fe/App.tsx`, `fe/test/fixtures.ts`.
- **`App.tsx` scope:** move universe-dependent code into `UniverseWorkspace` without rewriting it. Keep layout state, the switcher and the keyed workspace in `App`. Make no other change to `App.tsx`.
- **Interfaces produced:**
  - `UniverseScope`;
  - `ApiClient.scoped(scope): ScopedClient` (`health, getState, getEvents, getHistory, createBody, updateBody, deleteBody, step, reset, listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot`);
  - `useUniverses(client)`;
  - `useSimulation(client: ScopedClient, options & {onScopeInvalid?, onBusyWriteChange?})`.
- **Tests:** the M4 tests in §3, plus:
  - `switching remounts workspace and drops a late step response from the old universe`
  - `stale-activation adopts backend active universe`
  - `selection and focus are cleared on switch; axes/grid and sidebars persist`
  - all existing tests passing.
- **Commit:** `feat(frontend): universe-scoped client, switcher, presets and snapshots`

### M5: Catalogue, custom stars/planets, radius distinction
- **Create:** `backend/catalogue.py`, `backend/catalogue_data.json`, `tests/test_catalogue.py`, `fe/components/ui/CataloguePanel.tsx` (+ test).
- **Modify:** `backend/api_universes.py`, `fe/components/ui/{ControlPanel,BodyFields,BodyInspector}.tsx`, `fe/sim/validation.ts`.
- **Steps:** transcribe §10.2 (record anything unconfirmed); write the M5 tests in §3.
- **Commit:** `feat: sourced body catalogue and custom stars/planets`

### M6: UI-0 renderer integration boundary
- **Create:** `fe/render/contract.ts`, `fe/components/canvas/TrajectoryLayer.tsx`, `fe/sim/trajectory.ts` (+ tests).
- **Modify:** `fe/components/canvas/UniverseCanvas.tsx` (the one `trajectories` prop and the layer mount only); `fe/components/canvas/CelestialBody.tsx` (emissive by `kind`, if not done in M5).
- **Tests:** §11A.
- **Commit:** `feat(frontend): renderer contract and trajectory layer (UI-0)`

### M7: UI-2 history model, hooks, timeline and replay
- **Create:** `fe/sim/history/{historyModel,useHistory,useHistoryNavigation}.ts`, `fe/components/ui/HistoryTimeline.tsx`, tests.
- **Modify:** `fe/UniverseWorkspace.tsx` (mount the timeline, map frames to `bodies`, pass `trajectories`), `fe/components/ui/ViewPanel.tsx` ("Show paths"), `fe/api/*` (history DTO).
- **Do not modify** `UniverseCanvas.tsx` or `App.tsx`.
- **Tests:** frontend tests in §11B.7.
- **Docs:** add an "UI-2 history" section to `ARCHITECTURE.md`.
- **Commit:** `feat(frontend): recorded history timeline and replay (UI-2)`

### M8: Orbit Lab backend and Experiment 01 validation
- **Create:** `backend/orbit_lab.py`, `backend/orbit_lab_systems.json`, `backend/api_orbit_lab.py`, `tests/test_orbit_lab.py`, `tests/test_api_orbit_lab.py`, `tests/validation/kepler_reference.py` (no REBOUND or backend imports), `tests/validation/test_experiment01.py`.
- **Modify:** `backend/universes.py` (role rules), `backend/main.py`.
- **Interfaces produced:** `OrbitLab(registry)` with `.list_systems()`, `.create_experiment(system_id)`, `.create_modified_run(eid, body_id, speed_factor, replace_existing)`, `.initial_differences(eid)`, `.comparison(eid, body_id)`, `.delete(eid)`.
- **Tests:** the M8 tests in §3.2, including:
  - `test_disallowed_factor_or_body_rejected_without_change[0.5, 1.0, 1.1000001, 1e9, "body-sun"]`, plus a raw-JSON NaN;
  - `test_experiment_creation_fails_cleanly_on_bad_preset`;
  - `test_replace_modified_requires_flag_and_inactive`;
  - `test_delete_experiment_with_active_run_rejected`;
  - the §15.3 validation.
- **Commit:** `feat(backend): Orbit Lab experiments, modified runs and comparison`

### M9: Orbit Lab frontend
- **Create:** `fe/components/ui/{OrbitLabPanel,ComparisonPanel,RunBadge}.tsx`, `fe/sim/useOrbitLab.ts`, tests.
- **Modify:** `fe/UniverseWorkspace.tsx`.
- **Behaviour:**
  - `RunBadge`: "Orbit Lab · BASELINE" or "Orbit Lab · MODIFIED ×1.10 speed", plus "Uncontrolled since t = …" when applicable.
  - The panel shows the velocity record, the initial-differences check, and the model note "Two-body model: Sun + Earth–Moon barycentre; positions are barycentres; not a forecast of Earth's real position".
  - `ComparisonPanel`: both times, "compared up to t", a separation sparkline (inline SVG with labelled units), and a common-sample slider.
  - Trajectories: both runs through UI-0 (`active` / `reference`).
- **Tests:** the M9 tests in §3.2, plus `failed modified-run creation shows error and no success state` and `shows uncontrolled warning`.
- **Commit:** `feat(frontend): Orbit Lab panel, run identity and comparison`

### M10: Hardening, live smoke, browser journey
- **Modify** `tests/smoke/test_live_server.py`; add `test_universe_isolation_over_http`, `test_orbit_lab_journey_over_http`, `test_history_over_http`, `test_restart_loses_universes_and_default_is_recreated`.
- **§17.3 review:** check every row and confirm it has a passing test or a written reason.
- **Browser journey:** run §14.13 and record DOM- and API-based evidence in `STATUS.md`.
- **Commit:** `test: live-server isolation, history, restart and Orbit Lab journeys`

### M11: TRAPPIST-1 (optional, gated, only after M1–M10 are green)
- **Create:** `scripts/presets/build_trappist1.py`, `backend/presets/sources/trappist1/*` (with the MIT notice), `backend/presets/data/trappist-1-agol2021.json`, `tests/validation/test_preset_trappist1.py`.
- **Tests:** `test_trappist_elements_roundtrip`, `test_trappist_transit_times_match_observed`.
- **If the gate passes:** commit `data: TRAPPIST-1 preset (Agol et al. 2021)`.
- **If it fails:** commit only the `PRESETS.md` exclusion note with the measured values.

### M12: Documentation and PR
- **Update:** `context/API_CONTRACT.md`, `ARCHITECTURE.md` (incl. UI-0 and UI-2), `DECISIONS.md` (append D-025 onward: A1–A16 and the OD-1–OD-6 resolutions as accepted owner decisions citing the specs), `STATUS.md`, `TASKS.md`, `WORKLOG.md`, `HANDOFF.md`, `README.md`, `context/PRESETS.md`, `context/EXPERIMENT_01_PROTOCOL.md` (spec §5–§9 plus the **measured** results).
- **Push** the branch and **open the PR** (§19.4).
- **Monitor CI** and fix failures the implementation caused.
- **Stop.** Do not merge.

## 14. Test strategy and acceptance
Each group lists setup → action → expected result → invariant → failure condition.
1. **Different simultaneous states:** two non-trivial universes → read both → each matches what it was created with → engines, sims and history are distinct objects → fails if they are equal or identical objects.
2. **Advance one:** step U1 N times → U1's time and revision advance → U2's dump is bitwise equal, with the same revision → any change to U2 fails.
3. **Active-only:** mutate an inactive universe → 409 → it is unchanged.
4. **Switch during integration:** a blocked step on U1, then activate U2 → U1 is rolled back, including its history → U1 gains no time.
5. **Edit/reset isolation:** only the target universe changes; the catalogue is unchanged.
6. **Snapshot contract:** §8.2 levels 1–2.
7. **Concurrent and stale requests:** only valid requests commit, in order; revision = the number of successes.
8. **Failure diagnosability:** coded errors, `lastFailure` set, state equals the pre-request state.
9. **Preset data and Moon omission:** §15.1, §9.4 (and §15.2 if M11 runs).
10. **Custom bodies and catalogue:** creating in U1 leaves U2 and the catalogue unchanged.
11. **Orbit Lab:** M8 tests.
12. **History (UI-2):** §11B.7. The invariant: no sample is ever shown for a universe, generation or run other than its own.
13. **Regression and browser journey** (Playwright MCP or the in-app browser; own backend :8011, Vite :5183; record `GET /api/v1/universes` at every switch):
    1. First use.
    2. Load the Solar System (a new universe; the default is kept).
    3. Switch to the default (its time is retained) and back.
    4. Play, then Pause.
    5. Open the history timeline; seek back; the banner shows; Step is disabled; replay; return to live.
    6. Turn on "Show paths".
    7. Save a snapshot; Step; restore (confirm). The history generation changes and the timeline resets to the snapshot's history.
    8. Reset (confirm).
    9. Add the Betelgeuse catalogue star; the estimated badge is visible.
    10. Start Experiment 01. Inspect the EMB velocity. Choose ×1.10, check the preview, and create the run. The initial differences show one difference.
    11. Advance the baseline about 1 yr. Switch to the modified run (the badge changes) and advance it about 1 yr.
    12. The comparison shows separation and matching times; there are two trajectories (solid and dashed).
    13. Edit the modified run's mass → uncontrolled warning. Reset it → controlled again, and the baseline is unchanged.
    14. Recreate the run with ×0.90.
    15. Switch to the default and delete the experiment.
    16. Regression checks: selection, double-click focus and follow, empty-click dismissal, placement + Undo, Axes/Grid, sidebars at 1200 px and 1000 px, starfield zoom-out, a merger in History, diagnostics.

## 15. Scientific validation

### 15.0 Claim register (what is verified and what Sonnet must verify)
| Claim | Status | Sonnet's task |
|---|---|---|
| DE440 GM values, G, au (JPL astro_par) | **Verified on source** (verbatim, 2026-10-24) | Re-check them when building the JSON |
| Horizons query parameters, ecliptic J2000 frame, SSB centre, "source: DE441" | **Verified on source** (live API) | Record the per-target source line |
| JPL planet radii and masses (phys_par) | **Verified on source** | Transcribe |
| IAU 2015 nominal R☉ and GM☉ | **Verified on source** (arXiv:1510.07674) | Transcribe |
| Sirius A mass, Betelgeuse range and radius, Proxima values | Verified on source (abstract / archive) | Confirm the Proxima reference row |
| TRAPPIST-1 stellar and planet values, Sirius A radius | **Unverified** (model-extracted) | Transcribe from the tables; mark `illustrative` or drop if they cannot be confirmed |
| 9-body vs Horizons ≤ 3.9e-6 (2 yr) | **Planning probe**, not a committed test | `test_solar_against_horizons_1y_2y` |
| EMB vs Earth-centre model (11,717 km vs 1,288,654 km at 2 yr) | **Planning probe** | Record the values in `PRESETS.md` (an optional test may assert EMB ≤ 1e-4 relative) |
| Moon omission ≤ 234 km; EMB offset ≤ 4,940 km | **Planning probe** | §9.4 tests |
| Engine vs Kepler ≤ 2.5e-13·a | **Planning probe** | `test_exp01_matches_kepler_reference` |
| Orbital elements per factor (Exp spec Appendix A) | **Planning probe** (derived) | Recompute in the tests from the reference; never hard-code |
| Energy drift ≤ 6.7e-16 | **Planning probe** | `test_exp01_energy_and_angular_momentum_drift` |
| `copy()` bit-identical continuation | **Planning probe, REBOUND directly** (not through the service) | `test_snapshot_restore_bitwise_continuation` through the service |
| Records-rebuild drift 1.2e-4 m after 2e7 s | **Planning probe** | Informational only |

### 15.1 Solar System
- **Exact re-parse:** the SI values are reproduced exactly from the raw text.
- **Mass from GM:** `m·G/GM − 1` ≤ 4e-16.
- **Momentum:** `|Σmv| ≤ 1e-12 Σm|v|`.
- **Dynamics:** with dtS = 21 600 s, landing exactly at 365.25 d and 730.5 d, every planet's heliocentric position matches the committed Horizons truth to **≤ 2e-5 relative**.
  - The planning probe measured 9.1e-7 at 1 yr and 3.9e-6 at 2 yr, a margin of at least 5×.
  - A unit, frame or epoch error gives ≥ 1e-2.
  - This checks the pipeline. It is not a claim of ephemeris accuracy.
- **Energy:** K+U drift ≤ 1e-12 over 2 yr.
- **Moon omission:** §9.4.

### 15.2 TRAPPIST-1 (M11 gate)
- Element round trip to 1e-9.
- The first 3 transits of each planet match the observed times to ≤ 0.0035 d.
- If either fails, exclude the preset.

### 15.3 Experiment 01 (spec §9)
- **Kepler agreement:** an independent Kepler reference agrees with every one of the 731 samples to ≤ 1e-10·a, for f = 1 and each factor.
- **Qualitative ordering:** a, period and aphelion order with f. For f > 1 the start is ≈ perihelion; for f < 1, ≈ aphelion (|r₀ − r_turning| ≤ 1e-3 r₀).
- **Period:** within 1e-6 of 2π√(a³/μ).
- **Grid:** the grids are identical.
- **Conservation:** K+U and L drift ≤ 1e-12 (record the measured L value).
- **Repeatability:** digests and trajectories are bit-identical in one process.
- **Not claimed:** any real-world prediction.

## 16. Migration, rollback and compatibility
- No database or state migration.
- All API changes are additive. Semantic notes go into `API_CONTRACT.md` and D-025: reset means "the initial state"; body ids are unique per universe; legacy routes act on `uni-default`.
- An old frontend still works through the legacy routes. A new frontend against an old backend shows the load error.
- Rollback: revert the PR merge commit and restart the backends.

## 17. Decisions, risks, errors

### 17.1 Owner decisions (resolved 2026-10-24)
| ID | Resolution |
|---|---|
| OD-1 | Solar System required and sufficient; others only if validated; Kepler-90 removed; TRAPPIST-1 gated |
| OD-2 | Recommended catalogue with provenance, units, uncertainty and disclosure; entries, assets and presets kept distinct |
| OD-3 | Question confirmed; Sun + EMB, J2000, ×0.90/0.95/1.05/1.10, 730 d, daily samples; Moon consequences documented |
| OD-4 | Sonnet works autonomously within scope; baseline immutable; uncontrolled changes identifiable |
| OD-5 | No persistence across restarts; in-process semantics are tested |
| OD-6 | The owner reviews product behaviour; Opus does the later technical review; Sonnet never merges |
| UI-2 | Nikhil's proposal is accepted with constraints (§11B). Sonnet implements it; Nikhil proposes interfaces and reviews. |
| Branching | One feature branch and one PR; no separate docs PR |

### 17.2 Risks
| Risk | Mitigation |
|---|---|
| Splitting `App.tsx` regresses selection, focus or placement | Move code, don't rewrite it; existing tests; browser regression list |
| UI-0 definition and future renderer work diverge | One-prop contract (§11A); UI-1 explicitly out of scope; owner and Nikhil review the contract in the PR |
| Legacy guard and the global registry interact in tests | Fresh-registry fixture |
| Native stall ignores cancel | Commit guard still applies; documented limitation (D-021) |
| `integrate` does not land exactly on k·Δ | Test it; key on k |
| DE441 vectors vs DE440 GM | Recorded; the combined effect is measured by §15.1 |
| History memory | Caps; `array('d')`; 8 universes × 10 snapshots |
| History fetch cost during Play | Incremental `fromIndex`; `limit ≤ 5000`; lock-free read |
| Two tabs | `stale_activation` → resync |
| Catalogue values that can't be confirmed | Mark `illustrative` or drop |
| `origin/feature/grid-axis` reappears | Ignore; never use it; report it |
| Owner's :8000 backend | Never touched |

### 17.3 Error handling and recovery
| Case | Backend | UI | Test |
|---|---|---|---|
| Invalid velocity, factor or body | 422; nothing changes | inline error | `test_disallowed_factor_or_body_rejected_without_change` |
| Experiment initialization fails | 500 `preset_invalid`; nothing created | error | `test_experiment_creation_fails_cleanly_on_bad_preset` |
| Modified-run creation fails | 409/422/500; the old run is untouched | error, no success state | `failed modified-run creation shows error and no success state`, `test_replace_modified_requires_flag_and_inactive` |
| Invalid or stale universe id | 404 / 409 | resync notice | M1/M4 tests |
| Conflicting lifecycle | 409 with a code | detail shown | `test_mutation_on_inactive_universe_rejected` |
| Busy, failed or stalled integration | 503 / 500 / cancel → 409 | existing messages; Play stops | existing tests + `test_switch_during_step_rolls_back_outgoing_step` |
| Switching with a request pending | writes: switch disabled; steps: rolled back | switcher disabled | `switcher disabled while a write is pending` |
| Snapshot or restore failure | 409 `snapshot_limit` / 500 `restore_failed`; nothing changes | error | `test_failed_restore_leaves_state` |
| Incomplete comparison | 200 with `complete: false` and `issues` | issues shown | `test_comparison_incomplete_reported` |
| History fetch failure, gap or truncation | — | "may be incomplete" banner; cache kept | `history fetch failure keeps cache and marks stale` |
| Backend restart | fresh default universe | loss notice | M4 + smoke |
| Success before confirmation | — | success only after a parsed backend response | `no success before backend confirmation` |

## 18. Verification commands
```bash
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m pytest tests/validation -q
cd frontend && npm run typecheck && npm test && npm run build
.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8011
cd frontend && BACKEND_URL=http://127.0.0.1:8011 npx vite --port 5183
.venv/Scripts/python.exe scripts/presets/fetch_horizons.py     # dev only, needs network
```
CI runs pytest, `npm ci`, typecheck, vitest and build. New tests must not use the network.

## 19. Handoff

### 19.1 Branching (owner decision)
- There is one branch, `feature/simulation-lab-experiment-01`.
- It is based on `main` @ `d5220f9` and already contains the planning commits.
- There is no separate documentation PR. The specs, plan and implementation go into one PR.

### 19.2 Authoritative documents
- `context/specs/SIMULATION_LAB_SPEC.md`
- `context/specs/EXPERIMENT_01_SPEC.md`
- this plan

The specs outrank the plan. The code is the truth about the current state.

### 19.3 Required progress protocol
1. **Before coding:** post a concise milestone/checkpoint plan (M1–M12 with an expected commit per milestone). Then proceed without waiting.
2. **After each milestone:** a 3–6 line progress summary covering what changed, the test counts actually seen, deviations from this plan with reasons, and the next milestone. Append the same to `WORKLOG.md`.
3. **At the end:** an evidence-based report. It must include:
   - the actual command outputs (counts);
   - the measured scientific values against their thresholds;
   - the M11 outcome;
   - browser evidence;
   - the checks that could not run and why;
   - limitations and unresolved requirements;
   - the PR URL.

### 19.4 PR rules
- Push only `feature/simulation-lab-experiment-01`. Open one PR to `main` after M12. End the PR body with the session's attribution line.
- Monitor CI and fix failures the implementation caused.
- Never merge, never enable auto-merge, never bypass review.
- Request the owner's product review and note that an independent technical review will follow (OD-6). Never claim a review happened.

### 19.5 Autonomy and stop conditions (OD-4)
**Proceed without asking on:**
- routine engineering (names, structure, test organisation);
- fixing your own regressions;
- correcting this plan where it contradicts the code (record it in `WORKLOG.md`);
- choosing between equivalent implementations.

**Stop and report a genuine blocker when:**
1. The specs or plan are missing, or contradict each other on a requirement.
2. `origin/main` has moved in a way that changes the files or architecture this plan relies on, and adapting would change a spec-level behaviour.

   If it moved only harmlessly, merge `origin/main` into the branch with a normal merge commit (never rebase or force-push), re-run the baseline, and note it.
3. Horizons data cannot be retrieved and is not already committed. Never substitute values.
4. A required scientific check (§15.1, §9.4, §15.3) fails and investigation finds no implementation error.

   Report the measured values. Do not loosen tolerances or change the physics configuration.
5. A requirement would need any of these: a change to an accepted physics decision (D-007, D-008, D-010, D-011, D-012, D-021), a new runtime dependency, persistence, or "UI-1" behaviour.

   Also stop if it would require touching the :8000 backend or another branch.
6. A product-authority decision appears that the specs do not settle. Do not treat routine engineering choices as such.
7. A destructive or external action is needed beyond pushing this branch and opening its PR.
8. CI fails for reasons outside the branch.

**Not stop conditions** (handle them and document them):
- the bitwise snapshot test fails on some platform (downgrade the stated guarantee, §8.2);
- a catalogue value is unconfirmable (§10.2);
- the TRAPPIST-1 gate fails;
- Nikhil's review is not yet available.

### 19.6 Required verification before the PR
- Full pytest, typecheck, vitest and build all green.
- `tests/validation` green, with the measured values recorded.
- The live-server smoke tests are green.
- The §14.13 browser journey is recorded. If no browser tool is available, say so explicitly and list what was not verified.
- Docs are updated per M12.
- The §20 checklist is completed, with an evidence reference for each item.

### 19.7 Nikhil's role and the UI-2 / renderer ownership boundary
**Nikhil:**
- proposes interfaces, reviews the UI-2 design (§11B and the `ARCHITECTURE.md` section written in M7) and the resulting PR;
- does **not** modify implementation files or build a competing branch.

**Sonnet:** implements everything.

**Boundary:**
- History data (backend `HistoryBuffer`, `/history`, `fe/sim/history/*`, `HistoryTimeline`) is UI-2.
- The renderer (`UniverseCanvas`, `TrajectoryLayer`, `CelestialBody`, `StarfieldShell`, overlays, camera, metrics) is UI-0.
- They meet only at `fe/render/contract.ts` (`TrajectoryInput`, `PositionSample`) and the existing `bodies` prop.
- `App.tsx` changes are limited to the M4 extraction. UI-2 adds none.

If Nikhil proposes interface changes during the work, adopt them only if they keep this boundary and the specs. Otherwise record them as review comments for the owner.

## 20. Final acceptance checklist
**Simulation Lab (spec §13)**
- [ ] 1 Solar System validated; extra presets meet §5.4; Kepler-90 absent (M3, M11)
- [ ] 2 Catalogue: 9 entries with provenance and disclosure (M5)
- [ ] 3 Custom stars and planets (M5)
- [ ] 4 Navigation preserves state and time (M1, M4)
- [ ] 5 Only the active universe advances (M1)
- [ ] 6 No cross-universe mutation (M1, M2)
- [ ] 7 Lifecycle rules (M1, M2, M5)
- [ ] 8 Snapshot contract (M2)
- [ ] 9 Orbit Lab create and navigate (M8, M9)
- [ ] 10 Existing functionality intact (§14.13)
- [ ] 11 All checks pass (§18, M10)
- [ ] 12 Docs match (M12)
- [ ] 13 History meets §8.1: recorded, bounded, partitioned, reset and restore semantics, missing data shown (M2, M7)
- [ ] 14 Renderer changes only through UI-0; physical radius vs displayed size distinct (M5, M6)

**Experiment 01 (spec §12)**
- [ ] 1 Question (M8, M9)
- [ ] 2 Defensible ICs and Moon consequences documented (M3, M8)
- [ ] 3 Baseline immutable (M8)
- [ ] 4 Same intended initial state (M8)
- [ ] 5 Modification recorded and validated (M8)
- [ ] 6 No unintended difference (M8)
- [ ] 7 Independent advancement (M1)
- [ ] 8 Switching preserves state (M1, M4)
- [ ] 9 Edit/reset isolation; uncontrolled changes identifiable (M8)
- [ ] 10 Real measurements (M8, M9)
- [ ] 11 Independent expectations (§15.3)
- [ ] 12 Repeatable (M8)
- [ ] 13 Error handling (§17.3)
- [ ] 14 Existing functionality intact (§14.13)
- [ ] 15 Checks pass or blockers documented (§18)
- [ ] 16 Docs (M12)

---

## Appendix A — Self-review (planning architect's own pass; not an independent review)
| Looked for | Finding | Revision |
|---|---|---|
| Frontend-only isolation | none | — |
| Shared mutable global | Legacy `get_service()` | Bound to `uni-default` through the registry; fixture |
| Background advancement | Late commit after a switch | Commit guard + cancel |
| Incomplete snapshots | Records only | `copy()` + service state + history; limits stated in §8.2 |
| Mutable baseline | — | Derived from the initial snapshot; role rules |
| History mixing | Possible if keyed by body only | Universe + generation keys; separate caches; tests |
| History as hidden physics | Interpolation or extrapolation risk | Recorded samples only; gaps shown; replay over samples |
| Renderer coupling | History needing canvas changes | Frames via the existing `bodies`; paths via one contract prop |
| Undefined UI-0 / UI-1 | Not in the repo | UI-0 minimally defined here; UI-1 out of scope and a stop condition |
| Moon simplification | Earlier draft implied negligibility | Measured (234 km; 4,940 km) and documented; tests added |
| Overclaiming evidence | Probe numbers read as verified | Claim register §15.0 |
| Memory | History + snapshots | Caps lowered; `array('d')` |
| Tolerances | Earlier guesses | Probe-based with stated margins; Sonnet must reproduce them |
| Overengineering | — | No persistence, worker, E2E framework or extra presets |

## Appendix B — Sources consulted
- JPL Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html; live https://ssd.jpl.nasa.gov/api/horizons.api (2026-10-24).
- JPL SSD Astrodynamic Parameters: https://ssd.jpl.nasa.gov/astro_par.html.
- Park et al. 2021, AJ 161:105: https://ssd.jpl.nasa.gov/doc/Park.2021.AJ.DE440.pdf.
- JPL planetary physical parameters: https://ssd.jpl.nasa.gov/planets/phys_par.html.
- IAU 2015 B3 (Mamajek et al.): arXiv:1510.07674.
- Agol et al. 2021 (TRAPPIST-1): doi:10.3847/PSJ/abd022, arXiv:2010.01074; data https://github.com/ericagol/TRAPPIST1_Spitzer.
- Shaw et al. 2025 (Kepler-90): arXiv:2507.13588.
- NASA Exoplanet Archive, Proxima Cen: https://exoplanetarchive.ipac.caltech.edu/overview/Proxima%20Cen.
- Bond et al. 2017 (Sirius): arXiv:1703.10625.
- Joyce et al. 2020 (Betelgeuse): arXiv:2006.09837.
- Local probes (planning scratchpad, not in the repo): REBOUND 5.2.2 `copy()`; Experiment 01 model, Kepler, 9-body and Moon-omission evaluations.

## Appendix C — Paste-ready Sonnet 5.5 implementation prompt
```text
PLAYING GOD — Implement Simulation Lab + Experiment 01 (single branch, autonomous)

You are the sole application-code implementer for PLAYING GOD
(repo aarithooda/playing-god, local checkout "C:\Aarit\Projects\Playing God").

BRANCH AND BASE
- Work only on feature/simulation-lab-experiment-01 (already on origin). Base: main @
  d5220f93b25a93d08ae4fd3f7754fe7811710045. It already contains the specs and plan commits.
- Never push to main, force-push, rebase shared history, merge, enable auto-merge, create another
  branch, or use/restore feature/grid-axis or any other branch. If origin/main moves, follow plan §19.5(2).
- Never touch the owner's backend on port 8000; use your own ports (backend 8011, Vite 5183).

AUTHORITATIVE DOCUMENTS (read all three completely before changing code; specs outrank the plan)
- context/specs/SIMULATION_LAB_SPEC.md
- context/specs/EXPERIMENT_01_SPEC.md
- context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md
Also read context/HANDOFF.md, STATUS.md, API_CONTRACT.md, ARCHITECTURE.md, DECISIONS.md, AI_WORKFLOW.md.

FIRST
1. Audit: git fetch --all --prune; checkout and fast-forward the branch; confirm merge-base with origin/main;
   git status; read the code paths named in plan §2. Note any contradiction between plan and code in WORKLOG.md
   and correct the plan in your branch.
2. Baseline: .venv/Scripts/python.exe -m pytest -q ; cd frontend && npm run typecheck && npm test && npm run build.
   Record actual results.
3. Post a concise milestone/checkpoint plan (M1–M12, expected commit per milestone), then proceed without waiting.

SCOPE (complete all of it, in order M1→M12; M11 TRAPPIST-1 is optional and gated)
M1 universe registry, isolation, epoch-guarded active-only mutation, legacy routes on uni-default
M2 snapshots (rebound copy), initial-state reset, backend history recording (grid/step), controlled flag + audit
M3 Solar System J2000 preset (Horizons + DE440), loader, provenance, Moon-omission validation
M4 frontend universe scoping, switcher, presets, snapshots, keyed UniverseWorkspace (App.tsx: extraction only)
M5 sourced catalogue (9 entries), custom stars/planets, physical-vs-displayed radius labelling
M6 UI-0 renderer boundary: fe/render/contract.ts, TrajectoryLayer, ONE new UniverseCanvas prop (trajectories)
M7 UI-2 history model/hooks/timeline/replay (no UniverseCanvas.tsx or App.tsx changes; no canvas imports)
M8 Orbit Lab backend + Experiment 01 validation (independent Kepler reference)
M9 Orbit Lab frontend (run badges, comparison, reference/active trajectories via UI-0)
M10 hardening, live-server smoke, scripted browser journey (plan §14.13)
M11 optional TRAPPIST-1 behind its validation gate
M12 docs (API_CONTRACT, ARCHITECTURE incl. UI-0/UI-2, DECISIONS D-025+, STATUS, TASKS, WORKLOG, HANDOFF,
    README, PRESETS.md, EXPERIMENT_01_PROTOCOL.md with measured results) and the PR

OWNERSHIP AND BOUNDARIES
- Module ownership: plan §5.1–5.2. API: plan §12 (only endpoints marked ✅ exist today; add each new one to
  API_CONTRACT.md in the same commit). Renderer boundary: §11A. History: §11B.
- Nikhil (UI-2 proposer) may propose interfaces and review; he does not edit implementation files. Adopt his
  proposals only if they keep the UI-0/UI-2 boundary and the specs; otherwise record them for the owner.
- History is recorded only from backend-produced states; never interpolate, extrapolate or run frontend physics;
  never mix universes, generations, snapshots or runs.
- "UI-1" is unspecified: implement nothing under that name.

QUALITY RULES
- TDD per milestone: write the named failing tests, implement, run the full suites, commit.
- Coherent commits as milestones pass (messages in plan §13). Fix regressions; never weaken, skip or loosen tests or
  tolerances; never change the physics configuration (D-007/008/010/011/012/021).
- Never invent astronomical values, epochs or citations; transcribe from the sources in plan §9–§10 and record
  basis/uncertainty. Every claim marked "planning probe" or "unverified" in plan §15.0 must be reproduced by a
  committed test or marked unverified in your report.
- Required verification: backend pytest (incl. tests/validation), tsc, vitest, production build, live-server smoke,
  scientific validation with measured values, and the browser journey (Playwright MCP or the in-app browser) where
  available. Do not claim any of these without seeing the actual result.

COMMUNICATION
- After each milestone: 3–6 line progress summary (changes, real test counts, deviations, next) and a WORKLOG entry.
- Stop and report only for the genuine blockers in plan §19.5 (missing/contradictory specs, conflicting main changes,
  unretrievable source data, a required scientific check failing without a code cause, needing a physics-decision
  change/new dependency/persistence/UI-1, a product-authority question the specs do not settle, a destructive or
  external action beyond pushing this branch and opening its PR, CI failing outside the branch). Resolve routine
  engineering choices yourself.

FINISH
- When M12 is complete and verified: push the branch, open ONE PR to main with the evidence (test outputs, measured
  scientific values vs thresholds, M11 outcome, browser evidence, checks that could not run, limitations, unresolved
  requirements), request the owner's product review, note that an independent technical review follows, monitor CI,
  fix implementation-caused failures, and STOP. Never merge.
- Final report: evidence-based, with the PR URL and the completed plan §20 checklist.
```
