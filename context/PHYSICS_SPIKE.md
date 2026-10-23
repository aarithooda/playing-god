# M0 — Physics Engine Feasibility Spike (REBOUND)
**Status: plan only. No experiment has been run; nothing below is a verified result.** Statements about REBOUND are hypotheses to confirm against its docs and actual runs.

## Goal
Decide whether REBOUND can support PLAYING GOD's minimum physics with acceptable correctness and effort. Output: recorded results + an explicit go/no-go in `DECISIONS.md` (D-003). Do not build a full engine or the real simulation here.

## Questions to answer
1. How is state represented (particles, units, G, time) and how do we read/write it from Python?
2. Which integrators fit (e.g. IAS15 vs WHFast) and how do they behave with variable close encounters?
3. How are collisions detected (search mode) and resolved (built-in modes vs custom callback)? Can fast bodies tunnel between steps?
4. Can we implement a merger conserving total mass and linear momentum, and read collision diagnostics (bodies, relative speed, relative KE) from the live state?
5. Can state be saved/restored (binary snapshot/archive) so a scenario reproduces?
6. What are the license terms and distribution implications for a hackathon demo and any later release?
7. Is performance adequate for tens to low hundreds of bodies at interactive rates over an API?

## Shared conventions (agree first, record in DECISIONS.md)
Units (e.g. SI vs scaled/AU–Msun–yr), coordinate frame (right-handed, origin at barycentre?), initial conditions, tolerances. Tolerances are set *before* running and not tuned afterwards.

## Experiments
| ID | Experiment | Expected (derive by hand first — Vaibhav) | Pass criterion (to fix with units) |
|---|---|---|---|
| E1 | Two-body circular orbit, M≫m | Period T=2π√(a³/G(M+m)); constant separation | Period error and energy drift below agreed tolerance over N orbits; angular momentum conserved |
| E2 | Two-body eccentric orbit | Closed ellipse, E and L conserved | Same, plus periapsis returns to start |
| E3 | Collision detection, slow approach | Contact when separation ≤ r1+r2 | Event detected at the expected time ± one step |
| E4 | Tunnelling: fast small bodies, head-on, step size varied | Collision should occur; check whether engine misses it | Record the speed/step threshold where detection fails; document mitigation (smaller dt, line/continuous detection) |
| E5 | Perfectly inelastic merger | m=m1+m2; p=m1v1+m2v2 conserved; v=p/m; position at centre of mass; KE loss = ½μv_rel² | Mass and momentum conserved to numerical precision; COM unchanged |
| E6 | Collision diagnostics | Report: ids, masses, relative velocity, impact parameter, KE before/after | Values readable from simulation state at the collision and equal to hand calculation |
| E7 | Checkpoint/restore | Restore at t₀, run to t₁ equals uninterrupted run | Bitwise or within tolerance; note which engine state is/isn't captured (collision settings, callbacks, ids) |
| E8 | Performance | Wall time per step vs N (2, 10, 100, 500) | Records steps/s; compare to ~30–60 updates/s target |

## Risks to probe
- Timestep too large: collisions missed or merged late, energy error grows during close encounters.
- Collision detection checked only at step ends (tunnelling); merge removes particles — check index/id stability for the frontend.
- Callback merge conserving momentum but not the right radius/density rule: document the (approximate) radius model.
- Restore may omit Python-side state (callbacks, our own ids, event history).

## License and performance notes (to verify, not assume)
Check REBOUND's license text and that of any dependency; decide what that implies for hosting/publishing this repository (it is currently public). Note platform install issues on Windows (compiler/wheels). Record versions used.

## Go / no-go
**Go** if E1–E2, E5–E7 meet pre-agreed tolerances, E3–E4 give a documented, mitigable detection story, license is acceptable, and E8 is adequate. **No-go** if conservation or restore can't be achieved reliably, tunnelling can't be mitigated, or license is incompatible. Decision recorded jointly by project lead and Vaibhav in `DECISIONS.md` with the results table.

**Fallback:** a small in-house N-body core (velocity-Verlet/leapfrog, softened or exact pairwise force, our own swept-sphere collision test and merger) limited to the project's minimum scope, validated against the same E1–E8 tests. Choose this only after recording why REBOUND failed; avoid a full rewrite scope.

## Where results go
Harness/tests: `tests/spike/` (new files per experiment). Results table: appended below with date, versions, parameters, raw numbers, and who reviewed.

### Results
_None yet._
