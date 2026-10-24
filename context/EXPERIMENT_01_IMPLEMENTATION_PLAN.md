# Simulation Lab + Experiment 01 — Implementation Plan (final for implementation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-simulation PLAYING GOD app into Simulation Lab and deliver Orbit Lab / Experiment 01.
- Simulation Lab: independent backend-owned universes, active-only advancement, in-memory snapshots, a validated Solar System preset (plus TRAPPIST-1 only if it passes its gate), a sourced body catalogue, custom stars/planets.
- Experiment 01: a protected baseline versus a velocity-scaled modified run, compared from real backend samples.

**Architecture:**
- A backend `UniverseRegistry` owns one `SimulationService` engine per universe, each with its own lock, REBOUND simulation, merger resolver, ledgers, events, samples and snapshots.
- Only the active universe can be mutated. Every mutation echoes the activation epoch it was issued under, and the engine re-checks it under its lock on entry and immediately before commit. A stale, late or misdirected request therefore cannot advance or edit the wrong universe.
- The frontend keeps layout state in `App` and mounts one `UniverseWorkspace` keyed by `universeId:activationEpoch`, so a switch discards every client task of the old universe.

**Tech stack:** FastAPI + Pydantic v2 + REBOUND 5.2.2 (IAS15 GLOBAL, `line` collisions), Python 3.11; React 18 + TypeScript 5 + Vite 5 + three 0.186 / R3F 8 / drei 9; pytest; vitest + Testing Library.

**Authoritative documents (read all three before any change; the specs outrank this plan):**
- `context/specs/SIMULATION_LAB_SPEC.md` (Draft 0.2, owner decisions applied)
- `context/specs/EXPERIMENT_01_SPEC.md` (Draft 0.3, owner decisions applied, Appendix A evidence)
- this plan

**Status:** final planning revision, 2026-10-24, by the planning architect (Claude Opus 5.5). It contains no implementation and no review of an implementation. Owner decisions OD-1 to OD-6 are resolved (§17.1).

## Global constraints
- SI units in every API field and in tests. G = 6.67430e-11 m³ kg⁻¹ s⁻² (D-007). One right-handed inertial Cartesian frame (D-010).
- The physics engine configuration is unchanged: IAS15 with the GLOBAL criterion (D-011), the wall-clock budget (D-012), `line` collisions and `rand_seed = 12345` (D-008). Do not tune it.
- The backend stays authoritative (D-001). The frontend never integrates.
- No new runtime dependency (no database, no worker process, no E2E framework). Data files are committed; the runtime never uses the network.
- In-memory state only (OD-5).
- Never invent astronomical values, epochs or citations. Every value carries a source and a basis label.
- Tests and tolerances are never loosened to pass. A failed check is investigated and reported.
- Git: work on `feature/simulation-lab-experiment-01`. Never commit to `main`, force-push, rewrite shared history, merge your own PR, touch other people's branches, or touch the owner's backend on port 8000.

## Review focus (failure modes no single task's tests fully cover; each has a test in the named milestone)
1. **Switch while a step is in flight, then switch back (A→B→A):** the old A step must never commit. Test: `test_aba_switch_rejects_old_epoch` (M1).
2. **Two browser tabs on the same backend:** the second tab's writes fail visibly with `stale_activation` and it resyncs; nothing is mis-applied. Test: `stale-activation adopts backend active universe` (M4).
3. **Backend restart while the frontend is open:** the frontend shows "universes were lost" instead of stale state. Test: `useUniverses resyncs after universe-lost and shows notice` (M4).
4. **Edit to a modified run, then reset:** the run reports uncontrolled after the edit and controlled after the reset, while the audit log keeps the edit. Test: `test_modified_edit_marks_uncontrolled_and_reset_restores_controlled` (M6).
5. **Comparison requested before the modified run has advanced, or while times differ:** the response must be explicit, never empty-but-successful. Test: `test_comparison_incomplete_reported` (M6), `comparison flags different simulation times` (M7).

---

## 1. Executive summary
- **Verified start:** `main` = `origin/main` = `d5220f93b25a93d08ae4fd3f7754fe7811710045`. There is one in-memory `SimulationService` (`backend/simulation.py:368`) and no universe, snapshot, preset, catalogue, trajectory or experiment concept.
- **Isolation:** per-universe engine objects plus an activation epoch checked twice under the engine lock. Switching cancels the outgoing in-flight step (heartbeat stop) and the commit check rolls it back, so a universe that is left gains no time.
- **Snapshots:** `rebound.Simulation.copy()` plus deep copies of service state. Probed: bit-identical continuation within one process and REBOUND build. The limits are stated in §8.2.
- **Reset:** restores each universe's immutable initial snapshot.
- **Presets (OD-1):**
  - **Solar System at J2000** is required. Source: Horizons + DE440. Validation evidence: worst relative error vs. the ephemeris 3.9e-6 after 2 years.
  - **TRAPPIST-1** is conditional on a transit-time validation gate (milestone M9, after the required scope).
  - **Kepler-90** is removed.
- **Catalogue (OD-2):** 5 stars and 4 planets, with per-property value, uncertainty, source and basis (`measured`, `nominal`, `estimated`, `illustrative`). Catalogue entries, visual assets and validated presets are kept distinct.
- **Experiment 01 (OD-3, evidence in the Experiment spec Appendix A):**
  - Model: Sun + Earth–Moon barycentre (EMB) at J2000. Evidence: 110× closer to the ephemeris over two years than Sun + Earth-centre.
  - Control: speed factors {0.90, 0.95, 1.05, 1.10}, all bound.
  - Observation: 730 days with daily samples on an exact grid.
  - Validation: an independent Kepler reference with tolerance 1e-10·a (measured ≤ 2.5e-13·a).
- **Delivery:** milestones M1–M8 (required), then M9 (TRAPPIST-1, gated), then M10 (final docs, PR). One PR to `main`. The implementer never merges (OD-6).

## 2. Starting state and audit findings

### 2.1 Repository state verified 2026-10-24
| Item | Value |
|---|---|
| Repo | `C:/Aarit/Projects/Playing God`, remote `aarithooda/playing-god` |
| `main` = `origin/main` | `d5220f93b25a93d08ae4fd3f7754fe7811710045` (merge of PR #13) |
| Open PRs | none |
| Tags | `archive/frontend-close-body-inspector` |
| Remote branches | `main`; **`origin/feature/grid-axis` reappeared** (head `9ba7f9e`, 4 commits authored "Codex" on 2026-10-24, branched from `ede80c0`, **not** an ancestor of `main`; touches `frontend/src/App.tsx`, `ControlPanel.tsx`, `BodyInspector.tsx`, `BodyFields.tsx`, `UniverseCanvas.tsx`, `validation.ts`, `index.css`, and adds `ActionToast.tsx`, `ViewToolbar.tsx`, `CoordinateFrame.tsx`, `viewControlContract.ts`). The FINAL HANDOVER recorded this branch as deleted; someone has pushed it again. It is **unmerged teammate work**: do not merge, rebase, delete or build on it. See §17.2. |
| Working tree before this revision | only `context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md` (untracked) |
| Branch protection on `main` | none (handover) |
| REBOUND / Python in `.venv` | 5.2.2 / 3.11.7 |
| Baseline tests on `d5220f9` (run in the planning session) | pytest **265 passed**, 1 warning; `tsc` clean; vitest **203 passed** (23 files); `npm run build` **not run in planning** (STATUS reports it OK on `a2de061`) |

**Discrepancy resolved: plan and specs status.** Before this revision the plan file existed only as an untracked file on `main`, and `context/specs/` **did not exist**: the specifications had never been committed. The earlier report said the plan's Task 0.2 *would* commit them; it did not claim they were committed. In this revision:
- `context/specs/SIMULATION_LAB_SPEC.md` and `context/specs/EXPERIMENT_01_SPEC.md` were created from the owner-supplied text, with owner decisions applied and the replaced Draft wording kept in each "Revision record";
- this plan was rewritten in place (the earlier untracked draft was the planning session's own file);
- nothing else in the repository changed.

The documentation PR that preserves these files is described in §19.1.

**Operational caveat (unchanged):** the owner's backend on :8000 may run old code and hold an unrestorable universe. Use your own ports (backend :8011, Vite :5183).

### 2.2 Backend audit (verified in code)
- **Engine:** `SimulationService` (`backend/simulation.py`).
  - `_new_sim` sets units m/s/kg, then G = 6.67430e-11 after `units`, `rand_seed` 12345, IAS15 GLOBAL through `collisions.select_ias15`, `collision="line"`, the resolver `MergeResolver.resolve`, and the heartbeat `_heartbeat`.
  - Body id = particle `name` (`body-<12 hex>`). `_meta: dict[id, (name, colorHex)]` holds display data in creation order. `MergeResolver` holds `heat_J` and `spin`.
- **Time:** only `step(dt_s)` advances it (`_advance`: 1 % curvature chunks, at most 2000 chunks, heartbeat deadline). The server never runs on its own; Play is a client loop (`useSimulation.ts:213-232`).
- **Transactions:** `_capture` → advance → `_restore` on failure. The restore is a records rebuild, not bitwise (D-012). Responses: 500 failed, 503 timeout.
- **Concurrency (D-021):** one `RLock`. Mutations go through `_guard()` (bounded wait → 503 busy). Reads return `_published` without the lock.
- **Reset:** empty universe at t = 0; event ids keep counting.
- **Persistence:** none.
- **Test seam:** `get_service()` with `app.dependency_overrides`, or direct `SimulationService()`.

### 2.3 Frontend audit (verified in code)
- `App.tsx` owns UI state and calls `useSimulation(client)` once, with a module-level `createApiClient()`.
- `useSimulation`: one FIFO queue (`enqueue`) and a Play loop. Every `setState` is guarded by `mounted.current`, which is why the keyed remount drops late responses.
- `api/client.ts`: fixed `/api/v1/simulation/*`, `/api/v1/bodies*` and `/api/v1/events` paths; timeouts of 8 s (reads) and 35 s (writes).
- `api/parse.ts`: picks known keys, so additive fields are safe.
- UI: `ControlPanel`, `BodyInspector` (Apply is allowed while playing today), `BodyFields`, `validation.ts` (mirrors `LIMITS`), `EventTimeline`, `DiagnosticsPanel`, `ViewPanel`, `Sidebar`/`layout.ts`, `UniverseCanvas` (`CameraRig`, `ViewportInset`, placement, overlays), `renderTransform.ts` (scene = (x, z, −y)/metersPerUnit).

### 2.4 Tests, CI, commands (verified)
- `python -m pytest -q` (`pytest.ini`: `testpaths = tests`, `pythonpath = .`, `error::RuntimeWarning`): API, service, stall, step guard, P-003 stress, diagnostics, events, `validation/`, `spike/`, `smoke/` (real uvicorn).
- Frontend: `npm run typecheck`, `npm test`, `npm run build`.
- CI (`.github/workflows/ci.yml`) runs these on pushes to `main` and on PRs (Python 3.11, Node 20).
- No browser E2E framework (T-010). Playwright MCP / the in-app browser are available to the implementing session for scripted manual checks.
- No database; no migration.

## 3. Requirement → file → test traceability matrix
MS = milestone (§13). File paths are relative to the repo root; `fe/` = `frontend/src/`. Every listed test is created in that milestone.

### 3.1 Simulation Lab (spec Draft 0.2)
| Req | Requirement | Files | Tests | MS | Acceptance |
|---|---|---|---|---|---|
| SL-1 | Extend the existing app; backend authoritative; no frontend IDs over shared state | `backend/universes.py`, `backend/simulation.py`, `fe/App.tsx`, `fe/UniverseWorkspace.tsx` | `test_two_universes_hold_different_states`, `test_derived_engine_shares_no_mutable_objects`, all existing suites | M1, M4 | Engines are distinct objects; full regression green |
| SL-3 | A universe id alone is not independence | `backend/universes.py` | `test_two_universes_hold_different_states` (asserts `is not` on sim, resolver, meta) | M1 | — |
| SL-4.1a | Clear navigation; active universe identifiable | `fe/components/ui/UniverseSwitcher.tsx` | `UniverseSwitcher.test.tsx`: `shows active universe name and role` | M4 | Active name visible at all times |
| SL-4.1b | Leaving stops advancement; state, time, config and integration state retained; no background advance | `backend/simulation.py` (cancel, guard), `backend/universes.py` (`activate`) | `test_switch_during_step_rolls_back_outgoing_step`, `test_step_active_leaves_other_bitwise_unchanged` | M1 | The left universe's time and bodies are bitwise unchanged |
| SL-4.1c | Return resumes at the exact instant; no reset or reconstruction | same | `test_return_resumes_exact_instant` | M1 | Bitwise equal to an uninterrupted twin |
| SL-4.2 | Identity, transitions, active-only advancement, concurrency, isolation, stale/invalid handling, failure/busy/timeout, cleanup, restart | `backend/universes.py`, `backend/errors.py`, `backend/api_universes.py` | `test_mutation_on_inactive_universe_rejected[*]`, `test_stale_epoch_rejected`, `test_aba_switch_rejects_old_epoch`, `test_concurrent_steps_serialized`, `test_expected_revision_rejects_duplicate`, `test_stuck_universe_does_not_block_other_universe`, `test_delete_active_rejected`, `test_delete_then_404_with_deleted_detail`, `test_universe_limit`, `test_last_failure_recorded_and_cleared` | M1 | §7 table holds |
| SL-4.2b | An old request cannot advance an inactive universe | as above | `test_stale_epoch_rejected`, `test_legacy_routes_target_default_and_refuse_when_inactive` | M1 | 409, no change |
| SL-4.3 | In-memory only; after a restart the client detects loss | `fe/sim/useUniverses.ts` | `useUniverses resyncs after universe-lost and shows notice`; smoke `test_restart_loses_universes_and_default_is_recreated` | M4, M8 | Notice shown; no stale state shown as current |
| SL-5.1 | Solar System preset required, with a full provenance record | `backend/presets/loader.py`, `backend/presets/data/solar-system-j2000.json`, `backend/presets/sources/horizons/*`, `scripts/presets/fetch_horizons.py`, `context/PRESETS.md` | `test_solar_raw_to_si_exact`, `test_solar_masses_from_de440_gm`, `test_solar_barycentre_shift_zero_momentum`, `test_solar_against_horizons_1y_2y`, `test_solar_provenance_complete` | M3 | §15.1 thresholds |
| SL-5.2 | TRAPPIST-1 conditional; Kepler-90 removed | `backend/presets/data/trappist-1-agol2021.json` (M9 only) | `test_trappist_*` (M9); `test_presets_list_has_no_kepler90` | M3, M9 | TRAPPIST-1 listed only if its gate passes |
| SL-5.3 | Load creates a new universe, never silently replaces; isolated | `backend/api_universes.py`, `fe/components/ui/PresetPicker.tsx` | `test_preset_load_creates_new_universe_and_leaves_others`, `loading a preset creates a new universe and does not delete the current one` | M3, M4 | Others bitwise unchanged |
| SL-5.4 | Validation standard (sources, re-derivation, independent check) | `backend/presets/loader.py`, tests | `test_preset_invalid_file_creates_nothing`, `test_presets_list_marks_unavailable` | M3 | 500 `preset_invalid`, nothing created |
| SL-6.1 | Approved catalogue: 5 stars and 4 planets; value, unit, uncertainty, source, basis; estimated values disclosed; entries ≠ visual assets ≠ presets | `backend/catalogue.py`, `backend/catalogue_data.json`, `fe/components/ui/CataloguePanel.tsx` | `test_catalogue_entries_and_provenance`, `CataloguePanel.test.tsx`: `shows estimated badge and uncertainty`, `labels colour as display only` | M5 | Exactly the approved names; every property has source + basis |
| SL-6.2 | Entries are copied, never live references | `backend/catalogue.py` | `test_catalogue_is_immutable`, `catalogue entry prefills form without mutating the catalogue` | M5 | — |
| SL-6.3 | No moons | `context/PRESETS.md` | `test_solar_bodies_exact_set` (exactly the 9 bodies) | M3 | — |
| SL-7a | Custom stars and planets; mass, radius, velocity, position | `backend/models.py` (`kind`), `fe/components/ui/ControlPanel.tsx`, `BodyFields.tsx` | `test_body_kind_defaults_and_roundtrip`, `create star sends kind star` | M1, M5 | — |
| SL-7b | Validation incl. lifecycle and wrong universe; backend independent | `backend/models.py`, `backend/universes.py`, `fe/sim/validation.ts` | existing validation tests + `test_mutation_on_inactive_universe_rejected[*]`, `test_baseline_rejects_edits`, `invalid mass shows field error and sends nothing` | M1, M5, M6 | 422/409 and no mutation |
| SL-7c | Pause-to-edit (UI); atomic between steps (backend) | `fe/components/ui/BodyInspector.tsx` | `apply disabled while playing with explanation`, `test_edit_between_steps_is_atomic` | M1, M5 | — |
| SL-7d | Cancel leaves state unchanged; understandable errors | `BodyInspector.tsx`, `ControlPanel.tsx` | `revert leaves confirmed values`, `server 409 detail shown verbatim` | M5 | — |
| SL-8 | Play/Pause/Step/Reset/Switch/Load/Edit/Snapshot, explicit target, honest status | `fe/api/client.ts` (`scoped`), `fe/components/ui/SnapshotPanel.tsx` | `scoped client sends activationEpoch on every mutation`, `SnapshotPanel.test.tsx` | M4 | — |
| SL-9.1 | Snapshot contract (in-memory) | `backend/simulation.py` (`EngineSnapshot`) | `test_snapshot_restore_physical_state_exact`, `test_snapshot_restore_bitwise_continuation`, `test_restore_preserves_engine_configuration`, `test_failed_restore_leaves_state`, `test_event_ids_not_reused_after_restore` | M2 | §8.2 |
| SL-9.2 | Reset restores that universe's initial state; destructive reset confirmed | `backend/simulation.py`, `fe/components/ui/ConfirmButton.tsx` | `test_reset_restores_initial_snapshot_only_target`, `test_reset_default_sandbox_is_empty_like_before`, `reset and restore require confirmation` | M2, M4 | — |
| SL-9.3 | Independent copies | `SimulationService.from_snapshot` | `test_derived_engine_shares_no_mutable_objects`, `test_modified_ops_leave_baseline_bitwise` | M2, M6 | — |
| SL-10 | Orbit Lab: two universes, switchable, immutable baseline, identifiable uncontrolled changes | `backend/orbit_lab.py`, `fe/components/ui/OrbitLabPanel.tsx`, `RunBadge.tsx` | M6/M7 tests | M6, M7 | — |
| SL-11 | UX priorities | M4–M7 components | browser journey §14.13 | M4–M8 | — |
| SL-12 | NFRs (credibility, direct isolation tests, no weakened tests, error handling, no extra infrastructure, no background integration, docs) | all | full suites; `test_activation_does_no_integration` (activate does not call `integrate`: monkeypatch counter) | all | — |
| SL-13 | Acceptance | — | §20 | — | — |
| SL-14 | Exclusions; owner decisions recorded | `context/DECISIONS.md` | doc review | M10 | — |

### 3.2 Experiment 01 (spec Draft 0.3)
| Req | Requirement | Files | Tests | MS | Acceptance |
|---|---|---|---|---|---|
| E01-1 | Real backend gravity; no fabricated trajectories | `backend/orbit_lab.py` | `test_comparison_common_grid_and_separation` (recomputes from `/trajectory`); code review: no trajectory constants | M6 | — |
| E01-2 | Question; separate the velocity effect from IC, timing or sharing artefacts | `backend/orbit_lab.py` | `test_initial_differences_only_selected_velocity`, `test_sample_grids_identical` | M6 | — |
| E01-3 | Learning objectives; model limits visible | `fe/components/ui/OrbitLabPanel.tsx`, `context/EXPERIMENT_01_PROTOCOL.md` | `shows two-body model limitation note` | M7, M10 | — |
| E01-4.1 | Documented baseline; immutable (no edit, no arbitrary restore, no snapshots) | `backend/universes.py` (role checks), `backend/orbit_lab.py` | `test_baseline_rejects_edits`, `test_baseline_rejects_snapshot_and_restore`, `test_baseline_reset_restores_initial` | M6 | 409 `baseline_protected`, digest unchanged |
| E01-4.2 | Derived from the same intended state; one variable; recorded; uncontrolled changes identifiable; documented momentum consequence | `backend/orbit_lab.py`, `backend/simulation.py` (`controlled`, audit log) | `test_modified_derived_from_initial_not_current`, `test_speed_factor_preserves_direction`, `test_modified_edit_marks_uncontrolled_and_reset_restores_controlled`, `test_cosmetic_edit_keeps_controlled`, `test_snapshot_carries_controlled_flag` | M6 | — |
| E01-4.3 | Isolation of advance, edit, reset, switch, inactive retention, failed/stale requests | M1 + `backend/orbit_lab.py` | `test_modified_ops_leave_baseline_bitwise`, M1 tests | M1, M6 | — |
| E01-5 | Sun + EMB two-body at J2000 from the Solar data; full protocol | `backend/orbit_lab_systems.json`, `backend/orbit_lab.py`, `context/EXPERIMENT_01_PROTOCOL.md` | `test_exp01_system_bodies_and_sources`, `test_exp01_initial_state_from_horizons_exact`, `test_exp01_two_body_barycentre_zero_momentum` | M6 | — |
| E01-6 | Factors {0.90, 0.95, 1.05, 1.10}; preview before creation; backend validates | `backend/orbit_lab.py`, `fe/components/ui/OrbitLabPanel.tsx` | `test_disallowed_factor_or_body_rejected_without_change[*]`, `preview shows baseline and modified speed before creation` | M6, M7 | — |
| E01-7 | 12-step workflow; active run identity | `OrbitLabPanel.tsx`, `RunBadge.tsx` | `run badge distinguishes baseline and modified`; browser journey §14.13 | M7, M8 | All 12 steps executed |
| E01-8 | 730 d window, daily exact grid; 5 mandatory outputs; different times flagged; no mutation by display | `backend/simulation.py` (sampling), `backend/orbit_lab.py` (comparison), `fe/components/canvas/TrajectoryOverlay.tsx`, `fe/components/ui/ComparisonPanel.tsx` | `test_samples_on_exact_grid`, `test_comparison_common_grid_and_separation`, `test_comparison_incomplete_reported`, `comparison flags different simulation times`, `trajectory.ts builds scene points with toScenePosition`, `comparison never calls mutating endpoints` | M2, M6, M7 | — |
| E01-9 | Validation table (spec §9) | `tests/validation/kepler_reference.py`, `tests/validation/test_experiment01.py` | `test_exp01_matches_kepler_reference[f]`, `test_exp01_qualitative_ordering`, `test_exp01_period_matches_vis_viva[f]`, `test_exp01_energy_and_angular_momentum_drift[f]` | M6 | Spec §9 thresholds |
| E01-10 | Reset targeted run only; snapshot contract; reproducible | `backend/simulation.py`, `backend/orbit_lab.py` | `test_experiment_repeatable_digests`, `test_experiment_bitwise_repeatable_trajectories`, `test_reset_modified_only` | M2, M6 | — |
| E01-11 | Error cases (9 listed) | `backend/errors.py`, `backend/api_orbit_lab.py`, frontend panels | §17.3 table, each with a named test | M6–M8 | — |
| E01-12 | Acceptance | — | §20 | — | — |
| E01-13 | Decisions recorded | `context/DECISIONS.md`, `context/EXPERIMENT_01_PROTOCOL.md` | doc review | M10 | — |
| E01-14 | One modification, no moons, no extra physics | `backend/orbit_lab.py` | `test_only_one_modification_kind` (request schema forbids other fields) | M6 | — |

## 4. Current architecture and gaps
| Area | Today | Gap |
|---|---|---|
| Ownership | `_service` singleton | No identity, isolation or active concept |
| Advancement | Lock + budget | No eligibility rule |
| Restore | Records rebuild on failure | No user snapshots; not bitwise |
| Reset | Empty | Needs per-universe initial state |
| Data | User input only | No sourced data, provenance or catalogue |
| Frontend | One hook, one client | No scoping or stale-response policy across universes |
| Experiment | none | Everything |

## 5. Proposed architecture and decisions

### 5.1 Backend modules
| File | Responsibility |
|---|---|
| `backend/simulation.py` (modify) | `SimulationService` = the per-universe engine. Adds revision, commit guard parameter, cancel flag, initial snapshot, snapshot/restore, `load_bodies`, time-grid sampling, the controlled flag and audit log. Physics unchanged. |
| `backend/universes.py` (new) | `Universe`, `UniverseRegistry`, `get_registry()`, `DEFAULT_UNIVERSE_ID = "uni-default"`, legacy `get_service()` → default engine |
| `backend/errors.py` (new) | `CodedConflict(ConflictError)` with `.code`; `UniverseNotActive`, `StaleActivation`, `StaleRevision`, `BaselineProtected`, `UniverseNotFound`, `PresetDataError`; `StepCancelled(SimulationFailure)` |
| `backend/lab_models.py` (new) | Pydantic models in §12 |
| `backend/api_universes.py`, `backend/api_orbit_lab.py` (new) | `APIRouter`s |
| `backend/presets/{__init__,loader}.py`, `backend/presets/data/`, `backend/presets/sources/` (new) | Preset data and validation |
| `backend/catalogue.py`, `backend/catalogue_data.json` (new) | Read-only catalogue |
| `backend/orbit_lab.py`, `backend/orbit_lab_systems.json` (new) | Experiments, derivation, initial differences, comparison |
| `backend/main.py` (modify) | Routers, legacy guard dependency, coded-conflict handler (adds `code`) |
| `scripts/presets/fetch_horizons.py` (new, dev-only, not imported by the app) | Regenerates Horizons source files and the derived JSON |

### 5.2 Frontend modules
| File | Responsibility |
|---|---|
| `fe/api/types.ts`, `fe/api/parse.ts`, `fe/api/client.ts` (modify) | DTOs, strict parsers, `ApiClient.scoped(scope)`, registry/preset/catalogue/orbit-lab calls; legacy methods kept |
| `fe/sim/useUniverses.ts` (new) | List, active, scope, actions, resync |
| `fe/sim/useSimulation.ts` (modify, minimal) | Takes `ScopedClient`; reports `universe-lost` / `stale-activation` through `onScopeInvalid`; reports `busyWrite` |
| `fe/UniverseWorkspace.tsx` (new) | All universe-dependent UI moved from `App.tsx` (selection, focus, transform, placement, canvas, controls, inspector, snapshots, catalogue, Orbit Lab, comparison) |
| `fe/App.tsx` (modify) | Layout state (sidebars, Axes/Grid), `useUniverses`, `UniverseSwitcher`, keyed `UniverseWorkspace` |
| `fe/components/ui/{UniverseSwitcher,PresetPicker,SnapshotPanel,CataloguePanel,OrbitLabPanel,ComparisonPanel,RunBadge,ConfirmButton}.tsx` (new) | UI |
| `fe/components/canvas/TrajectoryOverlay.tsx`, `fe/sim/trajectory.ts`, `fe/sim/useOrbitLab.ts` (new) | Trajectories and Orbit Lab state |

### 5.3 Decisions and rejected alternatives
| # | Decision | Rejected and why |
|---|---|---|
| A1 | One engine instance per universe in a registry | Frontend IDs over one simulation (forbidden by the spec); one REBOUND sim for all universes (shared integrator, cross-gravity); one process per universe (unneeded infrastructure) |
| A2 | Activation epoch on every mutation, checked at entry and at commit | Universe id only (fails A→B→A); tokens or sessions (no auth model; the problem is ordering) |
| A3 | Activation cancels the outgoing step; the commit check rolls it back | Waiting for A (a stuck A blocks switching); letting A commit (background advancement) |
| A4 | Only the active universe can be mutated; reads work on any universe | Editing inactive universes multiplies the stale-target cases for no product benefit |
| A5 | Snapshots via `Simulation.copy()` + service state | Particle records only (not a checkpoint); disk files (OD-5) |
| A6 | Immutable initial snapshot per universe; reset restores it | Re-loading presets on reset (a second code path) |
| A7 | Preset load always creates a new universe | Implicit replace (the spec forbids silent destruction) |
| A8 | Modified run derived from the baseline's initial snapshot | Deriving from the current state (depends on progress) |
| A9 | Backend computes the comparison on an exact common grid | Frontend interpolation (not authoritative; times would not match) |
| A10 | Legacy endpoints bound to `uni-default`, 409 when it is inactive | Removing them (breaks ~100 tests); binding to the active universe (an old legacy step would advance another universe) |
| A11 | Keyed remount of `UniverseWorkspace` | Hand-written generation counters (duplicates the `mounted` guard) |
| A12 | In-memory only (OD-5) | Persistence |
| A13 | Offline data scripts; committed sources; no runtime network | Live Horizons at load (non-reproducible) |
| A14 | Sun + EMB two-body for Experiment 01 | Sun + Earth-centre (110× worse vs. the ephemeris, Experiment spec Appendix A); the full Solar System (no exact analytic reference; harder to interpret) |

### 5.4 Data flow
Step: `ControlPanel.onStep` → `useSimulation.doStep` → `ScopedClient.step(dtS)` → `POST /api/v1/universes/{id}/step?activationEpoch=E` → `registry.guard_for(id, E)` → `engine.step(dtS, guard=g)` (lock; `g()`; advance with sampling; `g()`; publish or roll back) → `UniverseStepResponse` → parse → `applySim` (only if this workspace is still mounted) → render.

## 6. Universe isolation and active-only advancement

### 6.1 Identity and limits
- `universeId` = `uni-<12 hex>`; the default is `uni-default` (role `sandbox`, empty, active at startup with epoch 1).
- `Universe` dataclass: `id`, `name` (1–64), `role: Literal["sandbox","preset","baseline","modified"]`, `preset_id`, `experiment_id`, `provenance: UniverseProvenance`, `engine: SimulationService`, `created_at` (ISO UTC), `snapshots: dict[str, EngineSnapshot]`, `deleted: bool`.
- Limits: `MAX_UNIVERSES = 16`, `MAX_SNAPSHOTS_PER_UNIVERSE = 20`, `MAX_SAMPLES = 20000`. Sampling is enabled only for Orbit Lab runs.
- Body ids are unique **per universe**. Preset and system bodies have stable ids (`body-sun`, `body-mercury`, …, `body-earth` for the EMB). Derived runs keep their baseline's body ids; user-created bodies keep `body-<12 hex>`.

### 6.2 Registry and lock order
- `UniverseRegistry` holds `_lock: threading.Lock`, `_universes`, `_deleted_ids: set[str]`, `_active_id`, and `_epoch: int` (+1 on every activation, including re-activating the same universe).
- **Eligible to advance** = active, not deleted, and the request's `activationEpoch == _epoch`.
- **Lock order:** an engine lock may be held while briefly taking the registry lock. The registry lock is never held while waiting for an engine lock. `activate`, `create`, `delete` and `list` take only the registry lock.

### 6.3 CommitGuard
```python
class CommitGuard(Protocol):
    def __call__(self) -> None: ...  # raises UniverseNotFound / UniverseNotActive / StaleActivation / StaleRevision
```
- `UniverseRegistry.guard_for(universe_id, activation_epoch, expected_revision=None) -> CommitGuard` validates immediately and returns a closure that re-validates under the registry lock.
- Every engine mutator takes `guard: CommitGuard | None = None` and calls it right after acquiring the engine lock and immediately before `_publish()`. If the second call raises, the mutator restores its pre-mutation state and re-raises.
  - For steps, the pre-mutation state is the existing `_capture`/`_restore`.
  - For CRUD, reset and restore, it is an `EngineSnapshot` taken at entry.
- `guard=None` preserves today's behaviour for the existing direct-service tests.

### 6.4 Activation
`activate(uid) -> ActivationResult` runs under the registry lock only:
1. 404 if unknown or deleted.
2. `previous.engine.request_cancel()`.
3. Set `_active_id`, then `_epoch += 1`.
4. `new.engine.clear_cancel()`.

It returns `{activeUniverseId, activationEpoch, previous: {universeId, simulationTimeS, revision} | null}`, with the previous universe's last committed values. It never integrates (`test_activation_does_no_integration`) and never waits for an engine lock.

### 6.5 Cancellation
- `request_cancel()` sets `_cancel = True`.
- `_heartbeat` stops `integrate` when the deadline passes or `_cancel` is set.
- `_check_deadline` raises `StepCancelled` first when `_cancel` is set.
- `step` rolls back and re-raises. HTTP answers 409 `deactivated_during_step`: "the universe was switched away during this step; it was not advanced".
- Even if a native stall never reaches the heartbeat, the commit guard blocks the commit when `integrate` returns.

### 6.6 Targeting
- Mutations: `…/universes/{uid}/…?activationEpoch=<int>[&expectedRevision=<int>]`. A missing or non-integer epoch → 422.
- Reads take no epoch.
- Role rules are enforced by the registry before the engine is called (§11.3).

## 7. Lifecycle, concurrency and failure semantics

### 7.1 States
- Per universe: `idle` ↔ `mutating` (engine lock held), and terminal `deleted`. The `active` flag is set by the registry.
- `status` in summaries is computed with a non-blocking `acquire(False)` probe (released immediately).
- `lastFailure: {kind: "step_failed"|"step_timeout"|"deactivated_during_step"|"busy"|"restore_failed", message, atSimulationTimeS, atIso} | null` is set by a failed mutation and cleared by the next successful one.
- `revision` +1 per committed change (step, CRUD, reset, restore). It appears in every state, step and summary response.

| From | Event | To | Effect |
|---|---|---|---|
| idle, active | Valid mutation | mutating → idle | Commit; revision +1 |
| mutating | Universe deactivated | idle | Rollback; 409 `deactivated_during_step` |
| mutating | Engine error / non-finite / budget | idle | Rollback (existing); 500/503; `lastFailure` |
| idle, inactive | Any mutation | idle | 409 `universe_not_active` |
| any (not active) | Delete | deleted | Removed; snapshots freed; a straggler commit is blocked by the guard |
| active | Delete | — | 409 `active_universe_delete` |

### 7.2 Concurrency rules
- Engine locks are per universe. A stuck A cannot block B (REBOUND's ctypes calls release the GIL; the heartbeat re-acquires it).
- Reads never take an engine lock. They read published copies: state, events, samples.
- `create_modified_run` reads the baseline's immutable initial snapshot without a lock and builds a new engine.

### 7.3 Defined race behaviour
| Race | Behaviour | Test |
|---|---|---|
| Switch A→B while A steps | Activate returns at once; A's step is cancelled or blocked at commit → rollback → 409; A keeps its pre-step state | `test_switch_during_step_rolls_back_outgoing_step` |
| Pause during a step | Client-only; the in-flight step commits (A is still active) | existing Play tests |
| Reset during a step | Waits for the engine lock (bounded) or 503 busy | `test_reset_waits_or_busy_during_step` |
| Two simultaneous steps | Serialized; with `expectedRevision` the second gets 409 `stale_revision` | `test_concurrent_steps_serialized`, `test_expected_revision_rejects_duplicate` |
| Edit while running | UI disables Apply while playing; backend applies it atomically between steps | `test_edit_between_steps_is_atomic`, `apply disabled while playing with explanation` |
| Inactive / deleted / stale target | 409 `universe_not_active` / 404 `universe_not_found` ("deleted") / 409 `stale_activation`; no change | `test_mutation_on_inactive_universe_rejected[*]`, `test_delete_then_404_with_deleted_detail`, `test_stale_epoch_rejected` |
| Stuck or failed integration | Existing 503/500 with rollback; other universes unaffected; switching works | `test_stuck_universe_does_not_block_other_universe` |
| Frontend lost its local state | `GET /universes` gives the active id and epoch; the workspace remounts | `useUniverses loads active scope on start` |
| A→B→A with an old A request | Epoch mismatch → 409 at entry, or rollback at commit | `test_aba_switch_rejects_old_epoch` |
| Pending non-step write during a switch | The switcher is disabled until the write settles (bounded by the 35 s client timeout) | `switcher disabled while a write is pending` |

### 7.4 Restart and cleanup
- Restart loses everything (OD-5). A fresh `uni-default` is created.
- The client gets 404 for its scope and shows "The backend restarted; universes held in memory were lost."
- Cleanup is explicit (DELETE for universes, snapshots and experiments). There is no automatic garbage collection.

## 8. Snapshot, reset and restoration

### 8.1 `EngineSnapshot` (frozen dataclass, `backend/simulation.py`)
- **Fields:** `sim` (from `copy()`, never integrated itself), `meta: dict[id, (name, color, kind)]`, `events: tuple`, `heat_J`, `spin` (deep copy), `samples` (deep copy), `controlled: bool`, `first_uncontrolled_at_s: float | None`, `simulation_time_s`, `revision`, `digest`.
- **Excluded:** `event_seq` (monotonic, never reused) and the audit log (append-only, never rolled back).
- **Restore:** `sim = snap.sim.copy()`, then re-register `collision_resolve` (new resolver with the restored ledgers) and `heartbeat`. G, `rand_seed`, integrator, GLOBAL mode and collision mode travel with the copy (probed; asserted by `test_restore_preserves_engine_configuration`).

### 8.2 Guarantees (documented in `API_CONTRACT.md`)
1. **Physical state, exact:** body ids, order, names, colours, kinds, mass, radius, position and velocity; simulation time; events; booked spin; heat ledger; samples; controlled status.
2. **Continuation, bit-identical:** within the **same backend process, REBOUND build and machine**, the same `dtS` sequence after a restore reproduces the original continuation bit for bit. This was probed in planning with REBOUND 5.2.2 (IAS15 step size, predictor arrays and `dt_last_done` are carried by `copy()`).
3. **Not guaranteed (limits of in-memory REBOUND copies):**
   - Survival across restart (OD-5).
   - Equality across processes, machines, OS or REBOUND versions.
   - Any guarantee after a REBOUND upgrade unless `test_snapshot_restore_bitwise_continuation` still passes.
   - Python-side callbacks are not part of the copy, which is why they are re-registered.
   - Memory is bounded only by the caps in §6.1.
4. **If the bitwise test fails on some platform:** downgrade the documented guarantee to "numerically equivalent continuation" (state the measured difference), which the specs allow, and report it. Do not hide the failure.

Step-failure rollback stays records-based and unchanged (D-012). Snapshots are a separate mechanism.

### 8.3 Initial snapshot, reset, digest
- `load_bodies(bodies: list[InitialBody], *, sample_interval_s: float | None)` is allowed only at N = 0 and t = 0. It adds bodies in order, sets meta, re-selects IAS15, records sample 0, captures `initial_snapshot`, sets revision to 1 and publishes.
- An empty sandbox's initial snapshot is captured in `__init__`.
- `reset(guard=…)` restores `initial_snapshot` and adds 1 to revision. For `uni-default` this is identical to today's reset.
- `initial_state_digest(...) -> str` = SHA-256 of canonical JSON containing:
  - per body, in creation order: `[id, name, kind, m.hex(), r.hex(), x.hex() … vz.hex()]`;
  - `t.hex()`, `G.hex()`, integrator, `adaptive_mode`, `collision`, `rand_seed` and `sample_interval_s`.
  Colour is excluded.

### 8.4 Derived engines
`SimulationService.from_snapshot(snap, *, transform=None, sample_interval_s=None) -> SimulationService` builds a new engine from `snap.sim.copy()`, applies `transform(sim, meta)`, then captures its own initial snapshot and sample 0. It holds no reference to the source engine's objects (`test_derived_engine_shares_no_mutable_objects` asserts `id()` inequality of sim, resolver, meta, events and samples).

## 9. Presets: methodology, data and limitations (OD-1)
**Common rules:**
- SI units throughout. Mass m = GM/G, which reproduces each source GM exactly up to rounding. Dynamics depend only on GM; the 2.2e-5 relative uncertainty in G affects only the displayed kg.
- Origin: the barycentre of the included bodies (zero total momentum; a documented derived step).
- t = 0 is the epoch. Engine configuration unchanged.
- Each value carries `basis ∈ {measured, nominal, derived, assumed}` and its sources.

### 9.1 Solar System `solar-system-j2000` (required)
- **Source:** JPL Horizons API `https://ssd.jpl.nasa.gov/api/horizons.api` with these parameters (verified 2026-10-24): `EPHEM_TYPE=VECTORS`, `CENTER='500@0'`, `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`, `VEC_TABLE=2`, `VEC_CORR=NONE`, `OUT_UNITS=KM-S`, `TIME_TYPE=TDB`, `CSV_FORMAT=YES`, `OBJ_DATA=NO`.
  - Every target reported "source: DE441"; record the line Horizons prints for each target.
  - Epochs fetched: `TLIST=2451545.0` (initial) and `2451910.25`, `2452275.5` (validation truth).
- **Epoch:** J2000.0 = JD 2451545.0 TDB.
- **Frame:** ecliptic and mean equinox of J2000.0 (IAU76 obliquity, per the Horizons header). Its x-y plane is the renderer's ground plane.
- **Bodies (Horizons id → app id):** Sun 10 → `body-sun`; Mercury 199; Venus 299; Earth–Moon barycentre 3 → `body-earth`, displayed "Earth (Earth–Moon barycentre)"; Mars barycentre 4; Jupiter barycentre 5; Saturn barycentre 6; Uranus barycentre 7; Neptune barycentre 8.
- **GM (DE440, JPL SSD Astrodynamic Parameters, Park et al. 2021 AJ 161:105, verified), km³/s²:**
  - Mercury 22031.868551; Venus 324858.592000;
  - EMB = Earth 398600.435507 + Moon 4902.800118;
  - Mars system 42828.375816; Jupiter system 126712764.100000; Saturn system 37940584.841800; Uranus system 5794556.400000; Neptune system 6836527.100580;
  - GM☉ = 1.32712440041279419e20 m³/s².
  - The ephemeris vectors are DE441 while the GM values are DE440. Record both; the validation below measures the combined effect.
- **Radii (collision and display only, `basis: measured`):** JPL planetary physical parameters, mean radius in km (verified; ref Archinal et al. 2018): Earth 6371.0084 (used for the EMB, `assumed`), Mars 3389.50, Jupiter 69911, Neptune 24622. Mercury, Venus, Saturn and Uranus come from the same page (fetch and record). Sun: IAU 2015 nominal 6.957e8 m (`nominal`).
- **Omitted:** dwarf planets, asteroids, comets, moons as separate bodies, general relativity, solar oblateness, non-gravitational forces.
- **Validation:** §15.1. Planning evidence for the 9-body run vs. Horizons: worst heliocentric relative error 9.1e-7 at 1 yr and 3.9e-6 at 2 yr (Mercury).
- **Files:**
  - `scripts/presets/fetch_horizons.py` writes `backend/presets/sources/horizons/<id>_<jd>.txt` (raw responses, retrieval UTC in a sidecar `retrieved.json`) and `backend/presets/data/solar-system-j2000.json` (derived SI values plus provenance, with the SHA-256 of each source file).
  - If Horizons is unreachable, the script fails. There is no fallback data (§19.4).

### 9.2 TRAPPIST-1 `trappist-1-agol2021`: conditional, milestone M9 only
- **Source:** Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022 (arXiv:2010.01074). Data repo `github.com/ericagol/TRAPPIST1_Spitzer` (MIT): `data/elements_noprior_students.txt` (mass, P, t0, e cos ω, e sin ω, inclination, Ω) and `data/T1_timings_20191203.txt` (observed transit times). Both files were verified to exist.
- **Transcription:** take values from the paper's tables / the repo file only. The planning-session numbers were model-extracted and must not be copied. Epoch: osculating Jacobi elements at BJD_TDB 2457257.93115525; confirm it from the Table 2 caption.
- **Conventions:** Jacobi coordinates; sky-plane frame as in paper §IV.1. Where the repo Ω column and the paper's "neglect nodes" statement differ, use the repo file and document it. Constants: the paper's own, or IAU 2015 nominal GM☉/GM⊕ labelled `assumed`.
- **Gate (§15.2):** element round-trip plus reproduction of observed transit times. **If the gate fails, or the sources cannot be transcribed unambiguously, exclude TRAPPIST-1, document why in `PRESETS.md`, and continue.** This is not a blocker.

### 9.3 Kepler-90: removed (OD-1)
Only g and h have measured masses (Shaw et al. 2025, arXiv:2507.13588: 15.0 ± 1.3 and 203 ± 16 M⊕); the inner six would need a mass–radius relation. Record the removal and its reason in `PRESETS.md` and `DECISIONS.md`. `test_presets_list_has_no_kepler90`.

### 9.4 Failed or missing data at runtime
The loader validates schema version, finiteness, bounds and source hashes. A failing preset is listed as `available: false, unavailableReason`, and creating from it answers 500 `preset_invalid` with nothing created. Values are never substituted.

## 10. Catalogue and custom bodies (OD-2)

### 10.1 Data model
`backend/catalogue_data.json` → `GET /api/v1/catalogue` → `{version, entries: [CatalogueEntry]}`:
```
CatalogueEntry = { id, name, kind: "star"|"planet",
  properties: { massKg: Property, radiusM: Property },
  visual: { colorHex, note: "display only, not a physical property" },
  notes }
Property = { value: float (SI), uncertainty: {minus: float, plus: float} | {range: [lo, hi]} | null,
  basis: "measured"|"nominal"|"estimated"|"illustrative",
  sourceValue: str  (as published, with its unit, e.g. "2.063 ± 0.023 M_sun"),
  conversion: str   (e.g. "M_sun = GM_sun^N / G, GM_sun^N = 1.3271244e20 (IAU 2015 B3)"),
  sources: [{citation, url, retrieved}] }
```
Solar-unit conversions: M☉ → kg via the IAU 2015 nominal GM☉ᴺ / G; R☉ → m via the IAU 2015 nominal R☉ᴺ = 6.957e8 m (`nominal`).

### 10.2 Approved entries and sources (transcribe values and confirm them on the source page)
| Entry | Mass (as published) | Radius (as published) | Basis | Source |
|---|---|---|---|---|
| Sun | GM☉ 1.32712440041279419e20 m³/s² (DE440) | 6.957e8 m | mass measured (via GM), radius nominal | JPL SSD astro_par; IAU 2015 B3 (Mamajek et al., arXiv:1510.07674) |
| Proxima Centauri | 0.1221 ± 0.0022 M☉ | 0.141 ± 0.021 R☉ | measured | NASA Exoplanet Archive Proxima Cen overview; cite the **specific reference row used** (seen in planning: Suárez Mascareño et al. 2025 / Faria et al. 2022; confirm) |
| TRAPPIST-1 | 0.0898 ± 0.0023 M☉ | 0.1192 ± 0.0013 R☉ | measured | Agol et al. 2021 (Table 7; mass attributed to Mann et al.; confirm the year in the bibliography). Planning values were model-extracted: re-verify. |
| Sirius A | 2.063 ± 0.023 M☉ (verbatim) | 1.7144 ± 0.0090 R☉ (model-extracted: verify §IX) | measured | Bond et al. 2017, doi:10.3847/1538-4357/aa6af8 (arXiv:1703.10625) |
| Betelgeuse | 16.5–19 M☉ (published range; store the midpoint 17.75 as the value with the range) | 764 (+116 / −62) R☉ | **estimated** (model-dependent; disclosed) | Joyce et al. 2020, ApJ 902(1), doi:10.3847/1538-4357/abb8db (arXiv:2006.09837) |
| Earth | 5.97217 ± 0.00028 ×10²⁴ kg | 6371.0084 ± 0.0001 km | measured | JPL planetary physical parameters (mass ref Folkner & Williams 2008; radius Archinal et al. 2018) |
| Mars | 0.641691 ± 0.000030 ×10²⁴ kg | 3389.50 ± 0.2 km | measured | same page |
| Jupiter | 1898.125 ± 0.088 ×10²⁴ kg | 69911 ± 6 km | measured | same page |
| Neptune | 102.4092 ± 0.0048 ×10²⁴ kg | 24622 ± 19 km | measured | same page |

If a value cannot be confirmed on its source, mark it `illustrative`, or drop the entry and report it (do not guess). The catalogue panel:
- shows each property with its uncertainty;
- shows an "Estimated" badge for estimated values and "Illustrative" for illustrative ones;
- labels colour as a display choice;
- states "Catalogue entries are single bodies, not validated systems; see Presets for those."

### 10.3 Use and editing
- "Add from catalogue" pre-fills the existing create form (name, kind, mass, radius, colour). Position and velocity come from the user or from placement.
- The request is a normal `POST …/bodies` with the additive optional `catalogueEntryId`, echoed on `Body` as provenance only. It is not a live link.
- `Body.kind: "star"|"planet"` (create default `"planet"`; patchable). `CelestialBody` renders stars emissive; inspect the current material first.

| Concern | Rule |
|---|---|
| Units | SI fields as today; Orbit Lab also shows km/s read-only |
| Validation | Existing bounds plus the `kind` enum; backend independent |
| Lifecycle | Active universe with a valid epoch; baseline → 409 `baseline_protected`; UI "Pause to edit" |
| Modified-run edits | Allowed. A physical change (add, delete, or patch mass/radius/position/velocity) appends `AuditEntry{action, bodyId, fields, atSimulationTimeS, atIso}` and sets `controlled=false` and `first_uncontrolled_at_s` (if not already set). Name, colour and kind changes are recorded but keep `controlled` |
| Cancel | Revert / Cancel sends nothing |
| Errors | Field errors inline; server detail and `code` shown verbatim |

## 11. Orbit Lab and the Experiment 01 protocol (OD-3, OD-4)

### 11.1 System definition (`backend/orbit_lab_systems.json`)
```json
{"id": "exp01-sun-emb-j2000", "name": "Sun + Earth–Moon barycentre (J2000)",
 "presetId": "solar-system-j2000", "bodyIds": ["body-sun", "body-earth"],
 "recentre": "included-barycentre", "selectableBodyIds": ["body-earth"],
 "speedFactors": [0.90, 0.95, 1.05, 1.10],
 "observationWindowS": 63072000.0, "sampleIntervalS": 86400.0}
```
Bodies are built from the Solar preset's archived Horizons data and DE440 GM (one source of truth), then re-centred to their two-body barycentre. Protocol: Experiment spec §5–§9; `context/EXPERIMENT_01_PROTOCOL.md` is written in M10 with the measured results.

### 11.2 Workflow (spec §7)
| Step | System behaviour |
|---|---|
| 1 | `GET /orbit-lab/systems` |
| 2 | `POST /orbit-lab/experiments {systemId}` → baseline universe (role `baseline`, activated, sampling on). The panel shows bodies, epoch, frame, units, model note and digest. |
| 3–4 | The panel shows `body-earth` initial velocity components and speed (m/s, km/s) from the **initial** snapshot |
| 5 | Radio over `speedFactors`; client-side preview "baseline \|v\| → modified \|v\|" plus components, labelled "preview" |
| 6 | `POST …/modified-run {bodyId, speedFactor, replaceExisting}`. Backend: exact membership checks; derive from the baseline initial snapshot (v′ = f·v); create role `modified` (not activated). Provenance: `{baselineUniverseId, baselineInitialDigest, bodyId, originalVelocityMPerS, modifiedVelocityMPerS, speedFactor, units:"m/s", createdAtIso}`. An existing run without `replaceExisting` → 409 `modified_run_exists`; replacing requires the old run to be inactive. |
| 7 | `GET …/initial-differences` → exactly one entry (`body-earth.velocityMPerS`), `configEqual: true`, `controlled` |
| 8 | Existing controls on the active run |
| 9 | Run badges call `activate` → workspace remount |
| 10 | `GET …/comparison?bodyId=body-earth` → panel + overlay |
| 11 | Reset (active run only, confirm) restores that run's initial snapshot; recreate = `replaceExisting=true` (confirm) |
| 12 | A new experiment gives the same baseline digest; the same factor gives the same modified digest |

### 11.3 Role rules (enforced in `backend/universes.py` before engine calls)
| Operation | sandbox / preset | baseline | modified |
|---|---|---|---|
| step, reset | ✓ (active) | ✓ (active) | ✓ (active) |
| body CRUD | ✓ | ✗ `baseline_protected` | ✓, audited, may flip `controlled` |
| snapshot save / restore / delete | ✓ | ✗ `baseline_protected` | ✓ (restore restores the captured `controlled`) |
| delete universe | ✓ (inactive) | only via `DELETE /orbit-lab/experiments/{eid}` | via replace or experiment delete |

## 12. API and data model

### 12.1 Error contract
Existing shapes are unchanged. Coded errors add `"code"`: `{"detail": "<message>", "code": "<code>"}`.

| HTTP | code | When |
|---|---|---|
| 404 | `universe_not_found` (detail says "deleted" when it was), `snapshot_not_found`, `experiment_not_found`, `preset_not_found`, `system_not_found` | — |
| 409 | `universe_not_active`, `stale_activation`, `stale_revision`, `deactivated_during_step`, `baseline_protected`, `active_universe_delete`, `universe_limit`, `snapshot_limit`, `modified_run_exists`, `experiment_has_active_run` | §6–§11 |
| 409 | (existing, no code) | overlap, body limit |
| 422 | existing shape | validation, epoch missing, disallowed factor or body, extra fields |
| 500 | `preset_invalid`, `restore_failed`; existing step failure | nothing changed |
| 503 | existing timeout / busy | nothing changed |

### 12.2 Endpoints
| Method & path | Request | Response |
|---|---|---|
| GET `/api/v1/universes` | — | `{activeUniverseId, activationEpoch, universes: [UniverseSummary]}` |
| POST `/api/v1/universes` | `{name?, source: {kind:"empty"} \| {kind:"preset", presetId}, activate=false}` | 201 `UniverseSummary` (+ `activationEpoch` if activated) |
| GET / DELETE `/api/v1/universes/{uid}` | — | `UniverseDetail` / 204 |
| POST `/api/v1/universes/{uid}/activate` | — | `ActivationResult` |
| GET `…/{uid}/state`, `…/events`, `…/trajectory?fromIndex=&bodyIds=` | — | `UniverseState` (= SimulationState + universeId, revision), `EventList`, `TrajectoryDto {sampleIntervalS, startIndex, timesS, bodies: {id: [[x,y,z]]}, truncated}` |
| POST `…/bodies`, PATCH / DELETE `…/bodies/{bid}` (`?activationEpoch&expectedRevision?`) | `BodyCreate` / `BodyUpdate` (+ `kind`, `catalogueEntryId`) | 201 `Body` / `Body` / 204 |
| POST `…/step`, `…/reset` (`?activationEpoch…`) | `StepRequest` / — | `UniverseStepResponse` / `UniverseState` |
| GET / POST `…/snapshots`; POST `…/snapshots/{sid}/restore?activationEpoch…`; DELETE `…/snapshots/{sid}` | `{label}` for POST | `[SnapshotSummary]` / 201 / `UniverseState` / 204 |
| GET `/api/v1/presets`, `/api/v1/presets/{pid}` | — | `[PresetSummary]`, `PresetDetail` |
| GET `/api/v1/catalogue` | — | `Catalogue` |
| GET `/api/v1/orbit-lab/systems` | — | `[ExperimentSystemDto]` |
| POST `/api/v1/orbit-lab/experiments`; GET / DELETE `…/{eid}` | `{systemId}` | 201 `ExperimentDto` / … / 204 |
| POST `…/{eid}/modified-run` | `{bodyId, speedFactor, replaceExisting=false}` (extra fields forbidden) | 201 `ExperimentDto` |
| GET `…/{eid}/initial-differences`, `…/{eid}/comparison?bodyId=` | — | `InitialDifferences`, `ComparisonDto` |
| Legacy ✅ `/api/v1/simulation/state\|step\|reset`, `/api/v1/bodies…`, `/api/v1/events` | unchanged | unchanged; operate on `uni-default`; mutations → 409 `universe_not_active` when it is inactive |

**Model fields:**
- `UniverseSummary = {id, name, role, presetId, experimentId, active, simulationTimeS, bodyCount, revision, status, lastFailure, createdAtIso, epochLabel}`.
- `UniverseProvenance = {sourceKind: "empty"|"preset"|"derived", presetId, presetDataVersion, epoch: {label, jdTdb}|null, frame, origin, units: "SI", initialStateDigest, derivedFrom|null, modification|null, controlled, firstUncontrolledAtS, audit: [AuditEntry]}`.
- `ComparisonDto = {bodyId, sampleIntervalS, baseline: {universeId, simulationTimeS, sampleCount}, modified: {…}, commonSampleCount, timesS, baselinePositionM, modifiedPositionM, separationM, observationWindowS, windowCompleteBoth, complete, issues: [str], controlled, firstUncontrolledAtS, modification}`. The issues covered are: no modified run; the modified run has not advanced; a body missing (merger); truncation; uncontrolled since t; and a grid mismatch (asserted to be impossible).

### 12.3 Sampling
- Option `sample_interval_s`. `_advance` treats every `k·Δ` (computed as `k * Δ`, never accumulated) inside the request as an extra integration target and records `(k·Δ, {id: (x,y,z)})` for all bodies after landing.
- Samples are committed state: published on commit, part of snapshots, rolled back on failure and reset.
- Cap `MAX_SAMPLES`, then `truncated = true`.
- `test_samples_on_exact_grid` asserts `timesS == [k*86400.0 …]` exactly and that the engine time equals each target. If REBOUND does not land exactly, key the samples on `k`, record the actual time, and document it.

### 12.4 Frontend types
Mirror every model in camelCase SI. `BodyDto.kind` (a missing value parses as `"planet"`) and `catalogueEntryId: string | null`.

## 13. Milestones (ordered; each leaves the full suites green)
Branch `feature/simulation-lab-experiment-01`. Dependencies: M1 → M2 → {M3, M4} → M5 → M6 → M7 → M8 → (M9 optional) → M10. M3 and M4 are independent of each other but are done sequentially in this single session.

### Task 0: Preparation
- [ ] 0.1 `git fetch --all --prune`. Confirm the base SHA (§19.2) and that `context/specs/*` and this plan exist at it. Re-read `STATUS.md` and `HANDOFF.md`.
- [ ] 0.2 Create the branch from the base.
- [ ] 0.3 Run the baseline suites (§18) including `npm run build`; record the results in `WORKLOG.md`.
- [ ] 0.4 If the docs PR was not merged (§19.1), make the three planning documents the first commit (`docs: add specs and implementation plan`).

### M1: Universe registry, isolation, active-only mutation (backend)
**Files:**
- Create: `backend/universes.py`, `backend/errors.py`, `backend/lab_models.py`, `backend/api_universes.py`, `tests/conftest.py` (`registry` fixture: a fresh `UniverseRegistry()` overriding `get_registry`), `tests/test_universe_registry.py`, `tests/test_api_universes.py`, `tests/test_universe_concurrency.py`.
- Modify: `backend/simulation.py`, `backend/main.py`, `backend/models.py` (`kind`, `catalogueEntryId`).

**Produces:**
- `SimulationService.revision`, `.request_cancel()`, `.clear_cancel()`.
- `guard=` keyword on `step`, `add_body`, `update_body`, `delete_body`, `reset`.
- `UniverseRegistry(engine_factory=SimulationService)` with `.create(name, role, engine=None, provenance=None, preset_id=None, experiment_id=None, activate=False) -> Universe`, `.get`, `.list`, `.delete`, `.activate`, `.guard_for`, `.active_id`, `.epoch`.
- `get_registry()`, `get_legacy_guard()`.

**Steps:**
- [ ] Write the failing tests named in §3.1 for SL-1, SL-3, SL-4.1b/c, SL-4.2, SL-4.2b, SL-7a (`kind`), SL-7c (atomic), SL-12 (`test_activation_does_no_integration`). The concurrency tests reuse the `BlockedStep` harness pattern from `tests/test_stall_resilience.py`.
- [ ] `python -m pytest tests/test_universe_registry.py tests/test_api_universes.py tests/test_universe_concurrency.py -q` → FAIL.
- [ ] Implement §6–§7.
- [ ] Full `python -m pytest -q` → pass. Existing exact-shape assertions that now see `kind`/`catalogueEntryId` are updated to the documented shape only, each one listed in the commit body.
- [ ] Commit `feat(backend): universe registry with active-only, epoch-guarded mutations`.

**Risks:** the legacy guard plus global registry leaking across tests (mitigation: fresh-registry fixture for all new tests); lock order (mitigation: §6.2 plus `test_stuck_universe_does_not_block_other_universe`).

### M2: Snapshots, initial state, reset, sampling, controlled flag (backend)
**Files:**
- Modify: `backend/simulation.py`, `backend/lab_models.py`, `backend/api_universes.py`.
- Create: `tests/test_snapshots.py`, `tests/test_sampling.py`.

**Produces:** `EngineSnapshot`, `InitialBody` (`id, name, kind, massKg, radiusM, positionM, velocityMPerS, colorHex, basis, sources`), `load_bodies`, `capture_snapshot`, `restore_snapshot(snap, *, guard=None)`, `initial_snapshot`, `samples()`, `from_snapshot`, `initial_state_digest`, `controlled`, `audit`.

**Steps:**
- [ ] Failing tests from §3 for SL-9.1, SL-9.2 (backend), SL-9.3, E01-8 (sampling): `test_snapshot_restore_physical_state_exact`, `test_snapshot_restore_bitwise_continuation` (`==`, not approx), `test_restore_preserves_engine_configuration` (a merger after restore records an event, `errors == []`), `test_snapshot_of_one_universe_cannot_restore_another`, `test_reset_restores_initial_snapshot_only_target`, `test_reset_default_sandbox_is_empty_like_before`, `test_event_ids_not_reused_after_restore`, `test_failed_restore_leaves_state` (monkeypatch `copy` to raise → 500 `restore_failed`, unchanged), `test_samples_on_exact_grid`, `test_samples_rolled_back_on_failed_step`, `test_samples_in_snapshot`, `test_samples_truncate_at_cap`, `test_derived_engine_shares_no_mutable_objects`, `test_snapshot_carries_controlled_flag`.
- [ ] Implement; full suite green.
- [ ] Commit `feat(backend): engine snapshots, initial-state reset and time-grid sampling`.

### M3: Solar System preset and loader (backend + script)
**Files:**
- Create: `scripts/presets/fetch_horizons.py`, `backend/presets/{__init__,loader}.py`, `backend/presets/data/solar-system-j2000.json`, `backend/presets/sources/horizons/*`, `context/PRESETS.md`, `tests/validation/test_preset_solar_system.py`, `tests/test_presets_api.py`.
- Modify: `backend/api_universes.py`, `THIRD_PARTY_NOTICES.md` (data attributions: JPL Horizons / SSD; cite Park et al. 2021).

**Produces:** `load_preset(preset_id) -> LoadedPreset{summary, provenance, bodies}`, `list_presets()`, `PresetDataError`.

**Steps:**
- [ ] Run the script once (network) and commit its outputs.
- [ ] Failing tests:
  - `test_solar_raw_to_si_exact`;
  - `test_solar_masses_from_de440_gm` (`abs(m*G/GM - 1) ≤ 4e-16`);
  - `test_solar_barycentre_shift_zero_momentum` (`|Σmv| ≤ 1e-12 Σm|v|`);
  - `test_solar_against_horizons_1y_2y` (§15.1);
  - `test_solar_bodies_exact_set`, `test_solar_provenance_complete` (all 12 spec fields non-empty);
  - `test_preset_load_creates_new_universe_and_leaves_others`, `test_preset_invalid_file_creates_nothing`, `test_presets_list_marks_unavailable`, `test_presets_list_has_no_kepler90`.
- [ ] Commits: `data: Solar System J2000 preset from JPL Horizons and DE440`, then `feat(backend): preset loader and endpoints`.

### M4: Frontend universe scoping, navigation, presets, snapshots
**Files:**
- Modify: `fe/api/{types,parse,client}.ts`, `fe/sim/useSimulation.ts`, `fe/App.tsx`, `fe/test/fixtures.ts`.
- Create: `fe/sim/useUniverses.ts`, `fe/UniverseWorkspace.tsx`, `fe/components/ui/{UniverseSwitcher,PresetPicker,SnapshotPanel,ConfirmButton}.tsx`, and tests `useUniverses.test.tsx`, `api/scoped.test.ts`, `UniverseSwitcher.test.tsx`, `SnapshotPanel.test.tsx`, `UniverseWorkspace.test.tsx`.

**Produces:**
- `type UniverseScope = {universeId: string; activationEpoch: number}`.
- `ApiClient.scoped(scope): ScopedClient` with `{health, getState, getEvents, getTrajectory(fromIndex?), createBody, updateBody, deleteBody, step, reset, listSnapshots, createSnapshot(label), restoreSnapshot(id), deleteSnapshot(id)}`. The method names and return types of the old `ApiClient` subset are kept.
- `useUniverses(client) -> {list, active, scope, loadStatus, error, notice, activate, createEmpty, loadPreset, remove, resync}`.
- `useSimulation(client: ScopedClient, options & {onScopeInvalid?, onBusyWriteChange?})`.

**Behaviour:**
- The App renders `<UniverseWorkspace key={`${scope.universeId}:${scope.activationEpoch}`} …/>`.
- Selection, focus, transform and placement reset on a switch. Sidebars and Axes/Grid persist.

**Steps:**
- [ ] Failing vitest tests:
  - `switching remounts workspace and drops a late step response from the old universe`;
  - `scoped client sends activationEpoch on every mutation`;
  - `useUniverses loads active scope on start`;
  - `useUniverses resyncs after universe-lost and shows notice`;
  - `stale-activation adopts backend active universe`;
  - `switcher disabled while a write is pending`;
  - `shows active universe name and role`;
  - `loading a preset creates a new universe and does not delete the current one`;
  - `reset and restore require confirmation`;
  - `selection and focus are cleared on switch; axes/grid and sidebars persist`;
  - all existing tests pass (fixture updates for `kind` only).
- [ ] `cd frontend && npm run typecheck && npm test && npm run build` → pass.
- [ ] Commit `feat(frontend): universe-scoped client, switcher, presets and snapshots`.

### M5: Catalogue and custom stars/planets
**Files:**
- Create: `backend/catalogue.py`, `backend/catalogue_data.json`, `tests/test_catalogue.py`, `fe/components/ui/CataloguePanel.tsx` (+ test).
- Modify: `backend/api_universes.py`, `fe/components/ui/{ControlPanel,BodyFields,BodyInspector}.tsx`, `fe/sim/validation.ts`, `fe/components/canvas/CelestialBody.tsx`.

**Steps:**
- [ ] Transcribe §10.2 from the sources; record any value that could not be confirmed.
- [ ] Failing tests:
  - `test_catalogue_entries_and_provenance` (exactly the 9 approved names; each property has value, basis and ≥ 1 source; Betelgeuse mass `estimated` with a range; SI conversions recomputed from `sourceValue`);
  - `test_catalogue_is_immutable`;
  - `shows estimated badge and uncertainty`, `labels colour as display only`;
  - `catalogue entry prefills form without mutating the catalogue`;
  - `create star sends kind star`, `apply disabled while playing with explanation`, `revert leaves confirmed values`, `invalid mass shows field error and sends nothing`, `server 409 detail shown verbatim`.
- [ ] Commit `feat: sourced body catalogue and custom stars/planets`.

### M6: Orbit Lab backend and Experiment 01 validation
**Files:**
- Create: `backend/orbit_lab.py`, `backend/orbit_lab_systems.json`, `backend/api_orbit_lab.py`, `tests/test_orbit_lab.py`, `tests/test_api_orbit_lab.py`, `tests/validation/kepler_reference.py` (independent: no REBOUND or backend import), `tests/validation/test_experiment01.py`.
- Modify: `backend/universes.py` (role rules), `backend/main.py`.

**Produces:** `OrbitLab(registry)` with `.list_systems()`, `.create_experiment(system_id)`, `.create_modified_run(eid, body_id, speed_factor, replace_existing)`, `.initial_differences(eid)`, `.comparison(eid, body_id)`, `.delete(eid)`.

**Steps:**
- [ ] Failing tests — all E01 tests in §3.2 for E01-1, 2, 4.1, 4.2, 4.3, 5, 6, 8, 9, 10 and 14, including:
  - `test_disallowed_factor_or_body_rejected_without_change[0.5, 1.0, 1.1000001, 1e9, "body-sun"]` (422; baseline digest and universe count unchanged; NaN is sent as a raw JSON literal and rejected);
  - `test_initial_differences_only_selected_velocity` (exactly one difference; modified components == `f*v` exactly);
  - `test_exp01_matches_kepler_reference[f]` (§15.3).
- [ ] Commit `feat(backend): Orbit Lab experiments, modified runs and comparison`.

### M7: Orbit Lab frontend
**Files:**
- Create: `fe/components/ui/{OrbitLabPanel,ComparisonPanel,RunBadge}.tsx`, `fe/components/canvas/TrajectoryOverlay.tsx`, `fe/sim/trajectory.ts`, `fe/sim/useOrbitLab.ts` and tests.
- Modify: `fe/UniverseWorkspace.tsx`, `fe/components/canvas/UniverseCanvas.tsx`, `fe/App.tsx`.

**Behaviour:**
- `RunBadge` (free-area top row): "Orbit Lab · BASELINE" (neutral) or "Orbit Lab · MODIFIED ×1.10 speed" (accent), plus an "Uncontrolled since t = …" warning when applicable.
- The panel shows the velocity record, the initial-differences check and a one-line model note ("Two-body model: Sun + Earth–Moon barycentre; not a forecast of Earth's real position").
- `ComparisonPanel` (left sidebar):
  - both runs' times and "compared up to t = X";
  - a sparkline of separation (m) against time (days) as inline SVG with theme tokens and labelled axes and units;
  - a common-sample slider showing both positions and the separation.
- Overlay: active run solid, other run dashed and muted, same `RenderTransform`, legend with times.
- Data: the inactive run's trajectory is fetched once per mount; the active run's incrementally (`fromIndex`) after each commit.

**Steps:**
- [ ] Failing tests:
  - `preview shows baseline and modified speed before creation`;
  - `create modified run sends exactly bodyId and factor`;
  - `run badge distinguishes baseline and modified`;
  - `shows uncontrolled warning`;
  - `comparison flags different simulation times`;
  - `comparison shows issues from backend verbatim`;
  - `comparison never calls mutating endpoints`;
  - `trajectory.ts builds scene points with toScenePosition`;
  - `failed modified-run creation shows error and no success state`;
  - `shows two-body model limitation note`.
- [ ] Commit `feat(frontend): Orbit Lab panel, run identity, trajectory overlay and comparison`.

### M8: Hardening, live smoke, browser evidence
**Files:** `tests/smoke/test_live_server.py`: add `test_universe_isolation_over_http`, `test_orbit_lab_journey_over_http`, `test_restart_loses_universes_and_default_is_recreated` (stop and restart the uvicorn fixture process).

**Steps:**
- [ ] Review every row of §17.3; each has a passing test or a written reason.
- [ ] Run the browser journey §14.13 on your own ports. Record DOM- and API-based evidence in `STATUS.md` (screenshots are supporting only).
- [ ] Commit `test: live-server isolation, restart and Orbit Lab journeys`.

### M9 (optional, gated): TRAPPIST-1 preset
Do this only after M1–M8 are complete and green.

**Files:** `scripts/presets/build_trappist1.py`, `backend/presets/sources/trappist1/*` (repo files with the MIT notice), `backend/presets/data/trappist-1-agol2021.json`, `tests/validation/test_preset_trappist1.py`.

**Steps:**
- [ ] Tests: `test_trappist_elements_roundtrip`, `test_trappist_transit_times_match_observed` (§15.2).
- [ ] If the gate passes, commit `data: TRAPPIST-1 preset (Agol et al. 2021)`.
- [ ] If not, do not commit the preset. Document the reason and the measured values in `PRESETS.md`.

### M10: Documentation and PR
**Files:**
- `context/API_CONTRACT.md` (all endpoints, codes and the §8.2 guarantees);
- `context/ARCHITECTURE.md`;
- `context/DECISIONS.md` (append D-025 onward: A1–A14 and the OD-1 to OD-6 resolutions as accepted owner decisions, citing the specs);
- `context/STATUS.md`, `TASKS.md`, `WORKLOG.md`, `HANDOFF.md`;
- `README.md` (usage);
- `context/PRESETS.md`;
- `context/EXPERIMENT_01_PROTOCOL.md` (the protocol in Experiment spec §5–§9 plus the **measured** validation results).

**Steps:**
- [ ] Docs complete.
- [ ] Push the branch; open the PR (§19.3).
- [ ] Monitor CI and fix implementation-caused failures.
- [ ] Stop. Do not merge.

## 14. Test strategy and acceptance
Each group lists setup → action → expected change → invariant → failure condition. Test names are in §3.
1. **Different simultaneous states:** two universes with non-trivial, different bodies → read both → each equals what was created → distinct engine and REBOUND objects → fails if equal or `is`-identical.
2. **Advance one:** step U1 N times → U1 time = N·dt and revision +N → U2 dump bitwise equal and revision equal → fails on any U2 change.
3. **Active-only:** mutate inactive U2 → 409 → unchanged → fails on 2xx or any change.
4. **Switch during integration:** blocked step on U1, then activate U2 → U1 rolled back (time, bodies, samples, revision) → U1 gains no time after deactivation → fails if U1 time exceeds its pre-step value.
5. **Edit/reset isolation:** edit or reset U1 → only U1 changes → fails if U2 or the catalogue changes.
6. **Snapshot contract:** §8.2 levels 1–2 → bitwise → fails on any `!=`.
7. **Concurrent/stale:** threads with overlapping steps, old epochs, A→B→A → only valid requests commit, in order → revision = number of successes → fails on a lost, duplicated or misdirected commit.
8. **Failure diagnosability:** injected engine error, timeout, copy failure → coded error, `lastFailure` set, state equals pre-request → fails on partial state or a missing `lastFailure`.
9. **Preset data:** §15.1 (and §15.2 if M9).
10. **Custom bodies and catalogue:** create a star in U1 → U2 unchanged; catalogue unchanged.
11. **Orbit Lab independence and protection:** M6 tests.
12. **Regression:** full pytest and vitest; `npm run build`. Manual checks: selection, double-click focus and follow, empty-click dismissal, placement plus Undo, independent Axes/Grid and the placement grid, sidebars at 1200 px and 1000 px, starfield zoom-out, a merger in History, diagnostics.
13. **Browser journey (Playwright MCP or the in-app browser; backend :8011, Vite :5183):**
    1. First use.
    2. Load the Solar System preset (a new universe; the default is kept).
    3. Switch to the default (its time is retained), then back.
    4. Play, Pause.
    5. Save a snapshot, Step, Restore (confirm).
    6. Reset (confirm).
    7. Add a catalogue star (estimated badge visible for Betelgeuse).
    8. Start Experiment 01; inspect the Earth (EMB) velocity; choose ×1.10; preview; create.
    9. The initial-differences check shows one difference.
    10. Advance the baseline about 1 yr; switch to the modified run (the badge changes; the baseline time is shown); advance it about 1 yr.
    11. The comparison shows the separation and matching times; the overlay shows two trajectories.
    12. Edit the modified run's mass → uncontrolled warning; reset the modified run → controlled again, baseline unchanged.
    13. Recreate with ×0.90.
    14. Switch to the default; delete the experiment.

    At each switch, record `GET /api/v1/universes` (times and revisions).

## 15. Scientific validation methodology
Tolerances were set from measured planning evidence with stated margins, before implementation. If a check fails: investigate, fix real bugs, never loosen, and report if it stays unexplained (§19.4).

### 15.1 Solar System
- **Re-parse:** raw Horizons → exact equality with the committed SI values.
- **GM:** `m·G` equals GM to ≤ 4e-16 relative.
- **Barycentre:** `|Σmv| ≤ 1e-12 Σm|v|`.
- **Dynamics vs ephemeris:** integrate with the app engine using `dtS = 21600 s`, landing exactly on 365.25 d and 730.5 d. Compare heliocentric positions (body − Sun) with the committed Horizons truth at JD 2451910.25 and 2452275.5. **Acceptance: ≤ 2e-5 relative to the heliocentric distance for every planet at both epochs.**
  - Measured in planning: worst 9.1e-7 (1 yr) and 3.9e-6 (2 yr, Mercury), a margin of ≥ 5×.
  - Unit, frame, epoch or sign errors give ≥ 1e-2.
  - This checks the pipeline. It is not a claim of ephemeris accuracy.
- **Energy:** K+U relative drift ≤ 1e-12 over 2 yr (measured ~4e-16).

### 15.2 TRAPPIST-1 (M9 gate)
- **Round-trip:** committed Cartesian → Jacobi elements reproduces P, e cos ω, e sin ω and inclination to 1e-9.
- **Transits:** the first 3 transits of each planet after the epoch (sky-plane crossing in front of the star, found by bisection in the test) match the nearest observed times in `T1_timings_20191203.txt` to **≤ 0.0035 d (≈5 min)**. Rationale: the observed uncertainties are tens of seconds and Agol's own Newtonian N-body model fits them, while convention errors move transits by hours.
- Failure → exclude the preset (§9.2).

### 15.3 Experiment 01 (spec §9)
- **Reference:** `tests/validation/kepler_reference.py`, an independent elliptic Kepler propagator: element derivation from (r, v), Newton solve of Kepler's equation, perifocal → frame. μ = G(m☉ + m_EMB).
- **Agreement:** at every sample k = 0…730, the relative vector `r_EMB − r_Sun` from backend samples is within **1e-10 · a** of the reference, for f = 1 (baseline) and every f in `speedFactors`. Measured ≤ 2.5e-13 · a.
- **Qualitative:** a, period and aphelion order as f; for f > 1 the start is ≈ perihelion; for f < 1 it is ≈ aphelion (|r₀ − r_turning| ≤ 1e-3 r₀). Expectations come from the reference at run time.
- **Period:** time between successive passages of the polar angle through its initial value (from samples, refined by the reference) matches 2π√(a³/μ) to ≤ 1e-6 relative.
- **Grid:** both runs' `timesS` are identical and equal to `k*86400.0`.
- **Conservation:** K+U and angular momentum about the origin each drift ≤ 1e-12 relative over the window. Record the measured values (angular momentum was not measured in planning).
- **Repeatability:** identical digests and bitwise trajectories for two experiments in one process.
- **Not claimed:** real-world prediction (two-body model; ≈1e-4 deviation from the ephemeris over 2 yr, Experiment spec Appendix A).

## 16. Migration, rollback and compatibility
- No database or state migration. The data files are new.
- Additive API: universe/preset/catalogue/orbit-lab endpoints; `Body.kind`, `Body.catalogueEntryId`; `code` on coded errors.
- Semantic notes (in `API_CONTRACT.md` and D-025 onward): reset = restore this universe's initial state (identical for `uni-default`); body ids are unique per universe; legacy routes operate on `uni-default` only.
- An old frontend still works through the legacy routes. A new frontend against an old backend shows the load error.
- Rollback: revert the PR merge commit; restart backends. No data cleanup.

## 17. Decisions, risks and error handling

### 17.1 Owner decisions (resolved 2026-10-24)
| ID | Resolution | Where |
|---|---|---|
| OD-1 | Solar System required and sufficient; others only if validated; Kepler-90 removed; TRAPPIST-1 gated | SL spec §5; plan §9 |
| OD-2 | Recommended catalogue, with provenance, units, uncertainty and disclosure; entries ≠ assets ≠ presets | SL spec §6.1; plan §10 |
| OD-3 | Question confirmed; Sun + EMB at J2000, ×0.90/0.95/1.05/1.10, 730 d, daily samples, adopted on evidence | E01 spec §5–§9, Appendix A; plan §11, §15.3 |
| OD-4 | The implementer works autonomously within scope; baseline immutable; uncontrolled modifications identifiable | E01 spec §4.1–4.2; plan §10.3, §11.3, §19 |
| OD-5 | No persistence across restart; in-process snapshot/restore/reset specified and tested | SL spec §4.3; plan §7.4, §8 |
| OD-6 | The owner reviews visuals and behaviour; Opus performs the later independent technical review; the implementer never merges | plan §19.3 |

### 17.2 Technical and scientific risks
| Risk | Mitigation |
|---|---|
| `App.tsx` split regresses selection, focus or placement | Move code; don't rewrite. Existing tests plus manual §14.12 |
| **Unmerged `origin/feature/grid-axis` (teammate/Codex work) overlaps `App.tsx`, `ControlPanel.tsx`, `BodyInspector.tsx`, `BodyFields.tsx`, `UniverseCanvas.tsx`, `validation.ts`** | Do not merge, rebase onto or delete it. Base on `main`. List the overlap in the PR body so the owner can decide its future. If `main` gains that work before you start, re-audit M4/M5 against it. |
| Legacy guard and global registry interact in tests | Fresh-registry fixture |
| A native stall ignores cancel | The commit guard still blocks the commit; limitation documented (as in D-021) |
| `integrate` not landing exactly on k·Δ | Test; key on k |
| Horizons DE441 vectors vs. DE440 GM | Recorded; the combined effect is measured by §15.1 (3.9e-6 ≪ 2e-5) |
| TRAPPIST-1 convention errors | Transit gate; exclude on failure |
| Memory | Caps; sampling only for Orbit Lab runs (worst case ≈ 16 × 21 × 20000 × 2 × 24 B ≈ 320 MB) |
| Two tabs | `stale_activation`, then resync |
| Catalogue values not confirmable | Mark `illustrative` or drop; report |
| The owner's :8000 backend | Never touched; use your own ports |

### 17.3 Error handling and recovery (spec E01-11 and SL-4.2)
| Case | Backend | UI | Test |
|---|---|---|---|
| Invalid velocity / factor / body | 422, nothing changed | Inline error | `test_disallowed_factor_or_body_rejected_without_change` |
| Experiment initialization fails (preset invalid) | 500 `preset_invalid`, no universe | Error with detail | `test_experiment_creation_fails_cleanly_on_bad_preset` |
| Modified-run creation fails | 409/422/500, old modified run untouched | Error; no success state | `failed modified-run creation shows error and no success state`, `test_replace_modified_requires_flag_and_inactive` |
| Invalid / stale universe id | 404 / 409 | Resync notice | M1/M4 tests |
| Conflicting lifecycle commands | 409 with code | Detail shown | `test_mutation_on_inactive_universe_rejected` |
| Busy / failed / stalled integration | 503 / 500 / cancel → 409 | Existing messages, Play stops | existing + `test_switch_during_step_rolls_back_outgoing_step` |
| Switching with a pending request | Pending write: switch disabled; pending step: rolled back | Switcher disabled | `switcher disabled while a write is pending` |
| Snapshot / restore failure | 409 `snapshot_limit` / 500 `restore_failed`, unchanged | Error | `test_failed_restore_leaves_state` |
| Incomplete comparison | 200 with `complete:false` and `issues` | Issues shown | `test_comparison_incomplete_reported` |
| Backend restart | Fresh default | Lost-universes notice | M4 + smoke |
| Unexpected success-shaped failure | — | UI shows success only after a parsed backend response | `UniverseWorkspace.test.tsx`: `no success before backend confirmation` |

## 18. Verification commands
```bash
# repo root, Git Bash, project venv
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m pytest tests/validation -q
cd frontend && npm run typecheck && npm test && npm run build
# own servers for browser checks (never :8000)
.venv/Scripts/python.exe -m uvicorn backend.main:app --port 8011
cd frontend && BACKEND_URL=http://127.0.0.1:8011 npx vite --port 5183
# data regeneration (dev only, needs network)
.venv/Scripts/python.exe scripts/presets/fetch_horizons.py
```
CI runs `python -m pytest -q`, `npm ci`, `npm run typecheck`, `npm test` and `npm run build`. New tests must not use the network.

## 19. Handoff to the implementation agent (Claude Sonnet 5.5)

### 19.1 Documentation PR (recommended before implementation)
**Recommendation: yes.** Preserve the two specs and this plan through a documentation-only PR, merged by the owner before implementation starts:
- the specs currently exist nowhere else in the repository;
- the implementer and the later independent review must read identical, versioned texts;
- a docs PR keeps the implementation PR's diff to code plus the docs it changes.

The planning session prepared a local branch `docs/simulation-lab-plan` containing only these three files. Whether it is pushed and the PR opened is the owner's call (outward-facing), as is the merge.

### 19.2 Agreed base
- **Preferred:** the `main` merge commit of the docs PR. Record its SHA in `WORKLOG.md` at Task 0.1 and verify that `git diff d5220f9..<base> --stat` contains only `context/specs/*` and `context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md`.
- **If the docs PR is not merged:** base on `d5220f93b25a93d08ae4fd3f7754fe7811710045` and make the three documents your first commit (Task 0.4).
- **If `main` contains anything else:** re-audit §2 against it before coding, and update this plan in your branch with a WORKLOG note.

### 19.3 Branch and PR constraints
- One branch, `feature/simulation-lab-experiment-01`. Small commits per milestone (§13).
- Never push to `main`, force-push, rewrite history, or delete or modify other branches (including `origin/feature/grid-axis`).
- Open one PR to `main` after M10. Its body must contain:
  - actual test output summaries (pytest, tsc, vitest, build);
  - the measured scientific validation values (§15) and which presets passed;
  - the M9 outcome;
  - browser evidence;
  - the overlapping `feature/grid-axis` files;
  - limitations and any unresolved requirement.
  End it with the session's attribution line.
- Monitor CI and fix implementation-caused failures. **Never merge**, never enable auto-merge, and never bypass review or branch rules.
- Request review: the owner for visuals and behaviour; the independent technical review happens afterwards (OD-6). Do not claim any review happened.

### 19.4 Autonomy and stop conditions (OD-4)
**Proceed without asking** on routine engineering decisions: naming, internal structure, test organisation, fixing your own regressions, choosing between equivalent implementations, and correcting this plan where it contradicts the code (record it in `WORKLOG.md`).

**Stop and report a genuine blocker (do not work around it)** if:
1. The specs or this plan are missing at the base, or contradict each other on a requirement.
2. `main` has moved in a way that changes the files or architecture this plan relies on (e.g. `feature/grid-axis` merged) and the needed re-design would change a spec-level behaviour.
3. The Horizons source data cannot be retrieved (no network) and is not already committed. Never substitute values.
4. A required scientific check (§15.1 or §15.3) fails and investigation finds no implementation error. Report the measured values; never loosen a tolerance or alter the physics configuration. A §15.2 failure is **not** a blocker: exclude TRAPPIST-1.
5. Meeting a requirement would need a change to an accepted physics decision (D-007, D-008, D-010, D-011, D-012, D-021), a new runtime dependency, persistence, or anything that touches the owner's :8000 backend or another person's branch.
6. CI fails for reasons outside the implementation (infrastructure, permissions) and cannot be fixed within the branch.

These are **not** stop conditions (handle them and document): the bitwise snapshot test failing on a platform (downgrade the documented guarantee, §8.2); a catalogue value that cannot be confirmed (mark it `illustrative` or drop the entry, §10.2); TRAPPIST-1 failing its gate.

### 19.5 Required verification before opening the PR
- Full pytest, tsc, vitest and build green.
- `tests/validation` green with the measured values recorded.
- Live smoke green.
- Browser journey §14.13 recorded.
- Docs (M10) updated.
- §20 checklist completed with evidence references.

## 20. Final traceability checklist
**Simulation Lab acceptance (spec §13)**
- [ ] 1 Solar System preset validated (§15.1); any extra preset meets §5.4; Kepler-90 absent — M3, M9
- [ ] 2 Catalogue: 9 approved entries with value, unit, uncertainty, source and basis; estimates disclosed — M5
- [ ] 3 Custom stars and planets — M5
- [ ] 4 Navigation preserves state and time — M1, M4
- [ ] 5 Only the active, eligible universe advances — M1
- [ ] 6 No cross-universe mutation — M1, M2
- [ ] 7 Lifecycle rules for play/pause/step/reset/edit — M1, M2, M5
- [ ] 8 Snapshot contract (in-memory, §8.2) — M2
- [ ] 9 Orbit Lab create and navigate — M6, M7
- [ ] 10 Existing functionality intact — §14.12
- [ ] 11 All checks pass — §18, M8
- [ ] 12 Docs match — M10

**Experiment 01 acceptance (spec §12)**
- [ ] 1 Question implemented — M6, M7
- [ ] 2 Defensible ICs (Sun + EMB, J2000, Horizons/DE440) — M6
- [ ] 3 Baseline immutable — M6
- [ ] 4 Same intended initial state — M6
- [ ] 5 Modification recorded and validated — M6
- [ ] 6 No unintended differences — M6
- [ ] 7 Independent advancement — M1
- [ ] 8 Switching preserves state and time — M1, M4
- [ ] 9 Edit/reset isolation; uncontrolled changes identifiable — M6
- [ ] 10 Real measurements — M6, M7
- [ ] 11 Independent expectations (§15.3) — M6
- [ ] 12 Repeatable — M6
- [ ] 13 Error handling protects state — §17.3
- [ ] 14 Existing functionality intact — §14.12
- [ ] 15 Checks pass or blockers documented — §18
- [ ] 16 Docs updated — M10

---

## Appendix A — Self-review (the planning architect's own adversarial pass; not an independent review)
| Looked for | Finding | Revision |
|---|---|---|
| Frontend-only isolation | None | — |
| Shared mutable global | Legacy `get_service()` | Bound to `uni-default` via the registry; fresh-registry test fixture |
| Background advancement | An in-flight step could commit after a switch | Commit-time guard + heartbeat cancel |
| Switch/edit races | Edits racing a switch | Guards at entry and commit; switcher disabled during writes |
| Incomplete snapshots | Records-only would lose IAS15 state | `copy()` + ledgers, events, samples, controlled flag; limits stated in §8.2 |
| Mutable baseline | Derivation from the current state; edits; snapshots | Derive from the initial snapshot; baseline rejects CRUD and snapshots |
| Uncontrolled modifications invisible | Draft 1 had only a boolean | `controlled`, `firstUncontrolledAtS`, append-only audit; reset semantics defined |
| Presets lacking sources | Kepler-90 | Removed (OD-1); TRAPPIST-1 gated |
| Unit/frame errors | km/m; EMB naming; DE440 vs DE441 | Exact re-parse; display name; both recorded and measured |
| Model choice unjustified | Draft 1 assumed EMB | Measured EMB vs geocentre (110×) |
| Tolerances unjustified | Draft 1 had 1e-8·a and 1e-4 guesses | Re-based on measured evidence (1e-10·a; 2e-5) with margins |
| Tests passing without proving independence | Empty-vs-empty comparisons | Non-trivial states, bitwise dumps, revisions, object identity |
| Breaking API changes | Exact-shape tests; reset meaning | Additive; reset identical for the default; changed assertions listed |
| Overengineering | Persistence, worker, E2E framework, extra presets | Excluded; TRAPPIST-1 optional |
| Omitted requirements | Learning objectives, the no-mutating-sync rule, no-success-without-confirmation, restart notice | Tests added |
| Unrequired features | Heliocentric frames, orbital-element plots, energy comparisons | Not planned |
| Unverifiable claims | Model-extracted TRAPPIST-1 / Sirius radius values | Marked "transcribe and confirm"; not used as data |
| Repository drift | Reappeared `feature/grid-axis` | Recorded; a stop condition if merged with conflicting design |

## Appendix B — Sources consulted
- JPL Horizons API docs https://ssd-api.jpl.nasa.gov/doc/horizons.html; live API https://ssd.jpl.nasa.gov/api/horizons.api (2026-10-24; targets 10, 199, 299, 3, 399, 301, 4–8; JD 2451545.0, 2451910.25, 2452275.5; "source: DE441").
- JPL SSD Astrodynamic Parameters (DE440 GM, G, au) https://ssd.jpl.nasa.gov/astro_par.html; Park et al. 2021, AJ 161:105 https://ssd.jpl.nasa.gov/doc/Park.2021.AJ.DE440.pdf
- JPL planetary physical parameters https://ssd.jpl.nasa.gov/planets/phys_par.html
- IAU 2015 Resolution B3 nominal values: Mamajek et al., arXiv:1510.07674
- Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022, arXiv:2010.01074; https://github.com/ericagol/TRAPPIST1_Spitzer (MIT)
- Shaw et al. 2025 (Kepler-90 g, h), arXiv:2507.13588
- NASA Exoplanet Archive, Proxima Cen overview https://exoplanetarchive.ipac.caltech.edu/overview/Proxima%20Cen
- Bond et al. 2017 (Sirius), arXiv:1703.10625, doi:10.3847/1538-4357/aa6af8
- Joyce et al. 2020 (Betelgeuse), arXiv:2006.09837, doi:10.3847/1538-4357/abb8db
- Local probes (scratchpad, not in the repo): REBOUND 5.2.2 `copy()` continuation; the Experiment 01 model, Kepler and 9-body evaluations (Experiment spec Appendix A).
