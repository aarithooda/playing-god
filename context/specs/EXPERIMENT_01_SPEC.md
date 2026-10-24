# PLAYING GOD — Experiment 01 Product Specification

**Version:** Draft 0.3 (2026-10-24)
**Status:** The scientific question is confirmed by the owner. The experimental parameters were evaluated against evidence in the planning session (Appendix A) and are adopted as the first-release protocol under owner decision OD-3, subject to the owner's product review (OD-6).
**Product:** PLAYING GOD — Simulation Lab and Orbit Lab.

**Labels used in this revision**
- **[Owner decision OD-n]**: confirmed by the owner on 2026-10-24.
- **[Adopted on evidence]**: a parameter the owner asked to be evaluated (OD-3) and that the planning evidence (Appendix A) supports. It is the protocol for the first release. Changing it requires a recorded reason and re-running the validation.
- **[Technical default]**: an engineering choice in the implementation plan. It is not a product requirement.
- Unlabelled text is the owner-supplied Draft 0.2 wording, unchanged.

The Draft 0.2 wording that this revision replaced is reproduced in the "Revision record".

---

## 1. Purpose
Experiment 01 is the first structured scientific investigation in PLAYING GOD.

It demonstrates how changing a planet's initial velocity changes its subsequent gravitational trajectory. Users begin with a baseline system, create an independent modified run, change the planet's velocity, and compare the resulting motion.

The experiment must use actual backend gravitational simulation results. It must not rely on fabricated trajectories, frontend-only physics or predetermined visual outcomes.

## 2. Confirmed scientific question **[Owner decision OD-3: confirmed]**
**How does changing a planet's initial velocity affect its subsequent orbit?**

The experiment explores the relationship between initial conditions and gravitational motion.

Users should be able to observe how a controlled velocity change affects the planet's trajectory while the other initial conditions remain unchanged.

The experiment should make it possible to distinguish the effect of the velocity change from differences caused by inconsistent initial conditions, simulation timing or accidental state sharing.

## 3. Learning objectives
By completing the experiment, users should understand that:
- A planet's trajectory depends on its initial position and velocity, as well as the gravitational environment.
- Changing the initial velocity can change the shape and evolution of its trajectory.
- A meaningful comparison requires controlled initial conditions.
- Simulation results depend on the physical model and numerical integration.
- A visually plausible result is not, by itself, proof of scientific accuracy.

The experiment should encourage exploration and observation rather than present one outcome as universally applicable to every gravitational system.

## 4. Experimental design
### 4.1 Baseline run
The baseline is the reference simulation.

It must contain a documented initial state, including the bodies, masses, positions, velocities, reference epoch, coordinate frame, units and simulation configuration.

The baseline must remain unchanged by all modifications applied to the modified run.

**[Owner decision OD-4]** The baseline is an immutable experimental reference:
- its bodies and initial state cannot be edited;
- it can be advanced and reset to its documented initial state;
- it cannot be restored to an arbitrary snapshot.

### 4.2 Modified run
The modified run must begin from the same intended initial state as the baseline.

Exactly one experimental variable is changed initially: the selected planet's initial velocity.

All other initial conditions and simulation parameters must remain equivalent unless the protocol explicitly documents an unavoidable difference.

The system must record the original velocity, modified velocity, units, selected body and baseline from which the modified run was created.

**[Owner decision OD-4]** Uncontrolled modifications must be identifiable. Any later physical change to the modified run:
- is recorded in the run's provenance with what changed and at which simulation time (a physical change is adding, deleting or editing a body's mass, radius, position or velocity);
- marks the run as **uncontrolled**, a status shown wherever its comparison is shown.

Resetting the run to its derived initial state makes it controlled again. The audit record of the earlier change is kept.

**Unavoidable documented difference:** changing the Earth–Moon barycentre's velocity also changes the system's total momentum. As a result the barycentre of the modified run moves at about m/(M+m)·Δv relative to the baseline's: about 9 mm/s for ×1.10, about 0.6 km over the observation window. This is a direct physical consequence of the single intended change, not a second change. It is about 10⁻⁷ of the position differences the experiment shows.

### 4.3 Independent simulation state
The baseline and modified run must have separate backend-owned mutable simulation state.
- Advancing the modified run must not advance the baseline.
- Editing the modified run must not change the baseline.
- Resetting one run must not reset the other.
- Switching between runs must not transfer physical state or simulation time.
- A run must retain its state when it becomes inactive.
- Failed or stale requests must not mutate the wrong run.

These properties must be established through backend tests and, where feasible, integration tests. Frontend navigation alone is insufficient evidence.

## 5. Initial system **[Adopted on evidence, OD-3]**
The experiment must use a scientifically defensible gravitational system with documented initial conditions.

**Selected system: "Sun + Earth–Moon barycentre (two-body), J2000.0".**

| Item | Protocol |
|---|---|
| Bodies | 1) Sun. 2) The Earth–Moon barycentre (EMB), a single point mass carrying the combined mass of Earth and Moon and shown as "Earth (Earth–Moon barycentre)". There is no separate Moon (moons are out of scope). |
| Selected planet | The Earth–Moon barycentre. |
| Reference epoch | J2000.0 = JD 2451545.0 TDB (2000-01-01 12:00:00 TDB). Simulation time t = 0 s is the epoch. |
| Source of positions and velocities | JPL Horizons vectors for target 10 (Sun) and target 3 (Earth–Moon Barycenter): centre 500@0 (Solar System Barycenter), geometric states, `VEC_CORR=NONE`. The same archived source files as the Solar System preset. |
| Source of masses | JPL DE440 GM values (JPL SSD Astrodynamic Parameters; Park et al. 2021): GM☉ = 1.32712440041279419×10²⁰ m³ s⁻². GM(EMB) = GM(Earth) + GM(Moon) = 398600.435507 + 4902.800118 km³ s⁻². Mass m = GM/G with G = 6.67430×10⁻¹¹, so the GM values are reproduced exactly. |
| Coordinate frame and origin | Ecliptic and mean equinox of J2000.0 (Horizons `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`). The origin is shifted to the two-body barycentre of the included bodies (zero total momentum). |
| Units and transformations | km → m and km/s → m/s (×1000); subtract the two-body barycentre position and velocity. No rotation. |
| Physical model | Newtonian point-mass gravity, no other forces. |
| Numerical integration | The application's IAS15 configuration (GLOBAL step-size criterion, `line` collision detection), unchanged. |
| Omitted bodies and effects | All other planets, dwarf planets, asteroids and comets; the Moon as a separate body (Earth–Moon internal motion); general relativity; solar oblateness; radiation and other non-gravitational forces. |

**Why the Earth–Moon barycentre, not Earth's centre (evidence in Appendix A):** in the real system it is the Earth–Moon barycentre, not Earth's centre, that moves on a nearly Keplerian orbit around the Sun. Earth's centre also circles the barycentre monthly; at J2000 it was 4,890 km and 11.8 m/s away from it (Horizons targets 399 and 3). A Sun–Earth model started from Earth's centre therefore starts with that monthly velocity error and drifts away from the real orbit. Evaluated over two years against the Horizons ephemeris:
- the Sun + EMB model stays within about 11,700 km of the ephemeris (8.0×10⁻⁵ relative);
- the Sun + Earth-centre model drifts by about 1.29 million km (8.8×10⁻³), more than 100 times worse.

**Limitation (to be shown to the user):** this is a two-body model. It reproduces the real Earth–Moon barycentre's orbit only to about 10⁻⁴ over two years, because the other planets are omitted. It is an experiment about the effect of initial velocity, not a prediction of Earth's real future position.

The initial system should be simple enough for the effect of the velocity change to be interpretable and for the expected behavior to be independently checked. (The two-body problem has an exact analytic solution, which is used as the independent reference in §9.)

The final protocol must identify all of the above; it is maintained in `context/EXPERIMENT_01_PROTOCOL.md`, which the implementation creates from this section and the measured validation results.

## 6. Velocity modification **[Adopted on evidence, OD-3]**
The user must be able to change the selected planet's initial velocity through guided controls.

The modification must be explicit and physically meaningful. The UI must display the baseline value and proposed modified value before creating the modified run.

**Supported control (first release):** scaling the magnitude of the Earth–Moon barycentre's initial velocity (in the barycentric simulation frame) while keeping its direction exactly. The modified velocity is v′ = f·v, with the factor f chosen from **{0.90, 0.95, 1.05, 1.10}**.
- Values are shown in m/s (with km/s as an aid) for each component and for the speed.
- All four factors give bound, non-colliding orbits; escape would need f ≈ 1.41.
- The backend accepts only these exact factors; any other value is rejected without changing either run.
- Component-wise changes and free numeric input are not part of the first release.

The backend must validate all inputs independently of frontend validation. Invalid values must be rejected without altering either run.

## 7. Orbit Lab workflow
The user workflow is:
1. Select the experimental system.
2. Initialize and inspect the baseline.
3. Select the planet to modify.
4. Inspect its initial velocity and relevant units.
5. Choose a supported velocity modification.
6. Create the modified run from the baseline's intended initial state.
7. Verify that the intended velocity change is the only experimental difference.
8. Advance the simulations using the available controls.
9. Switch between the baseline and modified run.
10. Compare the specified trajectories and measurements.
11. Reset or recreate a run using documented lifecycle semantics.
12. Repeat the experiment from the same initial conditions when reproducibility is required.

The interface must identify the active run clearly and distinguish the baseline from the modified run.

## 8. Measurements and visualizations **[Adopted on evidence, OD-3]**
**Observation window and sampling:**
- Each run is observed for **730 days** (63,072,000 s, about two years).
- The backend records the positions of both bodies on an exact common time grid **t_k = k × 86,400 s, k = 0 … 730** (731 daily samples per run).
- The window covers at least 1.38 orbits for every factor (orbital periods range from about 279 to 527 days; Appendix A).
- Runs may be advanced beyond the window. Comparison data are kept up to the backend's sample cap.

**Mandatory first-release outputs:**
- A 3D trajectory for the baseline and modified run, overlaid in the existing renderer (the active run drawn prominently, the other distinguishable).
- The selected planet's position at corresponding simulation times (m, simulation frame).
- The difference between the two positions at corresponding times (the magnitude of the position difference, in m, against time in days).
- The simulation time of each run.
- A clear record of the original and modified velocity (components and speed, m/s), the factor, the selected body, the baseline and the run's controlled/uncontrolled status.

All measurements must come from actual backend state and use consistent units and time references.

If runs are displayed at different simulation times, the UI must make this clear. Synchronizing the display must not silently mutate the physical state of either run. Comparisons use only the common sample times both runs have reached.

Orbital classifications, energy comparisons or other derived measurements may be added if scientifically justified and validated, but they are not mandatory unless selected as part of the final protocol. **They are not selected for the first release.**

## 9. Numerical and scientific validation
The experiment must be validated using an independent reference or an analytically predictable case where feasible.

Validation should cover:
- Correct initial conditions and unit conversions.
- Correct coordinate frames and transformations.
- Correct application of the velocity change.
- Equivalent baseline and modified initial states apart from the intended change.
- Expected qualitative behavior.
- Consistency of observation times.
- Numerical integration behavior and justified tolerances.
- Conservation properties where applicable.
- Repeatability of the documented initialization and experiment procedure.

**[Adopted on evidence]** Scientific acceptance criteria for the first release:

| Check | Independent expectation | Tolerance and justification |
|---|---|---|
| Initial conditions | Re-parsing the archived Horizons source files gives exactly the committed SI values | Exact (multiplication by 1000 only) |
| Velocity change | v′ = f·v component-wise; direction unchanged | Floating-point exact product; angle between v and v′ ≤ 1e-15 rad |
| Only intended difference | Field-by-field comparison of the two initial states | Exactly one differing field (EMB velocity); configuration identical |
| Trajectory vs analytic reference | Independent elliptic Kepler two-body solution for the relative vector r_EMB − r_Sun with μ = G(m☉ + m_EMB) | At every sample over the window, error ≤ 1e-10 × a. Measured in planning: ≤ 2.5e-13 × a (≤ 3.4 cm), so the margin is 400×. A unit or Δv error would exceed 1e-3 × a. |
| Qualitative behaviour | From vis-viva: f > 1 gives a larger semi-major axis, a longer period, the start point near perihelion and a larger aphelion; f < 1 gives the reverse, with the start point near aphelion | Signs and orderings as predicted. The measured period matches 2π√(a³/μ) to 1e-6 relative. |
| Observation times | Both runs' sample times are k × 86,400 s exactly | Exact equality |
| Conservation (integrator behaviour, not physics accuracy) | K+U and angular momentum about the origin constant for each run | Relative drift ≤ 1e-12 over the window. Measured in planning for K+U: ≤ 6.7e-16. Angular momentum was not measured in planning; the implementation measures and records it. |
| Repeatability | Repeating the initialization gives the same initial state; the same modification gives the same modified state | Identical state digests; bit-identical trajectories within one backend process |

Do not promise exact real-world predictions if the data, numerical method or simplified physical model cannot support them.

Do not hard-code expected trajectories or invent numerical outcomes to make the comparison appear convincing. (The values in Appendix A are for orientation only; tests must compute their expectations from the independent reference at run time.)

## 10. Reset, snapshots and reproducibility
Reset must restore the documented initial state of the targeted run without affecting other runs.

The snapshot and restoration contract must specify which physical and integration state is preserved. A saved collection of visible positions and velocities must not be presented as a complete checkpoint unless it satisfies the required continuation guarantees.

The experiment must be reproducible from documented initial conditions and the recorded modification.

Bit-for-bit reproducibility is not required unless it is explicitly supported and verified. **[Owner decision OD-5]** Snapshots and runs exist only for the lifetime of the backend process. Within that scope the implementation supports and tests bit-identical continuation after a restore (implementation plan §8). It is not claimed across restarts, machines or REBOUND versions.

## 11. Error handling
The system must handle:
- Invalid velocity values.
- Failure to initialize the experimental system.
- Failure to create the modified run.
- Invalid or stale run identifiers.
- Conflicting lifecycle commands.
- Busy, failed or stalled integration.
- Switching runs while a request is pending.
- Snapshot or restoration failures.
- Incomplete comparison data.

Failures must be visible and diagnosable. A failed operation must not silently corrupt the baseline or modified run, and the UI must not claim success without backend confirmation.

## 12. Acceptance criteria
Experiment 01 is complete when:
1. The confirmed scientific question is implemented.
2. The initial system has documented, defensible initial conditions.
3. The baseline is created and preserved correctly.
4. The modified run begins from the same intended initial state.
5. The intended velocity modification is explicitly recorded and validated.
6. No unintended initial-condition differences are introduced.
7. Both runs advance independently on the backend.
8. Switching between runs preserves each run's state and simulation time.
9. Editing and resetting one run do not affect the other.
10. The required measurements and trajectory comparisons use actual simulation results.
11. Numerical behavior is checked against suitable independent expectations.
12. The workflow can be repeated from documented initial conditions.
13. Error handling protects simulation state.
14. Existing application functionality remains intact.
15. Relevant automated tests, type-checking, production build and integration checks pass, or genuine blockers are documented.
16. Project context and API documentation reflect the implemented behavior.

## 13. Product decisions (resolved)
| Decision | Resolution (2026-10-24) |
|---|---|
| Initial system | Sun + Earth–Moon barycentre two-body system at J2000.0, from the same Horizons/DE440 source data as the Solar System preset (§5). [Adopted on evidence, OD-3] |
| Selected planet | Earth–Moon barycentre, shown as "Earth (Earth–Moon barycentre)". [Adopted on evidence, OD-3] |
| Velocity modification | Speed-magnitude factor f ∈ {0.90, 0.95, 1.05, 1.10}, direction kept (§6). [Adopted on evidence, OD-3] |
| Observation window | 730 days, with daily samples on the exact grid k × 86,400 s (§8). [Adopted on evidence, OD-3] |
| Comparison outputs | The five mandatory outputs in §8; no derived classifications or energy comparisons. [Adopted on evidence, OD-3] |
| Scientific acceptance criteria | The table in §9. [Adopted on evidence, OD-3] |
| Baseline / modified-run editing | Baseline immutable; modified-run physical edits recorded and flagged uncontrolled (§4.1, §4.2). [Owner decision OD-4] |
| Persistence | In-memory only (§10). [Owner decision OD-5] |

These values are recorded explicitly so that none is invented during implementation. Changing one requires a recorded reason, an update to this document and re-running the validation in §9.

## 14. Scope boundaries
The initial experiment does not require moon-specific workflows, multiple simultaneous experimental changes or unsupported physical effects.

Its purpose is to deliver one controlled, independently verifiable gravitational experiment using the Simulation Lab infrastructure.

The final protocol must preserve the confirmed scientific question and document all remaining assumptions, data sources and limitations.

---

## Appendix A — Planning evidence (2026-10-24; for orientation, not test constants)
**Method:**
- Horizons vectors were fetched on 2026-10-24 (each target reports "source: DE441") for targets 10, 3, 399 and the planetary system barycentres. Epochs: JD 2451545.0, 2451910.25 and 2452275.5 TDB. Frame: SSB, ecliptic J2000.
- Masses from DE440 GM.
- Integration used the repository's own `SimulationService` (IAS15 GLOBAL, `line` collisions) at `main` `d5220f9`, stepping 86,400 s per request.
- The analytic reference was an independent elliptic Kepler propagator written for the probe.
- Scripts and data were kept in the planning session's scratchpad, not in the repository. The implementation must rebuild this evidence as committed, automated tests.

**Model choice, two-body heliocentric position error vs Horizons:**
| Model | After 365.25 d | After 730.5 d |
|---|---|---|
| Sun + Earth–Moon barycentre (GM_E + GM_M) | 6,614 km (4.5e-5) | 11,717 km (8.0e-5) |
| Sun + Earth centre (GM_E only) | 650,726 km (4.4e-3) | 1,288,654 km (8.8e-3) |

**Initial state:** the heliocentric distance is 0.983310 au, and the relative speed is 30,286.011 m/s. The two-body perihelion is 2.49 days after the epoch (r·v < 0 at t = 0). This is why the start point is almost, but not exactly, a turning point for every factor. At J2000 Earth's centre is 4,890 km and 11.8 m/s away from the Earth–Moon barycentre.

**Expected orbits for each factor (vis-viva from the initial state; μ = G(m☉ + m_EMB)):**
| f | a (au) | e | Period (d) | Perihelion (au) | Aphelion (au) | Max engine−Kepler error over 730 d |
|---|---|---|---|---|---|---|
| 1.00 (baseline) | 1.00000 | 0.01670 | 365.25 | 0.9833 | 1.0167 | 1.4 cm (9.7e-14 a) |
| 0.90 | 0.83580 | 0.17648 | 279.10 | 0.6883 | 0.9833 | 2.9 cm (2.3e-13 a) |
| 0.95 | 0.90842 | 0.08244 | 316.25 | 0.8335 | 0.9833 | 3.3 cm (2.5e-13 a) |
| 1.05 | 1.11854 | 0.12090 | 432.09 | 0.9833 | 1.2538 | 1.4 cm (8.1e-14 a) |
| 1.10 | 1.27734 | 0.23019 | 527.30 | 0.9833 | 1.5714 | 2.1 cm (1.1e-13 a) |

**Energy drift over 730 d:** ≤ 6.7e-16 relative for every run.

**Context for the Solar System preset:** a full Sun + 8 planet-system 9-body run, compared with Horizons, has a worst heliocentric relative error of 9.1e-7 after 1 year and 3.9e-6 after 2 years (Mercury, as expected from the omitted general relativity and minor bodies).

## Revision record
- **Draft 0.2:** supplied by the owner in chat on 2026-10-24. It was not previously in the repository.
- **Draft 0.3 (2026-10-24):** OD-3, OD-4, OD-5 and OD-6 applied; parameters evaluated (Appendix A).

Draft 0.2 wording that was replaced or extended:
- Status line: "Scientific question confirmed; experimental parameters require finalization."
- §5, after the opening sentence: "The final protocol must identify: The selected system or preset. The bodies included in the model. The reference epoch. The coordinate frame and origin. The units and transformations. The source of each relevant mass, position and velocity. Any omitted bodies or physical effects. The numerical integration configuration. … A Sun–planet-style system is a possible starting point, but the final choice must be compatible with the validated Simulation Lab presets and available source data." (Answered by the §5 table.)
- §6: "The final protocol must specify the available changes, including their units and interpretation. Possible approaches include: Increasing or decreasing the magnitude of the initial velocity while retaining its direction. Applying a defined change to one component of the velocity vector. These are alternative experimental controls, not a requirement to implement both in the first release. The initial implementation should prefer the smallest set of controls that makes the scientific question understandable." (Answered by the "Supported control" paragraph.)
- §8: "The exact mandatory outputs must be finalized before implementation. Recommended initial outputs are: A 3D trajectory for the baseline and modified run. The selected planet's position at corresponding simulation times. The difference between the two positions at corresponding times. The simulation time of each run. A clear record of the original and modified velocity. A visual overlay or side-by-side trajectory comparison, depending on the existing renderer's capabilities." (Replaced by the window, sampling and mandatory outputs; the overlay was chosen.)
- §13, titled "Remaining product decisions": a table of six open decisions (initial system, selected planet, velocity modification, observation window, comparison outputs, scientific acceptance criteria). It was followed by "Recommended defaults": use the simplest scientifically defensible system compatible with Simulation Lab; change one velocity variable at a time; start with a guided velocity-magnitude adjustment retaining the initial direction; use the existing simulation controls and renderer wherever possible; compare positions at matching simulation times; validate against an independently calculated or otherwise defensible reference; keep derived orbital classifications and advanced analytical plots outside the mandatory scope unless the protocol requires them. Its closing note read: "These defaults are recommendations, not confirmed requirements. Any selected values, duration or numerical tolerances must be recorded explicitly rather than invented during implementation."

Added in Draft 0.3: the labelled paragraphs in §4.1, §4.2, §5, §6, §8, §9 and §10, Appendix A, and the resolved §13.
