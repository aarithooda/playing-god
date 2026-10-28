/**
 * Selectable collision-engine material profiles (ids are the backend registry's, GET /api/v1/materials). The user picks one explicitly;
 * nothing is inferred from a body's display `bodyType` (D-029) and no material is assigned silently (D-033 DQ-2 (a), repair M1).
 */
export const MATERIAL_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'silicate-rock', label: 'Silicate rock' },
  { id: 'iron', label: 'Iron' },
  { id: 'water-ice', label: 'Water ice' },
  { id: 'rubble-silicate', label: 'Rubble (loose silicate)' },
  { id: 'gas-envelope-hhe', label: 'Gas (hydrogen-helium)' },
];
