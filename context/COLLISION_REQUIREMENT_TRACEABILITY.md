# Collision Engine — Requirement Traceability Matrix

**Status:** PLANNING. Source: the Specification (`context/specs/COLLISION_PARTICLE_ENGINE_SPEC.md`, verbatim copy, 18 sections). Plan: `COLLISION_ENGINE_PLAN.md` (stages ST0–ST12, sections §P-n of the plan). Tests named here are **[Proposed]** unless marked [Exists].
**Status codes:** SUP = already supported (evidence given) · PART = partially supported · MISS = missing · BLK = blocked · DEC = requires an owner decision (DQ-n in `COLLISION_RISK_REGISTER.md` §3). **Every row maps to ≥ 1 stage and ≥ 1 verification.** Implementers update the last column to `VERIFIED <test id>` only after a test run they saw.

Test-file shorthand: `T/det` = `tests/impact/test_detection.py`, `T/geo` = `test_geometry.py`, `T/eqv` = `test_deferred_equivalence.py`, `T/mat` = `test_materials.py`, `T/rot` = `test_rotation.py`, `T/ls12` `T/crat` `T/env` `T/sel` = model tests, `T/app` = `test_applier.py`, `T/cons` = `test_conservation.py`, `T/frag` = `test_fragments.py`, `T/dmg` = `test_damage.py`, `T/life` = `test_lifecycle.py`, `T/rec` = `test_records_api.py`, `T/pers` = `test_persistence.py`, `T/iso` = `test_isolation.py`, `T/scn` = `test_scenarios_e2e.py`, `T/perf` = `test_performance.py`, `V/*` = vitest files under `frontend/src/sim/collision/` or as named, `E2E/col` = `frontend/e2e/collision-effects.spec.ts`, `REG` = full existing suites (pytest 567, vitest 433, Playwright in CI).

## §1 Purpose, vision and core principles
| ID | Requirement | Current / evidence | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| V-1 | Collide two planets; outcome depends on properties & conditions | merge only (`collisions.py`) | outcome models, materials | ST2–ST4 | T/scn A–D | MISS |
| V-2 | Strike a location; localized damage | none | damage sites | ST6 | T/dmg, T/scn A | MISS |
| V-3 | Craters, ejecta, partial disruption, catastrophic fragmentation where justified | none | models + fragments | ST3–ST6 | T/ls12, T/crat, T/frag | PART: cratering structure (no sourced constants, so Unsupported), erosion/disruption model level (PROVISIONAL, D-038: CP-SCI-1 unsigned) (tests/impact/test_ls12.py, tests/impact/test_cratering.py); application ST4-ST6 |
| V-4 | Coherent fragment trajectories | n/a | fragments as REBOUND bodies | ST5 | T/frag ICs | MISS |
| V-5 | Debris orbits, falls back, hits another body, escapes | n/a | lifecycle | ST7 | T/life, T/scn E | MISS |
| V-6 | Rocky, metallic, icy, gas giants, moons, asteroids | bodies have `kind`, display `bodyType`; no material | profiles | ST2, ST11 | T/mat, T/sel | PART: profiles for rock, rubble, iron, ice and a gas envelope exist, each number cited (tests/impact/test_materials.py); named solar-system bodies pending ST11 |
| V-7 | Understand why an outcome happened | event shows merge speed only | selection reasons + inspector | ST8 | T/rec, V/describe | MISS |
| V-8 | Replay and investigate events | history replay of positions [Exists `useHistoryNavigation`] | records + visual replay + dry-run replay | ST8–ST9 | T/rec replay, V/effectTimeline seek | PART |
| V-9 | Simulation continues without breaking the system | transactional steps [Exists D-012] | apply atomically | ST4 | T/app continue-10-orbits, REG | PART |
| P-1 | Physics determines outcomes; visuals never invent | backend-authoritative (D-001) | visual events from results only | ST9 | V/effectTimeline, boundary test | PART |
| P-2 | Material matters when the model predicts it | — | profiles feed models | ST2–ST3 | T/sel material comparison | VERIFIED at model level: identical geometry with c* = 5 vs 1.9 changes Q*_RD by exactly the c* ratio (tests/impact/test_ls12.py::test_c_star_scales_the_threshold_exactly_with_identical_geometry); application ST4 |
| P-3 | Location matters; no uniform damage by default | — | sites | ST6 | T/dmg | MISS |
| P-4 | Coherent motion | — | ICs | ST5 | T/frag | MISS |
| P-5 | Mass accounted, never silently lost | merge conserves mass [Exists] | budgets/ledgers | ST4–ST7 | T/cons, T/life ledger | PART |
| P-6 | Approximations explicit | doc'd limitations [Exists API_CONTRACT] | fidelity labels | ST0, ST8 | contract tests, V/describe labels | PART |
| P-7 | Existing universe keeps working | — | legacy mode, regression | all | REG every stage | PART |
| P-8 | Scientific validity tested | physics tests culture [Exists] | model reference tests | ST3, ST12 | T/ls12 references, CP-SCI-1 | PART: reference reproductions and analytic identities (tests/impact/test_ls12.py); UD-1/UD-2 OPEN and documented, no reproduction claimed |

## §2 Scope and fidelity boundaries
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| S1-1 | Reliable detection + impact diagnostics | `line` detection, contact-time estimate [Exists] | full ImpactState | ST1 | T/det, T/geo | PART: detection reliable in the tested envelope and geometry captured (Stage 1: test_geometry.py, test_detection.py); materials/spin pending ST2 |
| S1-2 | Material-aware inputs & outcome selection | — | — | ST2–ST3 | T/mat, T/sel | PART: selector routes by material and structure class (tests/impact/test_selector.py); the outcome is not applied yet (ST4) |
| S1-3 | Outcomes beyond merging | — | — | ST3–ST4 | T/ls12, T/app | PART: model-level outcomes for each class (PROVISIONAL, D-038: CP-SCI-1 unsigned); atomic application ST4 |
| S1-4 | Localized impact & surface damage | — | — | ST6 | T/dmg | MISS |
| S1-5 | Documented damage/propagation approximation | — | — | ST6 | T/dmg + SCIENTIFIC_MODELS §4.8 | MISS |
| S1-6 | Physical fragmentation, coherent trajectories | — | — | ST5 | T/frag | MISS |
| S1-7 | Bounded particle & debris system | — | — | ST5, ST9 | T/frag budgets, V/effectBudget | MISS |
| S1-8 | Debris lifecycle incl. orbital evolution, reaccretion | — | — | ST7 | T/life | MISS |
| S1-9 | Event records & diagnostics | merger events [Exists] | records | ST1, ST8 | T/rec | PART: collision records per event, linked to the merger event (Stage 1: test_detection.py::test_each_contact_gives_exactly_one_event_and_one_linked_record); API and full diagnostics pending ST8 |
| S1-10 | Conservation accounting & regression tests | diagnostics v1 [Exists D-013] | per-event report | ST4 | T/cons | PART |
| S1-11 | Integration with simulation & renderer | — | — | ST4, ST9 | T/scn, E2E/col | MISS |
| S1-12 | Performance controls not corrupting accounting | step budget [Exists D-012] | collision budgets | ST5, ST7, ST9 | T/perf, T/frag budgets | PART |
| S1-13 | Expandable architecture | — | `OutcomeModel` adapter | ST0, ST3 | contract tests; adding a dummy model in test needs no change downstream | VERIFIED tests/impact/test_selector.py::test_a_registered_model_passes_through_the_selector_unchanged (Stage 3) |
| D-1..D-6 | SPH, resolved interior P/ρ/T, first-principles shocks, gas-giant fluid motion, advanced EOS, research-grade reproduction **deferred** | not present | keep deferred | all | review: no solver dependency in `requirements.txt`; DoD audit | SUP (deferred) |
| S2-AN | Analytical/empirical/reduced-order models within limits | — | envelopes | ST3 | T/sel envelope tests | PART: gas bodies routed to explicit envelope models, never to the rigid-body model (tests/impact/test_envelope.py, tests/impact/test_selector.py); asteroid-to-giant scenario ST12 |
| S2-EXT | Extension path: inputs, materials, outputs, remnant reconstruction, transfer back | — | adapter + contracts | ST0, ST3 | T/contracts, dummy-model test | VERIFIED tests/impact/test_selector.py::test_a_registered_model_passes_through_the_selector_unchanged and ::test_a_registered_model_that_is_unsupported_triggers_the_labelled_fallback (Stage 3) |
| S2-NOMISLEAD | No misleading visuals simulating hydrodynamics; approximations distinguished | — | labels | ST6, ST8, ST9 | V/describe, labels in records | MISS |

## §3 Feature 1 — Detection and impact geometry
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| F1-OBJ | Detection approach chosen compatible with integrator, not tied to one resolution strategy | `line` + chunking [Exists]; resolution inside callback | deferred resolution | ST1 | T/eqv; plan §3.4 justification | VERIFIED (mode outcome-v1) test_deferred_equivalence.py; justification plan 3.4; default mode still legacy-merge; CP-1 review pending |
| F1-INFO-1 | Identity of colliding bodies | `bodyIds` [Exists] | target/projectile roles | ST1 | T/geo | VERIFIED test_geometry.py::test_equal_masses_choose_the_smaller_id_as_target, test_straight_line_impact_matches_the_analytic_construction (Stage 1) |
| F1-INFO-2 | Pre-impact masses, radii | in merger computation, not recorded | record | ST1 | T/geo | VERIFIED test_geometry.py::test_capture_happens_before_the_merge_mutates_anything (Stage 1) |
| F1-INFO-3 | Positions & velocities at impact state | not recorded | rewind + record | ST1 | T/geo analytic fixtures | VERIFIED test_geometry.py::test_straight_line_impact_matches_the_analytic_construction, test_curved_path_contact_point_is_within_the_curvature_budget (Stage 1) |
| F1-INFO-4 | Relative impact velocity | `relativeSpeedMPerS` (scalar) [Exists] | vector | ST1 | T/geo | VERIFIED test_geometry.py::test_straight_line_impact_matches_the_analytic_construction (vector and speed, Stage 1) |
| F1-INFO-5 | Contact point & surface normal | — | — | ST1 | T/geo (1e-9 straight, curvature bound curved) | VERIFIED test_geometry.py (1e-9 straight line; 0.02 R on the e = 0.9 Kepler path, Stage 1) |
| F1-INFO-6 | Impact angle & impact parameter | — | — | ST1 | T/geo b = 0, 0.5, 0.9 | VERIFIED test_geometry.py b = 0 / 0.5 / 0.9, near and far from the origin (Stage 1) |
| F1-INFO-7 | Target & projectile rotation | no spin state | rotation state | ST2 (data), ST1 field | T/rot, T/geo | VERIFIED tests/impact/test_rotation.py, tests/impact/test_geometry.py::test_capture_records_spin_orientation_material_latitude_and_axis_angle, tests/impact/test_state_paths_stage2.py (Stage 2) |
| F1-INFO-8 | Relative orientation of spin axes | — | — | ST2 | T/geo spin-axis angle | VERIFIED tests/impact/test_geometry.py::test_capture_records_spin_orientation_material_latitude_and_axis_angle (90 deg between z and x spin, Stage 2) |
| F1-INFO-9 | Material & internal-structure profiles | — | — | ST2 | T/mat, ImpactState snapshot | VERIFIED tests/impact/test_geometry.py::test_service_record_carries_rotation_and_material_and_drops_the_unspecified_label (Stage 2) |
| F1-INFO-10 | Gravitational environment & nearby bodies | `has_satellites` logic [Exists] | environment block | ST1 | T/geo environment fixture (moons preset) | VERIFIED on a star + planet fixture (test_geometry.py::test_environment_*, Stage 1); the moons preset fixture is not run yet |
| F1-INFO-11 | Collision time in sim time | detection time + estimate [Exists] | — | ST1 | T/det | VERIFIED test_deferred_equivalence.py (detection time and contact estimate equal the legacy values, Stage 1) |
| F1-INFO-12 | Energy, momentum, escape-velocity diagnostics | KE lost [Exists] | Q_R, v_esc, momentum, L | ST1 | T/geo | VERIFIED test_geometry.py (Q_R, both escape speeds, momentum, orbital L, KE in the COM frame, Stage 1) |
| F1-PRE | Impact vs post-impact distinguished; pre-state recorded before overwrite | merger overwrites survivor in callback | frozen ImpactState | ST1 | T/geo "capture before mutate" (mutation spy) | VERIFIED test_geometry.py::test_capture_happens_before_the_merge_mutates_anything (mutation spy, Stage 1) |
| F1-DET-1 | No repeated resolution of same contact | removal by merger [Exists] | for non-merge outcomes | ST1, ST4 | T/det one-contact-one-record; T/app hit-and-run no re-trigger | PART: one contact -> one record VERIFIED (test_detection.py, Stage 1); non-merge outcomes pending ST4 |
| F1-DET-2 | No missed fast bodies | `line` (D-008 evidence) | regression fixtures in new path | ST1 | T/det fast-impact | VERIFIED test_deferred_equivalence.py::test_a_fast_impact_is_detected_exactly_once and the 6 spike-sweep scenarios (Stage 1) |
| F1-DET-3 | Very different masses and sizes | stress 2e30:1 [Exists `test_stress_p003`] | re-run in new path | ST1 | REG + T/eqv | VERIFIED test_deferred_equivalence.py (1e12:1, 1e17:1 and equal masses reproduce the legacy values, Stage 1) |
| F1-DET-4 | Planets, moons, asteroids, tracked fragments | bodies generic | fragments are bodies | ST5, ST7 | T/life fragment contacts | PART |
| F1-DET-5 | Simultaneous contacts deterministic | `rand_seed` order [Exists] | sort key | ST1 | T/det 4 pairs × 20 orders | VERIFIED test_deferred_equivalence.py::test_four_simultaneous_pairs_resolve_identically_over_20_insertion_orders (identity and order exact; time quantised by the internal step, Stage 1) |
| F1-DET-6 | No corrupted integration state mid-step | rollback [Exists] | overlap check after apply | ST1, ST4 | T/det injected failure; post-apply overlap test | PART: injected failure rolls back byte-identically (test_detection.py, Stage 1); post-apply overlap check pending ST4 |
| F1-DET-EVAL | Evaluate swept/continuous/adaptive options; justify | spike evidence [Exists PHYSICS_SPIKE] | — | ST0 (doc) | plan §3.4; DECISIONS D-034 (architecture, Stage 0) | SUP (doc in plan) |
| F1-ID-1 | Stable event id and lifecycle | `evt-N` never reset [Exists] | lifecycle states | ST1 | T/rec | PART: stable `col-<n>` ids tied to `evt-<n>`, never reused after rollback (test_detection.py, Stage 1); lifecycle states pending ST8 |
| F1-ID-2 | Distinguish initial vs secondary impacts | — | generation/parent | ST7 | T/life parent link | MISS |
| F1-ID-3 | Distinguish repeated contacts of same objects | — | separate records | ST1, ST7 | T/det repeated contact after separation → 2 records | MISS |
| F1-ID-4 | One event producing several remnants | — | createdBodyIds | ST4 | T/app hit-and-run record | MISS |
| F1-ID-USE | Id usable by physics, renderer, diagnostics, persistence, replay | — | — | ST8–ST10 | T/rec, V/effectTimeline, T/pers | MISS |
| F1-AC-1 | Fast impacts not missed within envelope | as F1-DET-2 | envelope doc | ST1 | T/det | VERIFIED within the documented envelope (fast impact, 6 sweep cases, degraded-chunk flag: test_detection.py, Stage 1) |
| F1-AC-2 | No duplicate merges / fragment populations | — | — | ST1, ST5 | T/det, T/frag single population per event | PART |
| F1-AC-3 | Contact point within tolerance | — | tolerance plan §9.2 | ST1 | T/geo | VERIFIED test_geometry.py (Stage 1) |
| F1-AC-4 | Works when paused, resumed, time-scaled | step-driven [Exists] | tests | ST1 | T/det pause/scale equivalence | VERIFIED test_detection.py::test_pause_and_resume_do_not_change_the_event, test_time_scale_does_not_change_the_event (Stage 1) |
| F1-AC-5 | Non-collision orbital integration unchanged | — | equivalence | ST1 | REG validation suites unchanged; T/eqv | VERIFIED full backend suite unchanged in legacy mode: 800 passed (567 baseline + 233 new), 1 baseline warning (Stage 1) |

## §4 Feature 2 — Material-aware physics
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| M-OBJ | Same geometry, different materials → different outcomes (when model predicts) | — | — | ST3 | T/sel c* comparison | VERIFIED at model level (tests/impact/test_ls12.py c* test); application ST4 |
| M-CAT-ROCK | Rocky/silicate regimes (damage, fracture, crushing, melting, accretion, disruption) via selected approximation | — | LS12 + HH11; melting only as labelled energy partition | ST3, ST6 | T/ls12, T/crat | PART: LS12 regime outcomes (PROVISIONAL, D-038: CP-SCI-1 unsigned) for rock and rubble; cratering unsupported without constants |
| M-CAT-METAL | Metallic distinguished (density, response) | — | profile; c* gap recorded | ST2–ST3 | T/mat iron; T/sel | PART: `iron` profile with only the analytic k = 0.4; LS12/cratering numbers declared incomplete (tests/impact/test_materials.py); outcomes ST3 |
| M-CAT-ICE | Icy distinguished (density, strength, heating, melting, fragmentation) | — | profile; strength DQ-9 | ST2–ST3 | T/mat ice | PART: `water-ice` profile, strength/LS12/cratering declared incomplete (DQ-9) (tests/impact/test_materials.py) |
| M-CAT-GAS | Gas not solid; envelope-dominated selection; approximation, no gas-dynamics claim | — | envelope model | ST3 | T/env, T/sel never-LS12 | PART: gas-envelope bodies selected by gas mass fraction >= 0.5 (provisional) and routed to the envelope models (tests/impact/test_envelope.py); no gas-dynamics claim (warning `envelope_dynamics_not_resolved`) |
| M-CAT-MOLTEN | Data model permits molten; fluid-like behaviour when supported | — | `phase`, strengthless c* | ST2–ST3 | T/mat molten; T/sel | PART: `phase`/`meltFraction` exist in the layer schema (test_contracts.py); no molten profile shipped (strengthless-planet mu_bar unsourced); behaviour ST3 |
| M-CAT-MIXED | Differentiated bodies (core/mantle; ice/rock; core/envelope); not reduced silently | — | layers | ST2, ST5 | T/mat layers; T/frag composition | PART: layers and per-body layer overrides validated (tests/impact/test_materials.py, tests/impact/test_api_materials.py); differentiated profiles not shipped (core fractions unsourced); composition ST5 |
| M-PROP-1 | Composition & fractions | — | layers | ST2 | T/mat | VERIFIED tests/impact/test_materials.py::test_resolve_material_accepts_valid_input_and_rejects_the_rest_with_material_invalid (fractions sum to 1, Stage 2) |
| M-PROP-2 | Bulk & layer density | radius+mass give bulk density | computed bulk; layer optional | ST2 | T/mat | PART: bulk density is computed from mass and radius (not stored); optional layer densities validated (Stage 2) |
| M-PROP-3 | Strength/resistance parameters | — | c*, μ̄, BA99 | ST2–ST3 | T/mat | PART: LS12 c*, mu_bar stored for rock and rubble with citation (tests/impact/test_materials.py); strength constants incomplete (DQ-9) |
| M-PROP-4 | Compressibility / EOS ids where supported | — | optional `eosId` field (unused v1, labelled) | ST2 | T/contracts | MISS: no equation-of-state field was added (no model needs it in v1); optional field deferred |
| M-PROP-5 | Thermal properties where used | — | optional fields | ST2 | T/contracts | MISS: no thermal field was added (no model needs it in v1) |
| M-PROP-6 | Material-specific disruption/fragmentation params | — | β, c* | ST2–ST3 | T/mat | PART: LS12 c*, mu_bar only (tests/impact/test_materials.py); material-specific beta etc. pending ST3 |
| M-PROP-7 | Internal-structure description | — | structureClass + layers | ST2 | T/mat | VERIFIED structureClass + layers (tests/impact/test_materials.py, Stage 2) |
| M-PROP-8 | Validity range & provenance | catalogue pattern [Exists OD-2] | provenance per value | ST2 | T/mat provenance rejection | VERIFIED tests/impact/test_materials.py::test_every_number_of_every_profile_has_provenance, test_a_profile_with_an_unsourced_number_is_rejected (Stage 2) |
| M-PROP-MAP | Parameters required by models mapped to body representation | — | SCIENTIFIC_MODELS §5 | ST2 | review CP-SCI-1 | PART: only sourced parameters are mapped; the rest are listed `incomplete`; CP-SCI-1 review pending (ST3) |
| M-PROP-FALLBACK | Unknown/incomplete properties: explicit fallback; no arbitrary values | — | exact legacy merge + `material_unspecified` label in the record; never assign a material, never refuse (DQ-2 (a), D-033) | ST2–ST4 | T/sel fallback; T/mat incomplete; ST4 legacy-exactness re-run (byte-identical events/state) | VERIFIED for body creation: no material is ever assigned (tests/impact/test_state_paths_stage2.py::test_a_body_without_material_has_exactly_the_old_json_and_no_spin_state); outcome fallback ST4 |
| M-INT-1 | Rock+rock: cratering, accretion, ejecta, disruption | — | — | ST3–ST6 | T/scn A, C, D | PART: rock + rock LS12 outcomes (PROVISIONAL, D-038: CP-SCI-1 unsigned); cratering route unsupported without sourced constants; scenarios ST12 |
| M-INT-2 | Ice+rock: composition-sensitive outcome & debris | — | — | ST3, ST5 | T/sel ice-rock; T/frag composition | PART: ice + rock is selected and follows the target profile; an ice TARGET is Unsupported (no LS12 block) (tests/impact/test_selector.py); debris composition ST5 |
| M-INT-3 | Metal-rich+rock: different response, composition-dependent remnants | — | layered stripping | ST3, ST5 | T/frag iron-fraction direction | MISS |
| M-INT-4 | Asteroid+gas giant: envelope interaction | — | — | ST3 | T/scn B | PART: `envelope_deposition` selected (tests/impact/test_envelope.py); scenario B ST12 |
| M-INT-5 | Gas giant+gas giant: approximate envelope interaction, merger/disruption | — | no validated model | ST3 | T/env labelled approximation | PART: `envelope_merge_approximation`, fidelity `unsupported`, threshold 0.5 provisional (D-040) (tests/impact/test_envelope.py) |
| M-INT-6 | Molten+solid: deformation/mixing approx where modeled | — | strengthless c*, composition mix | ST3, ST5 | T/sel molten | PART by design |
| M-INT-7 | Fragment+planet: secondary impact with fragment's material | — | fragments inherit profile | ST7 | T/life | MISS |
| M-INT-8 | Mixed-material bodies use composition profile | — | — | ST3, ST5 | T/frag | MISS |
| M-INT-DOC | Shared models' assumptions & coverage documented | — | SCIENTIFIC_MODELS | ST3 | review | MISS |
| F2-AC-1 | Materials available to outcome & fragment systems | — | — | ST2–ST5 | T/sel, T/frag | MISS |
| F2-AC-2 | Equivalent setups comparable with different profiles | — | — | ST3 | T/sel comparison fixture | PART: equivalent setups with different profiles give different thresholds (tests/impact/test_ls12.py); UI comparison ST8 |
| F2-AC-3 | Output differences explainable by the model | — | regimeReasons | ST3, ST8 | T/sel reasons, T/rec | PART: reasons and parameters with sources are in every OutcomeSpec (tests/impact/test_ls12.py, tests/impact/test_selector.py); inspection API ST8 |
| F2-AC-4 | Unsupported combinations → documented fallback or validation error | — | — | ST2–ST3 | T/mat 422, T/sel unsupported | PART: invalid materials -> 422 material_invalid (tests/impact/test_api_materials.py, tests/impact/test_materials.py); unsupported combinations pending ST3 |
| F2-AC-5 | Gas giants not processed as rocky spheres | — | — | ST3 | T/sel | VERIFIED tests/impact/test_selector.py::test_gas_bodies_never_reach_the_rigid_body_model (Stage 3) |

## §5 Feature 3 — Localized impact, damage, propagation
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| L-OBJ | Local damage before global response; south ≠ north instantly | — | sites + front | ST6 | T/dmg antipode-not-yet | MISS |
| L-LOC-1..5 | Location accounts for orientation, spin axis, normal, contact geometry, impact direction | — | body-local site | ST2, ST6 | T/dmg, T/rot | PART: orientation, spin axis, normal and contact direction are captured in body-local form (tests/impact/test_geometry.py); damage sites ST6 |
| L-LOC-FRAME | World vs body-local never confused under rotation | — | `…Local` naming, transforms | ST2, ST6 | T/rot round trip; T/dmg half-rotation | VERIFIED tests/impact/test_rotation.py::test_body_local_world_round_trip_is_exact_to_1e12, tests/impact/test_geometry.py::test_a_fixed_surface_site_keeps_its_latitude_and_longitude_while_the_body_rotates (Stage 2); half-rotation damage alignment ST6 |
| L-DMG-REP | Spatially varying representation (documented) | — | ImpactSite list | ST6 | T/dmg | MISS |
| L-DMG-Q1..6 | Damage intensity, crater extent, ejecta sources, heating/intensity, propagation, local material loss | — | site fields | ST6 | T/dmg schema + values | MISS |
| L-DMG-COMPAT | Compatible with renderer; no hydrodynamics | — | surfaceMarks input | ST6, ST9 | V/surfaceMarks, boundary test | MISS |
| L-PROP-1..6 | Contact; crater/deformation; ejecta; propagation; secondary/broader damage when severe; relaxation where supported | — | phases + supersede on disruption | ST6, ST9 | T/dmg; V/effectTimeline phases | MISS (relaxation: not modelled, labelled) |
| L-PROP-DOC | Reduced-order model with assumptions/limits | — | SCIENTIFIC_MODELS §4.8 | ST6 | review | MISS |
| L-PROP-NOSHOCK | Visual wave not presented as calculated shock | — | label | ST6, ST9 | V/describe label test | MISS |
| L-SP-1 | South-pole scenario: impact begins at south pole | — | — | ST6, ST12 | T/scn A latitude −90° | MISS |
| L-SP-2 | Crater, damage, ejecta originate there | — | — | ST6 | T/scn A ejecta cone axis | MISS |
| L-SP-3 | Other regions not identical instantaneous damage | — | — | ST6 | T/scn A intensity profile | MISS |
| L-SP-4 | Disturbance propagates over time | — | — | ST6 | T/dmg arrival times | MISS |
| L-SP-5 | Opposite pole delayed/focused disturbance per approximation | — | antipodal focusing term | ST6 | T/dmg antipode arrival πR/c | MISS |
| L-SP-6 | Rendered damage aligned while rotating | — | orientation in renderer | ST9 | V/surfaceMarks alignment (pure transform), manual WebGL | MISS |
| L-SP-7 | Pause, inspect, replay | — | — | ST8, ST9 | T/rec, V/effectTimeline | MISS |
| L-SP-GLOBAL | Very energetic impact may disrupt globally | — | supersede rule | ST6 | T/dmg disruption supersedes | MISS |
| F3-AC-1 | Site aligned with body | — | — | ST6 | T/dmg | MISS |
| F3-AC-2 | Initial damage localized | — | — | ST6 | T/dmg | MISS |
| F3-AC-3 | Time-dependent progression | — | — | ST6 | T/dmg | MISS |
| F3-AC-4 | Rotation keeps damage attached | — | — | ST6, ST9 | T/rot, V/surfaceMarks | MISS |
| F3-AC-5 | Damage does not change mass/momentum without physical event | — | — | ST6 | T/dmg exact invariance | MISS |

## §6 Feature 4 — Outcome physics
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| O-OBJ | Not every collision a perfect merger | merge only | — | ST3–ST4 | T/sel | PART: selection by material, geometry and regime (tests/impact/test_selector.py) (PROVISIONAL, D-038: CP-SCI-1 unsigned) |
| O-CAT-1 | Cratering & ejecta | — | HH11 / LS12 low Q_R | ST3, ST6 | T/crat | PART: cratering model structure; Unsupported for every shipped profile (no sourced constants) (tests/impact/test_cratering.py) |
| O-CAT-2 | Perfect/near-perfect merger | [Exists] merge | regime-selected | ST3 | T/ls12 v ≤ v_esc | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): tests/impact/test_ls12.py::test_below_the_escape_speed_the_bodies_merge_without_any_strength_model |
| O-CAT-3 | Graze-and-merge | — | G12 | ST3 | T/ls12 G12 boundary | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): G12 eq. 16 coefficients transcribed (tests/impact/test_ls12.py::test_g12_*); calibrated for protoplanets only (warning) |
| O-CAT-4 | Hit-and-run (two remnants) | — | — | ST3–ST4 | T/scn C | PART (PROVISIONAL, D-038: CP-SCI-1 unsigned): hit-and-run selected by the model (Scenario C geometry, tests/impact/test_ls12.py); projectile erosion NOT modelled (warning); application ST4 |
| O-CAT-5 | Partial accretion | — | — | ST3–ST4 | T/app | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): tests/impact/test_ls12.py::test_regime_sequence_with_increasing_speed_is_ordered_and_largest_remnant_never_increases |
| O-CAT-6 | Partial erosion | — | — | ST3–ST4 | T/app | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): same test; erosion regime reached; application ST4 |
| O-CAT-7 | Catastrophic disruption (criterion-defined) | — | — | ST3–ST5 | T/scn D | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): tests/impact/test_ls12.py::test_head_on_equal_masses_at_high_speed_are_catastrophic_or_worse |
| O-CAT-8 | Super-catastrophic | — | — | ST3–ST5 | T/ls12 | VERIFIED at model level (PROVISIONAL, D-038: CP-SCI-1 unsigned): tests/impact/test_ls12.py::test_super_catastrophic_law_is_continuous_at_the_transition_and_decreasing (eq. 44 form unverified) |
| O-CAT-DEF | Categories defined consistently with prescription | — | LS12/SL12 definitions | ST3 | review CP-SCI-1 | PART: categories follow the LS12 universal law and thresholds recorded in the notes; CP-SCI-1 review open |
| O-MOD-SEL | Model selected & documented for regime | — | selector | ST3 | T/sel each branch | VERIFIED tests/impact/test_selector.py (each branch of the decision order, Stage 3) |
| O-MOD-INPUTS | v/v_esc, angle/b, mass ratio, interacting mass, binding thresholds, material, spin where supported | — | all except spin (LS12 has none → warn) | ST3 | T/ls12; T/sel spin warning | PART: speed, angle, mass ratio, interacting mass, escape speed, material and structure class are used; spin only recorded (`spin_not_in_model`) (tests/impact/test_ls12.py) |
| O-MOD-EXTRAP | No extrapolation beyond validity without fallback | — | envelopes | ST3 | T/sel unsupported | VERIFIED tests/impact/test_ls12.py::test_disruption_of_small_bodies_is_unsupported_not_a_plausible_looking_outcome, test_extrapolated_velocity_is_labelled, tests/impact/test_selector.py (Stage 3) |
| O-CONS-1 | Merger: remnant mass, position, velocity, spin | merge [Exists], spin as ledger | spin state | ST2, ST4 | T/app | PART: spin angular momentum of a merging pair is booked, not lost (tests/impact/test_state_paths_stage2.py::test_merging_books_the_spin_angular_momentum_into_the_existing_ledger); spin state of the remnant ST4 |
| O-CONS-2 | Hit-and-run: multiple remnants, consistent velocities & accounting | — | — | ST4 | T/scn C | MISS |
| O-CONS-3 | Disruption: largest remnant + defined population | — | — | ST5 | T/scn D | MISS |
| O-CONS-4 | Erosion: removed mass into explicit representation | — | — | ST4–ST5 | T/cons | MISS |
| O-CONS-NODOUBLE | No second outcome after resolution | — | one apply per record | ST4, ST6 | T/app, T/dmg supersede | MISS |
| F4-AC-1 | All categories within validity | — | — | ST3–ST5 | T/scn, T/ls12 | PART: all categories exist at model level within the declared validity range (PROVISIONAL, D-038: CP-SCI-1 unsigned); applied outcomes ST4 |
| F4-AC-2 | Deterministic repeatability | — | seeds | ST5, ST10 | T/rec replay digest | MISS |
| F4-AC-3 | Selection inspectable | — | reasons | ST8 | T/rec | MISS |
| F4-AC-4 | Existing merger path remains | [Exists] | keep as legacy + regime | ST1 | REG, T/eqv | VERIFIED test_deferred_equivalence.py::test_legacy_mode_reproduces_the_golden_values_bit_for_bit (Stage 1) |
| F4-AC-5 | Unsupported regime explicit | — | — | ST3 | T/sel | VERIFIED tests/impact/test_selector.py::test_the_fallback_is_always_a_valid_conserving_merge and the Unsupported tests (Stage 3) |

## §7 Feature 5 — Fragmentation and debris
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| R-OBJ | Meaningful products, coherent ICs, defined relation to mass & momentum; not decorative | — | — | ST5 | T/frag | MISS |
| R-A-1..6 | Major remnants: persistent id, mass, pos/vel, radius/shape, composition, spin, collision eligibility; participate in gravity | bodies have mass/state/radius [Exists] | composition, spin, flags | ST2, ST4 | T/app, T/rot | PART: spin state and material exist for bodies (tests/impact/test_state_paths_stage2.py); remnants/composition ST4-ST5 |
| R-B-1 | Tracked fragments above configurable threshold | — | — | ST5 | T/frag | MISS (threshold DQ-6) |
| R-B-2 | Statistical populations with documented distributions | — | parcels | ST5 | T/frag power-law fit | DEC (DQ-4) |
| R-B-3 | Particle samples for visualization | — | V/debrisSampling | ST9 | V/debrisSampling | MISS |
| R-B-4 | Aggregated representation for tiny debris | — | parcels/aggregation | ST5, ST7 | T/frag, T/life aggregation | MISS |
| R-B-ACC | Accounting relation between represented mass and samples | — | samples carry no mass; weight shown | ST5, ST9 | V/debrisSampling weight sum = parcel mass | MISS |
| R-C | Visual effects explicitly classified, not mass-bearing | — | `visualOnly` | ST9 | V/effectTimeline | MISS |
| FR-GEN-1..8 | Largest remnant, remaining mass, size/mass distribution, composition, velocity distribution, directions, rotational influence, bound/escape likelihood | — | — | ST5, ST7 | T/frag per item; T/life classification | MISS |
| FR-GEN-NOTRAND | Not identical fragments with uniformly random motion | — | power law + cone/plane geometry | ST5 | T/frag distinct masses & structured directions | MISS |
| IC-1..7 | ICs from bulk translation, impact momentum, surface orientation & local geometry, target rotation, ejecta distributions, binding, sim velocity frame | — | — | ST5 | T/frag IC tests | MISS |
| IC-DOC | Statistical distributions documented | — | SCIENTIFIC_MODELS §4.7 | ST5 | review | MISS |
| C-1 | Mass & linear momentum across bodies, fragments, aggregates | merge [Exists] | — | ST4–ST5 | T/cons | PART |
| C-2 | Rendering doesn't multiply mass | — | — | ST9 | V/debrisSampling | MISS |
| C-3 | Representation changes transfer accounting explicitly | — | ledger entries | ST5, ST7 | T/life aggregation accounting | MISS |
| C-4 | Angular momentum incl. spin & ejecta where supported | ledger [Exists] | spin states | ST4 | T/cons L | PART |
| C-5 | Energy partition (kinetic, gravitational, internal/dissipated) | KE lost [Exists] | partition | ST4 | T/cons energy | PART |
| F5-AC-1..5 | Coherent ICs; fragment mass in accounting; LR & debris consistent with outcome; rendering density doesn't change mass; resource limits respected | — | — | ST5, ST9 | T/frag, T/cons, V/effectBudget | MISS |

## §8 Feature 6 — Particle engine and visual evolution
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| V-EVT-PUB | Resolver publishes event description with physical results | — | VisualEventDescription | ST8 | T/rec schema | MISS |
| V-EVT-CONS | Renderer consumes event & produces matching transitions | — | effects layer | ST9 | V/effectTimeline | MISS |
| V-EVT-SEQ-1..8 | Contact, flash, crater/penetration, ejecta, separation, cloud expansion, trajectories, reaccretion/orbit/escape | — | phases | ST9 | V/effectTimeline phase list per outcome | MISS |
| V-EVT-OUTCOME | Sequence depends on outcome (mild crater ≠ explosion) | — | — | ST9 | V/effectTimeline cratering-no-disruption | MISS |
| V-MAT-1..5 | Rocky chunks, icy, molten glow, gas diffuse, fine debris field | colours/textures by bodyType [Exists] | appearance map | ST9 | V/materialAppearance | MISS |
| V-MAT-NOTEVID | Appearance not evidence of resolved thermodynamics | — | label | ST9 | V/describe | MISS |
| V-TRAJ-1 | Particles follow trajectories from physical ICs | — | parcels are bodies | ST5, ST9 | V/debrisSampling anchored to parcel position | MISS |
| V-TRAJ-NO-1..5 | No teleport, no per-frame randomization, no removal on animation end, no drama edits, no desync | — | deterministic samples | ST9 | V/debrisSampling determinism; T/life removal rules | MISS |
| V-TRAJ-INTERP | Interpolation only for display | no interpolation today | optional display interpolation | ST9 | V test: interpolation never feeds API | MISS |
| V-TIME-1..7 | Pause/resume, time scaling, replay, smooth interpolation, alignment, overlapping events, cleanup of expired visuals | history replay [Exists] | effect timeline; rule approved DQ-12 (a), D-033 | ST9 | V/effectTimeline | PART |
| V-TIME-LIFE | Visual effects finite lifetime; fragments follow lifecycle | — | visual-only: short wall-clock duration, frozen while paused, replayed on seek-back, no mass field (D-033) | ST0 (contract), ST9 | V/effectTimeline pause/seek-back/seek-past tests; type-level no-mass test | MISS (decided D-033) |
| V-PERF-1..6 | Limits: visual particles, tracked fragments, simultaneous effects, update frequency, camera LOD, aggregation | — | budgets | ST5, ST9 | V/effectBudget; T/frag budgets | MISS |
| V-PERF-NOPHYS | LOD never alters physical state/accounting | — | — | ST9 | E2E/col inspector numbers unchanged | MISS |
| F6-AC-1..5 | Animation matches outcome; fragments continue after effects; no divergence on pause/scale; materials distinguishable; limits don't lose mass | — | — | ST9, ST12 | V/*, E2E/col, T/scn F | MISS |

## §9 Feature 7 — Gravity, reaccretion, secondary impacts
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| LC-1..8 | Lifecycle: created, ICs, evolved, collides, merges/reaccretes, orbits, ejected, removed only by explicit rule | — | — | ST5, ST7 | T/life per state | MISS |
| LC-NOANIM | Never disappears because animation ended | — | — | ST7, ST9 | T/life; V/effectTimeline | MISS |
| G-1 | Remnants & tracked fragments in authoritative gravity | bodies in REBOUND [Exists] | — | ST5 | T/frag bodies in sim | SUP (by design) |
| G-2 | Reduced-order/statistical for small debris allowed | — | parcels | ST5 | T/frag | DEC (DQ-4) |
| G-3 | Explicit which interactions resolved vs approximated | — | API_CONTRACT note | ST5 | review | MISS |
| RA-1 | Detect returning debris; resolve via collision model | — | — | ST7 | T/life reaccretion | MISS |
| RA-2 | Outcomes: accretion, cratering, ejecta, fragmentation, new event | — | — | ST7 | T/life | MISS |
| RA-3 | Avoid infinite/expensive cascades | — | cascade limits | ST7 | T/life cascade | MISS |
| BE-1..4 | Bound to remnant, orbiting remnant, bound to system, escaping | — | classification | ST7 | T/life two-body energy tests | MISS |
| BE-DYN | Dynamical criterion, not visual distance | — | — | ST7 | T/life | MISS |
| SEC-ID | Secondary event distinct with parent link | — | — | ST7 | T/life parentEventId | MISS |
| F7-AC-1..5 | Orbit/reaccrete/collide/escape; secondary uses collision system; parent links valid; removal/aggregation accounted; cascades bounded | — | — | ST7 | T/life, T/scn E | MISS |

## §10 Feature 8 — Conservation, diagnostics, validation
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| DG-1..11 | Event id & parent; pre-impact states; geometry & rel. velocity; materials & params; outcome & model version; post states; fragment & debris accounting; mass & momentum residuals; L diagnostics; energy diagnostics; warnings/fallbacks/approximations | merger event subset [Exists] | full record | ST1, ST4, ST8 | T/rec schema test per field | PART |
| DG-ACCESS | Accessible to tests and developer tools | — | API + inspector | ST8 | T/rec, V/CollisionInspector | MISS |
| CN-MASS | Mass agreement within tolerance unless modeled source/sink | merge exact [Exists] | all outcomes | ST4–ST7 | T/cons | PART |
| CN-MOM | Linear momentum within tolerance | merge [Exists] | — | ST4–ST5 | T/cons | PART |
| CN-ANG | Angular momentum incl. spin & ejecta; unmodelled parts documented | ledger [Exists] | — | ST4 | T/cons | PART |
| CN-EN | Energy per model; K, U, internal/dissipated distinguished | — | partition | ST4 | T/cons | MISS |
| CN-NOKE | Not require KE conserved in inelastic collisions | diagnostics doc [Exists D-013] | — | ST4 | T/cons dissipation ≥ 0 | SUP (keep) |
| NF-1..8 | Detect: non-finite, invalid masses, invalid distributions, residuals out of tolerance, unsupported materials, fragment overflow, unresolved outcome, invalid integration state | non-finite [Exists] | rest | ST4–ST7 | T/app failure table row tests | PART |
| NF-POLICY | Each case: reject / fallback / pause / other, defined | — | plan §9.3 | ST4 | T/app | MISS |
| NF-NOSILENT | No silent corruption | rollback [Exists] | — | ST4 | T/app byte-identical after failure | PART |
| RP-1 | Deterministic reproduction | fixed rand_seed [Exists] | outcome sampling | ST5, ST10 | T/rec replay | PART |
| RP-2 | Controlled seed for stochastic sampling | — | config seed | ST0, ST5 | T/frag seed tests | MISS |
| RP-3 | Cross-platform tolerances defined | — | plan §9.2 | ST10 | doc + T/pers tolerance helper | MISS |
| ST-1..11 | Tests: head-on & oblique; low-energy cratering; merger & hit-and-run; partial accretion & erosion; catastrophic; material combos; polar; gas giant; reaccretion & secondary; mass & momentum; performance & deterministic replay | merger tests [Exists] | rest | ST3–ST12 | see plan §7 table | PART |
| ST-NOARB | Expected values from models/reference scenarios, not invented | culture [Exists TEAM_WORKFLOW] | reference_values.py | ST3 | CP-SCI-1 review | PART |
| F8-AC-1..5 | Inspectable; residuals measurable; physical vs rendering failures distinguished; regimes & limits covered; warnings actionable & reproducible | — | — | ST4, ST8, ST12 | T/rec, T/cons, separate test dirs | MISS |

## §11 Feature 9 — Performance and integration
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| F9-AUDIT | Audit before assuming modules | done in planning | — | ST0 | plan §1 | SUP |
| F9-BND-1..9 | Clear responsibilities for detection, capture, selection, resolution, generation, evolution, history, visual, persistence; no duplicated authoritative state | — | module layout plan §3.1 | ST0–ST10 | review + import-boundary test (`backend/impact` never imported by frontend; renderer never writes API) | PART: package boundary VERIFIED `test_no_existing_module_imports_backend_impact`, `test_impact_package_does_not_depend_on_the_simulation_service` (Stage 0); rest pending ST1-ST10 |
| AS-1..5 | Removal/transformation; remnants; tracked fragments registered; mass & momentum into debris; spin updates | merge [Exists] | — | ST4–ST5 | T/app | PART |
| AS-NORENDER | Renderer never modifies these values | backend-authoritative [Exists] | — | ST9 | boundary test | SUP (keep) |
| ISO-1..3 | Isolation of events, populations, seeds, histories, state; preserve model | per-engine [Exists D-025] | collision state per engine | ST10 | T/iso | PART |
| PER-1..5 | Persist: new body/material fields; fragments & debris; active aftermath; seeds; migration/compat | in-memory snapshots [Exists]; no disk (OD-5) | CollisionState in snapshots | ST2, ST10 | T/pers | PART: materials and rotation survive checkpoint, step rollback, snapshot restore, reset and derive (tests/impact/test_state_paths_stage2.py); collision records ST10; disk persistence DQ-11 |
| PER-VER | Versioned using repo approach; don't invalidate existing saves | `version` fields pattern [Exists diagnostics] | schemaVersion | ST0, ST10 | T/pers old-snapshot restore | MISS |
| LIM-1..6 | Configurable limits: fragments, active events, visual particles, secondary processing, aggregation, per-step computation | step time budget [Exists] | CollisionConfig | ST0, ST5, ST7, ST9 | T/frag, T/life, V/effectBudget | PART |
| LIM-POLICY | Explicit policy at limits; never discard mass | — | plan §9.3/9.4 | ST5, ST7 | T/frag overflow | MISS |
| REG-1..8 | Preserve orbital mechanics, trajectories, moons, workflows, isolation, time controls, rendering outside collisions, APIs/persistence | [Exists] suites | keep | all | REG each stage | SUP (must stay) |
| REG-BASE | Baseline failures distinguished | baseline recorded (plan §0: 567/433; E2E env failures) | — | all | stage reports | SUP |
| F9-AC-1..6 | Non-collision works; isolation; budgets respected; save/restore compatible; degradation measurable; render optimizations don't alter accounting | — | — | ST10, ST12 | REG, T/iso, T/perf, E2E/col | PART |

## §12 Feature 10 — Future hydrodynamics extension
| ID | Requirement | Current | Gap | Stage | Verification | Status |
|---|---|---|---|---|---|---|
| HX-CAP | Deferred capabilities not initial requirements | — | — | — | DoD audit | SUP (deferred) |
| HX-IF-1..9 | Interfaces: pre-impact state & materials; geometry & BCs; model selection; solver execution & status; remnants; fragment/debris distributions; conservation; transfer to N-body; rendering & history | — | contracts + adapter | ST0, ST3 | T/contracts; dummy external-model test (returns OutcomeSpec, flows through applier unchanged) | VERIFIED for the model interface: tests/impact/test_selector.py::test_a_registered_model_passes_through_the_selector_unchanged; application/transfer back ST4 |
| HX-NOSPH | Not assume SPH | — | generic adapter | ST0 | review | MISS |
| HX-JUSTIFY | Complexity justified by codebase | — | plan §3.15 | ST0 | review | SUP (doc) |
| FID-1..6 | Distinguish computed, empirical/analytic, reduced-order spatial, statistical, visual, future unsupported | — | labels | ST0, ST8, ST9 | T/contracts enum; V/describe | PART: enum VERIFIED test_contracts.py::test_fidelity_labels_match_the_plan (Stage 0); UI labels pending ST8-ST9 |
| FID-UI | UI does not imply resolved hydrodynamics | — | labels | ST8–ST9 | V/describe | MISS |
| F10-AC-1 | No hydrodynamics dependency | none [Exists] | keep | all | requirements diff review | SUP |
| F10-AC-2 | Models expandable/replaceable | — | adapter | ST3 | dummy-model test | VERIFIED tests/impact/test_selector.py::test_a_registered_model_passes_through_the_selector_unchanged (Stage 3) |
| F10-AC-3 | Event records accommodate new fields, versioned | — | schemaVersion + `fieldsExtra` | ST0 | T/contracts forward-compat | MISS |
| F10-AC-4 | State can receive future solver remnants via boundary | — | OutcomeSpec → applier | ST3–ST4 | dummy-model test | PART: OutcomeSpec/records are versioned and additive (Stage 0); a future solver's remnants flow through the same spec |

## §13 Shared contracts
| ID | Requirement | Plan section | Stage | Verification | Status |
|---|---|---|---|---|---|
| CT-IN | Collision input sufficient; simulation context access | §P-4.5, 4.6 | ST0–ST1 | T/contracts, T/geo | PART: schema VERIFIED test_contracts.py (CollisionInput, ImpactState round trip, Stage 0); geometry pending ST1 |
| CT-RES-1..10 | Outcome; surviving/transformed; removed; new remnants; tracked fragments; statistical populations; mass accounting; motion & spin; diagnostics & warnings; model version & approximation metadata | §P-4.6 | ST0, ST4 | T/contracts, T/app | PART: schema VERIFIED test_contracts.py (CollisionResult, ConservationReport round trip, Stage 0); application pending ST4 |
| CT-RES-VAL | Validated before commit | §P-3.7 | ST4 | T/app invalid-not-applied | MISS |
| CT-VIS-1..6 | Impact location & orientation; ejecta sources; fragment trajectories/ids; cloud params; timing & outcome; visual-only effects & lifetimes | §P-4.10 | ST8–ST9 | T/rec, V/effectTimeline | MISS |
| CT-VIS-NORECON | Renderer doesn't reconstruct collision | §P-3.12 | ST9 | boundary/import test | MISS |
| CT-FRAG | Distinguish tracked / statistical / visual; conversion rules | §P-3.9 | ST5, ST9 | T/frag, V/debrisSampling | MISS |
| CT-VER | Compatibility strategy for persisted event/result/material | §P-4 conventions, 3.13 | ST0, ST10 | T/pers | PART: schemaVersion + strict reader VERIFIED test_contracts.py::test_unsupported_schema_version_is_rejected (Stage 0); persistence pending ST10 |

## §14 Cross-feature scenarios
| ID | Expectations (each bullet of the spec) | Stage | Verification | Status |
|---|---|---|---|---|
| SC-A (south pole) | detection; contact point & diagnostics; localized initial damage; ejecta from site; coherent fragment velocities; continued evolution; no uniform instantaneous damage | ST6, ST9, ST12 | T/scn::test_scenario_a_* (backend), E2E/col (stub), manual WebGL check recorded | MISS |
| SC-B (asteroid → gas giant) | envelope-dominated identification; gas-envelope handling; outcome & limitations recorded; ejecta/remnant/envelope-loss consistent; no resolved-gas-dynamics claim | ST3, ST4, ST12 | T/scn::test_scenario_b_* | MISS |
| SC-C (hit-and-run) | regime selected; consistent remnants; mass & momentum; renderer shows both + debris; no duplicated/lost bodies | ST4, ST9, ST12 | T/scn::test_scenario_c_*, E2E/col | MISS |
| SC-D (catastrophic) | remnant + debris distribution; explicit accounting; coherent trajectories; bound debris orbit/reaccrete; unbound escape; limits don't discard mass; residuals & approximations reported | ST5, ST7, ST12 | T/scn::test_scenario_d_* | MISS |
| SC-E (secondary) | fragment registered; trajectory from state; secondary detected & resolved; parent link; damage & debris; history intact | ST7, ST12 | T/scn::test_scenario_e_* (moons preset) | MISS |
| SC-F (pause/resume/replay) | pause freezes sim & animation; resume continues; time scaling consistent; replay consistent; visuals cleaned, fragments accounted | ST1, ST8, ST9, ST12 | T/scn::test_scenario_f_*, V/effectTimeline, T/rec replay | PART |
| SC-G (independent sims) | own state & populations; no leakage of events/seeds/debris; updates isolated; save/restore association | ST10, ST12 | T/iso | PART |
| SC-H (regression & performance) | existing workflows pass; limits respected; fallbacks explicit; accounting available when detail reduced; baseline vs new failures separated | all, ST12 | REG, T/perf, E2E/col | PART |

## §15 Planning deliverables (this planning task)
| ID | Deliverable | Where | Status |
|---|---|---|---|
| DLV-1 | Repository audit | plan §0–§1 | done (planning) |
| DLV-2 | Requirement-to-code map | this file | done (planning) |
| DLV-3 | Scientific model selection | `COLLISION_SCIENTIFIC_MODELS.md` | done, with CP-SCI-1 open items incl. the mandatory gate UD-1/UD-2 (§6a, D-033) |
| DLV-4 | Architecture & contracts | plan §3–§4 | done (planning) |
| DLV-5 | Phased plan | plan §6 + execution guide | done (planning) |
| DLV-6 | Risk register | `COLLISION_RISK_REGISTER.md` | done (planning) |
| DLV-7 | Traceability incl. infeasible items with options | this file + plan §8 | done (planning) |

## §16 Implementation rules for Sonnet
| ID | Rule | Enforced by | Status |
|---|---|---|---|
| SR-1..15 | Inspect before editing; follow plan & traceability; bounded stages; tests with changes; no arbitrary replacement of models; no invented APIs; avoid deps/rewrites; preserve unrelated work; never discard user work; run tests per stage & regression at checkpoints; report exact outcomes; no completion claims without evidence; independent testability of physics/performance/rendering; stop on conflicts; keep hydrodynamics deferred | `COLLISION_SONNET_EXECUTION_GUIDE.md` §1 global rules + per-stage gates | encoded |

## §17 Definition of Done
| ID | Item | Verified at | Status |
|---|---|---|---|
| DOD-1 | All ten features addressed | ST12 audit of this matrix | open |
| DOD-2 | All initial requirements have evidence | ST12 (every row VERIFIED or approved limitation) | open |
| DOD-3 | Scenarios pass or have approved limitations | ST12 | open |
| DOD-4 | Outcomes driven by selected models | ST3–ST4 | open |
| DOD-5 | Localized impacts per damage approximation | ST6 | open |
| DOD-6 | Coherent trajectories & lifecycle | ST5, ST7 | open |
| DOD-7 | Mass & momentum validated within tolerances | ST4–ST7 | open |
| DOD-8 | Rendering follows authoritative event | ST9 | open |
| DOD-9 | Controls & isolation correct | ST10 | open |
| DOD-10 | Limits & fallbacks explicit | ST5, ST7, ST9 | open |
| DOD-11 | Persistence compatible / migrated | ST10 | open |
| DOD-12 | Regression passes, baseline distinguished | every stage | open |
| DOD-13 | Hydrodynamics integrable without redesign | ST0, ST3 (dummy model) | open |
| DOD-14 | Documented assumptions & reproducible scenarios | ST12 | open |

## §18 Final product requirement (user understanding)
| ID | The user can understand… | Delivered by | Stage | Verification |
|---|---|---|---|---|
| FP-1 | what collided | record bodyIds + inspector | ST8 | V/CollisionInspector |
| FP-2 | where the impact occurred | contact point/site (world + body-local) | ST6, ST8 | T/rec, V/surfaceMarks |
| FP-3 | why the outcome was selected | `regimeReasons`, parameters | ST3, ST8 | T/sel, V/describe |
| FP-4 | how materials influenced it | material params in reasons | ST3, ST8 | T/sel comparison |
| FP-5 | where fragments & ejecta came from | ejecta sources, fragment origin | ST5–ST6, ST8 | T/frag, T/rec |
| FP-6 | how fragments moved | bodies + history | ST5, ST9 | history tests, V/effectTimeline |
| FP-7 | what stayed bound / reaccreted / escaped | classification + ledgers | ST7, ST8 | T/life, T/rec |
| FP-8 | what was calculated, approximated or visualized | fidelity labels | ST0, ST8, ST9 | V/describe labels |

## Owner-decision constraints (D-033, 2026-10-24)
These are not spec requirements but binding constraints on how the rows above are implemented; each has its own verification.
| ID | Constraint | Stage | Verification | Status |
|---|---|---|---|---|
| OD33-BRIEF | `PROJECT_BRIEF.md` references the spec; hydrodynamics/SPH stays a non-goal (DQ-1 a) | ST0 | doc diff review | VERIFIED doc diff: PROJECT_BRIEF.md features list references the spec, non-goals unchanged (Stage 0) |
| OD33-LEGACY | Material-less pairs resolve exactly as legacy in every mode; label `material_unspecified`; no silent material; no refusal (DQ-2 a) | ST2, ST4 | ST4 legacy-exactness re-run; T/sel fallback | PART: material-less bodies get no new field and no spin state (tests/impact/test_state_paths_stage2.py); Stage 4 legacy-exactness re-run pending |
| OD33-MODE | All universes `legacy-merge` until step 4b; then `outcome-v1` for new sandboxes only (including the startup `uni-default`, owner-confirmed); presets and Orbit Lab legacy until Stage 11 | ST0 (constant), ST4b, ST11 | `tests/impact/test_mode_defaults.py`; ST11 acceptance | PART: constant VERIFIED test_contracts.py::test_default_sandbox_mode_is_legacy_merge_until_stage_4b (Stage 0); 4b/Stage 11 pending |
| OD33-VIS | Visual-only effects: wall-clock duration, freeze on pause, replay on seek-back, never mass-bearing (DQ-12 a) | ST0, ST9 | V/effectTimeline; type-level test | PART: contract VERIFIED test_contracts.py::test_visual_only_effect_has_no_mass_field (Stage 0); timeline tests pending ST9 |
| OD33-REVIEW | Independent AI session for routine physics checks; named human for CP-SCI-1 and CP-5; everything logged in `WORKLOG.md` (DQ-14 d) | ST3, ST12, all physics stages | WORKLOG entries; TASKS.md reviewer name | MISS |
| OD33-GATE | UD-1 (5.3 J/kg) and UD-2 (b_crit 0.66) reproduced from the original LS12 paper with traced equations/definitions/assumptions/units and human sign-off before disputed constants are used | ST3 | `test_ls12_worked_example_q_rd_gamma1`, `test_ls12_worked_example_b_crit`; WORKLOG sign-off | PROVISIONAL: D-038 (owner instruction) lets development use the planning relations; CP-SCI-1 is NOT signed off, UD-1/UD-2 are OPEN, no reviewer has agreed. Isolation: provisional registry + labels + `outcome-v1` opt-in; production default activation (ST4 step 4b) stays separately gated |

## Coverage summary
Every numbered item of §1–§18 has at least one row; grouped rows (e.g. `F1-INFO-1..12` expanded, `R-A-1..6`, `NF-1..8`, `ST-1..11`, `HX-IF-1..9`) list each sub-item in the spec's order and are verified item by item by the named tests. Rows with status DEC: M-CAT-ICE/M-PROP-3 strength (DQ-9), M-INT-5 (DQ-8), R-B-1 threshold (DQ-6), R-B-2/G-2 (DQ-4), PER-1..5 disk (DQ-11). M-PROP-FALLBACK and V-TIME-LIFE were decided by the owner (D-033) and are now MISS (to implement). The only BLK row is the owner constraint OD33-GATE, which blocks the disputed LS12 constants until CP-SCI-1; no spec requirement is blocked and none was removed.
