# Independent validation: production REBOUND physics

**Date:** 2026-10-24  
**Reviewer branch:** `validation/production-physics-review`, based on `feature/production-rebound-simulation` at `af3b29a`  
**Scope:** read-only review of `backend/simulation.py` and `backend/collisions.py`; new checks are isolated in `tests/validation/`. No production implementation was edited.

## Method and assumptions

The reference values below come from Newton's law, the exact Kepler circular two-body solution, conservation of two-body energy and angular momentum, and closed-form radial free fall. The independent fixtures do not call REBOUND to produce expected values and do not reuse production test helpers. The service is exercised only to obtain the observed state/events.

Assumptions are SI units, (G=6.67430\times10^{-11}\), Newtonian point-mass gravity, finite spherical collision radii, and a perfectly inelastic merger. Radius does not soften gravity. There is no relativistic correction, fragmentation, radiation, or rotational dynamics. IAS15 and REBOUND `line` collision detection are the implementation under review. Results are specific to REBOUND 5.2.2 / Python 3.12.10.

## Independent numerical results

| Check / reproducible fixture | Analytical expectation | Observed result | Criteria and outcome |
|---|---|---|---|
| Non-axis-aligned acceleration: (m_1=4\times10^{12}) kg at (0,0,0), (m_2=7\times10^{12}) kg at (1200,1600,0) m, initially at rest; step 1 s | (d=2000) m; force magnitude (Gm_1m_2/d^2); (a_1=(7.008015\times10^{-5},9.344020\times10^{-5},0)) m/s²; (a_2) points oppositely | (\Delta v_1/\Delta t=(7.0080152144\times10^{-5},9.3440202858\times10^{-5},0)) m/s²; component relative error (3.06\times10^{-8}) | Relative tolerance (2\times10^{-6}), allowing the predicted finite-step change in separation. **Pass.** Direction and component ratio also agree. |
| Sun–Earth mass ratio circular binary, barycentric initial conditions, one exact Kepler period | (T=2\pi\sqrt{a^3/[G(m_1+m_2)]}=31,557,671.482614245) s; relative position returns to (1 AU,0,0); (E=-Gm_1m_2/(2a)); (L=\mu\sqrt{G(m_1+m_2)a}) | Relative-position error (1.34\times10^{-15}); relative energy drift (4.35\times10^{-16}); relative angular-momentum drift (1.82\times10^{-16}); no collision | Position tolerance (2\times10^{-8}a); energy and angular-momentum drift (2\times10^{-10}). **Pass.** This is one smooth circular orbit, not a bound on close-encounter error. |
| Head-on merge: masses (2\times10^6,3\times10^6) kg; radii 10 m; centres at ±1000 m; velocities ±500 m/s | \,\(\mu=1.2\times10^6\) kg; initial relative KE (6.00000000000\times10^{11}) J; COM velocity −100 m/s; total initial momentum −(5\times10^8) kg·m/s. At contact (U=-20.0229) J and gravitational focusing raises (K_{rel}) by 19.8227 J. | One merger; mass (5\times10^6) kg; momentum residual (1.19\times10^{-7}) kg·m/s (about (2.4\times10^{-16}) relative); (v_{COM}=-100) m/s; event KE (600000000019.8986) J, 0.0759 J above the contact-energy reference; spin 0. | Momentum tolerance (2\times10^{-12}) relative; KE comparison uses contact-state energy, not the initial KE alone. **Pass.** Event was detected 75.5 μs after analytic contact; the contact-time estimate was 1.979999999999 s versus 1.98 s. |
| Grazing merge: same masses/radii and speeds, impact parameter 15 m | (L_{orb,COM}=\mu b v_{rel}=-1.8\times10^{10}) kg·m²/s; initial total (L_z=-1.875\times10^{10}) kg·m²/s; expected remnant orbital (L_z=-0.75\times10^9) plus spin −(1.8\times10^{10}). | Event and internal spin ledger both report −(1.8\times10^{10}); remnant orbital plus spin exactly reproduces the initial total in this run. Momentum residual (5.96\times10^{-8}) kg·m/s. Event KE is within 0.77 J of the two-body contact-energy reference. | Spin-ledger tolerance (2\times10^{-6}) relative; momentum (2\times10^{-12}). **Pass.** Spin is bookkeeping only and does not affect later motion. |
| Fast collision at 0.49c per body (numerical stress only): masses (10^{10},2\times10^{10}) kg, radii (5\times10^5) m, initial separation (10^9) m | Relative speed (0.98c=293,796,608.84) m/s; straight-line contact time 3.4003115419 s; Newtonian (\tfrac12\mu v_{rel}^2=2.8772149122\times10^{26}) J | One merger, exact relative speed and KE to shown precision; estimated contact time agrees to <(10^{-14}) s. Detection time is the request endpoint, 4 s. | **Pass for numerical sweep detection only.** Newtonian KE and momentum are not physically valid at this speed. |
| Fast near miss: relative speed (2\times10^6) m/s, impact parameter 2.002 m, radii sum 2 m, one 0.002 s step | Minimum straight-line distance 2.002 m (>R_1+R_2) | No merger; two bodies remain. | **Pass.** |
| Exact tangency: same sweep but impact parameter exactly 2 m | Geometric minimum distance equals (R_1+R_2); expected result depends on inclusive-contact convention | REBOUND reports one merger, but `estimatedContactTimeS` is `null` (analytic contact is 0.001 s). | Collision outcome **passes** the inclusive-contact convention. Event-time estimate is a known edge limitation: the quadratic is ill-conditioned at a double root. |
| Three-body simultaneous chain: masses (10^6,10^7,2\times10^6) kg at x=−30,0,+30 m; radii 10 m; outer velocities ±10 m/s; step 1.2 s | Both initial contacts at about 1 s; final mass (1.3\times10^7) kg; total momentum −(10^7) kg·m/s | Two mergers at detection time 1.060880737 s; final mass and momentum agree; no stale callbacks/errors. First contact estimate 0.999999946 s; second is `null`. | **Conservation passes.** Detection timestamp is 60.9 ms late; first estimate is accurate, second event lacks an estimate. |
| Two separated collision pairs in one 1.1 s request | Both pair contacts at 0.99 s; total mass (1.4\times10^7) kg and global momentum conserved | Two events, two remnants; total mass and momentum pass the independent checks; both estimates within 2 μs of 0.99 s. | **Pass for two independent pairs.** Does not prove arbitrary many-body collision ordering. |
| Radial fall from rest: (10^{24}) kg central body (radius (10^6) m), 1 kg probe from (10^8) m, contact radius (1,000,001) m | Exact radial time (t=\sqrt{r_0^3/[2G(M+m)]}(\theta+\sin\theta\cos\theta)=135,899.2629947) s, (\theta=\arccos\sqrt{R/r_0}) | One merger; estimated contact 135,899.2967959 s (relative error (2.49\times10^{-7})); detection at 135,902.6199284 s (3.357 s late). | Estimate tolerance (2\times10^{-3}), detection delay <1%. **Numerically passes, with an IAS15 non-convergence warning** (“at least 10 predictor corrector loops”). Warning means this case should not be described as cleanly converged. |
| Extreme mass ratio (10^{16}:1), 1 kg probe strikes a (10^{16}) kg body | Exact integer sum is 10,000,000,000,000,001 kg | Binary64 result is (10^{16}) kg: the 1 kg contribution rounds away (relative (10^{-16})); collision still resolves and momentum is retained in this fixture. | Within ordinary double-precision relative tolerances, but disproves literal “mass conserved exactly” for all allowed values. IAS15 also warns in this extreme case. |

## Tolerances and interpretation

The isolated tests use (2\times10^{-6}) relative for finite-step acceleration, (2\times10^{-8}) relative position and (2\times10^{-10}) relative energy/angular momentum for the smooth circular orbit, and (2\times10^{-12}) relative for merger momentum. Merger KE is compared with the two-body energy at contact (including gravitational focusing); the detection-state event differs by less than 0.1 J head-on and 1 J grazing in these high-KE fixtures. Timing checks distinguish detected-at-step-end time from estimated contact time. These are fixture-specific tolerances, not universal engine guarantees.

The merger KE event is translational relative KE at the resolver state. It is not total mechanical-energy loss: the pair's negative mutual potential energy disappears, and the remnant has no internal binding-energy model. `heat_J` and `spin` are private service ledgers; per-merge KE and spin increments are in events, but there is no public cumulative-ledger endpoint. Linear momentum is conserved separately from angular momentum. Angular momentum is represented by remnant orbital angular momentum plus booked spin; no spin dynamics or spin energy are evolved.

## Findings and remaining validation

1. The independent smooth-gravity and merger fixtures agree with the production service within the stated, physically justified tolerances. No production-code changes were made.
2. `line` detection caught fast through-crossings, a near-tangent overlap, two independent same-step collisions, and one simultaneous three-body chain. The near miss did not merge. This is evidence for those geometries, not proof for all curved paths.
3. Contact-time estimation can return `null` at exact tangency and for the second merge in a same-step chain. Detection time is not contact time; the API contract correctly labels it as such.
4. Large radial-fall and extreme-mass-ratio fixtures emitted IAS15 non-convergence warnings while still returning finite, apparently accurate states. The service logs but does not fail a step on REBOUND warnings. Warning policy and convergence response remain an engineering decision.
5. At 0.49c per body the numerical collision sweep works, but the Newtonian collision/energy model is physically unsuitable; the API's speed-below-c validation is only an input guard, not a relativity model.
6. Binary64 cannot represent every exact sum at extreme mass ratios. At (10^{16}:1), the 1 kg contribution disappears in the stored remnant mass, though the relative error is at the precision limit.

Recommended follow-up (not run here): strongly curved non-radial two-body contacts with timestep/request refinement; gravitationally perturbed three-body contacts against a separate high-resolution RK reference; more than three bodies in one connected simultaneous collision cluster; repeat collision-order tests over seeds; test the 2000-chunk cap and wall-clock behavior; and specify whether exact tangency must provide a contact-time estimate. Keep warning-producing cases visible in logs and decide whether non-convergence should fail or mark the step degraded.

## Reproduction

From `C:\Users\calli\code\playing-god-production-physics-validation`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q -s tests\validation
.\.venv\Scripts\python.exe -m pytest -q
```

The independent suite contains 11 tests in `tests/validation/test_independent_physics.py`. Final run: **11 passed**; complete branch suite: **160 passed, 3 warnings** (Starlette/httpx deprecation and two warnings in legacy spike merger tests). The independent radial-fall and extreme-mass-ratio checks also logged IAS15 convergence warnings.
