# Celestial texture attribution

## Source and license

Base planetary and solar maps are from [Solar System Scope's texture library](https://www.solarsystemscope.com/textures/),
created by INOVE and distributed under the [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/).
Attribution: **Solar System Scope (INOVE), “Solar Textures,” CC BY 4.0.** Source page notes that some unmapped areas use fictional terrain and that colors are more saturated than true color.

## Source-to-output mapping and modifications

| Downloaded source | Generated output prefix | Modifications |
| --- | --- | --- |
| `2k_earth_daymap.jpg` | `earth` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_mars.jpg` | `mars` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_jupiter.jpg` | `jupiter` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_neptune.jpg` | `neptune` | Diffuse retained as JPEG quality 90; normal and roughness maps derived from luminance (visual approximations). |
| `2k_sun.jpg` | `sun` | Diffuse retained; emissive map generated with contrast and brightness adjustments. |
| `2k_sun.jpg` | `betelgeuse`, `proxima`, `sirius`, `trappist1`, `generic_star` | Illustrative spectral-color tints and emissive derivatives. These are not observations or surface maps of those stars. |
| `2k_mercury.jpg` | `generic_rocky` | Generic rocky visual fallback; normal and roughness maps derived from luminance (visual approximations). |
| `2k_saturn.jpg` | `generic_gas` | Generic gas-giant visual fallback; normal and roughness maps derived from luminance (visual approximations). |
| `2k_uranus.jpg` | `generic_ice` | Generic ice-giant visual fallback; normal and roughness maps derived from luminance (visual approximations). |
| `2k_moon.jpg` | `generic_asteroid` | Generic rocky fallback only; not an asteroid surface claim. Normal and roughness maps derived from luminance (visual approximations). |

The derivative maps are stylized rendering inputs, not measured topography or physical material data.
All generated JPEG files were saved at quality 90. Rebuild with `scripts/build_ui0_textures.py` and the
listed source files in a local `raw_textures/` directory.

Moons (bodyType moon, assetKey moon) reuse the generic_asteroid maps, which are derived from the Solar System Scope 2k_moon.jpg. Moons other than Earth Moon have no surface map of their own; they use the same map multiplied by the body display colour (a visual distinction, not a surface claim).
