# PLAYING GOD — Simulation Lab Product Specification

**Version:** Draft 0.2 (2026-10-24)
**Status:** Product specification. Owner decisions OD-1, OD-2, OD-4, OD-5 and OD-6 (2026-10-24) are applied below. Remaining provisional items are labelled.
**Product:** PLAYING GOD — interactive 3D gravitational-universe simulator.

**Labels used in this revision**
- **[Owner decision OD-n]**: a requirement or scope decision the owner confirmed on 2026-10-24.
- **[Technical default]**: an engineering choice adopted in `context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md`. It is not a product requirement and may be changed by the implementer with a recorded reason.
- Unlabelled text is the owner-supplied Draft 0.1 wording, unchanged.

The Draft 0.1 wording that this revision replaced is reproduced in the "Revision record" at the end.

---

## 1. Purpose
Simulation Lab is the reusable environment in which users create, explore, modify and compare gravitational systems.

It extends the existing PLAYING GOD application rather than replacing it. It must integrate with the existing 3D renderer, simulation controls, body selection, camera, axes/grid and sidebar architecture.

The backend remains authoritative for physical simulation state. The frontend presents and controls that state but must not create the illusion of independent simulations by assigning identifiers to a shared mutable simulation.

The experience should allow users to explore recognizable astronomical systems, edit their physical parameters and switch between independent universes without losing the state of the universe they left.

## 2. Product goals
1. Make real astronomical systems explorable in an interactive 3D environment.
2. Let users understand how masses, positions and velocities influence gravitational behavior.
3. Support independent universes with predictable lifecycle and navigation semantics.
4. Provide validated presets and a reusable catalogue of bodies.
5. Support custom stars and planets.
6. Provide the state-management foundation required by Orbit Lab.
7. Preserve scientific credibility, numerical correctness and clear limitations.
8. Keep the interface focused on exploration rather than lengthy instructions.

## 3. Core terminology
- **Universe:** An independently owned simulation instance, including its physical state, simulation time, configuration and relevant integration state.
- **Active universe:** The universe currently selected for interaction and eligible to advance.
- **Preset:** A predefined astronomical system reconstructed from documented source data and assumptions.
- **Body catalogue:** A collection of reusable named or custom body definitions.
- **Snapshot:** A saved representation of the state needed to satisfy the documented restoration guarantee.
- **Baseline:** The original state used as the reference for a comparison.
- **Modified run:** An independent simulation derived from the same intended initial state as its baseline, with explicitly defined modifications.

A universe identifier alone does not establish simulation independence. Independence must be enforced by the backend.

## 4. Universe navigation and isolation
### 4.1 Navigation
The application must provide a clear navigation mechanism for switching between available universes.

Users should be able to identify the currently active universe and switch to another universe without confusing one universe's state with another's.

When a user leaves a universe:
- Its simulation advancement must stop.
- Its current physical state and simulation time must be retained.
- Its relevant configuration and integration state must remain available for the promised resume behavior.
- The universe must not continue advancing in the background.

When the user returns, the universe must resume from its exact saved simulation instant. It must not silently reset, reconstruct from approximate visible coordinates, or inherit state from another universe.

Here, "exact saved instant" means that simulation time and physical state are retained at the transition. Numerical continuation should meet the restoration guarantees documented by the implementation; bit-for-bit determinism must not be promised without evidence.

### 4.2 Backend authority
The backend must own each universe's mutable physical state and advancement lifecycle.

The implementation must establish:
- Distinct simulation identity and state.
- Explicit lifecycle transitions.
- Active-universe selection.
- Backend-enforced active-only advancement.
- Safe handling of concurrent commands.
- Isolation of edits, reset, snapshots and restoration.
- Rejection or safe handling of stale and invalid requests.
- Defined behavior for failed, busy or timed-out integrations.
- Resource cleanup and restart behavior.

The frontend must not be able to advance an inactive universe merely by sending an old request.

A switch between universes must not cause state, time, body modifications or integration state to leak between them.

### 4.3 Persistence and restart **[Owner decision OD-5]**
- Universes, snapshots and experiments live only in the memory of the running backend. They do **not** need to survive a backend restart in the first release.
- Within one running backend process, snapshot, restore and reset semantics must be correctly specified and tested.
- After a restart the application must detect that the universes it knew about no longer exist and tell the user. It must not fail silently or show stale state as current.

## 5. Presets
### 5.1 Required capability **[Owner decision OD-1]**
Simulation Lab must provide **at least one** scientifically defensible real-system preset. **The Solar System preset is required and is sufficient for the first release.**

A further preset may be included only if its initial conditions and physical parameters can be adequately sourced and validated to the same standard (§5.4). Scientific credibility takes priority over the number of presets. No value may be fabricated or silently estimated to satisfy a preset count.

Each preset must have a documented provenance record containing:
- System name and description.
- Included bodies and omitted bodies.
- Source dataset or authoritative reference.
- Reference epoch.
- Coordinate frame and origin.
- Units.
- Masses and their sources.
- Position and velocity source data or reconstruction methodology.
- Coordinate transformations.
- Assumptions and approximations.
- Known limitations and uncertainty.
- Data version and reproducibility information.

The initial conditions must be suitable for the simulation's chosen physical model. A collection of plausible-looking body positions is not a scientifically defensible reconstruction.

### 5.2 Preset selection **[Owner decision OD-1]**
| Candidate | Decision | Reason |
|---|---|---|
| Solar System | **Required** | Authoritative ephemeris (JPL Horizons) and planetary GM values (JPL DE440) are available; validated against the ephemeris. |
| TRAPPIST-1 | **Conditional.** Included only if it passes its validation gate (§5.4); otherwise excluded and documented. | Measured masses (≈3–5 %) and osculating elements are published (Agol et al. 2021, PSJ 2:1), with observed transit times available for independent validation. The coordinate-convention conversion is a real risk. |
| Kepler-90 | **Removed** from the first release | Only planets g and h have measured masses (Shaw et al. 2025). The other six would have to be estimated from a mass–radius relation, which does not meet §5.1. |

A preset that is excluded or fails validation must not be offered as a complete, validated preset.

### 5.3 Loading a preset
Loading a preset must create or initialize the intended universe with validated initial conditions.

The implementation must make clear whether the operation creates a new universe or deliberately replaces an existing one. It must not silently destroy an existing universe's state. **[Technical default]** Loading always creates a new universe; replacing one means explicitly deleting the old one.

Preset loading must be isolated from other universes.

### 5.4 Preset validation standard **[Owner decision OD-1]**
A preset is "adequately sourced and validated" only when all of the following hold:
1. Every mass, position and velocity comes from a cited primary or authoritative source, with any derived value labelled as derived.
2. The conversion from source units and frame to the simulation's units and frame is re-derived by an automated test from the archived source data.
3. An independent dynamical check passes against observed or ephemeris data. The check has a tolerance that is justified in advance, and the measured result is recorded.

The specific checks and tolerances are in the implementation plan.

## 6. Body catalogue
### 6.1 Catalogue requirements **[Owner decision OD-2]**
Provide a catalogue of named bodies and reusable body definitions. The approved initial catalogue is:
- **Stars (5):** Sun, Proxima Centauri, TRAPPIST-1, Sirius A, Betelgeuse.
- **Planets (4):** Earth, Mars, Jupiter, Neptune.

Each entry must record, per physical property:
- the value in SI units;
- the source (citation and URL);
- the stated uncertainty or range where the source gives one;
- a basis label: `measured`, `nominal` (a defined standard value), `estimated` (a model-dependent or highly uncertain value, e.g. Betelgeuse's mass), or `illustrative` (a simplified value with no source).

Estimated and illustrative values must be disclosed in the interface wherever the entry is shown.

The catalogue must clearly distinguish three different things:
1. **Catalogue body entries:** individual reusable body definitions. They are not simulation systems and carry no positions or velocities.
2. **Visual assets:** colour and display size, which are rendering choices and not physical claims.
3. **Validated simulation presets:** complete systems with initial conditions (§5).

The catalogue must not imply that every star and planet in it has been reconstructed into a compatible multi-body system.

### 6.2 Reusable body definitions
Catalogue entries should provide the physical properties needed to create a body in a universe, subject to the supported model.

A catalogue entry is a reusable definition, not a live reference to a body in another universe.

Editing or placing a body in one universe must not alter bodies in another universe or mutate the shared catalogue definition unintentionally.

### 6.3 Moons
Moons are out of scope for the initial Simulation Lab release.

Do not expand the first implementation into a moon catalogue, moon-specific interaction workflow or moon-focused experiment unless a mandatory dependency requires it and the scope is explicitly documented.

(Documented consequence: in the Solar System preset each planet with moons is modelled as one point mass at its system barycentre, which includes the moons' mass. Earth is modelled as the Earth–Moon barycentre. No moon exists as a separate body.)

## 7. Custom-body creation and editing
Users must be able to create custom stars and planets and edit supported physical properties of bodies in a universe.

The initial editing scope includes:
- Mass.
- Radius, where supported by the model and renderer.
- Velocity.
- Other initial-condition properties explicitly required by the Experiment 01 specification.

Position and additional physical parameters must be supported wherever required by the final experiment protocol and existing application design.

The interface must validate user input before applying changes.

Validation must address, as applicable:
- Non-finite numbers.
- Invalid or non-positive physical quantities where prohibited.
- Unsupported ranges.
- Unit conversion.
- Invalid vectors or incomplete values.
- Conflicts with the current lifecycle state.
- Requests targeting the wrong universe.

The backend must validate all physical inputs independently of frontend validation.

A body edit must affect only the intended universe. The product must define whether an edit applies immediately or requires a paused simulation; use the safest behavior consistent with the final experiment workflow and document it. **[Technical default]**
- The interface requires the simulation to be paused before an edit can be applied.
- The backend applies each edit atomically between steps.
- An Orbit Lab baseline cannot be edited (Experiment 01 spec §4.1).
- Any physical edit to a modified run is recorded and marks the run as uncontrolled (Experiment 01 spec §4.2).

Cancellation must leave the previous state unchanged. Invalid edits must provide understandable feedback without corrupting the simulation.

## 8. Simulation controls
Simulation Lab must integrate with the existing simulation controls and lifecycle.

The user must be able to perform the operations supported by the product specification, including:
- Play.
- Pause.
- Step.
- Reset.
- Switch between universes.
- Load a preset.
- Edit bodies.
- Save and restore a snapshot where specified.

Every operation must target an explicit universe on the backend.

The UI must communicate the current simulation status and handle busy, failed and timed-out requests without pretending an operation succeeded.

Inactive universes must not advance in the background.

## 9. Snapshot, reset and independent runs
### 9.1 Snapshot and restoration
Implement snapshot behavior sufficient to restore the state promised by the product.

The snapshot design must consider physical state, simulation time, body identities, configuration and any integration state needed for valid continuation.

Saving visible positions and velocities alone must not be described as complete checkpointing unless it meets the required restoration semantics.

The implementation must document whether restoration guarantees physical-state recovery, numerically equivalent continuation or stronger reproducibility. **[Owner decision OD-5]** Snapshots are in-memory and last only for the lifetime of the backend process; their guarantee is stated for that scope only.

### 9.2 Reset
Reset must restore the correct defined initial state for the relevant universe or run.

Resetting one universe must not reset another universe or change unrelated catalogue definitions.

The UI must make destructive reset behavior clear when an existing state would be discarded.

### 9.3 Independent runs
Independent runs must own separate mutable state.

Copying a baseline must produce a run that can be advanced, edited, reset and restored without mutating the baseline or other runs.

These guarantees must be demonstrated by backend tests, not inferred from frontend navigation.

## 10. Orbit Lab integration
Orbit Lab uses the capabilities provided by Simulation Lab.

It requires two independent universes:
- **Baseline:** The reference simulation.
- **Modified run:** A separate simulation initialized from the same intended initial conditions, with an explicit modification applied.

The interface must allow the user to switch between the baseline and modified run for comparison.

Both runs must preserve their own physical state and simulation time. Switching between them must not transfer advancement, physical changes, time or integration state from one to the other.

The baseline must remain protected from modifications applied to the modified run. **[Owner decision OD-4]** The baseline is an immutable experimental reference: its initial state can never be changed, and any uncontrolled modification to the modified run must be identifiable.

The exact scientific question, adjustable parameters, comparison measurements and visualizations are defined by the separate Experiment 01 Product Specification.

## 11. User experience
The interface should be compact, discoverable and consistent with the existing PLAYING GOD application.

Priorities:
- A clear universe-navigation mechanism.
- Obvious active-universe identity.
- Straightforward preset selection.
- A discoverable body catalogue.
- Focused body-editing controls.
- Clear play, pause, step and reset behavior.
- Understandable validation and error feedback.
- Clear separation between baseline and modified run.
- Preservation of existing rendering, selection, camera, axes/grid and sidebar behavior.

Initial interactions should favor guided choices over an overwhelming parameter interface. More advanced controls, including arbitrary velocity changes, can be introduced progressively when required by the experiment workflow.

Do not add long explanatory passages to the primary interface unless needed for scientific clarity or error recovery.

## 12. Non-functional requirements
- **Scientific credibility:** All preset data, units, frames, transformations and assumptions must be documented and defensible.
- **State correctness:** Backend state must remain authoritative, and universe isolation must be tested directly.
- **Regression safety:** Existing functionality must continue to work. Tests must not be weakened to accommodate implementation failures.
- **Error handling:** Invalid, busy, stale and failed operations must have defined behavior.
- **Maintainability:** Use the existing architecture where appropriate and avoid unnecessary infrastructure.
- **Performance:** Simulation switching, catalogue operations and ordinary controls should not introduce unnecessary integration work or background simulation advancement.
- **Documentation:** Update the canonical project context, API contract and relevant user-facing documentation.

## 13. Acceptance criteria
Simulation Lab is acceptable when:
1. **[Owner decision OD-1]** The Solar System preset is available with defensible, documented and validated initial conditions. Any additional preset that is offered meets the same standard (§5.4). No excluded candidate is presented as validated.
2. The body catalogue meets the approved scope (§6.1). It contains sourced definitions with units, uncertainty and basis labels, and discloses estimated values.
3. Users can create and edit supported custom stars and planets.
4. Universe navigation preserves each universe's state and simulation time.
5. Only the active, eligible universe advances.
6. Independent universes cannot mutate each other's state.
7. Play, pause, step, reset and editing behave according to documented lifecycle rules.
8. Snapshot and restoration behavior satisfies its explicit contract (in-memory scope, OD-5).
9. Orbit Lab can create and navigate independent baseline and modified runs.
10. Existing application functionality remains intact.
11. Backend, frontend, type-check, build and integration tests pass, or unresolved failures are explicitly documented.
12. The canonical documentation matches the implementation.

## 14. Exclusions, decisions and review
**Excluded initially:** moons and moon-focused workflows; persistence across backend restarts (OD-5); Kepler-90 (OD-1).

**Resolved by the owner on 2026-10-24:**
- **OD-1 (presets):** §5.1, §5.2, §5.4.
- **OD-2 (catalogue):** §6.1.
- **OD-4 (engineering autonomy):** the implementation agent may make routine engineering decisions, run tests and fix failures without repeated approvals, within the approved scope. The baseline is an immutable reference, and uncontrolled modified-run changes must be identifiable.
- **OD-5 (persistence):** §4.3.
- **OD-6 (review):** the owner reviews final visuals, usability and product behavior. An independent technical review (syntax, architecture, scientific rigor, concurrency, numerical correctness, tests and maintainability) is performed separately after the implementation PR exists. The implementation agent must not merge its own PR.

**Defined by the companion Experiment 01 specification:** the scientific question, exact experiment protocol, parameter changes, measurements, comparison visualizations and experiment-specific acceptance criteria.

No provisional choice in this document should be represented as a confirmed owner decision without confirmation. Items labelled **[Technical default]** are engineering choices, not owner decisions.

---

## Revision record
- **Draft 0.1:** supplied by the owner in chat on 2026-10-24. It was not previously in the repository.
- **Draft 0.2 (2026-10-24):** owner decisions OD-1, OD-2, OD-4, OD-5 and OD-6 applied by the planning session.

Draft 0.1 wording that was replaced or extended:
- §5.1 first paragraph: "Simulation Lab must provide three scientifically defensible real-system presets."
- §5.2, titled "Proposed preset candidates — not yet confirmed": "The following are candidates for the three presets: 1. Solar System — a familiar planetary system suitable for exploring orbital behavior. 2. TRAPPIST-1 — a compact multi-planet system. 3. Kepler-90 — a multi-planet system offering a different system architecture. These are provisional product choices, not confirmed owner decisions. The final selection must be validated against source-data availability, reconstruction feasibility, the supported gravitational model and the Experiment 01 requirements. Do not replace a candidate with invented or undocumented parameters. If a defensible reconstruction cannot be made, document the limitation and resolve the preset selection before claiming the requirement is complete."
- §6.1: "The initial catalogue target is: Four to five star entries. Three to four planet entries. The catalogue should contain real named examples where defensible data and useful physical definitions are available. The catalogue must distinguish sourced astronomical properties from simplified values used for illustrative or custom simulations. Provisional examples previously discussed include: Stars: Sun, Proxima Centauri, TRAPPIST-1, Sirius A and Betelgeuse. Planets: Earth, Mars, Jupiter and Neptune. These names are examples rather than a finalized catalogue. The implementation must not imply that every star and planet has been reconstructed into a compatible multi-body system merely because it appears in the catalogue."
- §13.1: "The required three presets are available with defensible, documented initial conditions."
- §13.2: "The body catalogue meets the agreed scope and contains validated definitions."
- §14: "Excluded initially: moons and moon-focused workflows. Still to confirm: the final three presets, exact catalogue entries, and any preset-specific modeling requirements."

Added in Draft 0.2: §4.3, §5.4, the labelled sentences in §5.3, §6.3, §7, §9.1 and §10, and the resolved list in §14.
