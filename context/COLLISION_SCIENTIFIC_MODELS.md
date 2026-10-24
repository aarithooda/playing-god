# Collision Engine — Scientific Models, References and Validity

**Status:** PLANNING. Nothing here is implemented. Companion of `COLLISION_ENGINE_PLAN.md` (architecture/stages), `COLLISION_REQUIREMENT_TRACEABILITY.md`, `COLLISION_RISK_REGISTER.md`, `COLLISION_SONNET_EXECUTION_GUIDE.md`.
**Rule for the implementer:** equations below are written as understood during planning. Items marked **[VERIFY]** were *not* confirmed verbatim against the primary source in this session and **must** be transcribed from the printed paper (equation number + page) and independently re-derived at checkpoint **CP-SCI-1** before any constant is coded. Never replace a missing value with a guess; mark the profile/model `incomplete` instead.

---

## 1. Classification of quantities (§12.4 fidelity labels)
| Label | Meaning | Examples in this engine |
|---|---|---|
| `computed` | directly from simulation state | masses, positions, velocities, contact geometry, impact speed/angle, Q_R, residuals, two-body energies, Hill radii |
| `model` | output of a published law inside its calibration envelope | LS12 regime, M_lr, Q'*_RD; Genda v_cr; Housen–Holsapple crater size/ejecta |
| `approximation` | engineering choice or bounded extrapolation | straight-line rewind; resolution at detection time; hit-and-run separation; layered stripping; fragment cone/ring geometry; ejection speed multiple; reduced-order propagation; self-gravity energy of uniform spheres; envelope deposition |
| `statistical` | population representation | debris parcels, size–frequency distribution, visual particle samples |
| `visual` | no physical meaning | flash, glow, shock indicator |
| `unsupported` | outside every envelope; fallback used | gas giant + gas giant, strength regime (if DQ-9 = out), material missing |

---

## 2. References (bibliographic details and verification status in this session)
"Verified" = title/venue/DOI or arXiv id seen in a search result or fetched page in this session. "Known, unverified" = from the planner's bibliographic knowledge; confirm before citing in code or docs.

| Key | Reference | Identifier | Status |
|---|---|---|---|
| LS12 | Leinhardt, Z. M. & Stewart, S. T. (2012). Collisions between gravity-dominated bodies. I. Outcome regimes and scaling laws. *ApJ* 745, 79. | arXiv:1106.6084; DOI 10.1088/0004-637X/745/1/79 | arXiv full text partly read (ar5iv); abstract values c* = 5 ± 2 (small bodies), 1.9 ± 0.3 (strengthless planets) verified; DOI known, unverified |
| SL12 | Stewart, S. T. & Leinhardt, Z. M. (2012). Collisions between gravity-dominated bodies. II. The diversity of impact outcomes during the end stage of planet formation. *ApJ* 751, 32. | DOI 10.1088/0004-637X/751/1/32 | venue/volume verified via citing text; DOI known, unverified |
| G12 | Genda, H., Kokubo, E. & Ida, S. (2012). Merging criteria for giant impacts of protoplanets. *ApJ* 744, 137. | arXiv:1109.4330; iopscience 0004-637X/744/2/137 | verified (search); coefficients **not** verified |
| C13 | Chambers, J. E. (2013). Late-stage planetary accretion including hit-and-run collisions and fragmentation. *Icarus* 224, 43–56. | DOI 10.1016/j.icarus.2013.02.015 | verified (search) |
| CS22 | Childs, A. C. & Steffen, J. H. (2022). Collisional fragmentation and bulk composition tracking in REBOUND. | arXiv:2201.05714 (MNRAS-formatted preprint) | preprint verified (Sections 1–3.2 read); journal volume/DOI unverified |
| HH11 | Housen, K. R. & Holsapple, K. A. (2011). Ejecta from impact craters. *Icarus* 211, 856–875. | DOI 10.1016/j.icarus.2010.09.017 | verified (citations in search results) |
| H93 | Holsapple, K. A. (1993). The scaling of impact processes in planetary sciences. *Annu. Rev. Earth Planet. Sci.* 21, 333–373. | DOI 10.1146/annurev.ea.21.050193.002001 | known, unverified |
| BA99 | Benz, W. & Asphaug, E. (1999). Catastrophic disruptions revisited. *Icarus* 142, 5–20. | DOI 10.1006/icar.1999.6204 | known, unverified |
| SL09 | Stewart, S. T. & Leinhardt, Z. M. (2009). Velocity-dependent catastrophic disruption criteria for planetesimals. *ApJ* 691, L133. | DOI 10.1088/0004-637X/691/2/L133 | known, unverified |
| A06 | Asphaug, E., Agnor, C. B. & Williams, Q. (2006). Hit-and-run planetary collisions. *Nature* 439, 155–160. | DOI 10.1038/nature04311 | known, unverified |
| A10 | Asphaug, E. (2010). Similar-sized collisions and the diversity of planets. *Chemie der Erde* 70, 199–219. | DOI 10.1016/j.chemer.2010.01.004 | known, unverified (cited by CS22) |
| M10 | Marcus, R. A., Sasselov, D., Stewart, S. T. & Hernquist, L. (2010). Water/icy super-Earths: giant impacts and maximum water content. *ApJL* 719, L45; and Marcus et al. (2009) Collisional stripping and disruption of super-Earths, *ApJL* 700, L118 (DOI 10.1088/0004-637X/700/2/L118) | — | known, unverified (core/mantle stripping fits) |
| C15 | Carter, P. J., Leinhardt, Z. M., Elliott, T., Walter, M. J. & Stewart, S. T. (2015). Compositional evolution during rocky protoplanet accretion. *ApJ* 813, 72. | arXiv:1509.07504 | arXiv id seen in search; details unverified (uses EDACM, composition) |
| L15 | Leinhardt, Z. M. et al. (2015). Numerically predicted indirect signatures of terrestrial planet formation. *ApJ* 806, 23. | arXiv:1506.05233 | arXiv id seen; describes EDACM as an empirically derived analytic collision model built on LS12 |
| E20 | Emsenhuber, A., Cambioni, S., Asphaug, E., Gabriel, T. S. J., Schwartz, S. R. & Furfaro, R. (2020). Realistic on-the-fly outcomes of planetary collisions II: Bringing machine learning to N-body simulations. *ApJ* 891, 6. | arXiv:2001.09542 | arXiv id seen ("collisions between rotating, differentiated planets"); journal details unverified |
| G20 | Gabriel, T. S. J. et al. (2020). Gravity-dominated collisions: A model for the largest remnant masses with treatment for hit and run and erosive collisions. *ApJ* 892, 40. | DOI 10.3847/1538-4357/ab528d | known, unverified (alternative M_lr model) |
| K20 | Kegerreis, J. A. et al. (2020). Atmospheric erosion by giant impacts onto terrestrial planets: a scaling law for any speed, angle, mass, and density. *ApJL* 901, L31. | DOI 10.3847/2041-8213/abb5fb; arXiv:2007.04321 | verified (repository listing). Note: a planner recollection "ApJL 897 L6" was wrong and is corrected here. |
| ZM94 | Zahnle, K. & Mac Low, M.-M. (1994). The collision of Jupiter and comet Shoemaker-Levy 9. *Icarus* 108, 1–17. | DOI 10.1006/icar.1994.1038 | known, unverified |
| CTZ93 | Chyba, C. F., Thomas, P. J. & Zahnle, K. J. (1993). The 1908 Tunguska explosion: atmospheric disruption of a stony asteroid. *Nature* 361, 40–44. | DOI 10.1038/361040a0 | known, unverified |
| SG75 | Schultz, P. H. & Gault, D. E. (1975). Seismic effects from major basin formations on the Moon and Mercury. *The Moon* 12, 159–177. | DOI 10.1007/BF00577875 | known, unverified |
| MMT11 | Meschede, M. A., Myhrvold, C. L. & Tromp, J. (2011). Antipodal focusing of seismic waves due to large meteorite impacts on Earth. *Geophys. J. Int.* 187, 529–537. | DOI 10.1111/j.1365-246X.2011.05170.x | known, unverified |
| M89 | Melosh, H. J. (1989). *Impact Cratering: A Geologic Process.* Oxford University Press. | ISBN 0-19-504284-0 | known, unverified |
| CMM05 | Collins, G. S., Melosh, H. J. & Marcus, R. A. (2005). Earth Impact Effects Program. *Meteoritics & Planetary Science* 40, 817–840. | DOI 10.1111/j.1945-5100.2005.tb00157.x | known, unverified |
| RS15 | Rein, H. & Spiegel, D. S. (2015). IAS15: a fast, adaptive, high-order integrator for gravitational dynamics. *MNRAS* 446, 1424–1437. | DOI 10.1093/mnras/stu2164 | known, unverified (already the integrator in use) |
| RL12 | Rein, H. & Liu, S.-F. (2012). REBOUND: an open-source multi-purpose N-body code for collisional dynamics. *A&A* 537, A128. | DOI 10.1051/0004-6361/201118085 | known, unverified |
| KG10 | Kokubo, E. & Genda, H. (2010). Formation of terrestrial planets from protoplanets under a realistic accretion condition. *ApJL* 714, L21. | DOI 10.1088/2041-8205/714/1/L21 | known, unverified |
| L19 | Liu, S.-F., Hori, Y., Müller, S., Zheng, X., Helled, R., Lin, D., Isella, A. (2019). The formation of Jupiter's diluted core by a giant impact. *Nature* 572, 355–357. | DOI 10.1038/s41586-019-1470-2 | known, unverified (evidence that gas-giant impacts are SPH case studies, not scaling laws) |

**EDACM.** Search results (L15 and citing papers) describe EDACM as the empirically derived analytic collision model of LS12 used in PKDGRAV, with regimes perfect merging, partial accretion, hit-and-run, partial erosion and erosive disruption, and an "unresolved debris" mass threshold whose debris is reaccreted semi-analytically. In this plan "EDACM-style" means: LS12/SL12 regime selection + universal largest-remnant law + LS12 fragment distribution + a resolution threshold below which debris is a statistical population.

---

## 3. Impact geometry and detection (computed / approximation)
- **Detection:** REBOUND `collision = "line"`: overlap test of the straight segments swept by each pair during one internal IAS15 step (D-008 evidence: 0 misses in 144 swept scenarios; `direct` misses fast impacts). Reliability condition: path curvature within a step ≤ 1 % of the contact distance (`simulation.py::_chunk_limit`). **Validation:** existing spike sweeps + stage-1 fast-impact and grazing fixtures.
- **Contact time and state:** `τ = (r·u + sqrt((r·u)² − |u|²(|r|² − R²)))/|u|²` (existing `contact_time_estimate`, exact for straight lines). Position error of the rewind on a curved path ≈ a_rel τ²/2 ≤ the curvature bound. Velocities are taken at detection (error a_rel τ). **Label:** approximation, bound recorded per event.
- **Impact angle:** θ between the line of centres at contact and the relative velocity; `b = sin θ` (LS12 convention). **Contact point:** target centre + R_t n̂. **Body-local site:** inverse rotation of n̂ by the target's orientation at t_c (`rotation.py`).
- **Escape speeds:** physical `v_esc = sqrt(2 G M_tot / (R_t + R_p))` (CS22 eq. 3 form) and LS12's `V_esc = sqrt(2 G M_tot / R_C1)` with `R_C1 = (3 M_tot / (4 π ρ1))^(1/3)`, ρ1 = 1000 kg m⁻³ (ρ1 verified verbatim; the R_C1 expression follows from the verbatim definition "spherical radius of the combined masses at density ρ1"). Both recorded, labelled.

## 4. Outcome models

### 4.1 Perfect merge (existing; `perfect_merge`) — `model` for v ≤ v_esc inside LS12, otherwise `approximation`
Existing production arithmetic (`backend/collisions.py`): mass and momentum conserved, COM state, volume-conserving radius (`(R_t³+R_p³)^(1/3)` — note: assumes equal densities; with materials the remnant radius is recomputed from the layer densities when known, else the legacy rule with label approximation), ΔK = ½ μ v² → dissipated, orbital L → remnant spin. **Inputs:** masses, radii, states. **Validity:** physically a merger for v_i ≤ v_esc (LS12/CS22 rule); as a legacy/fallback it is labelled. **Tests:** existing spike + stress tests (golden), conservation identities.

### 4.2 LS12 / SL12 regime model (`ls12`) — `model`
**Inputs:** M_t, M_p, R_t, R_p, v_i, b, material `structureClass` → (c*, μ̄); optional strength term (DQ-9).
**Equations** (numbering from LS12 as reported during planning; **[VERIFY]** all except where noted):
1. `Q_R = ½ μ v_i² / M_tot`, μ = M_p M_t / M_tot — **verbatim LS12 eq. (1)**.
2. `Q*_RD = ½ μ V*² / M_tot`, V* = impact speed that disperses half the total mass — **verbatim eq. (2)**.
3. Principal disruption curve `Q*_RD,γ=1 = c* (4/5) π ρ1 G R_C1²` — [VERIFY] eq. (28). **Open discrepancy:** LS12 §VI.3.2 (verbatim) gives Q*_RD,γ=1 = 5.3 J/kg and V* = 6.5 m/s for "two 1 km rock bodies with R_C1 ~ 2 km", c* = 5, μ̄ = 0.37; the formula above gives ≈ 3.35 J/kg for R_C1 = 2 km. Either the summarised formula or the reading of the example is wrong. **Must be resolved at CP-SCI-1 before coding.**
4. Mass-ratio correction `Q*_RD = Q*_RD,γ=1 [ (1/4)(γ+1)²/γ ]^(2/(3μ̄) − 1)` — [VERIFY] eq. (23).
5. Interacting mass for oblique impacts: `l = (R_t + R_p)(1 − b)`; `α = (3 R_p l² − l³)/(4 R_p³)` (α = 1 when l ≥ 2R_p); `μ_α = α M_p M_t / (α M_p + M_t)`; `Q'*_RD = (μ/μ_α)^(2 − 3μ̄/2) Q*_RD` — [VERIFY] eqs. (7), (11), (12), (15); planning summary was ambiguous about the exponent form.
6. Universal largest remnant: `M_lr / M_tot = −0.5 (Q_R / Q'*_RD − 1) + 0.5` — **verbatim eqs. (4)/(5)**; valid in the disruption regime up to `Q_R/Q'*_RD ≈ 1.8` (verbatim: super-catastrophic transition begins at Q_R/Q*_RD ≥ 1.8; deviations ~10 % near-normal, larger for highly oblique).
7. Super-catastrophic: `M_lr / M_tot = (0.1 / 1.8^η) (Q_R / Q'*_RD)^η`, η ≈ −1.5 — [VERIFY] eq. (44).
8. Grazing threshold `b_crit = R_t / (R_t + R_p)` — [VERIFY] eq. (6) (verbatim check value: b_crit = 0.66 for γ = 0.1 — consistent with equal densities: R_p/R_t = 0.1^(1/3) = 0.464 → b_crit = 1/1.464 = 0.683; **not** 0.66 exactly — another item for CP-SCI-1).
9. Erosion onset (M_lr = M_t) and hit-and-run reverse impact for the projectile (eqs. (46)–(54)) — [VERIFY]; LS12 (verbatim) notes "the escaping projectile is nearly always eroded in hit-and-run events".
10. Second largest remnant and fragment distribution: `n(D) dD = C D^−(β+1) dD`, β = 2.85; `M_slr / M_tot = (3 − β)(1 − N_lr M_lr/M_tot) / (N_slr β)` with N_lr = 1, N_slr = 2 — [VERIFY] eqs. (31), (37).
**Constants:** c* = 5 ± 2, μ̄ ≈ 0.37 (small bodies; verbatim); c* = 1.9 ± 0.3 (strengthless planets; verbatim), μ̄ for planets [VERIFY] (summary: 0.36). LS12 (verbatim) recommends testing sensitivity to c* up to ~20.
**Validity envelope (encode as data):** gravity-dominated bodies (strength regime explicitly not covered: "the strength regime will be the subject of future studies"); calibration velocities "0.001 to 5 km s⁻¹" for strong-rock data (verbatim; PKDGRAV runs lower [VERIFY]); mass ratios "1:1 to almost 1:45,000" (verbatim); spherical, non-rotating bodies ("we did not consider any pre-impact spin"); no tidal effects. Outside: `Unsupported` → fallback per selector.
**Outputs:** outcome class, M_lr, M_slr (hit-and-run), debris mass, β.
**Tests:** reproduce eq. (4) identities; continuity at 1.8; monotonicity; c* sensitivity; worked examples once CP-SCI-1 resolves them; reference values computed independently (`tests/impact/reference_values.py`, author ≠ implementer, per TEAM_WORKFLOW).

### 4.3 Graze-and-merge boundary (G12) — `model`
Critical velocity `v_cr / v_esc = c1 Γ (1 − b)^(5/2) + c2 Γ + c3 (1 − b)^(5/2) + c4`, Γ = (M_t − M_p)/(M_t + M_p). Planner's recollection of coefficients: c1 = 2.43, c2 = −0.0408, c3 = 1.86, c4 = 1.08 — **[VERIFY] not confirmed in this session**. Used by CS22 (eqs. 13–15). For `b ≥ b_crit`: `v_i ≤ v_cr` → graze-and-merge; else hit-and-run. **Validity:** G12 calibrated on protoplanet (Mars-size) collisions, independent of total mass per authors (search summary); applying it to small bodies is an approximation (label when M_tot outside the calibration). LS12 (verbatim) says graze-and-merge "is not explicitly defined in this work", hence G12.

### 4.4 Cratering (HH11, H93) — `model`
For a small impactor where `Q_R ≪ Q'*_RD` (selector threshold: M_p/M_t below a value where the LS12 eroded mass is < the crater ejecta mass from point-source scaling — computed, not assumed; a fixed fallback threshold is an engineering choice to be approved, DQ-7 note):
- Gravity-regime crater volume / radius from π-scaling: `R (ρ/m)^(1/3) = K1 [ (g a / U²) (ρ/δ)^((2ν)/μ) ]^(−μ/(2+μ))` — [VERIFY] HH11 eq. (form) and Table 3 constants (K1, μ, ν per target class: e.g. "sand", "glass beads", "basalt", "weakly cemented basalt", "sand/fly ash"); strength-regime form with Ȳ when appropriate.
- Ejecta velocity distribution: cumulative mass ejected faster than v: `M(>v)/m ∝ [ (v/U)(ρ/δ)^ν ]^(−3μ)` with near-rim cutoffs — [VERIFY] HH11.
- Escaping ejecta = M(> v_esc,target) (computed from the distribution) → debris parcels (`statistical`) and erosion of the target; bound ejecta → reaccreted parcel or a bound parcel with launch speeds < v_esc.
**Validity:** point-source assumption (impactor ≪ crater), target half-space (crater ≪ target radius; planetary curvature ignored — label when crater radius > 0.1 R_t), laboratory-calibrated constants extrapolated by similarity (standard practice, H93); oblique impacts: vertical-component scaling `U sin(elevation)` is a common approximation [VERIFY] (CMM05).
**Tests:** reproduce HH11 example values; scaling exponents (crater radius ∝ a^(…)) by dimensional checks; consistency: escaping mass ≤ projectile + target mass.

### 4.5 Envelope-dominated targets (`envelope`) — `approximation`
**Scenario B (rocky asteroid → gas giant).** A small projectile (M_p ≪ M_t) entering an H/He envelope is decelerated, ablated and fragmented in the atmosphere and its mass and energy are deposited at depth; this is the observed and modelled behaviour of comet Shoemaker-Levy 9 at Jupiter (ZM94) and of stony bolide breakup (CTZ93 "pancake" model). The engine models: projectile fully deposited (mass and momentum to the target; no solid crater; no bound ejecta), energy deposited as `dissipatedJ`, an entry site in body-local coordinates for visuals (plume, labelled visual + approximation), and **no** resolved gas dynamics (warning `envelope_dynamics_not_resolved`, §4.2/§14 B "does not claim fully resolved gas dynamics").
**Validity / limits:** projectile ≪ target and v_i ≲ a few × v_esc; **no** envelope stripping for small projectiles (K20's scaling covers *low-mass* atmospheres ~1 % of target mass on terrestrial planets, not envelope-dominated bodies, so it is not applied to gas giants; it is a candidate for rocky planets with a thin atmosphere layer — future, DQ-8 note).
**Gas giant + gas giant:** no validated reduced-order outcome law identified (published work = SPH case studies, e.g. L19). Proposed: `envelope_merge_approximation` (perfect merge, label `unsupported`, warning) — DQ-8.
**Tests:** structural (deposition conserves mass/momentum exactly; no fragments; label present); selector routes gas targets here and never to LS12 rigid-body regimes (§4.5 F2-AC-5).

### 4.6 Strength regime (BA99/SL09) — `model`, decision-gated (DQ-9)
`Q*_D = Q0 (R/1 cm)^a + B ρ (R/1 cm)^b` (cgs, per-target radius), constants per material and impact speed (basalt and ice at several speeds) — **[VERIFY] all constants**. Combined with LS12 per SL09. If DQ-9 = out of scope: bodies below a size threshold (from SL09's strength–gravity transition) get `Unsupported` → fallback, labelled.

### 4.7 Fragment generation (LS12 + C13/CS22 practice) — `model` (masses) + `approximation` (geometry)
- Debris mass `M_tot − M_lr (− M_slr)`; realised from the LS12 power law (β = 2.85 [VERIFY]) largest-first into tracked fragments above `m_track` (budget-limited); remainder into parcels with the truncated power law parameters (`statistical`).
- CS22 (verbatim): fragments of equal mass `M_r / N_frag`, "uniformly placed in a circle in the collision plane at an equal distance from the center of mass", initial speed "1.1 v_esc", called "likely an underestimate" and "somewhat arbitrary" (copied from C13). C13 uses a speed slightly above escape [VERIFY: 1.05 v_esc]. **The plan does not use equal-mass identical fragments** (§7.3 forbids identical fragments with uniformly random motion): masses follow the power law; directions: disruption → collision plane fan (C13/CS22 geometry) with deterministic jitter; cratering → ejecta cone about the local normal with HH11 speed distribution. Ejection speed multiple → DQ-6.
- Composition: layered stripping (outer layers removed first from the eroded body; projectile material in proportion to the interacting fraction) — approximation; M09/C15 show mantle stripping raises iron fraction (use as validation of direction, not as a fit).
- Rotation: fragment velocity includes `ω × r` of the source body at the source point; remnant spin from the angular-momentum budget (§9 of the plan).

### 4.8 Reduced-order damage propagation — `approximation`
Geodesic front from the impact site: arrival at angular distance Δ at `t = t_c + R Δ / c_eff`; amplitude `A(Δ) ∝ E^(1/2) · e^(−R Δ/L_att) / sqrt(sin Δ)` (regularised near Δ = 0 and π) — geometric spreading of surface waves on a sphere with antipodal focusing (SG75; MMT11 show antipodal focusing of seismic waves from large impacts). c_eff and L_att from the material profile (provenance required; if missing, propagation is disabled for that body and the site is static — documented fallback). **Never labelled a resolved shock.**

### 4.9 Remnant spin and angular momentum — `computed` budget + `approximation` moment of inertia
`S_remnant = L_before(about pair COM; orbital + spins) − Σ L_products(orbital about COM) − Σ S_other`; `ω = S / (k M R²)`. Critical spin `ω_crit = sqrt(G M / R³)`; super-critical result → warning (DQ-13); no mass shedding model in v1.

### 4.10 Bound/escape classification — `computed`
Two-body specific orbital energy relative to the remnant; apocentre vs Hill radius `r_H = a (m/(3M))^(1/3)` of the remnant about its dominant attractor; system-level energy relative to the barycentre of all bodies. Classification is dynamical, never by visual distance (§9.5).

---

## 5. Material profiles (initial set; every number needs provenance before use)
| Profile | Category / structure | Needs (by model) | Source plan |
|---|---|---|---|
| `silicate-rock` | rock / strong (small) or strengthless-planet (large) | c*, μ̄ (LS12), HH11 constants (basalt/competent rock), wave speed, k = 0.4 | LS12; HH11 Table 3; wave speed from a cited geophysics reference |
| `rubble-silicate` | rock / rubble | c*, μ̄ (LS12 PKDGRAV rubble fit: c* = 5.5, μ̄ = 0.365 verbatim), HH11 "sand"-like constants | LS12; HH11 |
| `iron` | metal / strong | density (CRC/handbook), c* (LS12 gives no iron-specific c* [VERIFY]) → use small-body range with label; HH11 has no iron target → cratering constants missing ⇒ cratering on iron targets `incomplete` (fallback) | handbook; record gaps |
| `water-ice` | ice / strong or rubble | density (Ice Ih ~917 kg m⁻³, handbook), BA99 ice constants (DQ-9), HH11 constants if available [VERIFY] | handbook; BA99 |
| `gas-envelope-hhe` | gas / envelope-dominated | none for LS12 (not applicable); appearance gas | — |
| `earth-like-differentiated` | mixed: iron core + silicate mantle (mass fractions from a cited Earth model, e.g. core ≈ 0.32–0.33 of mass [VERIFY]) | layer fractions, k (Earth ≈ 0.33 [VERIFY]), c* (strengthless planet) | geophysics reference |
| `icy-rock-differentiated` | mixed: rock core + ice mantle (Ganymede/Europa-like; fractions cited per body) | layers, k (Galilean-satellite gravity data [VERIFY]) | literature |
| `gas-giant-core-envelope` | mixed: core + H/He envelope (envelope mass fraction ≫ 0.5) | gas fraction | literature |
| `molten-silicate` | molten / strengthless | c* strengthless-planet value; appearance molten | LS12 (as approximation) |
Bulk density is **computed** from each body's mass and radius, not taken from the profile; layer densities (if given) are used only for composition/radius bookkeeping. A profile whose bulk density is inconsistent with the body by > a factor 3 produces a warning (not a rejection).

## 6. Selector thresholds and their basis
| Threshold | Basis | Status |
|---|---|---|
| v_i ≤ v_esc → merge | LS12 / CS22 | model |
| b ≥ b_crit grazing | LS12 eq. (6) [VERIFY] | model |
| v_cr (graze-and-merge) | G12 [VERIFY coefficients] | model |
| Q_R/Q'*_RD = 1.8 super-catastrophic | LS12 verbatim | model |
| envelope-dominated: gas mass fraction ≥ 0.5 | engineering choice ("dominated" = majority by mass) | decision (DQ-8) |
| cratering hand-off from LS12 | computed comparison of eroded masses + engineering floor | decision (DQ-7 note) |
| strength/gravity transition radius | SL09 / BA99 [VERIFY] | decision (DQ-9) |
| c* class (5 vs 1.9) | LS12 verbatim values; transition rule | decision (DQ-7) |
| tracked fragment mass threshold | engineering (budget) | decision (DQ-6) |
| ejection speed multiple of v_esc | C13 / CS22 practice ("somewhat arbitrary") | decision (DQ-6) |

## 6a. Mandatory scientific gate (owner, D-033) — part of CP-SCI-1
| ID | Paper value (LS12) | Planning calculation | What must be traced |
|---|---|---|---|
| UD-1 | Q*_RD,γ=1 = 5.3 J/kg (and V* = 6.5 m/s) for "two 1 km rock bodies", R_C1 ≈ 2 km, c* = 5, μ̄ = 0.37 (§VI.3.2, verbatim) | ≈ 3.35 J/kg from `c* (4/5) π ρ1 G R_C1²` with R_C1 = 2 km, ρ1 = 1000 kg m⁻³ | printed eq. (28) and its prefactor; whether "1 km" is radius or diameter; body density; the R_C1 actually used; units (J/kg vs erg/g) |
| UD-2 | b_crit = 0.66 for γ = 0.1 (§VI.3.1, verbatim) | 0.683 from `R_t/(R_t+R_p)` with equal densities | printed eq. (6); whether R_t, R_p or another radius definition is used; densities assumed in the example; rounding |
Procedure: (1) transcribe the printed equations and definitions with equation and page numbers; (2) reproduce both values independently (independent AI session) and record the full calculation in `WORKLOG.md`; (3) if they reproduce, record which planning assumption was wrong; if not, record the discrepancy and stop for an owner decision; (4) the named human reviewer signs off; (5) only then may LS12 code paths that depend on eq. (28), eq. (6) or derived thresholds be enabled. Gate tests assert the paper's printed values from traced inputs. Planner numbers are never used as expected values.

## 7. Unresolved scientific decisions (owner)
DQ-6 ejection speed prescription and tracked-fragment threshold; DQ-7 c* class transition; DQ-8 gas-giant handling and envelope threshold; DQ-9 strength regime; DQ-13 super-critical spin. CP-SCI-1 items: LS12 worked-example discrepancy (5.3 vs ≈3.35 J/kg); b_crit check value (0.66 vs 0.683); exponent form of Q'*_RD; G12 coefficients; BA99 constants; HH11 Table 3 transcription; μ̄ for planets; C13 ejection speed. **Alternative models kept as extension options:** G20 largest-remnant model (hit-and-run/erosive treatment), E20 machine-learning surrogate (rotating, differentiated bodies — would address spin and differentiation better than LS12), future hydrodynamics via the `OutcomeModel` adapter.

## 6b. Provisional decision on UD-1 / UD-2 (2026-10-24, D-038) — NOT resolved, NOT validated
Working assumptions (unchanged equations): eq. 28 `Q*_RD,gamma=1 = c* (4/5) pi rho_1 G R_C1^2`; eq. 6 `b_crit = R_t/(R_t + R_p)`. Transcription status (sub-agent read of the first ~37 % of arXiv:1106.6084; to be checked against the printed paper): eqs. 1, 2, 4, 5, 6, 7, 11, 12, 15, 23, 27, 28, 31-37 appear verbatim with the forms used here; eq. 15 exponent is `2 - 3 mubar/2`; hydrodynamic planets c* = 1.9 +/- 0.3, mubar = 0.36 +/- 0.01 (resolves that [VERIFY]); small bodies c* = 5 +/- 2, mubar = 0.37 +/- 0.01. NOT found in the portion read: the worked examples, eqs. 44-54, beta, a separate rubble fit (the c* = 5.5, mubar = 0.365 rubble values stay as recorded in section 5 and are still [VERIFY]). Open reviewer questions: which radii/densities the printed examples use; whether b_crit = 0.66 uses the projectile/target radius ratio from equal densities. Arithmetic observations are in D-038. All code that uses these relations is registered in `backend/impact/models/provisional.py`.
