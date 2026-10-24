// Grid scale for the optional analysis overlay (display only).
//
// The scene is a uniform scaling of the physics frame (renderTransform.ts), so a grid in scene units is a grid
// in metres. Cell sizes are 1, 2 or 5 times a power of ten metres, so the numbers on the legend are readable and
// stay put while the display scale is held fixed. Nothing here touches the simulation.

/** Aim for cells of about this many scene units across (the fitted scene is ~80 units wide). */
export const GRID_TARGET_CELL_UNITS = 5;
/** Every Nth line is drawn stronger, so distances can be counted in whole cells. */
export const GRID_SECTION_EVERY = 5;

const STEPS = [1, 2, 5, 10];

/** The 1-2-5 (x power of ten) value nearest, on a log scale, to `raw` (> 0). */
export function nearestNice(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const m = raw / 10 ** exp;
  let best = STEPS[0];
  for (const s of STEPS) if (Math.abs(Math.log(m / s)) < Math.abs(Math.log(m / best))) best = s;
  return best * 10 ** exp;
}

export interface GridCell {
  /** Cell edge in metres (1-2-5 x 10^n). */
  cellMeters: number;
  /** The same edge in scene units for the current display scale. */
  cellUnits: number;
  /** Edge of the stronger section lines in scene units. */
  sectionUnits: number;
}

export function gridCell(metersPerUnit: number): GridCell {
  const cellMeters = nearestNice(GRID_TARGET_CELL_UNITS * metersPerUnit);
  const cellUnits = cellMeters / metersPerUnit;
  return { cellMeters, cellUnits, sectionUnits: cellUnits * GRID_SECTION_EVERY };
}
