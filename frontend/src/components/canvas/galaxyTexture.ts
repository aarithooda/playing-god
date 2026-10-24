import { DataTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, ClampToEdgeWrapping, RGBAFormat, UnsignedByteType } from 'three';

export const GALAXY_TEXTURE_WIDTH = 768;
export const GALAXY_TEXTURE_HEIGHT = 384;

function hashGrid(x: number, y: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(u: number, v: number, scale: number): number {
  const x = u * scale;
  const y = v * scale;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx0 = x - ix;
  const fy0 = y - iy;
  const fx = fx0 * fx0 * (3 - 2 * fx0);
  const fy = fy0 * fy0 * (3 - 2 * fy0);
  const a = hashGrid(ix, iy) * (1 - fx) + hashGrid(ix + 1, iy) * fx;
  const b = hashGrid(ix, iy + 1) * (1 - fx) + hashGrid(ix + 1, iy + 1) * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * Builds a small, deterministic scenery texture once. The moving scene only samples this texture;
 * it does not run procedural noise for every pixel on every frame.
 */
export function createGalaxyTexture(): DataTexture {
  const pixels = new Uint8Array(GALAXY_TEXTURE_WIDTH * GALAXY_TEXTURE_HEIGHT * 4);
  for (let y = 0; y < GALAXY_TEXTURE_HEIGHT; y += 1) {
    const v = y / (GALAXY_TEXTURE_HEIGHT - 1);
    for (let x = 0; x < GALAXY_TEXTURE_WIDTH; x += 1) {
      const u = x / GALAXY_TEXTURE_WIDTH;
      // Centre the band near the default overview's viewing latitude; the warped ridge reads as a
      // diagonal cloud belt while still wrapping continuously around the sky sphere.
      const center = 0.36 + 0.105 * Math.sin(u * Math.PI * 2.0 - 0.4) + 0.018 * Math.sin(u * Math.PI * 11.0 + 1.4);
      const latitude = (v - center) / 0.115;
      const largeCloud = 0.5 + 0.24 * Math.sin(u * 19.0 + Math.sin(v * 12.0)) * Math.sin(v * 21.0 + u * 5.0);
      const cloudNoise = valueNoise(u, v, 5) * 0.5 + valueNoise(u, v, 11) * 0.28 + valueNoise(u, v, 23) * 0.15 + valueNoise(u, v, 47) * 0.07;
      const structure = Math.max(0, Math.min(1, largeCloud * 0.5 + cloudNoise * 0.5));
      const clouds = Math.max(0, Math.min(1, (structure - 0.28) / 0.62));
      const core = Math.exp(-latitude * latitude * 4.2) * Math.pow(0.08 + 0.92 * clouds, 1.5);
      const haze = Math.exp(-latitude * latitude * 0.72) * (0.08 + 0.12 * largeCloud);
      const alpha = Math.round(255 * Math.min(0.78, core * 0.58 + haze * 0.42));
      const warm = Math.max(0, Math.min(1, 0.5 + 0.24 * Math.sin(u * Math.PI * 2.0 - 0.8)));
      const i = (y * GALAXY_TEXTURE_WIDTH + x) * 4;
      pixels[i] = Math.round(108 + 55 * warm + 24 * structure);
      pixels[i + 1] = Math.round(122 + 23 * warm + 34 * structure);
      pixels[i + 2] = Math.round(151 - 20 * warm + 39 * structure);
      pixels[i + 3] = alpha;
    }
  }
  const texture = new DataTexture(pixels, GALAXY_TEXTURE_WIDTH, GALAXY_TEXTURE_HEIGHT, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
