# Presets

Provenance and validation of every preset the app offers. Spec: `context/specs/SIMULATION_LAB_SPEC.md` section 5; design: `context/EXPERIMENT_01_IMPLEMENTATION_PLAN.md` section 9. Every value below is transcribed from a cited source or derived by a stated, tested operation. Nothing is estimated to fill a gap.

## Offered
| Preset | Status |
|---|---|
| `solar-system-moons-j2000` Solar System with major moons (J2000.0) | **Offered** (listed first), 21 bodies; see below. |
| `solar-system-j2000` Solar System (J2000.0) | **Offered.** Required by OD-1. |
| `saturn-particle-rings` Ring World: Saturn and its particle rings (J2000.0) | **Offered** (listed last, never the default), 6 bodies; see "Ring World" below. |
| TRAPPIST-1 | **Excluded**: the plan's transit-time gate is not met (the published model itself fails it). See "TRAPPIST-1" below. |
| Kepler-90 | **Removed** (OD-1): only planets g and h have measured masses (Shaw et al. 2025, arXiv:2507.13588); the other six would need a mass-radius estimate, which does not meet the sourcing standard. |

## Solar System, J2000.0 (`backend/presets/data/solar-system-j2000.json`)
- **Bodies (9):** Sun; Mercury; Venus; Earth = **Earth-Moon barycentre** (Horizons 3); Mars, Jupiter, Saturn, Uranus, Neptune = **planetary-system barycentres** (Horizons 4-8). No Moon, no other moons, no dwarf planets, asteroids or comets.
- **Epoch:** J2000.0 = JD 2451545.0 TDB (2000-01-01 12:00:00 TDB). Simulation time t = 0 s is the epoch.
- **Frame and origin:** ecliptic and mean equinox of J2000.0 (Horizons `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=ICRF`), right-handed, x-y plane = the ecliptic = the renderer's ground plane. The origin is the barycentre of the nine included bodies (zero total momentum), shifted from the Solar System Barycenter at load time by a pure translation.
- **Units:** SI (m, kg, s, m/s). G = 6.67430e-11 m^3 kg^-1 s^-2 (CODATA 2018, as used by JPL and the engine).
- **Positions and velocities:** JPL Horizons API vectors, `CENTER=500@0`, `VEC_CORR=NONE` (geometric), `TIME_TYPE=TDB`, `OUT_UNITS=KM-S`; km and km/s are converted by x1000. The archived raw responses are in `backend/presets/sources/horizons/<target>_<jd>.txt`; `retrieved.json` records the retrieval time (UTC), the query parameters and each file's SHA-256 and "source" line. Every target reported `{source: DE441}`.
- **Masses:** m = GM / G from the JPL DE440 GM values (JPL SSD Astrodynamic Parameters; Park et al. 2021, AJ 161:105), so the source GM is reproduced exactly (relative error <= 4e-16, tested). GM(Earth-Moon barycentre) = 398600.435507 + 4902.800118 km^3/s^2. GM(Sun) = 1.32712440041279419e20 m^3/s^2.
- **Radii** (collision and display; not a claim about a barycentre): JPL SSD Planetary Physical Parameters, mean radius (Archinal et al. 2018): Mercury 2439.4, Venus 6051.8, Earth 6371.0084, Mars 3389.50, Jupiter 69911, Saturn 58232, Uranus 25362, Neptune 24622 km. Barycentre bodies use their planet's mean radius, labelled `assumed`. Sun: 6.957e8 m (IAU 2015 B3 nominal).
- **History:** `grid`, sample interval 432,000 s (5 d).
- **Omitted:** every separate moon, dwarf planets, asteroids, comets, general relativity, solar oblateness, non-gravitational forces.
- **Basis labels:** each GM, radius and state carries `measured | nominal | derived | assumed` and its source in the data file.
- **DE441 vectors vs DE440 GM:** recorded; the combined effect is measured by the dynamical check below.

### Validation (`tests/validation/test_preset_solar_system.py`)
| Check | Threshold | Measured |
|---|---|---|
| Raw Horizons text re-parsed to the committed SI values | exact | exact |
| Source files match recorded SHA-256; each reports DE441 | exact | pass |
| m*G/GM - 1 for every body | <= 4e-16 | pass |
| Total momentum / sum of m*abs(v) | <= 1e-12 | pass |
| Worst planet heliocentric position error vs Horizons (engine, dtS = 21,600 s, landing exactly at 365.25 d) | <= 2e-5 relative | **9.137e-07** |
| same at 730.5 d | <= 2e-5 relative | **3.921e-06** |
| K+U relative drift over 730.5 d | <= 1e-12 | **0.0** (equal to the last bit) |

The dynamical check validates the pipeline (units, frame, epoch, masses, engine); a unit, frame or epoch error would give >= 1e-2. It does not claim ephemeris accuracy: the residual is dominated by omitted bodies and relativity (Mercury). The two errors reproduce the planning probe (9.1e-7, 3.9e-6).

## Consequences of omitting the Moon (`tests/validation/test_moon_omission.py`)
Model A: Sun + Earth-Moon barycentre (what the app uses). Model B: Sun + Earth + Moon from Horizons 10/399/301 and DE440 GM; Moon mean radius 1737.4 km (JPL SSD planetary satellite physical parameters, used only as B's collision radius).
- **Earth centre to barycentre at J2000:** **4,890.0 km**, inside Earth's mean radius (6,371.0 km). Over two years in model B the offset reaches at most **4,939.6 km**.
- **Point mass vs three bodies:** the heliocentric EMB path differs by at most **234.1 km** over 730.5 d (test bound 1,000 km, a 4x margin that detects regressions; it is not a claim that the effect is irrelevant).
- **Versus the ephemeris (recorded, not asserted):** at 730.5 d the Sun + EMB model is **11,717 km** from Horizons and the Sun + Earth + Moon model **11,946 km**. Including the Moon does not bring the model closer, because the omitted planets dominate.
- **UI note:** positions are barycentres; Moon dynamics, tides, eclipses and lunar perturbations are absent; a real velocity change would act on two bodies.

## TRAPPIST-1: excluded (M11 gate not met)
**Not offered.** The plan's gate (section 15.2) requires the element round trip to 1e-9 and "the first 3 transits of each planet match the observed times to <= 0.0035 d". The conversion and the dynamics were built and checked; the transit-time gate fails for a reason that is not an implementation error, so the preset is excluded as the owner's rule requires (OD-1, spec 5.4).

What was done (sources: Agol et al. 2021, PSJ 2:1, doi:10.3847/PSJ/abd022; the maximum-likelihood elements `data/elements_noprior_students.txt`, the 447 observed transit times `data/T1_timings_20191203.txt` and the authors' model times `data/times_obs_and_posterior.txt` from github.com/ericagol/TRAPPIST1_Spitzer, MIT licence, 2026-10-24; stellar values 0.0898 +/- 0.0023 M-sun and 0.1192 +/- 0.0013 R-sun from the NASA Exoplanet Archive row for Agol et al. 2021):
- The elements are osculating *Jacobi* elements at BJD_TDB - 2,450,000 = 7257.93115525 d (stated in the paper, section 4.1 and the Table 2 caption), coplanar and edge-on; (P, t0) are the period and time of transit on a Kepler orbit around the star plus the interior planets. They were converted to barycentric Cartesian state with plain Kepler geometry and run in the application's engine (IAS15) with 1-hour steps; transit times were found by cubic-Hermite root finding.
- Check of the conversion: with negligible planet masses the engine reproduces the linear ephemeris t0 + n P to 0.1 min.
- Convention: the paper's transit condition must be applied with omega shifted by pi relative to the most direct reading (pericentre direction at omega + pi/2 from the observer direction in the preset frame). With it, every one of the 21 simulated transits (first 3 of each planet) agrees with the authors' published best-fit model times within **0.0009 d (1.3 min)**.
- Gate result against the **observed** times: worst **0.0134 d** (planet g, first transit: simulated 19.2 min before the observed time), then 0.0047 d (planet d); thresholds 0.0035 d. **The published model itself misses the same observations by up to 0.0138 d** (planet g first transit, a 3.5-sigma outlier; planet d 0.0046 d), so no correct implementation can meet this gate: it is observational scatter (sigma_obs of 0.001-0.004 d per transit), not a modelling or conversion error.
- Not done: the tolerance was not loosened and no alternative gate was substituted. A gate against the published model times (for example 0.002 d, which the conversion meets with a margin of more than two) with the observed residuals shown as information would admit the preset; that is the owner's decision.
- The investigation scripts and the archived inputs are kept outside the repository (the implementation session's notes folder), because nothing in the product uses them.

## Solar System with major moons, J2000.0 (`backend/presets/data/solar-system-moons-j2000.json`)
Decision: D-030. Tests: `tests/validation/test_preset_moons.py`, `tests/test_presets_api.py`.
- **Bodies (21):** Sun; Mercury; Venus; Earth + **Moon**; Mars (planet centre, Horizons 499) + **Phobos and Deimos**; Jupiter + **Io, Europa, Ganymede, Callisto**; Saturn + **Titan, Rhea, Iapetus, Dione, Tethys**; Uranus, Neptune (system barycentres, Horizons 7, 8). Moon bodies have `bodyType: moon`, `assetKey` = their lowercase name and `primaryId` = their planet's body id.
- **Epoch, frame, units, origin:** identical to the 9-body preset (J2000.0 TDB, ecliptic/ICRF, SI, origin shifted to the barycentre of the included bodies).
- **States:** Horizons vectors with `CENTER=500@0` for 399, 301, 499, 401, 402, 599, 501-504, 699, 606, 605, 608, 604, 603 (new files in `sources/horizons/`, hashes in `retrieved.json`; retrieved 2026-10-24). Earth and the Moon are DE441; Mars, Phobos and Deimos use the JPL satellite ephemeris `mar099`; the Jovian bodies come from `jup365_merged` and the Saturnian bodies from `sat441l`, all merged with DE441 by Horizons. All bodies of one planet system are in one frame at one epoch: no planet-relative to heliocentric conversion is applied.
- **Masses:** moons: GM from the JPL satellite physical-parameters page (Phobos 0.0007087, Deimos 0.0000962; Moon 4902.800118 from DE440; Io 5959.9155, Europa 3202.7121, Ganymede 9887.8328, Callisto 7179.2834, Titan 8978.14, Rhea 153.94, Iapetus 120.52, Dione 73.116, Tethys 41.21 km^3/s^2). Earth: DE440 398600.435507. Mars carries the DE440 Mars-system GM minus Phobos and Deimos. Jupiter and Saturn carry the DE440 system GM minus their listed moons, so each system keeps the 9-body preset GM and includes unlisted small moons.
- **Radii:** moons: mean radii from the JPL satellite physical-parameters page and cited references (Phobos 11.08, Deimos 6.2; Moon 1737.4, Io 1821.49, Europa 1560.8, Ganymede 2631.2, Callisto 2410.3, Titan 2575.5, Rhea 764.5, Iapetus 734.5, Dione 562.5, Tethys 536.3 km), Earth 6371.0084 km, Jupiter 69911 km, Saturn 58232 km. Physical radii only; the renderer's display radii are separate.
- **Not included:** other Mars moons; Uranus and Neptune moons; small Jovian and Saturnian moons (Enceladus, Mimas, Hyperion, Amalthea...); Triton; dwarf planets; oblateness (J2), tides and non-gravitational forces. The Laplace resonance and the Moon's apsidal/nodal precession are reproduced only as far as mutual point-mass gravity produces them.
- **Validation (1 year, dtS = 5 d, application engine):** every moon stays bound and within +-20 % of its initial semi-major axis; mean periods of the Moon, Io, Europa, Ganymede, Callisto, Titan, Dione, Tethys within 1 % of the published sidereal periods; K+U drift 3.7e-16, angular momentum drift 1.6e-16 (relative), no collisions; each planet + moons centre of mass stays within 117 / 1 / 107 km (Earth / Jupiter / Saturn) of the 9-body preset's barycentre body, Mercury, Mars and Neptune within 0.03 km. Plane tilts identify the frame: the Moon's orbit ~5 deg and Titan's ~27 deg from the ecliptic pole.
- **Performance (development machine, original 19-body preset):** ~0.18 s per 5-day step (PRS23) vs ~0.004 s for the 9-body preset; IAS15 itself needs ~0.05 s/day because Io and Tethys orbit in under two days. Phobos and Deimos increase the active preset to 21 bodies.

## Ring World: Saturn and its particle rings (`backend/presets/data/saturn-particle-rings.json`)
Tests: `tests/test_preset_saturn_particle_rings.py` (backend), `frontend/src/sim/ringWorld.test.ts` and `frontend/src/components/canvas/RingWorld.test.tsx` (display).
- **Physical bodies (6):** Saturn (planet centre, Horizons 699) and Titan, Rhea, Iapetus, Dione, Tethys. Every entry is copied unchanged from the Solar System with major moons preset (same Horizons files and SHA-256, same GM, radius and basis labels), then re-centred on the barycentre of these six bodies. There is no Sun and no other planet, so Saturn does not orbit anything in this preset.
- **The ring grains are NOT simulated bodies.** They are a visual-only layer (`frontend/src/sim/ringWorld.ts`, `components/canvas/RingGrains.tsx`): 12,000 massless grains drawn as one instanced mesh. They have no mass, no gravity, no collisions and no backend state; the backend never sees them, they are never picked, and they create no events. The engine (IAS15, all-pairs) cannot integrate thousands of independent bodies at interactive speed, so this was chosen on purpose rather than forcing them into the simulation.
- **What the grains do:** a slow cosmetic drift in the shader (angular speed ~ r^-1.5), advancing only while the simulation is playing (frozen on pause, restarting at the preset's opening state on reload). It is not tied to simulation time and is not a physical orbit.
- **Display choices (not data):** radial structure (C ring, dense B ring, empty Cassini division, thinner A ring with an Encke gap, a thin F ring and a faint outer scatter) uses approximate public ring-system radii (C inner 74,658 km, B 92,000-117,580 km, A 122,170-136,775 km, Encke 133,589 km, F 140,180 km), written down from general knowledge, not from an archived source file in this repository, divided by Saturn's mean radius. The azimuthal weighting (a dense lobe facing the opening camera, thin arcs to the sides) is an artistic composition, not a physical ring property. The ring plane is tilted a few degrees for composition and is not Saturn's real orientation. Grain sizes are exaggerated so grains are visible at the opening distance. Saturn's cream colour and bands come from a generated map; the lighting direction, the Milky Way sky (procedural shader, no texture) and the planet's shadow on the grains are all display only.
- **Frontend wiring:** `UniverseWorkspace` passes `universe.presetId` to the canvas. Only the body with asset key `saturn` in a universe whose preset id is `saturn-particle-rings` gets the planet material and grains; every other universe, including the Solar System presets, renders exactly as before. The opening camera (`ringWorldCameraOffset`) frames Saturn and the A ring in the free area between the sidebars.
- **Shared files touched:** `backend/presets/loader.py` (one line in `PRESET_FILES`), `UniverseCanvas.tsx`, `CelestialBody.tsx`, `UniverseWorkspace.tsx` (small, additive).

## Reference orbits and main-belt sample (display only; D-064)
Not part of either preset's state. Shown with the two Solar System presets; toggled by "Orbit guides" and "Asteroid belt" in the View panel.
- **Guides:** J2000.0 heliocentric osculating elements from JPL Horizons (GEOMETRIC, centre Sun 500@10, ecliptic/ICRF, AU-D) for the eight planets (Horizons 199, 299, 3, 4-8) and Pluto system barycentre (9), Haumea (136108), Makemake (136472), Quaoar (50000), Orcus (90482), Chiron (2060), 523727 (2014 NW65), 532037 Chiminigagua (2013 FY27). Small bodies report their JPL orbit solution (e.g. `{source: JPL#18}`), planets and Pluto DE441.
- **Belt:** JPL SBDB Query API, the first 10,000 numbered asteroids of class MBA, osculating elements at JD 2461200.5 (4 significant digits).
- **Approximations:** ellipses are osculating two-body orbits at their epoch; markers and asteroids are propagated by Kepler's equation alone. Illustrative positions, not an ephemeris.
- **Check:** the planets' elements reproduce this preset's J2000 heliocentric state (position and velocity) to < 1e-9 relative (`tests/validation/test_reference_orbits.py`).
