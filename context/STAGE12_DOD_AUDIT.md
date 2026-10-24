# Stage 12 — scenarios, performance and Definition-of-Done audit (2026-10-25)

**Governance (D-059):** CP-SCI-1 and CP-5 are waived by the owner *for continued development only*. Nothing here is signed by a human reviewer and nothing is independently scientifically validated. "Pass" below means a software test ran and passed; the outcome models stay `provisional:CP-SCI-1`. UD-1 and UD-2 remain unresolved.

## Commands and results (branch `collision/stage-11-12`)
| Check | Command | Result |
|---|---|---|
| Backend, whole suite | `python -m pytest -q -p no:cacheprovider` | **1399 passed** (1373 earlier + 15 Stage 11 + 9 scenarios + 2 performance) |
| Trajectory baselines | `tests/validation/test_stage11_trajectory_baseline.py` | both presets bit-identical to the pre-Stage-11 digests |
| Frontend types | `npx tsc --noEmit -p .` | clean |
| Frontend unit | `npx vitest run` | 502 passed (51 files) |
| Frontend build | `npm run build` | OK (existing chunk-size warning) |
| Browser | `npx playwright test` with `PW_CHROMIUM_PATH` set | 14 passed (headless software-WebGL Chromium, stubbed API; not a GPU, not another browser, not the real backend) |

## Scenarios A–H (`tests/impact/test_scenarios_e2e.py`, run through the real service in outcome-v1)
| Scenario | Test | Result | What it does NOT show |
|---|---|---|---|
| A south pole | `test_scenario_a_south_pole_localized` | pass: site at latitude −90° ± 1e-6, in the record, mass conserved | no propagation to the antipode: every shipped profile is static (no sourced wave speed); crater size unmodelled |
| B asteroid → gas giant | `test_scenario_b_envelope_event` | pass: `envelope_deposition`, whole-system conservation, `envelope_dynamics_not_resolved` recorded, no gas-dynamics claim | not a hydrodynamic result |
| C hit-and-run | `test_scenario_c_hit_and_run_two_remnants` | pass: both identities continue, conserved | model calibration is provisional |
| D catastrophic | `test_scenario_d_disruption_accounting` | pass: remnant + fragments + parcels carry the whole mass (1e-13), residuals reported | fragment-size law and ejecta speeds provisional |
| E secondary impact | `test_scenario_e_fragment_hits_moon_parent_link` | pass (runs the Stage 7 test on the moons-preset Earth/Moon/Sun) | structural only; the Moon is not claimed to be hit |
| F pause/resume/replay | `test_scenario_f_pause_resume_equivalence`, `test_scenario_f_replay_digest` | pass (restore-from-snapshot gives the same future; dry-run replay reproduces the digest) | same-platform only; cross-platform tolerance not implemented; render-side pause covered only by vitest and the stubbed e2e |
| G independent simulations | `test_scenario_g_independent_universes` (+ `test_isolation.py`) | pass | the browser scenario with two stubbed universes was not run |
| H regression | `test_scenario_h_*` + all suites above | pass | — |

## Performance criteria
| Criterion (plan, Stage 12) | Measured here | Verdict |
|---|---|---|
| Collision-free step within +10 % of baseline at N = 50/100/200 | ratios 1.050 / 1.038 / 0.996 (`test_performance_stage1.py`; 6 ms absolute slack for timer noise) | MET on this machine; N = 50 is 5 % over, inside the allowance |
| Catastrophic event with full budgets ≤ 0.5 s | 0.06 s best of 3 | MET |
| Step with many simultaneous events inside the step budget | 12 simultaneous pairs, 0.51 s, 12 events, limit `step_time_limit_s` | MET (one machine, not CI) |
| Frame pacing with 8 active effects and 20,000 particles not worse than 64 bodies by > 25 % | **not measured**: only the existing 64-body profile exists (median 100 ms in software WebGL); no test with effects/particles was written | **UNMET (unmeasured)** |

## Definition of Done (traceability §17)
| ID | Assessment | Status |
|---|---|---|
| DOD-1 ten features addressed | implemented in software behind provisional science | MET in software; science not validated |
| DOD-2 every requirement has evidence | re-audited row by row (D-062): 59 rows moved to VERIFIED with named tests, 0 MISS remain, 75 PART rows remain, each with its gap stated | **UNMET** (75 PART) |
| DOD-3 scenarios pass or have approved limits | A–D, F, G, H pass in the backend; limits stated above; browser scenario G and frame pacing missing | PARTIAL |
| DOD-4 outcomes driven by selected models | selector/realiser tests | MET in software (provisional) |
| DOD-5 localized impacts | static sites only | PARTIAL |
| DOD-6 trajectories and lifecycle | Stages 5, 7 tests | MET in software |
| DOD-7 mass and momentum | residuals 1e-14 / 1e-12, angular momentum 1e-8 system-wide | MET in software |
| DOD-8 rendering follows the event | software WebGL, stubbed API only | PARTIAL |
| DOD-9 controls and isolation | `test_isolation.py`, scenario G | MET backend |
| DOD-10 limits and fallbacks explicit | labels, warnings, `unsupported` fidelity | MET in software |
| DOD-11 persistence | serialisation round trip only; no disk persistence by decision (D-054) | PARTIAL (as decided) |
| DOD-12 regression passes | all suites green; no baseline failures | MET |
| DOD-13 hydrodynamics integrable | dummy-model/adapter tested in Stage 0/3; not re-audited in Stage 12 | PARTIAL (not re-audited) |
| DOD-14 assumptions documented, scenarios reproducible | scenarios reproducible; `COLLISION_SCIENTIFIC_MODELS.md` header and risk R-22 are stale (listed in the review package) | PARTIAL |
| CP-5 human sign-off | **WAIVED by the owner (D-059); no human signed** | WAIVED, not signed |

## Unmet or open (honest list)
1. DOD-2: the per-row re-audit is done (D-062); 75 rows are still PART. Main causes: no sourced wave speed, cratering constants, structure classes or LS12 inputs for named bodies; crater/ejecta extent and several visual phases not modelled or drawn; no GPU, other-browser or real-backend run; cross-platform replay tolerance not implemented; M-PROP-4/5 (equation of state, thermal) deliberately absent; science PROVISIONAL, UD-1/UD-2 open.
2. Frame pacing with effects/particles: unmeasured; no GPU, no other browser, no real-backend end-to-end run.
3. Cross-platform replay tolerance: not implemented.
4. Wave speed, cratering constants, structure classes, LS12 for planets: unsourced; UD-1/UD-2 unresolved; every model PROVISIONAL.
5. Stale documents: `COLLISION_SCIENTIFIC_MODELS.md` header, risk R-22.
6. Stage 11 values were fetched through a web-fetch sub-agent and not re-read by a human.

## Re-audit of the traceability matrix (D-062, 2026-10-25)
Of 135 rows that were MISS, open or PART: 59 are now VERIFIED, citing existing tests (software evidence, provisional science, owner-accepted D-059, not independently validated); 75 stay PART (60 unchanged with their gap re-confirmed, 15 rewritten with sharper evidence and limits) and 1 (OD33-REVIEW) is WAIVED by D-059, not signed. No row was marked VERIFIED without a named test or document; no test was run or changed for this pass beyond the full suites already green. The cited test names were checked to exist.
