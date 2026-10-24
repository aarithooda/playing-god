// Point-size compensation for drei's <Stars> vertex shader (see sim/starfieldScale.ts).
//
// drei attenuates star size as 30.0 / -mvPosition.z. When the starfield group is scaled by s, every
// view-space depth is s times larger, so size would shrink by 1/s; multiplying by the same s restores
// it. Both replacements must apply together (the uniform declaration and its use), otherwise the
// shader would fail to compile; if drei's shader ever changes shape we leave it untouched and warn.

export const STAR_UNIFORM_DECLARATION = 'uniform float time;';
export const STAR_POINT_SIZE_TERM = '(30.0 / -mvPosition.z)';

export function applyStarSizeScale(vertexShader: string): string | null {
  if (!vertexShader.includes(STAR_UNIFORM_DECLARATION) || !vertexShader.includes(STAR_POINT_SIZE_TERM)) {
    return null;
  }
  return vertexShader
    .replace(STAR_UNIFORM_DECLARATION, `${STAR_UNIFORM_DECLARATION}\nuniform float sizeScale;`)
    .replace(STAR_POINT_SIZE_TERM, '(30.0 * sizeScale / -mvPosition.z)');
}
