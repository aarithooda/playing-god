// The renderer owns materials. A star glows (emissive) so it reads as a light source; a planet is lit by the scene.
// Only `kind` and the display colour are inputs: no textures or models.
import type { BodyKind } from '../../api/types';

export interface BodyMaterialSpec {
  color: string;
  emissive: string;
  emissiveIntensity: number;
}

export function materialForKind(kind: BodyKind | undefined, color: string): BodyMaterialSpec {
  if (kind === 'star') return { color, emissive: color, emissiveIntensity: 1 };
  return { color, emissive: '#000000', emissiveIntensity: 0 };
}
