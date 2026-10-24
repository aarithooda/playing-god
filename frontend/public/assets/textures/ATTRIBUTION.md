# Celestial texture attribution

## Source and license

Base planetary and solar maps are from [Solar System Scope's texture library](https://www.solarsystemscope.com/textures/),
created by INOVE and distributed under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/).
Attribution: **Solar System Scope (INOVE), “Solar Textures,” CC BY 4.0.** Source page notes that some unmapped areas use fictional terrain and that colors are more saturated than true color.

## Source-to-output mapping and modifications

| Downloaded source | Generated output prefix | Modifications |
| --- | --- | --- |
| `2k_earth_daymap.jpg` | `earth` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_mercury.jpg` | `mercury`, `generic_rocky` | Body-specific Mercury diffuse and generic rocky diffuse retained as JPEG quality 90; each normal and roughness map derived from luminance (visual approximations). |
| `2k_venus_surface.jpg` | `venus` | Venus surface diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_mars.jpg` | `mars` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_jupiter.jpg` | `jupiter` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_neptune.jpg` | `neptune` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_sun.jpg` | `sun` | Diffuse retained; emissive map generated with contrast and brightness adjustments. |
| `2k_sun.jpg` | `betelgeuse`, `proxima`, `sirius`, `trappist1`, `generic_star` | Illustrative spectral-color tints and emissive derivatives. These are not observations or surface maps of those stars. |
| `2k_saturn.jpg` | `saturn`, `generic_gas` | Saturn diffuse and generic gas-giant diffuse retained as JPEG quality 90; generic normal and roughness maps derived from luminance (visual approximations). |
| `2k_uranus.jpg` | `uranus`, `generic_ice` | Uranus diffuse and generic ice-giant diffuse retained as JPEG quality 90; generic normal and roughness maps derived from luminance (visual approximations). |
| `2k_moon.jpg` | `generic_asteroid` | Generic rocky fallback only; not an asteroid surface claim. Normal and roughness maps derived from luminance (visual approximations). |

## Generated moon maps

The following 2:1 equirectangular diffuse maps were generated for this project as stylized visual
approximations: `moon_diffuse.jpg`, `io_diffuse.jpg`, `europa_diffuse.jpg`, `ganymede_diffuse.jpg`,
`callisto_diffuse.jpg`, `titan_diffuse.jpg`, `rhea_diffuse.jpg`, `iapetus_diffuse.jpg`,
`dione_diffuse.jpg`, and `tethys_diffuse.jpg`. They are not scientific surface measurements or
official imagery. The images were converted to JPEG quality 90 for runtime use.

The derivative maps are stylized rendering inputs, not measured topography or physical material data.
All generated JPEG files were saved at quality 90. Rebuild with `scripts/build_ui0_textures.py` and the
listed source files in a local `raw_textures/` directory.

Recognized major moons use the generated diffuse maps named above. Their normal and roughness
channels still come from the generic moon fallback and are visual approximations, not measured
topography or material data. Custom moons and recognized moons without a specific map use the generic
fallback, derived from Solar System Scope's `2k_moon.jpg`.

## Planetary rings

`jupiter_rings.svg`, `saturn_rings.svg`, `uranus_rings.svg`, and `neptune_rings.svg` are original
vector textures made for this project. They stylize the faint dusty rings of Jupiter, Saturn's broad
bright bands and Cassini Division, Uranus' narrow dark rings, and Neptune's faint ring arcs. These are
illustrative maps, not measured optical depth or scientific imagery. Ring width and opacity are set
per planet in the renderer. NASA references: [Jupiter](https://science.nasa.gov/jupiter/jupiter-facts/),
[Saturn](https://science.nasa.gov/saturn/facts/), [Uranus](https://science.nasa.gov/Uranus/facts/),
and [Neptune](https://science.nasa.gov/neptune/neptune-facts/).
