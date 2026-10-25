# PLAYING GOD
# Collision Engine & Particle Engine — Master Requirements Specification

**Document type:** Product and Engineering Requirements
**Status:** Ready for repository audit and implementation planning
**Applies to:** Collision detection, collision physics, impact damage, fragmentation, particles, debris evolution, and rendering integration
**Planning agent:** Claude Opus
**Implementation agent:** Claude Sonnet
**Authority:** This document defines the required product behavior. The implementation plan may determine how to achieve it, but must not silently remove or weaken these requirements.

> Repository copy: provided by the project owner in the planning session of 2026-10-24 (pasted in chat, no original filename) and recorded here verbatim so implementation sessions can read it (only the trailing two-space line breaks of the header lines were removed for `git diff --check`). Do not edit; a changed requirement needs a new revision from the owner.

---

# 1. Purpose and Vision

Playing God is an interactive universe simulator in which users can construct and manipulate celestial systems and observe their physical evolution.

The collision system must go significantly beyond detecting overlapping spheres and merging their masses. It must support meaningful collision outcomes, localized impact effects, material-dependent behavior, coherent fragmentation, and the evolution of debris after an impact.

The objective is to create a system in which a user can:

- Make two planets collide and observe different outcomes depending on their physical properties and impact conditions.
- Strike a planet at a particular location and observe localized damage.
- Produce craters, ejecta, partial disruption, and catastrophic fragmentation where physically justified.
- Observe fragments follow coherent trajectories rather than disappearing or moving randomly.
- See debris remain in orbit, fall back onto a planet, collide with another body, or escape.
- Experiment with rocky planets, metallic bodies, icy bodies, gas giants, moons, and asteroids.
- Understand why a collision produces its particular outcome.
- Replay and investigate collision events.
- Continue the simulation after the event without breaking the integrity of the wider Solar System.

The collision and particle engines must be designed together. The collision engine calculates the physical outcome; the particle engine represents and visualizes the resulting material and motion.

## 1.1 Core principles

1. **Physics determines outcomes.** Visual effects must not independently invent physical results.
2. **Material matters.** Different materials and internal structures must produce different behavior when the selected physical model predicts a difference.
3. **Location matters.** An impact must originate at its actual contact point and must not apply uniform local damage everywhere by default.
4. **Motion remains coherent.** Fragments must have defined physical initial conditions and evolve according to the simulation model.
5. **Mass is accounted for.** Physical material cannot silently disappear when a body breaks apart or when rendering limits are reached.
6. **Approximations are explicit.** The system must distinguish physically calculated quantities, approximate outcomes, statistical representations, and purely visual effects.
7. **The existing universe must remain functional.** Adding collisions must not break orbital mechanics, moons, independent simulations, or existing user workflows.
8. **Scientific validity is tested.** Visually impressive results alone do not constitute a successful implementation.

---

# 2. Scope and Fidelity Boundaries

This specification defines the desired capabilities of the first collision and particle engine. It does not require every physical process to be simulated at the same resolution.

## 2.1 Required for the initial engine

The initial engine must include:

- Reliable collision detection and impact diagnostics.
- Material-aware collision inputs and outcome selection.
- Collision outcomes beyond simple merging.
- Localized impact and surface-damage representation.
- A documented approximation for damage and disturbance propagation.
- Physical fragmentation and coherent fragment trajectories.
- A bounded particle and debris system.
- Debris lifecycle management, including orbital evolution and reaccretion where supported.
- Collision event records and diagnostic information.
- Conservation accounting and regression tests.
- Integration with the existing simulation and renderer.
- Performance controls that do not silently corrupt physical accounting.

The initial engine must be architected so that these capabilities can be expanded without replacing the entire collision system.

## 2.2 Explicitly deferred

Full internal hydrodynamics is **not required for the initial implementation**.

The following are deferred to a future extension:

- Full three-dimensional SPH or an equivalent high-fidelity hydrodynamics solver.
- Fully resolved pressure, density, and temperature evolution throughout a planet's interior.
- First-principles simulation of shock fronts through a complete differentiated planetary interior.
- High-fidelity fluid motion and material mixing throughout gas giants.
- Detailed thermodynamic phase transitions using advanced equations of state.
- Full numerical reproduction of research-grade giant-impact simulations.

The initial engine may use scientifically documented analytical, empirical, or reduced-order models for these processes, within their stated limits.

The architecture must preserve an extension path for a future hydrodynamics solver, including interfaces for collision inputs, material properties, physical outputs, remnant reconstruction, and transfer back to the N-body simulation.

**Important:** A deferred hydrodynamics solver must not be simulated through misleading visual effects. The initial engine must clearly distinguish its modeled approximations from fully resolved internal physics.

---

# 3. Feature 1 — Collision Detection and Impact Geometry

## 3.1 Objective

Detect collisions reliably and calculate enough information about each impact for downstream physical models to determine the outcome.

Collision detection must not be tied to a single resolution strategy. The implementation must audit the existing integration method and choose a compatible collision-detection approach.

## 3.2 Required impact information

For every detected collision, the engine must establish, where applicable:

- Identity of the colliding bodies.
- Pre-impact masses and radii.
- Positions and velocities at the impact state.
- Relative impact velocity.
- Contact point and surface normal.
- Impact angle and impact parameter.
- Target and projectile rotation.
- Relative orientation of spin axes.
- Material and internal-structure profiles.
- Gravitational environment and relevant nearby bodies.
- Collision time in simulation time.
- Relevant energy, momentum, and escape-velocity diagnostics.

The system must distinguish impact conditions from post-impact conditions. Collision resolution must not overwrite the pre-impact state before it has been recorded.

## 3.3 Reliable detection

The detector must:

- Avoid repeatedly resolving the same contact as multiple independent collisions.
- Avoid missing fast-moving bodies that pass through a collision region between checks.
- Handle bodies with substantially different masses and sizes.
- Support collisions between planets, moons, asteroids, and tracked fragments.
- Handle simultaneous or near-simultaneous collisions deterministically where possible.
- Avoid corrupting integration state when an impact occurs during a simulation step.

The implementation plan must evaluate whether the current integrator and collision detector support swept or continuous collision detection, adaptive checks, or another appropriate solution.

The choice must be justified against accuracy, performance, and compatibility with the current simulation.

## 3.4 Collision event identity

Each physical collision event must have a stable identifier and a well-defined lifecycle.

The system must distinguish:
- An initial impact.
- Secondary impacts caused by resulting fragments.
- Repeated contacts involving the same objects.
- A single collision event that produces several remnants.

This identity must be usable by the physics engine, renderer, diagnostics, persistence layer, and event replay system.

## 3.5 Acceptance criteria

- Fast impacts are not silently missed within the supported operating envelope.
- A single impact does not produce duplicate merges or duplicate fragment populations.
- The calculated contact point agrees with the collision geometry within the specified numerical tolerance.
- Collision detection remains functional when the simulation is paused, resumed, or time-scaled.
- Existing non-collision orbital integration remains unchanged in behavior except for documented improvements.

---

# 4. Feature 2 — Material-Aware Collision Physics

## 4.1 Objective

Collision outcomes must depend on the properties of the bodies, not merely their masses and radii.

The same geometric impact must be capable of producing different outcomes when the material profiles or internal structures differ.

## 4.2 Supported material categories

The initial material model must be extensible and support at least the following categories:

### Rocky and silicate material

The model should represent the different regimes of surface damage, fracture, crushing, melting, accretion, and gravitational disruption using the selected approximation.

### Metallic and iron-rich material

The model must distinguish its density and relevant mechanical or shock-response properties from ordinary silicate material.

### Icy material

The model must distinguish ice-rich bodies through their density and the applicable strength, heating, melting, and fragmentation behavior.

### Gas and gas envelopes

Gas must not be treated as ordinary solid material.

A gas giant's radius may describe an atmospheric boundary rather than a solid surface. The initial engine must represent the body as a gaseous or envelope-dominated object for collision-outcome selection.

The first implementation may approximate envelope interaction, heating, and stripping. It must not claim to resolve full gas dynamics.

### Molten or partially molten material

The data model must permit molten material and the corresponding fluid-like or deformable behavior when supported by the chosen model.

### Mixed and differentiated bodies

The engine must support bodies with multiple material components, such as:

- An iron-rich core and rocky mantle.
- An icy body with a rocky interior.
- A rocky or icy core with a gas envelope.
- Other documented compositions supported by the model.

A differentiated profile must not be reduced to a single homogeneous material without an explicit approximation.

## 4.3 Material properties

The body model must be able to store and provide relevant properties such as:

- Composition and material fractions.
- Bulk density and, where needed, layer density.
- Strength or effective resistance parameters.
- Compressibility and equation-of-state identifiers where supported.
- Thermal properties where used by the selected model.
- Material-specific disruption or fragmentation parameters.
- Internal-structure description.
- Validity range and provenance of model parameters.

The specification does not prescribe a single universal parameter list for every material. Opus must determine which parameters are required by the selected published models and map them to the existing body representation.

Unknown or incomplete material properties must have explicit fallback behavior. The engine must not silently assign arbitrary physical properties.

## 4.4 Required material interaction coverage

| Interaction | Required capability |
|---|---|
| Rock + rock | Cratering, accretion, ejecta, and disruption outcomes |
| Ice + rock | Composition-sensitive collision outcome and debris properties |
| Metal-rich + rock | Different material response and composition-dependent remnants |
| Asteroid + gas giant | Envelope interaction rather than rigid-sphere collision behavior |
| Gas giant + gas giant | Approximate envelope interaction and possible merger or disruption outcomes |
| Molten + solid | Support for deformation or mixing approximations where modeled |
| Fragment + planet | Secondary impact using the fragment's material and impact conditions |
| Mixed-material bodies | Outcome calculation using the available composition profile |

Not every interaction requires a separate hard-coded algorithm. Shared physical models may be used where appropriate, but their assumptions and material coverage must be documented.

## 4.5 Acceptance criteria

- Material properties are available to the outcome model and fragment-generation system.
- Equivalent collision setups can be compared with different material profiles.
- Differences in output are explainable through the chosen physical model.
- Unsupported material combinations produce a documented fallback or validation error.
- Gas giants are not automatically processed as ordinary rocky spheres.

---

# 5. Feature 3 — Localized Impact, Surface Damage, and Propagation

## 5.1 Objective

The engine must preserve the spatial location of the impact and represent damage as a local process before any subsequent global response.

A collision at the south pole must not automatically damage the north pole to the same degree at the same instant.

## 5.2 Impact location

The collision event must identify the impact location relative to the target body.

The representation must account for:
- Body orientation.
- Spin-axis orientation.
- Surface normal.
- Contact geometry.
- Relative impact direction.

The system must avoid confusing a world-space location with a body-local location, particularly when a planet is rotating.

## 5.3 Spatial damage model

The engine must support a spatially varying damage representation rather than a single uniform damage value.

Depending on the selected implementation, this may be a surface mesh, spherical grid, localized impact regions, or another documented representation.

It must be capable of representing quantities such as:

- Local damage or fracture intensity.
- Crater or deformation extent.
- Ejecta source regions.
- Approximate heating or impact intensity.
- Disturbance propagation.
- Local material loss.

The selected representation must be compatible with the current rendering architecture and must not require a full hydrodynamics solver.

## 5.4 Initial impact and propagation

The engine must distinguish:

1. Initial contact and local damage.
2. Crater formation or surface deformation.
3. Ejecta generation.
4. Approximate propagation of disturbance away from the impact region.
5. Secondary damage or broader deformation when justified by impact severity.
6. Post-impact relaxation or continuing material motion where supported.

The first engine may use a reduced-order propagation model. The model must have documented assumptions, parameters, and limitations.

It must not present a visual wave as a physically calculated internal shock unless that calculation actually exists.

## 5.5 South-pole acceptance scenario

Create a repeatable scenario in which an asteroid impacts a rotating planet at the south pole.

The expected behavior is:

- The impact begins at the south-pole location.
- Initial crater formation, local damage, and ejecta originate there.
- Other regions do not receive identical instantaneous local damage.
- Disturbances may propagate away from the impact site over time.
- The opposite pole may experience delayed or focused disturbances depending on the selected approximation.
- The rendered damage remains aligned with the target's orientation as it rotates.
- The event can be paused, inspected, and replayed.

A very energetic impact may produce global disruption. The requirement is spatially grounded damage and a nonuniform initial response, not a guarantee that the far side always remains unharmed.

## 5.6 Acceptance criteria

- The impact site remains correctly aligned with the body.
- Initial damage is localized.
- Damage progression is time-dependent where propagation is modeled.
- Rotating the target does not detach damage from the intended physical location.
- Localized damage does not independently modify the body's mass or momentum without a corresponding physical event or explicit approximation.

---

# 6. Feature 4 — Collision Outcome Physics

## 6.1 Objective

Determine the physical outcome of a collision using the impact conditions, material properties, and a documented collision model.

The engine must not assume that every collision produces a perfect merger.

## 6.2 Required outcome categories

### Cratering and ejecta

The target remains substantially intact but loses or redistributes surface material.

### Perfect or near-perfect merger

The bodies merge into one dominant remnant when the selected model predicts this outcome.

### Graze-and-merge

An oblique impact initially produces a grazing interaction, but the bodies ultimately merge.

### Hit-and-run

An oblique collision leaves two major remnants moving apart, potentially with changes in mass, composition, spin, and surface condition.

### Partial accretion

A target accretes some of the projectile while some projectile material escapes or remains in separate fragments.

### Partial erosion

The collision removes material from one or both bodies while leaving major remnants intact.

### Catastrophic disruption

The collision disrupts a body sufficiently that no single remnant retains the dominant fraction specified by the chosen disruption criterion.

### Super-catastrophic disruption

The outcome produces extensive mass loss from the largest remnant according to the selected model's definition.

These categories must be defined consistently with the selected scientific prescription rather than invented independently.

## 6.3 Model selection

The implementation must select and document an appropriate collision-outcome model for the relevant physical regime.

For gravity-dominated planetary impacts, Leinhardt–Stewart-style scaling laws and the EDACM framework are candidate starting points. Their assumptions, calibration domains, and limits must be reviewed before implementation.

The chosen model must consider, as applicable:

- Impact speed relative to mutual escape velocity.
- Impact angle and impact parameter.
- Mass ratio.
- Interacting mass.
- Gravitational binding and disruption thresholds.
- Material profile.
- Rotation or spin where supported.

The model must not be extrapolated beyond its valid range without an explicit fallback or documented approximation.

## 6.4 Outcome and state consistency

Every outcome must generate a coherent set of post-impact objects and material populations.

For example:
- A merger produces a surviving remnant with updated mass, position, velocity, and relevant spin properties.
- A hit-and-run event produces multiple remnants with consistent velocities and mass accounting.
- A disruption produces a largest remnant and a defined fragment/debris population.
- Erosion transfers removed mass into tracked fragments, debris, or another explicit representation.

The collision resolver must not independently apply a second visual or physical outcome after the event has already been resolved.

## 6.5 Acceptance criteria

- The engine supports all required outcome categories within their declared validity ranges.
- Identical collision inputs produce repeatable outcomes when deterministic mode is enabled.
- Outcome selection is inspectable through diagnostics.
- The existing merger path remains available as a valid outcome.
- An unsupported regime is handled explicitly rather than silently assigned a misleading outcome.

---

# 7. Feature 5 — Fragmentation and Debris Physics

## 7.1 Objective

When a body breaks apart, the engine must create physically meaningful products with coherent initial conditions and a defined relationship to the original mass and momentum.

Fragments must not be decorative objects whose motion is chosen independently of the collision.

## 7.2 Three representations

The engine must separate three categories.

### A. Major physical remnants

Examples include surviving planets, moons, large fragments, and other bodies whose individual gravitational influence matters.

Each must have a persistent identity and a defined physical state, including supported quantities such as:

- Mass.
- Position and velocity.
- Effective radius or shape approximation.
- Composition.
- Spin.
- Collision eligibility.

These bodies must participate in the authoritative gravitational simulation.

### B. Physical debris populations

Smaller fragments, ejecta, and dust may be too numerous to track individually.

The system must support a bounded combination of:

- Individually tracked fragments above a configurable threshold.
- Statistical debris populations with documented mass and size distributions.
- Particle samples representing those populations for visualization.
- Aggregated representations for debris too small to simulate individually.

The representation must preserve a defined accounting relationship between the actual represented mass and the displayed or sampled particles.

### C. Purely visual effects

Flash, glow, transient shock indicators, and other visual effects may be nonphysical.

They must be explicitly classified as visual effects and must not be mistaken for mass-bearing bodies.

## 7.3 Fragment generation

Fragment generation must depend on the resolved collision outcome, impact conditions, material properties, and the selected physical model.

Where supported, it must determine:

- Largest-remnant mass.
- Remaining mass available for fragments and ejecta.
- Fragment size or mass distribution.
- Fragment composition.
- Initial velocity distribution.
- Ejection directions.
- Rotational influence.
- Whether fragments are likely to remain bound or escape.

The engine must not create an arbitrary collection of identical fragments moving at uniformly random speeds and directions.

## 7.4 Initial conditions

Every tracked fragment must receive initial conditions derived from the pre-impact state and the collision outcome.

The model must account for:

- Bulk translation of the original bodies.
- Impact momentum.
- Surface orientation and local impact geometry.
- Target rotation.
- Ejecta velocity and direction distributions.
- Gravitational binding.
- The velocity frame used by the simulation.

Where a statistical distribution is used, its parameters and assumptions must be documented.

## 7.5 Conservation

The system must account for mass and linear momentum across surviving bodies, tracked fragments, and aggregate debris populations.

Rendering particles must not accidentally multiply the represented physical mass.

If an optimization changes the representation of material—for example, converting many individual fragments into an aggregate debris population—the accounting must be transferred explicitly.

Energy and angular momentum must be recorded according to the fidelity of the model. Angular momentum should include remnant spin and ejecta where supported. Energy accounting must distinguish modeled kinetic, gravitational, and internal or dissipated energy rather than requiring all impact energy to remain as translational kinetic energy.

## 7.6 Acceptance criteria

- Fragments have coherent initial states and are not assigned unconstrained random motion.
- Fragment mass is included in the event's mass accounting.
- The largest remnant and debris population are consistent with the selected collision outcome.
- Rendering density does not change physical fragment mass.
- Fragment creation respects the engine's documented resource limits.

---

# 8. Feature 6 — Particle Engine and Visual Evolution

## 8.1 Objective

Create a particle and visual-effects system that represents collision outcomes continuously and coherently.

The particle engine must work with the collision engine rather than create its own independent version of the collision physics.

## 8.2 Event-driven visualization

The collision resolver must publish an event description containing the relevant physical results.

The renderer must consume that event and produce visual transitions corresponding to the event's state.

A typical collision sequence may include:

1. Initial contact.
2. Localized impact flash.
3. Crater formation, deformation, or penetration as appropriate.
4. Ejecta generation.
5. Fragment separation.
6. Expansion of dust, gas, or debris clouds.
7. Continued fragment trajectories.
8. Reaccretion, orbital evolution, or escape.

The sequence must depend on the actual outcome. A mild cratering event must not automatically play a catastrophic explosion.

## 8.3 Material-sensitive appearance

The rendering system should distinguish material populations when the physical data supports that distinction.

Examples:
- Rocky fragments use solid, irregular chunk-like representations.
- Icy fragments use appropriate ice-like visual properties.
- Molten material may use glowing or deforming appearances where the model supports a thermal interpretation.
- Gas and vapor use diffuse, expanding representations rather than rigid solid particles.
- Fine debris may use a statistical particle field.

Visual appearance is a representation of modeled material, not evidence that the corresponding thermodynamics has been resolved.

## 8.4 Continuous trajectories

Particles representing physical debris must follow trajectories derived from their physical initial conditions and the selected motion model.

The engine must not:
- Teleport fragments to arbitrary positions.
- Randomize velocity every frame.
- Remove fragments merely because an animation has finished.
- Change fragment trajectories solely to make the scene look more dramatic.
- Desynchronize visual fragments from authoritative physics state.

Interpolation may be used for smooth rendering, but it must not alter the underlying authoritative simulation.

## 8.5 Simulation time and replay

The visual system must support:

- Pause and resume.
- Time scaling.
- Event replay where the underlying state history is available.
- Smooth interpolation between simulation states.
- Correct alignment of effects with the impact site.
- Handling of multiple simultaneous or overlapping events.
- Cleanup of expired purely visual effects.

Purely visual effects may have finite lifetimes. Physical fragments must instead follow the fragment lifecycle rules defined in this specification.

## 8.6 Performance controls

The engine must provide explicit limits or strategies for:

- Number of active visual particles.
- Number of tracked physical fragments.
- Number of simultaneous collision effects.
- Particle update frequency.
- Camera-distance-based level of detail.
- Debris aggregation or statistical representation.

Visual level-of-detail changes must not silently change authoritative physical state or conservation accounting.

## 8.7 Acceptance criteria

- The animation corresponds to the actual collision outcome.
- Physical fragments continue evolving after transient effects end.
- Pause, resume, and time scaling do not create visual/physics divergence.
- Material categories are visually distinguishable when relevant.
- Resource limits do not cause silent loss of physical material.

---

# 9. Feature 7 — Gravity, Reaccretion, and Secondary Impacts

## 9.1 Objective

The aftermath of a collision must remain part of the simulation. The engine must account for the evolution of debris after its initial creation.

## 9.2 Fragment lifecycle

A physical fragment or debris population must have a defined lifecycle:

1. Created by a collision event.
2. Assigned initial conditions.
3. Evolved through the applicable motion model.
4. Potentially involved in further collisions.
5. Potentially merged or reaccreted.
6. Potentially retained in orbit.
7. Potentially ejected from the system.
8. Removed from active tracking only through an explicit, accounted-for rule.

A fragment must not disappear solely because its visual animation has ended.

## 9.3 Gravitational evolution

Major remnants and tracked fragments must participate in the authoritative gravitational simulation according to the existing engine's supported physics.

For smaller debris populations, the implementation may use a reduced-order or statistical approach when individually integrating every particle is impractical.

The selected approach must be explicit about which interactions are resolved and which are approximated.

## 9.4 Reaccretion

The system should detect when debris returns to a body and resolve the secondary impact using the supported collision model.

Depending on the mass, velocity, and material properties of the fragment, the event may produce:
- Accretion.
- Localized cratering.
- Ejecta.
- Further fragmentation.
- Another collision event.

The engine must avoid infinite or excessively expensive cascades of tiny fragments.

## 9.5 Bound and escaping material

The system should distinguish, using the applicable dynamical model, between:
- Material remaining bound to the original remnant.
- Material in orbit around a remnant.
- Material bound to the wider system.
- Material escaping the relevant gravitational system.

Escape classification must not rely on visual distance alone when a more appropriate dynamical criterion is available.

## 9.6 Secondary collision identity

A fragment collision must be recorded as a distinct event with a link to the parent event that created the fragment.

This allows the user to inspect a chain of events, such as a planetary impact producing debris that later strikes a moon.

## 9.7 Acceptance criteria

- Physical fragments can remain in orbit, reaccrete, collide, or escape.
- Secondary impacts use the collision system rather than a separate arbitrary effect.
- Parent-child event relationships remain valid.
- Fragment removal and aggregation preserve documented accounting.
- Fragment cascades remain within resource limits.

---

# 10. Feature 8 — Conservation, Diagnostics, and Scientific Validation

## 10.1 Objective

The engine must provide measurable evidence that its results are consistent with the selected physical models.

Visual plausibility is not sufficient validation.

## 10.2 Collision diagnostics

Every collision event must record the relevant information available at the chosen fidelity, including:

- Event identifier and parent event, if applicable.
- Pre-impact body states.
- Impact geometry and relative velocity.
- Material profiles and model parameters.
- Selected outcome and model version.
- Post-impact remnant states.
- Fragment and debris accounting.
- Mass and momentum residuals.
- Angular-momentum diagnostics where supported.
- Energy diagnostics appropriate to the model.
- Numerical warnings, fallbacks, and approximations.

Diagnostics must be accessible to automated tests and, where appropriate, the developer-facing inspection tools.

## 10.3 Conservation requirements

### Mass

The represented mass before and after a collision must agree within a documented tolerance, unless a modeled source or sink is explicitly present.

### Linear momentum

The combined momentum of surviving bodies and represented debris must agree with the pre-impact total within the specified numerical tolerance.

### Angular momentum

Where the selected model supports it, angular momentum accounting must include remnant spin and ejecta. Any unmodeled component must be documented.

### Energy

Energy accounting must reflect the selected physical model. The system must distinguish kinetic energy, gravitational energy, and internal or dissipated energy where those quantities are represented.

The engine must not incorrectly require kinetic energy to remain constant through an inelastic collision.

## 10.4 Numerical failure handling

The engine must detect and report cases such as:

- Non-finite positions or velocities.
- Negative or invalid masses.
- Invalid fragment distributions.
- Conservation residuals outside tolerance.
- Unsupported material configurations.
- Fragment-count overflow.
- Failure to resolve a collision outcome.
- Invalid integration state after resolution.

The implementation must define whether each case triggers rejection, a controlled fallback, a simulation pause, or another safe response.

Silent corruption is unacceptable.

## 10.5 Repeatability

With deterministic settings and identical initial conditions, the engine should reproduce the same physical outcomes.

If stochastic fragment sampling is used, it must support a controlled random seed and reproducible generation.

Where cross-platform numerical differences prevent exact bitwise equality, the specification must define appropriate tolerances for physical results.

## 10.6 Required scientific tests

The test suite must include:

- Head-on and oblique impacts.
- Low-energy cratering.
- Merger and hit-and-run scenarios.
- Partial accretion and erosion.
- Catastrophic disruption.
- Different material combinations.
- Localized polar impact.
- Gas-giant interaction within the selected model's validity range.
- Fragment reaccretion and secondary impacts.
- Mass and momentum accounting.
- Performance limits and deterministic replay.

Expected results must be derived from the selected models or reference scenarios. Arbitrary expected values must not be invented to make tests pass.

## 10.7 Acceptance criteria

- Every collision outcome is inspectable.
- Conservation residuals are measurable.
- Tests distinguish physical failures from rendering failures.
- The test suite covers supported model regimes and declared limitations.
- Numerical warnings are actionable and reproducible.

---

# 11. Feature 9 — Performance and Integration with Playing God

## 11.1 Objective

Integrate the collision and particle engines without compromising the existing universe simulation.

The implementation must first audit the actual codebase. It must not assume the names, responsibilities, or current correctness of specific modules before inspecting them.

## 11.2 Architectural boundaries

The implementation must define clear responsibilities for:

- Collision detection.
- Impact-state capture.
- Outcome selection.
- Physical resolution.
- Fragment and debris generation.
- Gravitational evolution.
- Event history and diagnostics.
- Visual event representation.
- Persistence and restoration.

These may map to existing modules or new modules. The architecture should avoid duplicating authoritative physics state across independent subsystems.

## 11.3 Authoritative state

The existing simulation remains the authority for the states it currently owns.

The collision system must define how collision resolution updates that state, including:
- Removal or transformation of original bodies.
- Creation of surviving remnants.
- Creation and registration of tracked fragments.
- Transfer of mass and momentum into debris representations.
- Updates to spin or other properties where supported.

The renderer must not independently modify these values.

## 11.4 Independent simulations

Separate simulations must remain isolated.

Collision events, fragment populations, random seeds, event histories, and physics state belonging to one simulation must not leak into another.

The implementation must preserve the existing simulation isolation model discovered during the repository audit.

## 11.5 Persistence and restoration

The implementation plan must identify which collision-related state needs to be persisted.

Where simulations can be saved and restored, the design must address:
- New body and material fields.
- Tracked fragments and debris populations.
- Active event or aftermath state.
- Random seeds where needed for reproducibility.
- Schema migration and backward compatibility.

Persisted data must be versioned or migrated using the repository's established approach. The implementation must not silently invalidate existing saved simulations.

## 11.6 Performance limits

The system must define configurable limits for:
- Tracked physical fragments.
- Active collision events.
- Visual particles.
- Secondary-collision processing.
- Debris aggregation.
- Per-step collision and particle computation.

When a limit is reached, the system must follow an explicit policy. It may aggregate, defer, reduce visual detail, or use a documented approximation, but it must not silently discard represented mass.

## 11.7 Regression safety

The implementation must preserve, unless a change is explicitly approved:

- Existing orbital mechanics.
- Planetary trajectories.
- Moon systems.
- Existing body creation and manipulation workflows.
- Simulation isolation.
- Time controls.
- Existing rendering behavior outside the collision system.
- Existing APIs and persistence contracts, or documented migrations where changes are required.

The current codebase and test suite must be audited before making changes. Baseline failures must be distinguished from regressions introduced by the new implementation.

## 11.8 Acceptance criteria

- Existing non-collision scenarios continue to work.
- Independent simulations remain isolated.
- Collision processing respects explicit resource budgets.
- Save/restore behavior remains compatible or is migrated safely.
- Performance degradation and fallback behavior are measurable.
- Rendering optimizations do not alter physical accounting.

---

# 12. Feature 10 — Future Hydrodynamics Extension

## 12.1 Objective

Preserve a clean route to adding a high-fidelity internal hydrodynamics solver later without requiring that solver in the initial implementation.

## 12.2 Deferred physical capabilities

A future solver may add:

- Spatially resolved internal pressure, density, and temperature.
- Shock propagation through planetary interiors.
- Detailed deformation of differentiated bodies.
- Material mixing and phase transitions.
- More detailed gas-envelope interaction.
- High-fidelity giant-impact disruption and remnant reconstruction.

These capabilities are not initial acceptance requirements.

## 12.3 Required architectural preparation

The initial engine must avoid designs that unnecessarily prevent a later solver from being integrated.

Where appropriate, define stable interfaces for:

- Pre-impact state and material profiles.
- Impact geometry and boundary conditions.
- Collision model selection.
- Solver execution and result status.
- Post-impact remnants.
- Fragment and debris distributions.
- Conservation diagnostics.
- Transfer back into the N-body simulation.
- Rendering and event history.

The interface should not assume that every future solver will use SPH. A solver adapter or equivalent abstraction may be appropriate, but Opus must justify the complexity based on the actual codebase.

## 12.4 Fidelity labeling

The engine must distinguish among:

- Calculated physical quantities.
- Empirical or analytical model outputs.
- Reduced-order spatial approximations.
- Statistical debris representations.
- Purely visual effects.
- Future unsupported capabilities.

The UI or diagnostics should not imply that internal hydrodynamics has been resolved when only a reduced-order approximation is used.

## 12.5 Acceptance criteria

- The initial implementation does not require a hydrodynamics dependency.
- Collision outcome models can be expanded or replaced without redesigning the whole product.
- Event records can accommodate additional physical fields in a versioned manner.
- Existing simulation state can receive a future solver's remnant outputs through a defined integration boundary.

---

# 13. Shared Data and Event Contracts

The exact implementation must be determined after the repository audit, but the following logical contracts are required.

## 13.1 Collision input

The collision resolver must receive enough information to identify the colliding bodies, reconstruct the impact conditions, access their material profiles, and select a valid outcome model.

It must also receive or have access to the simulation context needed for the selected calculations.

## 13.2 Collision result

A collision result must be capable of describing:

- The selected outcome.
- Surviving or transformed bodies.
- Removed bodies.
- Newly created remnants.
- Tracked fragments.
- Statistical debris populations.
- Material and mass accounting.
- Updated motion and spin states where supported.
- Diagnostics and warnings.
- Model version and approximation metadata.

A result must be validated before it is committed to authoritative simulation state.

## 13.3 Visual event description

The visual event must reference the physical collision event and provide the data needed to visualize:

- Impact location and orientation.
- Ejecta sources.
- Fragment trajectories or authoritative fragment identities.
- Debris-cloud parameters.
- Relevant timing and outcome information.
- Visual-only effects and their lifetimes.

The renderer must not reconstruct the collision independently from scratch or invent a conflicting outcome.

## 13.4 Fragment representation

The fragment system must distinguish tracked physical objects, statistical material populations, and nonphysical visual particles.

Conversions between these representations must have documented rules and accounting.

## 13.5 Versioning

Any persisted event, collision result, or material profile must have an explicit compatibility strategy appropriate to the existing application.

Opus must determine the concrete schemas and migration mechanism after inspecting the repository.

---

# 14. Cross-Feature Acceptance Scenarios

These scenarios verify that the ten features work together rather than passing only isolated unit tests.

## Scenario A — Asteroid impacts the south pole

**Setup:** A rotating rocky planet and an asteroid with known mass, material, and trajectory.

**Expected:**
- Reliable collision detection.
- Correct contact point and impact diagnostics.
- Initial localized damage.
- Ejecta originating from the impact region.
- Fragments with coherent initial velocities.
- Continued physical and visual evolution.
- No uniform instantaneous damage applied by default to the entire surface.

## Scenario B — Rocky asteroid strikes a gas giant

**Setup:** A rocky asteroid approaches a gas giant.

**Expected:**
- The target is identified as envelope-dominated.
- The selected model handles the interaction as a gas-envelope event rather than an ordinary rigid-sphere merger.
- The outcome and its limitations are recorded.
- Ejecta, remnants, or envelope-loss approximations are consistent with the selected model.
- The event does not claim fully resolved gas dynamics.

## Scenario C — Oblique impact and hit-and-run

**Setup:** Two bodies collide at an oblique angle under conditions where the chosen model predicts hit-and-run.

**Expected:**
- The outcome model selects the supported hit-and-run regime.
- Surviving remnants have consistent post-impact states.
- Mass and momentum are accounted for.
- The renderer visualizes both remnants and the relevant debris.
- The simulation continues without duplicating or losing bodies.

## Scenario D — Catastrophic planetary disruption

**Setup:** A planetary impact lies within a validated catastrophic-disruption regime.

**Expected:**
- The selected model produces an appropriate remnant and debris distribution.
- Material accounting is explicit.
- Fragments follow coherent trajectories.
- Bound debris may remain in orbit or reaccrete.
- Unbound material can escape.
- Resource limits do not silently discard physical mass.
- Diagnostics identify conservation residuals and approximations.

## Scenario E — Secondary impact

**Setup:** A fragment created by one impact later strikes a moon or planet.

**Expected:**
- The fragment remains registered as a physical object or represented population.
- Its trajectory is derived from its physical state.
- The secondary collision is detected and resolved.
- The event is linked to its parent collision.
- The new collision produces appropriate damage and debris.
- The original event history remains intact.

## Scenario F — Pause, resume, and replay

**Setup:** A collision produces multiple fragments and an evolving debris field.

**Expected:**
- Pause freezes the simulation and the associated animation coherently.
- Resume continues from the appropriate state.
- Time scaling does not independently accelerate visual effects and physical motion in contradictory ways.
- Replay, when supported by available state history, reproduces the event consistently.
- Expired visual effects may be cleaned up, but physical fragments remain accounted for.

## Scenario G — Independent simulations

**Setup:** Two independent simulations produce different collision events.

**Expected:**
- Each simulation owns its own collision state and fragment populations.
- Events, random seeds, and debris do not leak across simulations.
- Updating one simulation does not mutate the other.
- Save/restore preserves the correct association between events and their simulation.

## Scenario H — Regression and performance

**Setup:** Run the existing test suite and established non-collision scenarios alongside collision stress tests.

**Expected:**
- Existing supported workflows continue to pass.
- Collision and particle limits are respected.
- Performance fallbacks are explicit.
- Mass and momentum accounting remain available when rendering detail is reduced.
- Baseline failures and newly introduced regressions are reported separately.

---

# 15. Required Implementation Planning Deliverables

Opus must use this specification to produce a repository-specific plan before Sonnet begins implementation.

The plan must include the following deliverables.

## 15.1 Repository audit

Identify:
- Existing simulation and integration architecture.
- Current body and material representations.
- Existing collision detection and resolution paths.
- Renderer and particle/effect architecture.
- State ownership and simulation isolation.
- Persistence and migration mechanisms.
- Existing tests and baseline failures.
- Performance bottlenecks and relevant dependencies.

The audit must be based on the actual repository, not assumptions from this document.

## 15.2 Requirement-to-code map

For each requirement, identify:
- Existing implementation, if any.
- Missing capability.
- Required modification.
- Relevant modules and interfaces.
- Tests needed.
- Dependencies or blockers.

The plan must distinguish genuinely missing features from existing capabilities that need validation or integration.

## 15.3 Scientific model selection

For every selected physical model, document:
- The physical regime it covers.
- Its required inputs.
- Its outputs.
- Its assumptions and validity limits.
- Relevant reference literature.
- How its outputs are tested.
- What happens outside its supported range.

Model selection must not be reduced to choosing the most sophisticated-sounding algorithm.

## 15.4 Architecture and contracts

Specify:
- Module responsibilities.
- Collision input and result contracts.
- Material profile representation.
- Fragment and debris representations.
- Event history and visual event contracts.
- State-transition and validation rules.
- Error handling and fallback policies.
- Persistence and compatibility changes.
- Future hydrodynamics integration boundary.

## 15.5 Phased implementation plan

Break the work into stages that can be independently reviewed and tested.

For every stage, specify:
- Exact scope.
- Expected code changes.
- Dependencies.
- Acceptance tests.
- Regression tests.
- Performance implications.
- Completion criteria.
- Conditions that must be satisfied before the next stage begins.

The stages must collectively cover all initial requirements in this document. Hydrodynamics itself remains deferred.

## 15.6 Risk register

Identify risks such as:
- Collision-detection errors.
- Numerical instability.
- Invalid or extrapolated physical models.
- Mass or momentum accounting failures.
- Fragment-count explosion.
- Renderer/physics desynchronization.
- Persistence incompatibility.
- Excessive performance cost.
- Unintended changes to the existing orbital simulation.

Each risk must have a mitigation or a clearly stated unresolved decision.

## 15.7 Requirement traceability

Every numbered feature, acceptance criterion, and cross-feature scenario in this specification must map to one or more planned implementation tasks and tests.

If a requirement cannot be met, Opus must state the reason, options, and trade-offs. It must not silently remove the requirement.

---

# 16. Implementation Rules for Sonnet

Once the plan has been reviewed and approved, Sonnet must implement it under the following rules.

1. Inspect the actual code before editing a subsystem.
2. Follow the approved plan and preserve its requirement traceability.
3. Work in bounded stages with clear completion criteria.
4. Add or update tests with each meaningful change.
5. Do not replace a scientifically grounded model with arbitrary behavior to make a demo look impressive.
6. Do not invent modules, APIs, or data fields without verifying the current architecture.
7. Avoid unnecessary dependencies and architectural rewrites.
8. Preserve unrelated changes and respect existing branch and worktree state.
9. Never discard uncommitted user work or overwrite unrelated work.
10. Run relevant tests after each stage and the broader regression suite at planned checkpoints.
11. Report exact test outcomes, failures, skipped tests, and known limitations.
12. Do not claim a feature is complete based only on code being written; demonstrate it through tests or reproducible scenarios.
13. Keep physical correctness, performance, and rendering correctness independently testable.
14. Stop and report a material conflict between the specification and the approved plan instead of silently changing scope.
15. Keep the hydrodynamics implementation deferred unless the user explicitly changes the scope.

---

# 17. Definition of Done

The initial collision and particle engine is complete only when:

- All ten features have been addressed.
- All initial requirements have implementation evidence.
- All required acceptance scenarios pass or have explicitly approved, documented limitations.
- Collision outcomes are driven by the selected physical models.
- Localized impacts behave as specified within the supported damage approximation.
- Fragments and debris have coherent trajectories and a defined lifecycle.
- Physical mass and momentum accounting is available and validated within declared tolerances.
- Rendering follows the authoritative physical event.
- Simulation controls and isolation remain correct.
- Performance limits and fallback behavior are explicit.
- Persistence remains compatible or is safely migrated.
- Existing regression tests pass, with baseline failures clearly distinguished.
- Future hydrodynamics can be integrated without redesigning the entire collision system.
- The implementation has documented model assumptions and reproducible validation scenarios.

A visually spectacular explosion is not, by itself, a completed collision engine.

**The standard is a coherent physical event—from impact detection through outcome selection, localized damage, fragmentation, debris evolution, rendering, and long-term gravitational aftermath—with explicit scientific and numerical limitations.**

---

# 18. Final Product Requirement

Playing God's collision and particle engine must turn a collision from a single event that merges two bodies into a coherent, inspectable physical process.

A user should be able to understand:
- What collided.
- Where the impact occurred.
- Why a particular outcome was selected.
- How material properties influenced the result.
- Where fragments and ejecta came from.
- How those fragments moved.
- What material remained bound, reaccreted, or escaped.
- What was calculated, approximated, or only visualized.

The first implementation must deliver this experience within a clearly documented physical model, while preserving an extensible architecture for future hydrodynamics.

**This specification defines the required behavior. Opus determines the repository-specific implementation plan. Sonnet implements the approved plan. Neither agent may silently redefine the product scope.**
