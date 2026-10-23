# Independent first-principles physics review — PLAYING GOD M0

**Date:** 2026-10-23  
**Purpose:** Independent analytical reference for comparison with the engine and the other implementation. This derivation did not inspect another reviewer's calculations or engine outputs.  
**Units assumed for this report:** SI: kg, m, s, J, kg·m²/s; G = 6.67430×10^-11 m³ kg^-1 s^-2.  
**Reproducibility:** `context/independent_reference.py` uses only Python's standard library and direct scalar/vector arithmetic, not REBOUND or project code. Its printed outputs are independent arithmetic checks, not simulation validation.

## 1. Newtonian two-body gravity

Let `r = r2-r1`, `d=|r|`, and `rhat=r/d`. Newton's law gives force on body 1 toward body 2:
`F1 = G m1 m2 r/d^3 = (Gm1m2/d²) rhat`.
Newton's third law gives `F2=-F1`. Dividing by each body's own mass:
`a1 = G m2 r/d³ = (Gm2/d²) rhat`
and
`a2 = -G m1 r/d³ = -(Gm1/d²) rhat`.
Thus both accelerations point toward the other body. Force magnitudes are equal, but acceleration magnitudes scale with the *other* body's mass: `|a1|/|a2|=m2/m1`. Each acceleration falls as `d^-2`; doubling separation quarters acceleration. This is a point-mass, unsoftened Newtonian model and is singular at d=0.

**Dimensions:** `[G]=L³ M^-1 T^-2`; `[Gm/d²]=(L³M^-1T^-2)(M)/L²=L T^-2`, i.e. m/s². Force `[Gm1m2/d²]=M L T^-2, i.e. N.

**Worked SI example:** m1=2.0×10^10 kg at r1=(0,0,0) m; m2=3.0×10^10 kg at r2=(3000,4000,0) m. Then r=(3000,4000,0) m and d=5000 m. For body 1:
- magnitude = Gm2/d² = (6.67430×10^-11)(3.0×10^10)/(25×10^6) = 8.00916×10^-8 m/s².
- direction = (0.6,0.8,0), so a1=(4.805496×10^-8, 6.407328×10^-8, 0) m/s².
For body 2, magnitude = Gm1/d² = 5.33944×10^-8 m/s² and a2=(-3.203664×10^-8,-4.271552×10^-8,0) m/s². The direction is exactly opposite and magnitude ratio is 1.5, as m2/m1 predicts.

**Independence:** derive expected values from G, masses, coordinates, and the analytical equations, then compare the program's output to those constants. A test that calls the same acceleration helper or reuses its intermediate displacement/norm routine can repeat the same bug and is not independent. This report's example is manually reduced from stated coordinates; the accompanying script implements the equations separately using only Python math/vector arithmetic. A second independent check can use force balance and the ratio `m1 a1 + m2 a2=0`.

## 2. Perfectly inelastic merger

Assume an isolated pair, no mass loss, no external impulse during the instantaneous collision, and velocities immediately before contact. Define M=m1+m2, `V=(m1v1+m2v2)/M`, `vrel=v1-v2`, and reduced mass `mu=m1m2/M`. Write:
`v1=V+(m2/M)vrel`; `v2=V-(m1/M)vrel`.
Substitution into the kinetic-energy sum gives
`Ki = 1/2 M |V|² + 1/2 mu |vrel|²`.
A single merged body's translational kinetic energy is `Kf=1/2 M|V|²`. Therefore the exact translational energy converted out of pair translation is
`ΔK_loss = Ki-Kf = 1/2 mu |vrel|² ≥ 0`.
This identity applies in any inertial frame; the removed term is frame-independent.

Mass: `Mf=M`. Momentum before is `Pi=m1v1+m2v2); after is `Pf=M V=Pi`. Dimensions: mass kg; momentum kg·m/s; kinetic energy `[mu v²]=kg·m²/s²=J`.

The pair's mutual gravitational potential immediately before contact at center separation d is `U12=-Gm1m2/d` (J; `[Gm1m2/d]=kg·m²/s²`). It is not the same as `ΔK_loss`. A collision converts translational relative energy into internal heating, deformation, fracture, radiation, or spin depending on the physical model. A one-particle point-mass representation has no pair self-potential after merging, so the potential bookkeeping changes; in a more complete body model self-binding/internal energy is retained. If there are external bodies, their potential terms also change as the pair is replaced by one source. Do not call the pair's potential drop “kinetic energy lost.”

### Head-on worked merger

Let m1=2 kg, m2=1 kg, radii R1=R2=1 m, with contact separation d=2 m. Let v1=(3,0,0), v2=(-3,0,0) m/s. (The chosen frame is an inertial frame; these velocities do not imply equal/opposite momentum because masses differ.)
- M=3 kg; Pi=(2·3 + 1·(-3),0,0)=(3,0,0) kg·m/s.
- V=Pi/M=(1,0,0) m/s; Pf=3(1,0,0)=(3,0,0) kg·m/s.
- Ki=½·2·9 + ½·1·9=13.5 J. Kf=½·3·1=1.5 J.
- mu=2/3 kg; |vrel|=6 m/s; loss=½·(2/3)·36=12 J=Ki-Kf.
- U12=-G·2·1/2=-6.67430×10^-11 J at d=2 m. It is a separate potential-energy term, not the 12 J translational loss.
- Head-on orbital angular momentum about CM is zero because relative position and relative velocity are parallel.

### Off-centre/grazing worked merger

Let equal 1 kg spheres have radii 1 m, so contact separation is 2 m. In the CM frame at contact take `r=r1-r2=(-1.6,1.2,0)` m and `vrel=v1-v2=(10,0,0)` m/s; each body's velocity is ±(5,0,0) m/s and position is ±r/2. This is grazing because impact parameter b=1.2 m is less than R1+R2=2 m.
- M=2 kg, V=0, Pi=Pf=0.
- Ki=2·½·1·25=25 J; Kf=0; mu=0.5 kg and ½mu|vrel|²=25 J.
- `Lorb=mu(r×vrel)=(0,0,-6)` kg·m²/s. Dimensions: kg·m·m/s.
- Volume-additive radius is `R=(1³+1³)^(1/3)=1.25992105 m`.
A merged, non-spinning point mass at the CM has zero represented orbital angular momentum. Linear momentum is conserved, but total angular momentum is not represented: the missing -6 kg·m²/s must be explicitly discarded as a model approximation or stored as remnant spin (or other angular momentum-bearing degrees of freedom). If the remnant is approximated as a uniform solid sphere, `I=(2/5)MR²=1.26992084 kg·m²`, `ω=L/I=-4.72470394 rad/s`, and spin energy is `L²/(2I)=14.1741118 J`. In this idealized spin-retaining accounting, remaining energy from the 25 J relative translation is 10.8258882 J for heat/deformation/etc. This spin calculation depends on the assumed density profile and spherical remnant; it is not a universal collision outcome.

**Assumptions/limitations:** fixed mass; perfect sticking; center-of-mass remnant position at event time; spherical constant-density volume rule for radius; no fragmentation, ejecta, radiation, tidal deformation, or pre-existing spin; pair isolated for the momentum derivation. If collision occurs under external gravity, the collision impulse still conserves pair momentum only when external impulse over the collision duration is negligible; total system momentum is the stronger conserved quantity.

## 3. Collision geometry and detection

For spherical radii R1,R2, define R=R1+R2 and relative position `r(t)=r1(t)-r2(t)`. Geometric contact/overlap is `|r(t)|≤R`; first contact solves `|r(t)|=R`. The strict “less than” versus “less than or equal” policy at tangency must be explicit.

For a constant relative velocity u over interval [0,dt], `r(t)=r0+ut`. Squared separation is a quadratic:
`q(t)=|r0|²+2t(r0·u)+t²|u|²`.
For `|u|²>0`, its unconstrained minimum occurs at `t*=-r0·u/|u|²`. Clamp to the interval:
`tau=clamp(t*,0,dt)`; `dmin=|r0+u tau|`.
Collision during the interval iff dmin≤R. If u=0, dmin=|r0|. This test detects any swept-sphere crossing under the straight-line assumption. Endpoint-only tests check only `|r0|≤R` and `|r0+u dt|≤R`; both can be false while the interior minimum is below R.

Gravity makes u change over the interval. A straight chord can differ from the curved trajectory, with leading positional deviation proportional to relative acceleration times dt² (for constant acceleration, midpoint deviation from the chord is |arel|dt²/8). Thus swept-linear geometry is not exact for a large curved step. Reduce dt, substep, or solve for the earliest root on a sufficiently accurate trajectory, then re-evaluate other bodies after every event.

### Geometry examples and expected outcomes

| Case | Inputs (relative state, radii, interval) | Independent expected result | Pass/fail evidence |
|---|---|---|---|
| Slow head-on | r0=(-5,0,0) m, u=(1,0,0) m/s, R=2 m, dt=4 s | Contact first at t=3 s; at t=4 separation is 1 m (overlap). | Report first-contact time 3 s within declared tolerance; endpoint detector sees overlap but must not report a false earlier contact. |
| Fast head-on / tunnel | r0=(-100,0,0) m, u=(1000,0,0) m/s, R=2 m, dt=0.2 s | Contact interval [0.098,0.102] s; closest approach t=.1 s, dmin=0; endpoints are 100 m away. | Endpoint-only detector fails this fixture; swept/root detector reports contact. |
| Grazing | r0=(-5,1.9,0) m, u=(10,0,0) m/s, R=2 m, dt=1 s | Closest approach at .5 s; dmin=1.9 m, so collision. First contact x=-sqrt(4-1.9²)=-0.6244998 m, t≈0.4375500 s. | Detect, and distinguish contact root from closest-approach time. |
| Near miss | Same, but impact parameter 2.1 m | dmin=2.1 m>2 m, no collision. | No collision with a tolerance smaller than 0.1 m; overly generous epsilon is a false positive. |
| Two hits in one step | Point projectile x=-5 m, vx=20 m/s, targets at x=0 and 10 m, each combined collision radius 1 m, dt=1 s | Candidate contacts with target 1 at .2 s and target 2 at .7 s if projectile remains unchanged. A first merger changes mass/state and may remove the second event. | Select earliest event (.2 s), resolve it, recompute state and next candidates; never apply both stale predicted events unconditionally. |
| Three-body encounter near contact | A and B approach within R while C passes nearby; C's gravity changes relative acceleration during dt | No universal numeric event time without masses, full initial state, and integrated curved trajectory. Straight-line pair prediction can shift or miss the root. | Define a fully specified initial value problem; refine dt/solver tolerance and compare earliest-contact time and all three states. Recompute after first event. Mark uncomputed values as not analytically determined. |

The numerical values in first five rows follow the stated constant-velocity model; they do not validate an engine. Three-body encounter requires additional initial conditions and a numerical reference; no value is claimed here.

## 4. Checkpoint and reproducibility test

Create a collision-free baseline first, then a collision case. For each, run A uninterrupted from t0 to t1. Run B from identical initial state to checkpoint time tc, serialize, restore into a fresh process/object, then advance exactly t1-tc using the same algorithm/configuration. Compare at the same physical time:
- simulation time and all body IDs/order, mass, radius, position, velocity, and any spin/internal-energy fields;
- G, unit/convention metadata, integrator identity and parameters, fixed/adaptive timestep state, timestep/controller history if required by the integrator, collision search and resolution policy, tolerances, box/boundary settings;
- custom ID map, next-ID counter, callbacks reattached to equivalent code, random generator state/seed, event log/sequence counters, and pending events.
For collision run additionally compare collision pair IDs, event count/order, event times, pre/post states, and diagnostics.

A checkpoint taken on a fixed-step boundary is simplest. Saving only visible particle positions and velocities can fail to restore the integrator's hidden adaptive history, collision configuration, callbacks, custom IDs, random state, or queued events. A collision exactly at the checkpoint boundary needs an explicit “before/after event” convention to prevent duplicate or omitted merges.

Use per-field absolute and relative tolerances, and compare conserved quantities plus a state norm. Same machine, same binary/version, same deterministic settings may produce very close results, but bitwise equality is not a general promise. Different machines/library versions/integrators can change floating-point summation, adaptive decisions, or chaotic trajectory phase. Legitimate numerical divergence should shrink or remain within the established convergence envelope; changed particle count, missing collision event/configuration, different IDs, large momentum jump, or divergent smooth no-collision state indicates a restoration defect.

## 5. Tolerances, units, and error sources

There is no universal tolerance independent of scale, integrator, duration, event model, and demo requirements. Set tolerances before looking at outcomes. Use scale-aware comparisons `|x-xref|≤atol+rtol·|xref|`; state vector comparisons should use characteristic length/speed scales, not a single unscaled tolerance.

| Quantity | Recommended method / starting point | What dominates |
|---|---|---|
| Acceleration vs analytical pair value | In simple double-precision pair fixture, begin with rtol around 1e-12 and scale-aware atol near roundoff times the characteristic acceleration; verify with at least two independent configurations/scales. Tighten only if arithmetic and coordinate scale permit. | Floating point and implementation arithmetic; singular/near-zero vector components require atol. |
| Merger mass and momentum | Compute from pre-event values independently. For double precision and a two-body algebraic merge, residual target around 1e-12 relative to a nonzero characteristic mass/momentum is a reasonable initial diagnostic, not an engine guarantee. If true P≈0, use absolute scale Σm|v|. | Roundoff/cancellation; external impulse if collision is not treated as instantaneous/isolated. |
| Merger kinetic-energy loss | Compare Ki-Kf to ½μ|vrel|²; use relative residual when expected loss is nonzero and scale Σ½m v² near zero-loss cases. Initial algebraic target about 1e-12 for double precision. | Roundoff plus mismatch in pre/post event state; not the total gravitational energy change. |
| Collision event time and minimum distance | For normal approach, relate timing error to spatial error by δt≈δd/|v·n|. At grazing, normal speed tends to zero and time is ill-conditioned: judge dmin-R and convergence instead. Require refinement in dt; report absolute seconds/meters and relative errors. | Straight-line/curvature approximation and event root localization, usually much larger than roundoff. |
| Checkpoint reproducibility | First measure serialize/restore error at tc. Then compare smooth trajectory at identical t. Set threshold from the serialization baseline plus integrator convergence study; collision/event comparison also needs event tolerance. Do not demand bitwise equality across hardware or versions. | Omitted hidden state, serialization precision, integrator/adaptive state, nondeterminism, chaotic sensitivity. |
| Orbit energy/angular momentum drift | Record max absolute/relative excursion and long-term trend over a declared number of periods; compare dt, dt/2, dt/4 (and a higher-accuracy reference). For symplectic fixed-step methods energy may oscillate boundedly rather than drift monotonically. Set allowed drift from acceptable orbit/state error over demo duration. | Integrator truncation and close encounters; force summation roundoff at large N. |

Distinguish:
- **Round-off:** finite precision in arithmetic; reduced by stable formulas/scaling, not by merely reducing dt indefinitely.
- **Integrator error:** truncation in approximating smooth gravitational motion; measured by timestep/tolerance refinement.
- **Collision-model approximation:** perfectly sticking spheres, no fragments/ejecta/tidal deformation, possibly no spin; not fixed by smaller dt.
- **Event-detection error:** timestep sampling, swept-line curvature, root localization, event ordering; measured with analytic fixtures and dt refinement.
A convergence study can reveal observed order: if halving dt reduces a smooth-state error by about 4, that is evidence of second order in that regime. It does not establish collision correctness or global order across discontinuous merger events.

## 6. Priority edge cases for a 36-hour implementation

1. Coincident/near-coincident centers (avoid division by zero/NaN; define overlap resolution).
2. Very unequal masses, zero mass if schema permits, tiny/huge scales, overflow/underflow.
3. Zero relative velocity; exact tangency; near-miss within geometric epsilon.
4. Fast tunnelling with both endpoints outside; grazing and high-curvature close approach.
5. Multiple candidate impacts in one step; collision chains; simultaneous events and deterministic tie policy.
6. Three-body close encounter where third-body acceleration bends the path.
7. Merge with zero net momentum, large momentum cancellation, off-center angular momentum, pre-existing spin if modeled.
8. Radius update choice (volume-additive vs another density rule), and radius zero/invalid inputs.
9. Checkpoint immediately before/after collision; callbacks/config/IDs/event history and adaptive-step state restore.
10. Collision pair IDs stable across particle removal/reindexing; no duplicate event side effects.
11. Units consistency and coordinate-frame translations/boosts; gravity should be Galilean invariant and depend only on relative separation.
12. Very long orbit runs, close periapsis, and near-parabolic/unbound trajectories.

## 7. Assumptions and limitations

| Assumption | Consequence / limitation |
|---|---|
| Newtonian point-mass force, no softening | Singular at zero separation; finite radii affect collision detection only, not pre-contact force law. |
| Collision spheres | Contact uses center distance R1+R2; ignores deformation and material properties. |
| Perfectly inelastic sticking | Removes pair relative translation; does not predict fragmentation, rebound, radiation, heat partition, or remnant shape. |
| No spin in baseline merger | Orbital angular momentum disappears from represented state in off-centre impacts. |
| Isolated instantaneous pair for merger identities | External impulses and multi-body simultaneous impacts need full-system event treatment. |
| Constant-velocity swept path | Exact only for linear relative motion over the step; gravity curves paths. |
| SI units | Inputs and outputs require consistent conversion; G must match kg/m/s. |
| Finite precision and finite timestep | Exact analytical conservation is not expected at machine level throughout numerical integration. |
| Checkpoint equality | Same algorithm/configuration is required; bitwise equality across environment/version is not assumed. |

## Recommendation

Newtonian gravity plus a custom collision layer is physically defensible for a simplified educational sandbox if the product clearly labels its perfect-sticking/finite-step approximations, validates pair forces and merger bookkeeping against independent formulas, localizes or bounds collision-time error, and preserves or reports angular momentum/energy that its state model omits. A single non-spinning point remnant is acceptable as an explicit simplification, but it does not conserve total angular momentum for grazing mergers. The engine's output must be checked against the fixtures here; this report itself does not claim an engine pass.

## Independent calculation source

See `context/independent_reference.py`. It uses only Python standard library `math` and direct vector operations. Run from repository root with `python context/independent_reference.py`. Expected console values from this run:
- gravity: d=5000 m; a1=(4.805496e-8,6.407328e-8,0) m/s²; |a1|=8.00916e-8; a2=(-3.203664e-8,-4.271552e-8,0), |a2|=5.33944e-8.
- head-on: Pi=(3,0,0) kg·m/s; V=(1,0,0) m/s; Ki=13.5 J; Kf=1.5 J; loss=Erel=12 J; U12=-6.67430e-11 J.
- grazing: |r|=2 m; L=(0,0,-6) kg·m²/s; pair relative K=25 J; volume radius=1.25992105 m; uniform-sphere I=1.26992084 kg·m²; omega_z=-4.72470394 rad/s; spin energy=14.1741118 J; residual heat under that assumed spin model=10.8258882 J.
- swept cases: slow head-on contact; fast head-on minimum at t=.1 s; grazing collision at t=.5 s and dmin=1.9 m; near miss dmin=2.1 m.

**Not calculated here:** a unique three-body event time; it requires specific masses and full initial conditions plus numerical integration. No REBOUND run, checkpoint experiment, or engine output is asserted by this report.


