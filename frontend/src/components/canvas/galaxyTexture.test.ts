import { describe, expect, it } from 'vitest';
import { GALAXY_TEXTURE_HEIGHT, GALAXY_TEXTURE_WIDTH, createGalaxyTexture } from './galaxyTexture';

describe('procedural galaxy scenery', () => {
  it('creates a deterministic, bounded RGBA texture with a narrow cloudy band', () => {
    const texture = createGalaxyTexture();
    const image = texture.image as { data: Uint8Array; width: number; height: number };
    expect(image.width).toBe(GALAXY_TEXTURE_WIDTH);
    expect(image.height).toBe(GALAXY_TEXTURE_HEIGHT);
    expect(image.data).toHaveLength(GALAXY_TEXTURE_WIDTH * GALAXY_TEXTURE_HEIGHT * 4);
    let bandOpacity = 0;
    let poleOpacity = 0;
    for (let x = 0; x < GALAXY_TEXTURE_WIDTH; x += 1) {
      bandOpacity += image.data[(Math.floor(GALAXY_TEXTURE_HEIGHT / 2) * GALAXY_TEXTURE_WIDTH + x) * 4 + 3]!;
      poleOpacity += image.data[x * 4 + 3]!;
    }
    expect(bandOpacity).toBeGreaterThan(poleOpacity * 3);
    expect([...image.data].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)).toBe(true);
    texture.dispose();
  });
});
