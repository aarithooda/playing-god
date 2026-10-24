"""Build the UI-0 texture manifest from licensed Solar System Scope source maps.

Generated normal/roughness maps and tinted star variants are visual approximations, not scientific
measurements. See frontend/src/assets/ASSET_HANDOFF.md and the accompanying attribution record.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_OUTPUTS = 54
EXPECTED_FILENAMES = {
    f"{prefix}_{kind}.jpg"
    for prefix in (
        "mercury", "venus", "earth", "mars", "jupiter", "neptune",
        "generic_rocky", "generic_gas", "generic_ice", "generic_asteroid"
    )
    for kind in ("diffuse", "normal", "roughness")
} | {
    f"{prefix}_diffuse.jpg"
    for prefix in ("moon", "io", "europa", "ganymede", "callisto", "titan", "rhea", "iapetus", "dione", "tethys")
} | {
    f"{prefix}_diffuse.jpg"
    for prefix in ("saturn", "uranus")
} | {
    f"{prefix}_{kind}.jpg"
    for prefix in ("sun", "betelgeuse", "proxima", "sirius", "trappist1", "generic_star")
    for kind in ("diffuse", "emissive")
}


def load_rgb(raw_dir: Path, filename: str) -> Image.Image:
    path = raw_dir / filename
    if not path.is_file():
        raise FileNotFoundError(f"Missing {path}; download the named source map from Solar System Scope.")
    with Image.open(path) as image:
        return image.convert("RGB")


def generate_normal_map(image: Image.Image, strength: float = 2.0) -> Image.Image:
    """Create an explicitly approximate tangent normal map from diffuse-map luminance."""
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    dx = (np.roll(gray, -1, axis=1) - np.roll(gray, 1, axis=1)) * strength
    dy = (np.roll(gray, -1, axis=0) - np.roll(gray, 1, axis=0)) * strength
    dz = np.ones_like(gray)
    norm = np.sqrt(dx * dx + dy * dy + dz * dz)
    nx = ((dx / norm) * 0.5 + 0.5) * 255.0
    ny = ((-dy / norm) * 0.5 + 0.5) * 255.0
    nz = ((dz / norm) * 0.5 + 0.5) * 255.0
    rgb = np.stack([nx, ny, nz], axis=-1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def generate_roughness_map(image: Image.Image, base_roughness: float = 0.75) -> Image.Image:
    """Create an approximate roughness map from diffuse contrast; this is not measured material data."""
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    roughness = np.clip(base_roughness + 0.25 * (0.5 - gray), 0.1, 0.98) * 255.0
    return Image.fromarray(roughness.astype(np.uint8), mode="L").convert("RGB")


def tint_star(sun_image: Image.Image, rgb_tint: tuple[float, float, float], contrast: float = 1.15) -> Image.Image:
    """Make a stylized spectral-color variant; this does not depict an observed star surface."""
    gray = np.asarray(ImageEnhance.Contrast(sun_image.convert("L")).enhance(contrast), dtype=np.float32) / 255.0
    red = np.clip((gray**0.75) * rgb_tint[0], 0, 1) * 255.0
    green = np.clip((gray**0.95) * rgb_tint[1], 0, 1) * 255.0
    blue = np.clip((gray**1.20) * rgb_tint[2], 0, 1) * 255.0
    return Image.fromarray(np.stack([red, green, blue], axis=-1).astype(np.uint8), mode="RGB")


def save_jpg(image: Image.Image, output_dir: Path, filename: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    image.save(output_dir / filename, "JPEG", quality=90, optimize=True)


def build_planet(
    raw_dir: Path,
    output_dir: Path,
    source: str,
    prefix: str,
    bump_strength: float = 2.0,
    base_roughness: float = 0.75,
) -> None:
    diffuse = load_rgb(raw_dir, source)
    save_jpg(diffuse, output_dir, f"{prefix}_diffuse.jpg")
    save_jpg(generate_normal_map(diffuse, bump_strength), output_dir, f"{prefix}_normal.jpg")
    save_jpg(generate_roughness_map(diffuse, base_roughness), output_dir, f"{prefix}_roughness.jpg")


def build_star(image: Image.Image, output_dir: Path, prefix: str) -> None:
    save_jpg(image, output_dir, f"{prefix}_diffuse.jpg")
    emissive = ImageEnhance.Brightness(ImageEnhance.Contrast(image).enhance(1.2)).enhance(1.15)
    save_jpg(emissive, output_dir, f"{prefix}_emissive.jpg")


def build_specific_diffuse(raw_dir: Path, output_dir: Path, source: str, prefix: str) -> None:
    """Save a body-specific diffuse map when its type-level material maps are shared."""
    save_jpg(load_rgb(raw_dir, source), output_dir, f"{prefix}_diffuse.jpg")


def build(raw_dir: Path, output_dir: Path) -> list[Path]:
    build_planet(raw_dir, output_dir, "2k_mercury.jpg", "mercury", bump_strength=4.0, base_roughness=0.90)
    build_planet(raw_dir, output_dir, "2k_venus_surface.jpg", "venus", bump_strength=2.0, base_roughness=0.85)
    build_planet(raw_dir, output_dir, "2k_earth_daymap.jpg", "earth", bump_strength=2.5, base_roughness=0.65)
    build_planet(raw_dir, output_dir, "2k_mars.jpg", "mars", bump_strength=3.5, base_roughness=0.85)
    build_planet(raw_dir, output_dir, "2k_jupiter.jpg", "jupiter", bump_strength=0.8, base_roughness=0.55)
    build_planet(raw_dir, output_dir, "2k_neptune.jpg", "neptune", bump_strength=0.6, base_roughness=0.50)
    build_specific_diffuse(raw_dir, output_dir, "2k_saturn.jpg", "saturn")
    build_specific_diffuse(raw_dir, output_dir, "2k_uranus.jpg", "uranus")

    sun = load_rgb(raw_dir, "2k_sun.jpg")
    build_star(sun, output_dir, "sun")
    build_star(tint_star(sun, (1.0, 0.42, 0.15), contrast=1.3), output_dir, "betelgeuse")
    build_star(tint_star(sun, (1.0, 0.32, 0.18), contrast=1.4), output_dir, "proxima")
    build_star(tint_star(sun, (0.75, 0.88, 1.0), contrast=1.1), output_dir, "sirius")
    build_star(tint_star(sun, (1.0, 0.28, 0.12), contrast=1.4), output_dir, "trappist1")
    build_star(tint_star(sun, (1.0, 0.85, 0.55), contrast=1.1), output_dir, "generic_star")

    build_planet(raw_dir, output_dir, "2k_mercury.jpg", "generic_rocky", bump_strength=4.0, base_roughness=0.90)
    build_planet(raw_dir, output_dir, "2k_saturn.jpg", "generic_gas", bump_strength=0.7, base_roughness=0.55)
    build_planet(raw_dir, output_dir, "2k_uranus.jpg", "generic_ice", bump_strength=0.5, base_roughness=0.45)
    # Generic moon imagery is only a rocky fallback, not a specific asteroid surface claim.
    build_planet(raw_dir, output_dir, "2k_moon.jpg", "generic_asteroid", bump_strength=5.0, base_roughness=0.95)

    outputs = sorted(output_dir.glob("*.jpg"))
    actual_filenames = {path.name for path in outputs}
    missing = sorted(EXPECTED_FILENAMES - actual_filenames)
    extra = sorted(actual_filenames - EXPECTED_FILENAMES)
    if missing or extra or len(outputs) != EXPECTED_OUTPUTS:
        raise RuntimeError(f"Manifest mismatch. Missing: {missing}; unexpected JPG files: {extra}.")
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "raw_textures")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "frontend/public/assets/textures")
    args = parser.parse_args()
    files = build(args.raw_dir, args.out_dir)
    print(f"Generated {EXPECTED_OUTPUTS} textures in {args.out_dir}")
    for path in files:
        print(path.name)


if __name__ == "__main__":
    main()
