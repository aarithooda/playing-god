# Experiment 01 protocol (first release)

Question (owner, OD-3): **How does changing a planet's initial velocity affect its subsequent orbit?**
Product spec: `context/specs/EXPERIMENT_01_SPEC.md` (sections 5-9); implementation: `backend/orbit_lab.py`, `backend/orbit_lab_systems.json`; validation: `tests/validation/test_experiment01.py`. This document records the protocol and the **measured** results of the committed tests. Nothing here is a prediction of the real world.

## System: Sun + Earth-Moon barycentre (two bodies), J2000.0
| Item | Protocol |
|---|---|
| Bodies | Sun; the Earth-Moon barycentre (EMB), one point mass carrying the mass of Earth and Moon, shown as "Earth (Earth-Moon barycentre)". No separate Moon. |
| Selected planet | the EMB (`body-earth`) |
| Epoch | J2000.0 = JD 2451545.0 TDB; simulation time 0 s |
| Positions, velocities | JPL Horizons vectors for targets 10 and 3, centre 500@0 (Solar System Barycenter), geometric (`VEC_CORR=NONE`), ecliptic and mean equinox of J2000.0; the archived raw responses of the Solar System preset (`backend/presets/sources/horizons/`, SHA-256 checked at load) |
| Masses | m = GM / G from JPL DE440: GM(Sun) = 1.32712440041279419e20 m^3/s^2; GM(EMB) = 398600.435507 + 4902.800118 km^3/s^2; G = 6.67430e-11 |
| Frame, origin | ecliptic J2000.0; origin shifted to the barycentre of the two bodies (zero total momentum); no rotation |
| Units | SI; km to m and km/s to m/s by x1000 |
| Physics | Newtonian point-mass gravity only; the application's IAS15 (GLOBAL step-size criterion), `line` collision detection, unchanged |
| Omitted | all other planets, dwarf planets, asteroids, comets, the Moon as a separate body, general relativity, solar oblateness, non-gravitational forces |
| Observation window | 730 days (63,072,000 s), 731 samples at the exact times k x 86,400 s, k = 0 ... 730 |

**Limitation shown to the user:** two-body model; positions are barycentres; not a forecast of Earth's real position. Over two years the model stays within about 11,700 km of the Horizons ephemeris (`context/PRESETS.md`), because the other planets are omitted.

## Variable
The magnitude of the EMB's initial velocity (in the barycentric simulation frame) is multiplied by f in {0.90, 0.95, 1.05, 1.10}; its direction is kept exactly (v' = f v, component-wise, floating-point exact). The backend accepts only these exact factors and only the EMB; anything else is refused with 422 and changes nothing. Recorded: original and modified velocity, units, factor, body, and the baseline (universe id and initial-state digest).

## Workflow (spec section 7)
Select the system; create and inspect the baseline; inspect the EMB's initial velocity; choose a factor (preview shown); create the modified run (from the baseline's *initial* snapshot, not its current state); verify that the velocity is the only initial difference; advance each run with the normal controls; switch between runs; compare; reset or recreate (with confirmation); repeat from the same initial conditions.

## Roles and protections
- **Baseline:** immutable reference. Cannot be edited (bodies), snapshotted or restored; can be advanced and reset to its documented initial state.
- **Modified run:** a physical edit (mass, radius, position, velocity, add, delete) is recorded in its audit log with the simulation time and marks it **uncontrolled** (shown wherever its comparison is shown). Name, colour or type changes are logged but keep it controlled. Resetting returns it to its derived initial state and makes it controlled again; the audit record stays.
- Documented unavoidable consequence of the single change: scaling the EMB's velocity changes the total momentum, so the modified run's system barycentre drifts at m/(M+m) x dv relative to the baseline's.

## Independent reference
`tests/validation/kepler_reference.py` propagates the relative two-body state exactly (Gauss f and g functions in the change of eccentric anomaly, Newton on Kepler's equation). It imports nothing from REBOUND or the backend and is itself checked against closed-form cases and a separate brute-force RK4 integration (`test_kepler_reference.py`). Expectations are computed at run time, never hard-coded.

## Measured results (committed tests, this machine, one process)
Engine vs reference over all 731 samples:
| f | a (au) | e | period (d) | perihelion (au) | aphelion (au) | max engine-Kepler error | / a |
|---|---|---|---|---|---|---|---|
| 1.00 (baseline) | 1.00000 | 0.01670 | 365.25 | 0.9833 | 1.0167 | 0.01475 m | 9.86e-14 |
| 0.90 | 0.83580 | 0.17648 | 279.10 | 0.6883 | 0.9833 | 0.02931 m | 2.34e-13 |
| 0.95 | 0.90842 | 0.08244 | 316.25 | 0.8335 | 0.9833 | 0.01078 m | 7.93e-14 |
| 1.05 | 1.11854 | 0.12090 | 432.09 | 0.9833 | 1.2538 | 0.01358 m | 8.11e-14 |
| 1.10 | 1.27734 | 0.23019 | 527.30 | 0.9833 | 1.5714 | 0.02098 m | 1.10e-13 |

Threshold 1e-10 x a (about 12-19 m): the margin is about 400x to 1000x. A deliberately wrong velocity (+1 %) exceeds 1e-3 x a, so the check can fail.

| Check | Threshold | Measured |
|---|---|---|
| Sample times | exactly k x 86,400 s in every run | exact |
| Orbit ordering | a, period, aphelion increase with f; start at perihelion for f > 1 and at aphelion for f < 1 (within 1e-3 r0) | holds |
| Period | engine returns to its start after exactly 2 pi sqrt(a^3/mu); implied relative period error <= 1e-6 | 4.6e-15 to 8.2e-15 |
| K+U relative drift over 730 d | <= 1e-12 | <= 1.1e-15 |
| angular momentum (about the origin) relative drift over 730 d | <= 1e-12 | <= 5.6e-16 |
| Velocity change | v' = f v exactly; angle between v and v' <= 1e-15 | exact product; sin(angle) <= 1e-15 |
| Only intended difference | exactly one differing field (EMB velocity), configuration equal | 1 difference, config equal |
| Repeatability | same digests, bit-identical trajectories in one process | identical |
| Modified-run system barycentre speed (x1.10) | about m/(M+m) x dv | 9.21 mm/s |

**Specification correction (2026-10-24):** spec section 4.2 originally said the barycentre drift is "about 0.6 km over the observation window" and "about 10^-7 of the position differences". 9.2 mm/s over 730 d is about **580 km** (about 6e-6 to 6e-5 of the 10^10 to 10^11 m separations), so that sentence had a 1000x unit slip; the 9 mm/s figure and the mechanism were right. The spec text was corrected in the finalisation sprint (Draft 0.3, correction 2, revision record) and the test asserts the measured ~580 km. The owner confirms the correction at review.

## Not claimed
Any real-world prediction; bit-identical results across processes, machines, OS or REBOUND versions; Moon dynamics.
