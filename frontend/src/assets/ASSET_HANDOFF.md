# Celestial visual assets

The renderer looks for maps under `/assets/textures/` (served from `frontend/public/assets/textures/`),
matching the texture manifest in `frontend/public/assets/textures/`.
All texture files are attributed in `frontend/public/assets/textures/ATTRIBUTION.md`.
Missing individual maps still fall back to the body-type maps, then the backend body color.

## File layout

- Body-specific files: `<prefix>_{diffuse,normal,roughness,emissive}.jpg`
- Generic fallback files: `generic_{star,rocky,gas,ice,asteroid}_{diffuse,normal,roughness,emissive}.jpg`
- Body types: `star`, `rocky-planet`, `gas-giant`, `ice-giant`, `asteroid`
- Body-specific asset keys: `sun`, `mercury`, `venus`, `earth`, `moon`, `mars`, `phobos`, `deimos`, `jupiter`, `io`, `europa`, `ganymede`, `callisto`, `saturn`, `titan`, `rhea`, `iapetus`, `dione`, `tethys`, `uranus`, `neptune`,
  `proxima-centauri`,
  `trappist-1`, `sirius-a`, `betelgeuse`

The named major moons have individual generated diffuse maps. Phobos and Deimos are not included in
this set yet and continue to use the generic moon fallback.

All maps are optional. `diffuse` and `emissive` are interpreted as sRGB; normal and roughness maps
are interpreted as linear data. The renderer attempts a body-specific map and then a generic map,
finally falling back to the backend body color. Jupiter, Saturn, Uranus, and Neptune have their own
transparent ring maps and per-planet display scales.
An atmosphere is enabled only when the registry has explicit `atmosphereColor` and optional
`atmosphereOpacity` metadata; the renderer does not infer these from the body's name.

To regenerate the files, put the source maps listed in `ATTRIBUTION.md` into the repository's
`raw_textures/` directory, install the build-only dependencies with
`python -m pip install -r scripts/requirements-ui0-textures.txt`, and run
`python scripts/build_ui0_textures.py`.

## Candidate inventory (not a finalized preset catalogue)

| Candidate | Asset key | Expected visual class | Asset and license status |
| --- | --- | --- | --- |
| Sun | `sun` | Star | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Mercury | `mercury` | Rocky planet | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Venus | `venus` | Rocky planet | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Earth | `earth` | Rocky planet | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Mars | `mars` | Rocky planet | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Jupiter | `jupiter` | Gas giant | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Saturn | `saturn` | Gas giant | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Uranus | `uranus` | Ice giant | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Neptune | `neptune` | Ice giant | Solar System Scope source; attribution in `frontend/public/assets/textures/ATTRIBUTION.md` |
| Proxima Centauri | `proxima-centauri` | Star | Stylized Sun-map color derivative; not observed surface imagery |
| TRAPPIST-1 | `trappist-1` | Star | Stylized Sun-map color derivative; not observed surface imagery |
| Sirius A | `sirius-a` | Star | Stylized Sun-map color derivative; not observed surface imagery |
| Betelgeuse | `betelgeuse` | Star | Stylized Sun-map color derivative; not observed surface imagery |

Atmospheric and ring effects are opt-in asset metadata, not inferred from the candidate name.

## Attribution record required for each supplied asset

Generated normal and roughness maps are visual approximations derived from image luminance; they are
not measured topography or material data. Tinted star maps are illustrative color variants of the Sun
map, not observed surface imagery of those stars. Preserve this caveat when presenting the scene.
