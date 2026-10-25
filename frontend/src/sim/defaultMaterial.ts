import type { BodyKind, BodyType, MaterialDto } from '../api/types';

/**
 * Default material profile per display bodyType for bodies the user creates (twin of DEFAULT_PROFILE_BY_BODY_TYPE in
 * backend/impact/materials.py). Without a material the backend resolves every contact as the legacy perfect merge.
 */
const PROFILE_BY_BODY_TYPE: Record<BodyType, string> = {
  star: 'gas-envelope-hhe',
  'gas-giant': 'gas-envelope-hhe',
  'ice-giant': 'water-ice',
  'rocky-planet': 'silicate-rock',
  moon: 'silicate-rock',
  asteroid: 'rubble-silicate',
  default: 'silicate-rock',
};

/** bodyType as the backend derives it when the request omits one (backend/models.py `default_body_type`). */
export function effectiveBodyType(kind: BodyKind, bodyType: BodyType | undefined): BodyType {
  return bodyType ?? (kind === 'star' ? 'star' : 'default');
}

export function defaultMaterial(kind: BodyKind, bodyType: BodyType | undefined): MaterialDto {
  return { profileId: PROFILE_BY_BODY_TYPE[effectiveBodyType(kind, bodyType)], layers: null };
}
