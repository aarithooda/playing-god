# Project Brief — PLAYING GOD
Stable spec. Change only when product direction or scope genuinely changes.

## Vision
An interactive scientific sandbox: a browser-based 3D gravitational universe where users create bodies, run Newtonian gravity, observe collisions/mergers, and investigate the results. Not merely a pretty animation — physics is validated and approximations are documented.

## Core loop
Create → Configure → Simulate → Observe → Investigate → Modify → Simulate again.

## Intended features
- Create stars/planets; configure mass, radius, position, velocity.
- Run, pause, step, reset the simulation.
- Newtonian N-body gravity.
- Collisions with simplified merger outcomes; collision reports, physical quantities, event history.
- Approximate tidal deformation.
- Save/restore checkpoints.

## Non-goals
General relativity, hydrodynamics/SPH, full Universe Sandbox parity, multiplayer, accounts, feature breadth at the cost of correctness. (Revisit only by explicit team decision.)

## Constraints
About 36 hours. Prefer a few correct, integrated features over many unfinished ones. Architecture must stay understandable to first-year university students.

## Technology direction
Frontend: React + TypeScript + Vite + Three.js. Backend: Python + FastAPI. Physics engine: REBOUND is a *candidate only* — integration, collision behavior, checkpoints, performance and licensing must be checked in a feasibility spike first. Tests: physical behavior, key calculations, end-to-end. Git + GitHub.

## Scientific correctness principles
- The backend owns the authoritative simulation state; the frontend never runs a second simulation.
- Validate against known results (conservation of energy, momentum, angular momentum; two-body orbits).
- Document every approximation (integrator, collision model, tidal model) and its limits.
- Units and coordinate conventions are explicit decisions in `DECISIONS.md`.

## Team
1. Project lead: simulation architecture, engine integration, API contracts, numerical validation, integration.
2. Vaibhav: collision physics, mergers, conservation laws, approximate tidal deformation.
3. Frontend developer: Three.js scene, camera, visualization, controls, UI.
4. Integration/testing developer: test infrastructure, events/checkpoints, integration, docs, demo readiness.

Ownership areas are initial, not rigid; everyone may review and contribute anywhere.

## Successful demo
End-to-end in the browser: create bodies, run a stable orbit, trigger a collision, see a report with conserved-quantity checks, tweak parameters and rerun, save/restore a checkpoint — with the physics demonstrably validated by tests.
