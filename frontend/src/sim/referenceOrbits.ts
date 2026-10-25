// Display-only reference orbits for the Solar System presets (D-064). Pure, so it is unit-tested.
//
// What is drawn, and what it means:
// - planets: the J2000.0 heliocentric osculating ellipse of each planet (JPL Horizons). It is a guide to the orbit the
//   simulated planet starts on; the simulated planet itself (and its recorded path) comes from the backend only. A
//   planet's guide is drawn only while that planet's body exists in the universe.
// - outer bodies (Pluto and seven other trans-Neptunian objects and Centaurs): not simulated. Their J2000.0 ellipse is
//   drawn with a marker that moves along it by two-body propagation, so it is a labelled guide, not a body.
// The elements and their provenance are in src/data/referenceOrbits.json; the raw Horizons responses are archived in
// backend/presets/sources/reference-orbits.
import data from "../data/referenceOrbits.json";
import { toKeplerElements, type KeplerElements, type SourceElements } from "./keplerOrbit";

/** The presets whose bodies and epoch the reference orbits belong to (J2000.0, ecliptic frame, t = 0 at the epoch). */
export const REFERENCE_ORBIT_PRESETS: ReadonlySet<string> = new Set(["solar-system-j2000", "solar-system-moons-j2000"]);

/** The Sun body of both presets: the focus every heliocentric orbit is drawn around. */
export const SUN_BODY_ID = "body-sun";

export type ReferenceOrbitGroup = "planet" | "outer";

export interface ReferenceOrbit {
  id: string;
  name: string;
  group: ReferenceOrbitGroup;
  /** The simulated body this guide belongs to (planets only). */
  bodyId?: string;
  elements: KeplerElements;
  color: string;
  /** Line opacity: planets are first in the visual hierarchy, the outer web third. */
  opacity: number;
  /** Lower draws first and wins label conflicts. */
  priority: number;
}

/**
 * Orbit colours (display only). Neptune blue, Uranus teal, Saturn muted brown, Pluto orange and a grey web for the
 * other outer bodies; the remaining planets get restrained colours that stay apart from those and from each other.
 */
export const ORBIT_COLORS: Readonly<Record<string, string>> = {
  mercury: "#b3a593",
  venus: "#d9b56c",
  earth: "#5fa8e8",
  mars: "#cf6a43",
  jupiter: "#c9a27e",
  saturn: "#9a7651",
  uranus: "#3fb5a8",
  neptune: "#3f6be0",
  pluto: "#f08a2c",
};
export const OUTER_WEB_COLOR = "#8b929c";

const PRIORITY: readonly string[] = [
  "jupiter", "saturn", "uranus", "neptune", "earth", "mars", "venus", "mercury",
  "pluto", "haumea", "makemake", "quaoar", "orcus", "chiron", "2014-nw65", "chiminigagua",
];

interface SourceOrbit {
  id: string;
  name: string;
  group: string;
  bodyId?: string;
  elements: SourceElements;
}

export const REFERENCE_ORBITS: readonly ReferenceOrbit[] = (data.orbits as SourceOrbit[]).map((o) => {
  const group: ReferenceOrbitGroup = o.group === "planet" ? "planet" : "outer";
  return {
    id: o.id,
    name: o.name,
    group,
    ...(o.bodyId === undefined ? {} : { bodyId: o.bodyId }),
    elements: toKeplerElements(o.elements),
    color: ORBIT_COLORS[o.id] ?? OUTER_WEB_COLOR,
    opacity: group === "planet" ? 0.62 : o.id === "pluto" ? 0.9 : 0.42,
    priority: PRIORITY.indexOf(o.id) >= 0 ? PRIORITY.indexOf(o.id) : PRIORITY.length,
  };
});

export const REFERENCE_EPOCH_LABEL = data.epoch.label;

/** Whether a universe shows the reference orbits: a Solar System preset that still has its Sun. */
export function referenceOrbitsApply(presetId: string | null | undefined, bodyIds: readonly string[]): boolean {
  return !!presetId && REFERENCE_ORBIT_PRESETS.has(presetId) && bodyIds.includes(SUN_BODY_ID);
}

/** The guides to draw: every outer orbit, and a planet's only while its simulated body exists. */
export function visibleReferenceOrbits(bodyIds: readonly string[]): ReferenceOrbit[] {
  const present = new Set(bodyIds);
  return REFERENCE_ORBITS.filter((o) => o.bodyId === undefined || present.has(o.bodyId));
}

/** The guide colour of a simulated planet (so its recorded path matches its guide), if it has one. */
export function orbitColorForBody(bodyId: string): string | undefined {
  return REFERENCE_ORBITS.find((o) => o.bodyId === bodyId)?.color;
}
