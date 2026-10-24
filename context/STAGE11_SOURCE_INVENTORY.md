# Stage 11 source inventory (DQ-3 (a), D-058) — preparation only

**Status: INVENTORY, NOT IMPLEMENTATION.** Stage 11 has not started and its implementation gate is closed: DQ-3 (a) needs a **named qualified reviewer** and none is confirmed (Vaibhav has not confirmed; no alternative is confirmed). Nothing in `backend/presets/` was changed. CP-SCI-1 is unsigned; sourced material inputs would not validate the collision-outcome models.

## What the repository already holds for each preset body
Source: `backend/presets/data/solar-system-moons-j2000.json` (19 bodies; the 9-body preset is a subset). GM and radius come from JPL SSD / Horizons with a recorded `basis` (`measured`, `nominal`, `assumed`). The mean density below is **derived** (3 GM / (4 pi G R^3), G = 6.6743e-11, the engine's fixed value), so it is computed from the sourced GM and radius, not looked up; it inherits the radius basis and says nothing about composition or internal structure.

| body | kind / bodyType | primary | GM [m^3/s^2] (basis) | radius [m] (basis) | mean density [kg/m^3] (computed) |
|---|---|---|---|---|---|
| body-sun | star / star | - | 1.3271244e+20 (measured) | 695700000 (nominal) | 1410 |
| body-mercury | planet / rocky-planet | - | 2.20318686e+13 (measured) | 2439400 (measured) | 5429 |
| body-venus | planet / rocky-planet | - | 3.24858592e+14 (measured) | 6051800 (measured) | 5243 |
| body-earth | planet / rocky-planet | - | 3.98600436e+14 (measured) | 6371008.4 (measured) | 5513 |
| body-moon | planet / moon | body-earth | 4.90280012e+12 (measured) | 1737400 (measured) | 3344 |
| body-mars | planet / rocky-planet | - | 4.28283758e+13 (measured) | 3389500 (assumed) | 3934 |
| body-jupiter | planet / gas-giant | - | 1.26686534e+17 (derived) | 69911000 (measured) | 1326 |
| body-io | planet / moon | body-jupiter | 5.9599155e+12 (measured) | 1821490 (measured) | 3527 |
| body-europa | planet / moon | body-jupiter | 3.2027121e+12 (measured) | 1560800 (measured) | 3013 |
| body-ganymede | planet / moon | body-jupiter | 9.8878328e+12 (measured) | 2631200 (measured) | 1942 |
| body-callisto | planet / moon | body-jupiter | 7.1792834e+12 (measured) | 2410300 (measured) | 1834 |
| body-saturn | planet / gas-giant | - | 3.79312179e+16 (derived) | 58232000 (measured) | 687 |
| body-titan | planet / moon | body-saturn | 8.97814e+12 (measured) | 2575500 (measured) | 1880 |
| body-rhea | planet / moon | body-saturn | 1.5394e+11 (measured) | 764500 (measured) | 1232 |
| body-iapetus | planet / moon | body-saturn | 1.2052e+11 (measured) | 734500 (measured) | 1088 |
| body-dione | planet / moon | body-saturn | 7.3116e+10 (measured) | 562500 (measured) | 1469 |
| body-tethys | planet / moon | body-saturn | 4.121e+10 (measured) | 536300 (measured) | 956 |
| body-uranus | planet / ice-giant | - | 5.7945564e+15 (measured) | 25362000 (assumed) | 1271 |
| body-neptune | planet / ice-giant | - | 6.8365271e+15 (measured) | 24622000 (assumed) | 1638 |

Horizons ephemeris text files (41) are the only files under `backend/presets/sources/`; they contain states, not material properties.

## What a material profile needs and what is missing
`MaterialProfile` (see `backend/impact/contracts.py`, `materials.py`): `category`, `structureClass`, `layers`, `appearance`, `momentOfInertiaFactor`, optional `ls12` (c*, mubar), `strength`, `cratering`, `waveSpeedMPerS`, and a `provenance` entry for every number present. Missing quantities are listed in `incomplete` and make the profile **unsupported for the models that need them** (never guessed).

| property | in the repo for named bodies? | consequence if it stays missing |
|---|---|---|
| bulk density | derived from GM and radius (above) | usable, as a computed value with the radius basis |
| composition / layers | no | no layered profile; stripping/composition outputs unsupported |
| structure class (rubble / strong / strengthless-planet / envelope-dominated) | no (the owner's DQ-7 (a) requires it be set per profile, never inferred from size or `bodyType`) | LS12 outcomes unsupported (falls back to the labelled perfect merge) |
| moment of inertia factor | no | the body cannot carry a spin state (DQ-2): no rotation state, spin angular momentum booked in the ledger |
| LS12 c*, mubar | only the generic small-body values of two shipped profiles; NOT applicable to planets (those values are for small bodies / specific simulations, D-038, D-041) | LS12 outcomes unsupported for the body |
| wave speed | no (also absent from every shipped profile, D-050) | surface sites static |
| cratering constants | no (D-048 (2)) | cratering unsupported |

**Applicability warning.** The five registry profiles are generic (`silicate-rock`, `rubble-silicate`, `iron`, `water-ice`, `gas-envelope-hhe`) with a homogeneous moment of inertia factor of 0.4 and small-body c*; they were written for the engine's own scenarios, not for Earth, the Moon or Jupiter. Assigning one to a named body would be a guess about that body and is exactly what safeguards 1 and 2 of D-058 forbid unless a source says the profile applies.

## Per-body status if Stage 11 started today (no new sources)
* Every body would receive **no material** (kept legacy) or an **incomplete** profile marked unsupported for the models above. For the gas and ice giants (`gas-giant`, `ice-giant`) the registry's only envelope profile has no moment of inertia.
* Because the safe default without sources is "incomplete and unsupported", the effect of Stage 11 depends entirely on what sourced values the reviewer and owner can supply.

## What the reviewer / owner must supply (per body, with citation, units, assumptions, applicability)
1. composition or layer structure and its source;
2. structure class under DQ-7 (a) and the basis for it;
3. moment of inertia factor (published geodetic value) and its uncertainty;
4. which LS12 parameters (if any) apply to a body of that size and class, citing the paper and regime (the repository's own notes say none verified applies; CP-SCI-1 is open);
5. optionally a wave speed and cratering constants (D-048 (2), D-050: absent for every profile today).

## Acceptance tests prepared in the plan (to be written only when the gate opens)
* trajectory validation (`tests/validation/*`, Horizons epochs, moons preset, Experiment 01) bit-identical before/after (materials do not affect gravity): capture the current outputs as the baseline first;
* every value in the preset JSON has a provenance entry; an annotation with a missing source is rejected by the loader (extend `backend/impact/materials.py` rules to the preset loader);
* a body with an incomplete profile reports `unsupported` for the models that need the missing value (tests per profile);
* presets and Orbit Lab stay `legacy-merge` unless Stage 11's own acceptance passes (D-033, D-045).
