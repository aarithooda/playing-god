# M0 — Physics Engine Feasibility Spike (REBOUND)

**Status (2026-10-23): complete. Decision: GO WITH CUSTOM COLLISION LAYER, accepted as D-008** (conditions below; limitations remain open work). All numbers below come from tests that were run on this machine (REBOUND 5.2.2, Python 3.11.7, Windows 11); expectations in the tests are hand-derived or taken from the independent review on branch `validation/physics-first-principles` (`context/INDEPENDENT_PHYSICS_REVIEW.md`, not yet merged).

## Reproduce
```bash
pip install -r backend/experiments/requirements.txt     # rebound>=5.2 (spike only; NOT in backend/requirements.txt)
python -m backend.experiments.rebound_spike             # gravity, orbits, smooth checkpoint, performance tables
python -m backend.experiments.collision_spike           # collision, merger, sweep, checkpoint-with-collision tables
pytest                                                  # full suite; spike tests are tests/spike/ (58 tests)
```
Run on 2026-10-23: `pytest` -> **88 passed, 3 warnings** (1 health + 29 API + 58 spike), about 9 s, repeated twice with identical results. Code: `backend/experiments/{rebound_spike,collision_spike}.py`; tests: `tests/spike/test_si_gravity_orbits.py`, `tests/spike/test_collisions_mergers.py`.

## Unit convention (decided by the team; D-007) and REBOUND implications
SI: m, m/s, kg, s, J, kg·m²/s; G = 6.67430e-11 m³ kg⁻¹ s⁻². Every experiment, expectation and tolerance is in SI; no dimensionless units are used.
- `sim.units = ("m","s","kg")` only labels units and sets REBOUND's own G = 6.67408e-11, **3.3e-5 relative lower** than the project value (it would shift an orbital period by ~1.6e-5). `new_sim()` therefore sets `sim.G = 6.67430e-11` explicitly (tested; with the REBOUND value the 10-orbit return error is 1e-3 vs the 1e-10 bound, so the tests would catch it).
- All times (`integrate`, `sim.dt`) are seconds; IAS15 `epsilon` is dimensionless; WHFast needs a dt in seconds (we use T/200).
- Doubles resolve ~3e-5 m at 1 AU, which bounds collision-geometry precision for small bodies far from the origin.

## Tolerances (round-off vs integration error vs model approximation)
| Class | Used for | Value and why |
|---|---|---|
| Round-off | arithmetic identities (KE loss = ½μv², mass, momentum of a merge, COM velocity) | 1e-12 relative to the scale of the quantity (e.g. Σ\|m v\|); a few thousand ε of headroom |
| Integration error, IAS15 | orbit dE/E, dL/L | 1e-12 (observed 2e-16; ~400 steps ⇒ accumulated round-off ~5e-15) |
| Integration error, IAS15 | phase: return to start after 10 orbits | 1e-10 relative (observed 5e-14–9e-14) |
| Integration error, WHFast dt=T/200 | orbit dE/E, return error | 1e-8, from the scheme: (m/M)(2π dt/T)² ≈ 3e-9 (observed ≤1e-11) |
| Model approximation | expectations from initial conditions for 1-tonne spheres that neglect mutual gravity | 1e-6 relative; the neglected speed-up is 2GM(1/r_contact − 1/r₀)/v² ≈ 5.6e-8, and with that term included the match is 1.7e-16 |
| Event time | contact time from the straight-line estimate | 1e-9 s (exact for gravity-free motion); delay of detection ≤ one step |
| Reproducibility | checkpoint restore | exact (bitwise) equality, since REBOUND is deterministic on one machine/version |
Tolerances were set from these arguments before the final runs, not tuned to pass. Cross-machine bitwise equality is **not** claimed.

## Results
### Gravity and orbits (E0–E2) — PASS
| Quantity (SI) | Expected (analytic) | Measured | Error |
|---|---|---|---|
| Earth acceleration in an Earth–Moon pair [m/s²] | G m_moon/r² = 3.3162965e-5 | 3.3162965e-5 | rel 1.4e-11 (bound 1e-9) |
| Sun–Earth period T [s] | 2π√(a³/G(M+m)) = 3.1557671e7 | used for 10-orbit runs | — |
| IAS15, e=0 / 0.5, 10 orbits | E, L, p constant; return to start | dE/E ≤ 2.2e-16, dL/L ≤ 1.8e-16, dp/(Mv) ≤ 5e-21; return 5.5e-14 / 8.5e-14 (0.008 m / 0.006 m at 1 AU) | pass |
| WHFast dt=T/200, e=0 / 0.5 | same | dE/E 2.8e-15 / 8.3e-15, dL/L 1.6e-15 / 6.3e-15; return 3.1e-12 / 1.3e-11 (0.46 m / 0.99 m) | pass |

### Collision detection (analytic scenarios, gravity negligible)
Test spheres A 2000 kg r=1.0 m, B 1000 kg r=0.8 m, contact distance 1.8 m; geometry chosen so contact is not aligned with a step end.
| Scenario | direct | line |
|---|---|---|
| Slow head-on, v_rel 2 m/s, contact 99.1185 s; dt = 1, 0.1, 0.01 s | detected, delay 0.88 / 0.081 / 0.0015 s (≤ dt) | identical |
| Fast head-on, v_rel 2000 m/s, 20 m per step | **missed** | detected |
| Phase scan: 50–100 crossing phases per step, v_rel 2000 m/s, dt 0.01, b = 0, 1e-6, 0.5 m, axis-aligned and oblique | **missed 91/100**; at 200 m/s missed 10–13/100 | missed **0/100** in all 12 configurations |
| Grazing b = 1.7 m (1.18 m path inside contact) | detected at dt 0.1; at dt 1.0 line only | detected at dt 0.1 and 1.0 |
| Near miss b = 1.9 m (0.1 m margin) | no false positive at dt 1.0, 0.1 | no false positive |
| Contact time estimate (REBOUND reports only at the step end; we solve \|r−uτ\|=R backwards) | — | matches analytic to 1e-9 s |

### Independent-review fixtures (`INDEPENDENT_PHYSICS_REVIEW.md`, derived without this spike)
| Fixture | Their expectation | Ours |
|---|---|---|
| Slow head-on, r0=(−5,0,0), u=1, R=2, dt=4 | contact 3 s, overlap at end | both modes detect at step end 4.0; contact estimate 3.0 |
| Fast head-on, r0=−97 (shifted 3 ms, see below), u=1000, R=2, dt=0.2 | endpoint detector fails, swept detects | direct missed, line detected; estimate 0.095 (analytic 0.095) |
| Grazing, r0=(−5,1.9,0), u=10, R=2, dt=1 | collision, first contact ≈0.43755 s | direct missed, line detected; estimate 0.43755002 |
| Near miss, impact 2.1 m | no collision | none in either mode |
| Head-on merger 2 kg + 1 kg, v=±3 | M=3, V=(1,0,0), Ki=13.5, Kf=1.5, loss 12 J, L_orb 0 | M=3, V=1+4e-16, loss 12.000000000009 J (7e-13), L_orb 0 |
| Grazing merger 1 kg + 1 kg | loss 25 J, L_orb=(0,0,−6), R=1.25992105 m | 25.000000000006 J (2e-13), L_orb z=−5.999999999999999, R=1.2599210499 |
Their fast fixture as written crosses at exactly dt/2: centres coincide mid-step and REBOUND returns **NaN positions** even with G=0 (0·1/0). Tested as a limitation.

### Randomised detection sweep against measured truth (the key evidence for `line`)
150 random scenarios (seed 12345): relative speed 10–1e5 m/s, impact parameter 0–3 contact distances, random 3-D direction and random encounter phase; a star + Earth-like planet set the step size, so the pair crosses inside one adaptive step. Each scenario's **true** closest approach comes from a collision-free IAS15 reference run (aimed by Newton iteration). Six scenarios within 5% of the contact distance are excluded as ambiguous; 50 true collisions, 94 true misses are classified.
| Integrator / step | direct (TP/FN/FP/TN) | line (TP/FN/FP/TN) |
|---|---|---|
| IAS15 adaptive | 0 / 50 / 0 / 94 | 50 / 0 / 0 / 94 |
| IAS15 with 1000 s step cap | 2 / 48 / 0 / 94 | 50 / 0 / 0 / 94 |
| WHFast dt = 1e5, 1e4, 1e3 s | 0 / 50 / 0 / 94 each | 50 / 0 / 0 / 94 each |
This is **evidence, not proof of general reliability**: one seed, one geometry family (star + planet tidal curvature), 144 classified scenarios per row. For constant relative acceleration the chord of a step deviates from the true path by a_rel·dt²/8 (also stated in the independent review), so `line` needs a step cap such that this is ≪ the contact distance; the sweep's curvature was too small to stress it.

### Mergers, conservation and energy accounting (custom layer; SI) — PASS
Analytic test: A 2000 kg + B 1000 kg, v_rel 2 m/s, b = 0.5 m, common drift (0.3, −0.2, 0.1) m/s, expectations from initial conditions only.
| Quantity | Expected | Measured | Error |
|---|---|---|---|
| Mass [kg] | 3000 | 3000 | 0 |
| Remnant velocity = p/M [m/s] | (0.3, −0.2, 0.1) | identical | ≤ 1e-16 |
| Remnant position after 40 s | x_com0 + v t | | < 1e-9 m |
| Translational KE lost [J] | ½μv₀² = 1333.3333333 | 1333.3334083 | 5.6e-8 (gravity speed-up) |
| … with v² = v₀² + 2GM(1/r_cb − 1/r₀) | 1333.3334083424 | 1333.3334083424 | 1.7e-16 |
| Orbital angular momentum μ(r_rel×v_rel) [kg m²/s] | (0,0,−666.6666666666665) | (0,0,−666.6666666666702) | 5e-15 |
| Total energy change KE+PE [J] | −Q + ΔPE_jump | −1333.3333326660 = −1333.3334083 + 7.57e-5 | 2e-13 |
- **Energy**: the merge discards ½μv_rel² of translational energy and removes the pair's mutual potential; **kinetic+potential energy is NOT conserved**. The layer books the lost kinetic energy in a `heat_J` ledger (there is no internal-energy variable in REBOUND) and the potential-energy jump separately.
- **Angular momentum**: a point-mass remnant keeps only M r_com×v_com. The orbital part μ(r_rel×v_rel) disappears from the particle state and is booked as remnant `spin` (L_before = L_after + spin to 1e-9). Spin energy and a spin/rotation model are *not* implemented (the independent review gives a uniform-sphere example: for its grazing case 14.17 J of the 25 J would be spin energy).
- REBOUND's built-in `"merge"` gives the same remnant mass/position/velocity but no diagnostics, no ledger, no stable-id rule and no IAS15 reset (below).

### Multiple collisions, three bodies, ids — PASS with caveats
| Test | Result |
|---|---|
| Two independent pairs (A,B), (C,D) in the same step (dt 0.5 and 5 s, direct and line) | both merged, N=4→2, mass/momentum conserved to 1e-12 relative, 0 stale callbacks, 0 exceptions |
| Chain A–B–C (A and C hit a resting B in the same step), direct and line | first merge in that step, remnant merges with the third body one step later; N=1; mass and momentum conserved; survivor id depends on callback order |
| Three-body: A,B collide while a 1e11 kg body pulls on them | one event, total momentum error **4.5e-13 kg m/s** with our layer vs **9.3e-6** (5e-9 relative) without the IAS15 reset (REBOUND's built-in merge behaves like the latter) |
| Id stability: order [X, p1, p2, Z], p1 lighter or heavier | array index of Z drops 3→2, `particles["Z"]` still finds it with the exact free-flight state (<1e-6 m); heavier body keeps its name; absorbed name raises `ParticleNotFound` |

### Checkpoint and reproducibility — PASS
| Test | Result |
|---|---|
| Smooth 3-body (Sun, Earth, Mars), save at 1e7 s, restore, advance to 2e7 s; IAS15 and WHFast | bitwise-identical positions, velocities, masses, names; t, G, integrator equal |
| Collision at ~99 s after a save at 50 s (IAS15 and leapfrog) | bitwise-identical final state, identical event list [(99.256, A, B)], same collision mode, G, N, dt, IAS15 epsilon; the original run is not perturbed by saving |
| Chain collision after restore, 10 repetitions | identical event order, survivors and state (thanks to a fixed `rand_seed`) |
| Restore without re-registering the resolver | collision mode **is** restored but the resolver is **not** (REBOUND emits a RuntimeWarning); REBOUND then raises `rebound.Collision` at the first overlap, i.e. fails loudly |
Must be reconfigured after every restore: the Python collision resolver; any custom id map/ledgers/spin/heat and our own event history (REBOUND stores only particles, `name`, radius, configuration). Not tested: archives with automatic snapshots, restores across machines or REBOUND versions.

### Performance (steps/s on this machine; 20 steps; order of magnitude only, ±2× noise)
| N | IAS15 | WHFast |
|---|---|---|
| 2 | 5e4 | 6e5 |
| 10 | 2e4 | 1.5e5 |
| 100 | 5e2–1e3 | 7e3 |
| 500 | ~40 | ~9e2 |
Collision search ('direct' and 'line') added no measurable cost relative to the O(N²) gravity at N = 10, 100, 500 (no collisions occurring). IAS15 takes many adaptive steps per simulated second, so these are not frames per second; tens of bodies are comfortable, several hundred are not interactive with IAS15.

## Observed REBOUND failure modes and mitigations
| # | Observation | Mitigation / regression test |
|---|---|---|
| F1 | REBOUND's SI `G` is 6.67408e-11, not the project's | set `sim.G` explicitly (`test_project_G_…`) |
| F2 | `direct` detects only if a step end falls inside the overlap: missed 91% of fast head-on phases and 50/50 sweep collisions with IAS15 | use `line` (`test_line_never_misses…`, `test_sweep_…`) |
| F3 | **WHFast + exact head-on (b=0), real G** returns a corrupted state (\|x\|≈1e45 m) or hangs for some separations (20007: corrupt, 20012: hangs, 20016: corrupt; 17 of 20 integer separations fine); IAS15, leapfrog, b≠0 were fine | do not use WHFast where bodies can collide (`test_whfast_radial_pass_corrupts_state_known_failure`); the process hang is not run in tests |
| F4 | A resolver returning 0 (keep both bodies) lets overlapping point masses fall to r→0 where G m₁m₂/r² diverges; IAS15 then stalled (>40 s wall for a 100 s scenario) | every resolver must merge, bounce or remove overlapping bodies; the detection recorder removes one body |
| F5 | `G = 0` with WHFast hangs; exact centre coincidence gives NaN positions even with G = 0 | harness uses leapfrog for gravity-free geometry; layer must never allow r = 0 (`test_exactly_coincident_centres…`) |
| F6 | Simultaneous collisions are resolved in **random order** (survivor id changed run to run, 30 unseeded runs gave both outcomes) | `sim.rand_seed` fixed in `new_sim()` (`test_collision_resolution_order…`, `test_chain_collision_after_restore…`) |
| F7 | IAS15 after a particle removal/merge injects momentum error (5e-9 relative with a 1e11 kg neighbour) because stale predictor coefficients no longer satisfy Σ m b = 0; built-in merge has it | re-select the integrator (`sim.integrator = "ias15"`) inside the resolver after a merge; dp 9.3e-6 → 4.5e-13 (`test_three_body_…`) |
| F8 | REBOUND reports a collision only at the end of the step and gives no in-step time (collision struct has only p1, p2, gb, ri) | straight-line backward estimate (`contact_time_estimate`), exact for gravity-free motion; curvature error a_rel dt²/8 otherwise |
| F9 | Exceptions raised inside a Python resolver are swallowed by ctypes (printed, callback returns 0) | the layer wraps its body, stores tracebacks in `errors`; tests assert `errors == []` |
| F10 | `RuntimeWarning: predictor corrector loops in IAS15 did not converge` appeared once after a merge when stepping in capped chunks (2-body analytic case; none without chunking); results stayed within tolerance | **unresolved**, see risks |
| F11 | Resolver not restored from a checkpoint; REBOUND warns, then halts with `Collision` on first overlap | re-register after every restore (`test_restore_without_resolver_halts…`) |

## M0 acceptance criteria
| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Two-body motion physically plausible | **met** | gravity and 10-orbit tests, IAS15 and WHFast; independent period formula |
| 2 | Know how collisions are detected; can fast bodies pass through? | **met** | `direct` end-of-step overlap only: yes, they tunnel; `line`: 0 errors in 144 swept scenarios + 12 phase-scan configurations; limits listed below |
| 3 | Merger conserving mass and linear momentum | **met** | custom layer, 4 scenario families, 1e-12 relative (with the IAS15 reset) |
| 4 | Collision diagnostics from the live state | **met** | masses, positions, velocities, v_rel, b, KE loss, L_orb, ΔE, estimated contact time, matched to independent formulas |
| 5 | Save/restore reproduces a test scenario | **met** with re-registration | bitwise-identical smooth and collision scenarios, event list and ids |
| 6 | License understood | **understood; distribution decision open** | below |
| 7 | Results recorded with explicit go/no-go | **met** | this report; D-008 awaiting sign-off |

## Decision: GO WITH CUSTOM COLLISION LAYER
REBOUND gravity plus `line` detection plus our own merger layer **is sufficient for a 36-hour project**: gravity, conservation and reproducibility are excellent, `line` detection matched the measured truth in every classified scenario, and the layer is small (~100 lines) and independently verifiable. It is not NO-GO because every failure above has a tested mitigation or an avoidable trigger; it is not plain GO because REBOUND alone (built-in `merge`, `direct`, WHFast) would give tunnelling, momentum error, random order, no diagnostics and no ids.
**Conditions (the layer spec):** IAS15 (not WHFast); `collision = "line"`; fixed `rand_seed`; custom resolver that merges (heavier keeps its `name`; COM state; volume-conserving radius; ledgers for heat, spin; contact-time estimate), catches exceptions, and re-selects IAS15 afterwards; identify bodies by `name`, never by array index; re-register the resolver (and rebuild ledgers) after every restore; cap each step so that a_rel·dt²/8 ≪ contact distance (integrate in frame-sized chunks); never allow two centres to coincide; label spin/energy approximations in the UI and docs.

## Not tested / unresolved risks
- `line` under strong path curvature within a step (tight binaries, close three-body encounters with large steps); tree and linetree modes; hardsphere; more than three simultaneous bodies; collision handling at N > 500 or with many collisions per step; Python-callback cost at scale.
- Exact tangency policy (REBOUND uses strict `<`); zero or tiny masses; extreme mass ratios beyond 1e11:1; precision for tiny bodies far from the origin (3e-5 m at 1 AU).
- F10 (IAS15 warning after a merge with capped chunks) is not understood; the 2-body result stayed within tolerance but the interaction with chunked stepping needs a closer look.
- Sweep evidence is one seed and one geometry family; cross-machine / cross-version reproducibility not tested; Windows and Python 3.11 only; online REBOUND documentation not consulted (installed package metadata, docstrings and behaviour only).
- Spin (rotation) and tidal deformation are not modelled; mergers lose orbital angular momentum into a bookkeeping vector only.

## License and distribution (findings preserved; decision D-009: GPL-3.0-only)
REBOUND 5.2.2 declares **GPL-3.0-only** (installed package metadata, `License-Expression: GPL-3.0-only`, full text in the wheel). Implication to be handled by an informed decision, not assumed (this is not legal advice): distributing a backend that links REBOUND carries GPL-3.0 obligations for the combined work (source offer, same license); running it as a hosted service generally does not by itself trigger source distribution under plain GPL-3.0 (it would under AGPL, which this is not). The repository is public and currently has no license file. **Decision (D-009, accepted 2026-10-23):** PLAYING GOD is licensed GPL-3.0-only (`LICENSE`), consistent with REBOUND; third-party notices are in `THIRD_PARTY_NOTICES.md`; other dependencies were checked and declare GPL-compatible licenses. Project decision, not legal advice.

## Fallback (if the sign-off or the license decision rejects REBOUND)
A small in-house N-body core (IAS15-class or leapfrog with substeps, our own swept-sphere `line` test and the same merger layer), validated against the same tests in `tests/spike/`. The merger layer, the contact-time estimate, the ledgers and almost all tests are engine-independent and carry over. Choose it only after recording why REBOUND failed.
