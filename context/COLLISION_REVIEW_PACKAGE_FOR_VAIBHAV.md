# Collision & Particle Engine — Consolidated Review Package for Vaibhav

**Prepared:** 2026-10-25 by the Claude Sonnet 5.5 implementer sessions, from the repository state of branch `collision/review-package` (stacked on `collision/stage-11-prep`, which stacks on stages 0–10 and the browser verification; **nothing is pushed or merged**).
**Purpose:** list everything that needs a human scientific or technical decision, with the exact claim, the evidence, the known limits and the question to answer.

> **Nothing in this document is a sign-off, and nothing is validated by having passing tests.** CP-SCI-1, CP-5 and the Stage 11 reviewer prerequisite are all **open**. No reviewer has confirmed (see section 1). This package changes no code and marks no gate complete. A sign-off block at the end is intentionally blank.

## How to read this package

The work is separated into three kinds of approval, because passing tests answers only the first:

| Part | What it asks | Who can decide | Tests help? |
|---|---|---|---|
| **A. Software correctness** | Does the code do what its contract says (conservation arithmetic, determinism, state paths, API, UI logic)? | reviewer, by inspection and by running the tests | **Yes**: the tests are the evidence, within the limits stated |
| **B. Scientific validation** | Are the equations, constants, assumptions, material properties and sources *right and applicable*? | **a qualified human, against the primary papers** (CP-SCI-1) | **No**: tests pin what the code does, not whether it is correct |
| **C. Final Definition-of-Done approval (CP-5)** | Is the whole engine complete per spec section 17, with every requirement evidenced or an owner-approved limitation? | the named human reviewer, after Stage 12 | partly |

**Evidence base used throughout.** Backend `python -m pytest -q`: 1373 passed (last full run, Stage 10; backend code unchanged since). Frontend: `npx vitest run` 502 passed, `npx tsc --noEmit` clean, `npm run build` OK. Browser: 14 Playwright tests pass in headless Chromium 153 with software WebGL against a stubbed API (D-057). Branch chain and commits are listed in `context/WORKLOG.md`. **The implementer never read the primary papers in full**: for LS12 a fetch sub-agent (a model) read roughly the first 37 % of the arXiv text; for Genda et al. 2012 a sub-agent read part of the text; CS22 sections 1–3.2; all other references are known only from bibliographic knowledge or search results (`COLLISION_SCIENTIFIC_MODELS.md` section 2 states each status).

---

## 1. Gates and reviewer status (nothing signed)

| Gate | Requirement (source) | Status | What is needed |
|---|---|---|---|
| **CP-SCI-1** | Every equation and constant transcribed from the primary papers with equation/page, independently re-derived; **UD-1** and **UD-2** reproduced from the paper or the discrepancy explained and accepted; signed by the **named human reviewer** (D-033, plan Stage 3, `WORKLOG.md`). | **OPEN, unsigned.** The code uses the planning relations as *working assumptions* (D-038, instructed by the owner), all labelled `provisional:CP-SCI-1`. | A named human, the papers, and a signed record in `WORKLOG.md`. |
| **CP-5** | Definition-of-Done audit signed by the named human reviewer before any PR to `main` (plan section 6; guide Stage 12; DQ-14 (d)). | **OPEN.** Stage 12 (scenarios A–H, performance, DoD audit) has not been done. | Stage 12, then the signature. |
| **Stage 11 reviewer** | DQ-3 (a) "each value cited, reviewer assigned" (D-058). | **NOT SATISFIED.** Stage 11 has not started. | A named reviewer and cited per-body material values. |
| **CP-3, CP-4b, CP-1, CP-2** | Owner approvals. | Done by the owner (D-036, D-045..D-048, D-053). They approve *implementation evidence or a boundary change*, **not** the science. | — |

Reviewer facts in the repository: no reviewer is named in `TASKS.md`; Vaibhav was "approached" only (D-038); he has not confirmed, and no alternative is confirmed. This document does not name anyone.

---

# PART B — SCIENTIFIC VALIDATION (human review required)

For every item: **Where** (file/section), **Claim** (what the code or note asserts), **Evidence** (tests and what they do and do not show), **Limits**, **Question** (what you need to answer). "Provisional" below means registered in `backend/impact/models/provisional.py` and carried as the warning `provisional:CP-SCI-1` on every dependent outcome. All items in Part B are **unvalidated**.

## B1. Gravity-regime outcome equations (LS12 and Genda)

| ID | Where | Claim | Evidence and limits | Question for Vaibhav |
|---|---|---|---|---|
| **B1.1** UD-1 | `backend/impact/models/ls12.py::q_star_rd_gamma1`; notes 4.2; D-038 | Q*_RD,γ=1 = c* (4/5) π ρ₁ G R_C1² (eq. 28), R_C1 = radius of a sphere of the combined mass at ρ₁ = 1000 kg/m³, c* = 5 for small bodies. | `tests/impact/test_ls12.py` pins the equation and **documents the open difference**: for "two 1 km rock bodies" (R_C1 ≈ 2 km) it gives **3.35 J/kg**, the printed worked example is **5.3 J/kg**. The inputs the paper used (radii vs diameters, densities, R_C1) are unknown to us; 5.3 J/kg would need R_C1 = 2.51 km. The equation was **not** tuned to match. | Reproduce the worked example from the printed paper. Is the printed 5.3 J/kg consistent with eq. 28 under a stated definition (radius vs diameter, density)? If not, what is the correct relation? |
| **B1.2** UD-2 | `ls12.py::b_crit`; eq. 6; D-038 | b_crit = R_t/(R_t + R_p) with the radius ratio from equal densities. | Gives **0.683** for γ = 0.1; the paper's printed value is **0.66**. `test_ls12.py` asserts the model value differs from 0.66 (open). | What density/radius assumption gives 0.66? Is eq. 6 transcribed correctly? |
| **B1.3** | `ls12.py` eq. 23 (`q_star_rd_mass_ratio`) | Q*_RD = Q*_RD,γ=1 (¼(γ+1)²/γ)^(2/(3μ̄) − 1). | Seen verbatim by a model sub-agent in the first ~37 % of the arXiv text; tested for the γ = 1 identity. Not checked against the printed paper. | Confirm the printed form and the exponent. |
| **B1.4** | eqs. 7, 11, 12, 15 (interacting mass α, μ_α, Q'*_RD = (μ/μ_α)^(2−3μ̄/2) Q*_RD) | The interacting-mass correction. | Same status as B1.3. | Confirm each. |
| **B1.5** | eqs. 4–5 (universal law), transition at Q_R/Q'*_RD = 1.8 | M_lr/M_tot = −0.5(Q_R/Q'*_RD − 1) + 0.5 up to 1.8. | The text read prints the 1.8 transition against Q*_RD, the code uses **Q'*_RD**; the registry item says so. Tests pin monotonicity and mass conservation, not truth. | Is the transition on Q*_RD or Q'*_RD? |
| **B1.6** | eq. 44, `SUPERCAT_ETA = −1.5`, prefactor 0.1/1.8^η | Super-catastrophic power law M_lr/M_tot = (0.1/1.8^η)(Q_R/Q'*_RD)^η. | **Unverified**: seen only in a model summary; η and the form are unconfirmed (registry status `unverified`). | Provide the printed equation and exponent. |
| **B1.7** | `ls12.py` constants; `material_profiles.json` | c* = 5 ± 2, μ̄ = 0.37 (small bodies); c* = 1.9 ± 0.3, μ̄ = 0.36 (hydrodynamic planets); rubble c* = 5.5, μ̄ = 0.365. | The first two appeared in the text read; the **rubble values were not found** and are `unverified`. `silicate-rock` and `rubble-silicate` carry them with provenance entries; iron/ice/gas have none (so LS12 is unsupported for them). | Confirm the values, which class each applies to, and the rubble numbers. |
| **B1.8** | `ls12.py::C1..C5`, Genda et al. 2012 eq. 16 | v_cr/v_esc = c₁ΓΘ^c₅ + c₂Γ + c₃Θ^c₅ + c₄, Θ = 1 − sin θ, (c₁..c₅) = (2.43, −0.0408, 1.86, 1.08, 2.5). | Coefficients "transcribed" from part of the paper (by a sub-agent). **Calibrated for protoplanet collisions**; the engine uses it for any body size as an approximation. | Confirm the coefficients and whether use outside protoplanet scale is acceptable. |
| **B1.9** | `ls12.py::mutual_escape_speed`; registry `ESC-physical-radii` | Merge criterion v_i ≤ sqrt(2 G M_tot/(R_t + R_p)) with physical radii (G12 eq. 8); LS12's R_C1 form is also recorded. | Both speeds are stored in every record; which is used is an engineering choice. | Which radius definition should decide merge vs disruption? |
| **B1.10** | selector; D-041; `validity.py` | LS12 outcomes only for target radius ≥ 1e4 m (smallest LS12 target, as read by a sub-agent) and mass ratio inside the envelope; below it the labelled perfect-merge fallback. | `test_selector.py` covers the branches. The 1e4 m value is **unverified**. No strength-regime model exists (DQ-9: out of envelope). | Is 1e4 m the right limit? Should a strength-regime model (BA99/SL09, constants unverified) be added? |
| **B1.11** | DQ-7 / D-039 | Which c* class applies comes from the profile's `structureClass` set by the user or preset, never inferred from size. | Tested. No rule for transition or interpolation exists. | Is class-by-profile acceptable, and what are the right classes for named bodies? |

## B2. Outcome construction, geometry and conservation claims

| ID | Where | Claim | Evidence and limits | Question |
|---|---|---|---|---|
| **B2.1** | `applier.py::realise`; D-043; `conservation.py` | Every realised result conserves **mass (1e-14), linear momentum (1e-12) and, where the remnant has a moment of inertia, angular momentum (1e-10)**; energy is not created: dissipated + placement shift ≥ −1e-9·KE_com. | 1,008-point realiser grid + 48 engine points + 60 recorded events replayed (`test_invariants_grid.py`, `test_fragments.py`, `test_engine_outcomes.py`, `test_records_api.py`) all within tolerance, **including via the labelled fallbacks** (about 10–20 % of grid points need tier 2/3). Whole-universe conservation is also asserted through the service. **This shows the bookkeeping closes, not that the outcome is physical.** | Are these tolerances adequate and the energy test (a floor, with a "placement artefact" credit) an acceptable criterion? |
| **B2.2** | `conservation.py` | Energy: translational + rotational + point-mass mutual potential + uniform-sphere self-gravity (−3/5 G m²/R), with parcels given zero self-gravity; `dissipated` is the remainder. | Self-gravity is an approximation; the parcel exclusion was needed to avoid inventing energy. A "placement shift" credits the potential energy of keeping products apart. | Is this energy partition defensible? Should the placement shift exist? |
| **B2.3** | `applier.py` hit-and-run branch; registry `LS12-hit-and-run-minimal` | Hit-and-run: the normal relative velocity is removed (inelastic), the pair is separated by a factor κ ≥ 1+ε and the tangential speed divided by κ (angular momentum exact); target keeps min(M_t, M_lr), **projectile unchanged**. | Conserves exactly by construction; not compared to any published hit-and-run result. LS12 eqs. 46–54 (projectile erosion) were **not read**. The hit-and-run debris is still **one** parcel (Stage 4a placeholder). | Is this minimal hit-and-run acceptable, and what should the projectile and its debris do? |
| **B2.4** | `applier.py`; D-043 | **DQ-13:** a remnant cannot spin faster than break-up sqrt(G M/R³); with debris present the excess angular momentum is attributed to the untracked debris (booked in the spin ledger, reported `unmodelled`); a single remnant keeps a supercritical spin with a warning. | Tests assert the ledger closes. Moment of inertia factor 0.4 (homogeneous) is the only value in the shipped profiles. | Is the cap and the "carried by the debris" bookkeeping acceptable? |
| **B2.5** | `applier.py`; `fragments.py`; D-049 | **Momentum and centre of mass are closed by one uniform shift of all bodies**, not on the largest remnant alone (the plan's wording), because a very light remnant would otherwise get an unbounded velocity (found by the engine grid). The shift is reported. | Exact to round-off; the shift is bounded by the escape speed or the result is rejected. A deliberate deviation from plan 3.9. | Accept the deviation, or require the remnant closure? |
| **B2.6** | `fragments.py` | Products are placed on a ring in the collision plane around the remnant, with outward velocities, at the smallest radius that leaves every pair non-overlapping with clearance and **unbound at the start**. | Tests prove no overlap, unbound pairs, closure. The geometry (C13/CS22 style) is an approximation; it does not use the target's rotation (ω × r) or the surface-local geometry. | Is the ring geometry an acceptable initial condition? |
| **B2.7** | `engine.py`; D-051 | The contact time and state use a **straight-line rewind** by τ from the detection time; error ≤ a_rel τ²/2, within the curvature budget when the chunk criterion held. | Tests (`test_geometry.py`, deferred equivalence); labelled `approximation`. | Is the straight-line rewind adequate at the speeds and scales supported? |
| **B2.8** | `lifecycle.py`; D-051 | Classification of fragments/parcels (`bound_to_remnant`, `orbiting_system`, `escaping`) from two-body specific energies; the Hill radius of the remnant about a heavier dominant body bounds "bound to remnant". | Textbook arithmetic, tested against analytic cases (energy sign, circular apocentre, frame independence). The Hill criterion is an **engineering** choice. | Is the Hill-radius boundary appropriate? |
| **B2.9** | `simulation.py::_remove_escaped`; D-051 | An escaping product farther than **1000 × the system extent** is removed to a ledger (mass, momentum, angular momentum), conserved in the totals; **no event is emitted and the energy leaving is not tracked**. | Tested to 1e-15 (mass). The factor 1000 and the "extent" definition are engineering. | Acceptable removal rule? Should energy be ledgered? |

## B3. Provisional engineering parameters (no source)

All are in `provisional.py` with status `engineering` (or `unverified`). **None has a source.** For each the question is the same: *keep, replace with a sourced value, or remove?*

| ID | Parameter | Value | Where | Effect |
|---|---|---|---|---|
| B3.1 | `DQ6-ejection-factor` | ejection speed = f × mutual escape speed, f ∈ [1.05, 1.10] | `fragments.py` | Speeds of every fragment/parcel. Sources (C13, CS22) call 1.1 "somewhat arbitrary", "likely an underestimate"; secondary text only; calibrated for protoplanet scale. (D-048 says: **not a universal constant**.) |
| B3.2 | `FRAG-tracked-share` | tracked fragments hold ≤ 50 % of the debris mass | `fragments.py` | Tracked/untracked split. |
| B3.3 | `LS12-beta` | β = 2.85, cumulative N(>D) ∝ D^−β, N(>m) ∝ m^(−β/3) | `ls12.py`, `fragments.py` | Fragment mass ranks m_k ∝ (k − u)^(−1/q). **Unverified** value; the order-statistic realisation is my construction, not LS12's. |
| B3.4 | `FRAG-parcel-dmin` | untracked population diameter range [1e-3, 1] × upper cut | `applier.py` | Only a numerical truncation of the parcel descriptor. |
| B3.5 | `ENV-0.5-threshold` | gas mass fraction ≥ 0.5 = envelope-dominated (D-040) | `models/envelope.py` | Routes to `envelope_deposition` / `envelope_merge_approximation`. Not a physical law. |
| B3.6 | `DMG-falloff-exponent`, `PROP-regularisation` | exponent 1; 0.05 rad | `damage.py` | Qualitative damage proxy; geometric spreading regularisation (visual/approximate). |
| B3.7 | removal factor, Hill criterion, step caps | 1000; Hill; 64 resolutions, 200 bodies, 16/64 fragments, 4/32 parcels, reserve 8 | `config.py` | Budgets and rules, not physics. |

## B4. Material properties and sources

| ID | Where | Claim | Evidence and limits | Question |
|---|---|---|---|---|
| **B4.1** | `backend/impact/material_profiles.json`, `materials.py` | Five registry profiles (`silicate-rock`, `rubble-silicate`, `iron`, `water-ice`, `gas-envelope-hhe`): category, structure class, layers, appearance, **moment of inertia factor 0.4** (homogeneous; absent for gas), LS12 c*/μ̄ for two of them, with a provenance entry for every number. A number without a source is absent and listed in `incomplete`. | The validator enforces provenance; tests check it (`test_materials.py`). **Nobody has verified the cited sources**; densities and layer data were written for the engine's own scenarios. Every profile lacks `waveSpeedMPerS`, cratering constants and layer densities. | For each profile and each cited value: is the source correct, is the value as stated, does it apply to the bodies it will be used for? |
| **B4.2** | same | Moment-of-inertia factor 0.4 for a "homogeneous sphere". | Used for spin angular momentum of remnants. Real planets differ (differentiated bodies); the profiles are generic. | Is 0.4 acceptable for the generic profiles, and what should named bodies use? |
| **B4.3** | `backend/presets/data/*.json`, `context/STAGE11_SOURCE_INVENTORY.md` (D-058) | **Preset bodies have no material.** Only GM and radius (with basis) exist; a mean density can be *computed* from them. No composition, structure class, moment of inertia, c*, wave speed or cratering constants exist for any named body in the repository. | **Insufficient evidence by construction**: every such value must be newly sourced and cited. The inventory lists what is missing. | Name the reviewer; supply cited values per body (composition/layers, structure class, moment of inertia with uncertainty, applicable LS12 parameters if any). |
| **B4.4** | D-058 | Safeguards: no invented values; incomplete = unsupported; validation bit-identical; CP-SCI-1 unsigned. | Not yet exercised (Stage 11 not started). | Confirm the safeguards as the acceptance rule. |

## B5. Wave speeds and surface damage

| ID | Where | Claim | Evidence and limits | Question |
|---|---|---|---|---|
| **B5.1** | D-050; `damage.py::propagation_support`; `GET /materials` `propagation` map | **No shipped profile has a wave speed**, so every profile takes the **static fallback**; a profile propagates only if it has a finite positive speed with a `measured`/`literature` provenance entry matching the number. | Tested for supported (synthetic test profile, labelled "NOT a measurement"), static, invalid, engineering-only, mismatched provenance. **No real wave speed exists in the repository.** | For each profile: is there an applicable, citable effective surface/regional wave speed (units, assumptions, applicability)? Is a body-wide speed meaningful for a layered planet? |
| **B5.2** | `damage.py` (propagation) | Front angle D = c (t − t₀)/R; antipode at t₀ + πR/c; relative geometric spreading factor √(sin_reg(D_ref)/sin_reg(D)); no attenuation; never a shock. | Tested analytically only for the synthetic profile. Plan cites Schultz & Gault 1975, Meschede et al. 2011: **not read**. | Is this reduced-order model acceptable, and is the sin-regularisation (0.05 rad) justified? |
| **B5.3** | `damage.py::build_sites` | A site records the body-local contact direction, the contact time and the pair energy; **crater radius and depth are 0 and flagged unmodelled**; the ejecta cone is the whole hemisphere; the footprint is the other body's radius. | Tested; honest about the absence of a crater model. | Is a site without a crater size acceptable for the "localized damage" requirement? |

## B6. Cratering and ejecta

| ID | Where | Claim | Evidence | Question |
|---|---|---|---|---|
| **B6.1** | D-048 (2); `models/cratering.py`; registry `HH11-cratering-form` | **Cratering is Unsupported for every profile**: HH11 equations and Table 3 constants are unverified and not in the repository. Low-mass-ratio impacts therefore use the labelled fallback. | `test_cratering.py` structure only; no shipped profile has constants. | Provide the exact HH11 equations, constants and regime if cratering is to be supported; otherwise confirm it stays unsupported. |

## B7. Visual behaviour (not physics, but needs judgement)

| ID | Claim | Evidence and limits | Question |
|---|---|---|---|
| **B7.1** | The flash (0.8 s wall clock, intensity = dissipated fraction of COM kinetic energy, clamped) and the cloud (radius = largest parcel radius, speed = mean parcel speed relative to the COM) have **no physical meaning** except the quantities taken from the result (D-055, notes 4.12). | Unit tests; browser check of the flash rules (D-057). The renderer's appearance quality was only looked at in two screenshots. | Are the labels ("visual · debris is statistical, the flash has no physical meaning") sufficient to prevent misreading as hydrodynamics? |
| **B7.2** | Debris samples are massless, deterministic per parcel id, drawn inside a parcel's sphere (D-056). | Unit-tested; only their *count* was read in the browser. | Is drawing statistical samples in the parcel's sphere an acceptable representation? |
| **B7.3** | Surface marks and orientation: the body-local direction follows the orientation in the renderer frame (x, y, z) → (x, z, −y). | Math tested to 1e-12; browser check with two orientations, evidence screenshots in `context/evidence/stage9-webgl/`; two real defects were found and fixed. **Not run on a GPU, in a headed browser or another browser.** | Please look at the screenshots and, ideally, run `frontend/e2e/collision-effects.spec.ts` on a GPU browser (see HANDOFF.md for the command). |

---

# PART A — SOFTWARE CORRECTNESS (tests are the evidence; inspection welcome)

| ID | Topic | Claim | Evidence | Limits / known gaps | Question |
|---|---|---|---|---|---|
| **A1** | Legacy path exactness | `legacy-merge` is byte-identical to the pre-engine behaviour; a pair with a body without a material resolves with the exact legacy merge (DQ-2). D-035: a legacy defect was found and **deliberately preserved** (do not fix). | Golden values from the legacy build in `test_deferred_equivalence.py` (bit-for-bit), 7 scenarios identical in both modes (`test_engine_outcomes.py`); 566/567 pre-existing tests pass on the new path. | The preserved defect: when one detection pass holds three or more contacts the legacy resolver's callback indices refer to particles shifted by the first removal, so it can merge bodies that do not touch (D-035, `test_legacy_resolver_merges_bodies_that_do_not_touch_in_a_ring_of_six`). The new mode resolves contacts in (estimated contact time, ids) order, so a simultaneous symmetric contact may merge a mirror-image pair first. | Confirm that preserving the defect is right. |
| **A2** | Default switch | New sandboxes and `uni-default` are `outcome-v1`; presets and Orbit Lab stay `legacy-merge` (D-045). | `test_mode_defaults.py`. | The science behind the new default is provisional. | Confirm. |
| **A3** | Transactional steps | Nothing is resolved inside the REBOUND callback; results are validated before any change; a failure rolls the whole step back with the event number given back. | Rollback tests (`test_engine_outcomes.py`, `test_damage.py`, `test_lifecycle.py`). | — | — |
| **A4** | Determinism and replay | Replay recomputes an event from its record and compares digests (`POST …/collisions/{id}/replay`); 60 events (fallbacks, cascade- and budget-limited included) reproduce; restore-then-step is bitwise (numbers). | `test_records_api.py`, `test_persistence.py`. | **Same platform only**; cross-platform tolerance 1e-12 (plan 9.5) is **not implemented**. The content-addressed seed includes the **random body ids**, so two fresh universes with the same universe seed differ; ids are never reused, so a re-run names products differently. | Is same-platform replay acceptable, or is the cross-platform tolerance required before CP-5? |
| **A5** | REBOUND workaround | `Simulation.add(name=…)` corrupts names after interleaved remove/add (REBOUND 5.2.2); fixed with a name setter (`add_named_particle`) (D-044). | Plain-REBOUND reproduction and 20,000-operation fuzz (`test_rebound_names.py`). | Upstream defect not reported. | — |
| **A6** | Step budget | At `maxResolutionsPerStep` (64) the step ends early (`advancedS < dtS`, `collision_budget_reached`); the check runs after a detection pass so reported contacts are always resolved (DQ-10 a). | `test_lifecycle.py`. | The count can exceed the budget by one pass; clients must use `advancedS`. | — |
| **A7** | Integrator choice | Systems with debris bodies use IAS15 PRS23 instead of GLOBAL (GLOBAL collapsed erratically: 1.4–115 s vs 1.1–1.7 s over 12 runs) (D-051). | Timing study in `WORKLOG.md`; regression test. | Not a theory-backed choice; the earlier D-030 caveats (PRS23 stalls on exact cancellation symmetries) apply. | Acceptable numerically? |
| **A8** | State paths and isolation | Materials, rotations, products, sites, records, escaped ledger travel through checkpoint, rollback, snapshot, restore, reset and derive; universes share nothing; `CollisionState` (schemaVersion 1) round-trips losslessly; **no persistence** (OD-5, D-054). | `test_state_paths_stage2.py`, `test_persistence.py`, `test_isolation.py`. | A restart clears everything, records and replay included. | — |
| **A9** | API contract | Additive routes (`/materials`, `/universes/{id}/collisions[...]`, `/replay`, `/visual`, `/bodies/{id}/surface`); diagnostics stay `version: 1` with optional additive keys (spin term, `escaped`) — a deliberate deviation from the plan's "diagnostics v2" (D-042) because the frontend parser rejects other versions. | API and parser tests (backend and vitest). | The plan's v2 was not adopted. | Accept the deviation? |
| **A10** | Frontend logic | Pause/seek/flash rules, LOD caps (8 events, 20,000 samples), deterministic samples, orientation conversion, inspector text from API fields only. | 502 vitest tests incl. hook tests; 14 Playwright tests (headless software WebGL, stubbed API). | Not verified: GPU/other browsers, time scale, overlapping events, caps and frame pacing with effects, the real backend end to end. | — |
| **A11** | Performance | Stage-1 latency check passed (flaky once at N = 50, then made robust). | `test_performance_stage1.py`. | The Stage 12 performance criteria (step latency ±10 % at N = 50/100/200, a catastrophic event ≤ 0.5 s, frame pacing with 8 effects/20,000 particles) are **not measured**. | — |

---

# PART C — FINAL DEFINITION-OF-DONE (spec section 17) AND REMAINING ACCEPTANCE

Status per bullet of `context/specs/COLLISION_PARTICLE_ENGINE_SPEC.md` section 17. **None is signed.**

| Spec section 17 bullet | Status | Evidence / gap |
|---|---|---|
| All ten features addressed | PARTIAL | Features 1–9 have implementations at the stated fidelity; localized damage lacks crater size and any real propagation (B5, B6). |
| All initial requirements have implementation evidence | **NOT YET** | Traceability matrix (293 rows; counts from the status column, approximate): ~94 VERIFIED, ~94 PART, ~44 MISS, ~11 SUP. The MISS rows are listed below. |
| Required acceptance scenarios pass or have approved limitations | **NOT DONE** | Scenarios A–H (plan section 7) are Stage 12; only parts exist (Scenario E structural; D backend; A partly via the south-pole fixture). |
| Outcomes driven by the selected physical models | PARTIAL | By *provisional* models (Part B). |
| Localized impacts within the supported damage approximation | PARTIAL | Sites exist; crater and propagation unsupported or static. |
| Coherent fragment/debris trajectories and lifecycle | PARTIAL | Implemented and conserving; physical correctness unvalidated (B2). |
| Mass and momentum accounting available and validated within tolerances | **Software: yes; scientific: no** | Part A/B2.1. |
| Rendering follows the authoritative physical event | PARTIAL | Logic tested; limited browser check (B7, A10). |
| Controls and isolation correct | Software: yes | A8. |
| Performance limits and fallback explicit | PARTIAL | Budgets and fallbacks explicit; Stage 12 measurements missing (A11). |
| Persistence compatible or safely migrated | Yes for in-memory (by decision) | A8; no disk persistence. |
| Existing regression tests pass, baseline failures distinguished | Yes (full runs green) | The Stage 12 report must separate baseline from new failures. |
| Future hydrodynamics can be integrated | Not evaluated | No adapter exists; hydrodynamics is out of scope by decision. |
| Documented model assumptions and reproducible validation scenarios | PARTIAL | Assumptions documented (this package, notes, decisions); validation scenarios (A–H) pending. |

**Open traceability rows marked MISS** (as of this package; from `COLLISION_REQUIREMENT_TRACEABILITY.md`): V-2, V-4, V-5, V-7, P-3, P-4, S1-4, S1-5, S1-6, S1-7, S1-8, S1-11, F1-ID-2, F1-ID-3, M-PROP-4 (EOS), M-PROP-5 (thermal), M-INT-3, M-INT-7, M-INT-8, M-INT-DOC, F2-AC-1, L-OBJ, L-SP-7, O-CONS-2/3/4, O-CONS-NODOUBLE, F4-AC-2/3, R-OBJ, V-EVT-SEQ-1..8, V-TRAJ-NO-1..5, V-TRAJ-INTERP, NF-POLICY, RP-2, HX-NOSPH, F10-AC-3, CT-VIS-1..6, CT-VIS-NORECON, CT-FRAG, OD33-REVIEW. **Several are probably satisfiable by existing code and tests but were never re-audited**: the Stage 12 DoD audit must update the status column with test names. Do not read the MISS list as "unimplemented"; read it as "not yet shown against the matrix".

---

# EVIDENCE GAPS AND DOCUMENT DISCREPANCIES (the repository does not support a claim)

1. **No primary source has been read in full by an implementer** (B1): every LS12/Genda relation is "transcribed" from partial model-assisted reads. UD-1 and UD-2 are unresolved.
2. **LS12 eqs. 44, β, rubble c*/μ̄, the 1.8 transition variable, the 1e4 m validity limit** are unverified (B1.5–B1.10).
3. **No wave speed, cratering constant, layer density or thermal/EOS value exists** for any profile (B4.1, B5, B6).
4. **No material property of any named body exists** in the repository (B4.3).
5. **Cross-platform replay tolerance** is specified but not implemented (A4); no cross-platform run has been made.
6. **Stage 12 criteria are unmeasured** (A11); scenarios A–H are not written; the DoD audit is not done (Part C).
7. **Renderer** has been run only in headless software-WebGL Chromium with a stubbed API (A10).
8. **Documentation discrepancies found while preparing this package (not fixed, because this task forbids changes other than the package and the handoff pointer):**
   * `COLLISION_SCIENTIFIC_MODELS.md` header still says "Status: PLANNING. Nothing here is implemented." (stale; implementation notes 4.7a, 4.8a, 4.10a, 4.12 were appended below it).
   * `COLLISION_RISK_REGISTER.md` R-22 ("Browser E2E not runnable locally") is superseded by D-057 (the browsers exist; the Playwright revision differs; `PW_CHROMIUM_PATH` was added).
   * Plan 3.11: "oldest summaries kept, detail dropped with `detailDropped`"; implemented as dropped whole (the flag exists and is always false) (D-052).
   * Plan Stage 8 file list omits `visual.py` while the guide, plan 3.12 and the Stage 9 prerequisite require it (D-055).
   * Plan 3.9 closes momentum on the largest remnant; implemented as a uniform shift (B2.5, D-049).
   * Plan "diagnostics v2" vs implemented `version: 1` + optional keys (D-042).
   * Traceability counts above are from a text count of the status column, not an audited figure.

---

# CONSOLIDATED QUESTIONS FOR VAIBHAV

Tick-boxes are deliberately **unchecked**. Each is a question, not an approval.

**Scientific (CP-SCI-1):**
- [ ] B1.1 / B1.2: reproduce UD-1 (5.3 J/kg) and UD-2 (0.66) from the printed LS12; state the definitions that reconcile them, or the corrected relations.
- [ ] B1.3–B1.7: confirm eqs. 4, 5, 6, 7, 11, 12, 15, 23, 28, 44 and the c*/μ̄ values (including rubble) against the printed paper; say which are wrong.
- [ ] B1.8–B1.9: confirm Genda et al. 2012 eq. 16 coefficients and the choice of the merge criterion; accept or reject use outside protoplanet scale.
- [ ] B1.10–B1.11: confirm the 1e4 m limit and the class-by-profile rule; decide on a strength-regime model.
- [ ] B2.3–B2.4: accept or replace the minimal hit-and-run and the break-up spin cap.
- [ ] B3.1–B3.7: for each provisional engineering parameter: keep, source, or remove.
- [ ] B4.1–B4.3: verify each cited material source and its applicability; supply per-body values for Stage 11.
- [ ] B5.1–B5.3, B6.1: supply sourced wave speeds and HH11 constants, or confirm static/unsupported.

**Software and process (Part A):**
- [ ] A1: confirm the preserved legacy defect (D-035).
- [ ] A4: is same-platform replay enough?
- [ ] A9: accept `version: 1` diagnostics with optional keys?
- [ ] A7: acceptable numerics for the PRS23 choice with debris?

**Definition of Done (CP-5, after Stage 12):**
- [ ] Review Scenarios A–H, performance measurements and the updated traceability matrix.
- [ ] Decide which MISS rows are owner-approved limitations.

**Process:**
- [ ] Confirm you will act as the named human reviewer for Stage 11, CP-SCI-1 and CP-5, or name someone else (record it in `TASKS.md`).

## Sign-off record — intentionally blank

| Gate | Reviewer (name) | Date | Decision | Notes |
|---|---|---|---|---|
| CP-SCI-1 | *not named* | — | **NOT SIGNED** | — |
| Stage 11 prerequisite | *not named* | — | **NOT SATISFIED** | — |
| CP-5 | *not named* | — | **NOT SIGNED** | — |

## Appendix — where to look

| Topic | File |
|---|---|
| Specification | `context/specs/COLLISION_PARTICLE_ENGINE_SPEC.md` (section 17 = DoD) |
| Plan and stages | `context/COLLISION_ENGINE_PLAN.md`, `COLLISION_SONNET_EXECUTION_GUIDE.md` |
| Model notes and references | `context/COLLISION_SCIENTIFIC_MODELS.md` (sections 2–4, 4.7a, 4.8a, 4.10a, 4.12) |
| Decisions | `context/DECISIONS.md`: D-033…D-058 |
| Risks and open decisions | `context/COLLISION_RISK_REGISTER.md` |
| Traceability | `context/COLLISION_REQUIREMENT_TRACEABILITY.md` |
| Provisional registry | `backend/impact/models/provisional.py` |
| Stage 11 inventory | `context/STAGE11_SOURCE_INVENTORY.md` |
| Browser evidence | `context/evidence/stage9-webgl/`, `frontend/e2e/collision-effects.spec.ts` |
| Key tests | `tests/impact/` (`test_ls12.py`, `test_selector.py`, `test_invariants_grid.py`, `test_fragments.py`, `test_lifecycle.py`, `test_damage.py`, `test_records_api.py`, `test_persistence.py`, `test_isolation.py`, `test_deferred_equivalence.py`), `tests/validation/` |
