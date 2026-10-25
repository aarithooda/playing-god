// UI-0: the renderer integration boundary (plan section 11A).
//
// The 3D canvas consumes only defined inputs: bodies in display form (`SceneBody`), view options, and these
// trajectories. It owns every visual choice (displayed size, minimum on-screen size, materials, colours, camera,
// starfield). No other feature changes the renderer except through these inputs. Positions here are SI metres in the
// simulation frame; the renderer converts them with the current RenderTransform. Nothing in this file may import from
// `components/canvas/*`.

/**
 * D-064: display-only reference orbits of a Solar System preset. Not simulation state: the guides are J2000 osculating
 * ellipses, the outer-body markers and the main-belt sample move by two-body propagation of JPL elements, and none of
 * it is ever sent to the backend. Absent = the canvas is drawn as before.
 */
export interface ReferenceOrbitsInput {
  /** The body whose displayed position is the common focus (the Sun). */
  sunBodyId: string;
  orbits: readonly ReferenceOrbitGuide[];
  /** Simulation time of the displayed state (s since J2000.0, live or a recorded sample). */
  displayTimeS: number;
  /** The guides and labels; when false only the canvas's Solar System framing remains. */
  showGuides: boolean;
  showMainBelt: boolean;
}

/** One heliocentric two-body guide (sim/referenceOrbits.ts builds these from committed JPL elements). */
export interface ReferenceOrbitGuide {
  id: string;
  name: string;
  /** "planet": guide of a simulated planet (`bodyId`); "outer": a non-simulated object, drawn with a moving marker. */
  group: "planet" | "outer";
  bodyId?: string;
  color: string;
  opacity: number;
  /** Lower wins label conflicts. */
  priority: number;
  /** Osculating elements in the simulation frame: semi-major axis (m), mean anomaly at `epochJd` (rad), mean motion (rad/day), perifocal unit vectors. */
  elements: { aM: number; e: number; meanAnomaly: number; meanMotionPerDay: number; epochJd: number; p: EffectPoint; q: EffectPoint };
}

/** A position sample produced from backend state. The renderer converts it to scene units. */
export interface PositionSample {
  simulationTimeS: number;
  positionM: { x: number; y: number; z: number };
  /** A change of `segment` between neighbours means the path is discontinuous there: never connect across it. */
  segment: number;
}

/** A massless visual sample point (simulation metres). It carries no mass and is never fed back into the simulation. */
export interface EffectPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * UI-0 (Stage 9, CP-3 / D-053): one collision effect at the displayed time. `cloud` and `particles` represent material and follow the
 * displayed SIMULATION time; `flash` is visual only (wall-clock, frozen while paused). Nothing here has a mass field: the renderer
 * draws it and reports nothing back.
 */
export interface CollisionEffectInput {
  /** `${universeId}:${eventId}`. */
  key: string;
  eventId: string;
  /** Where the bodies touched (simulation metres). */
  centerM: EffectPoint;
  cloud?: { radiusM: number; opacity: number; colorHex: string };
  flash?: { intensity: number; remaining01: number };
  /** Deterministic samples of the debris parcels (statistical, massless). */
  particles: readonly EffectPoint[];
  colorHex: string;
  /** Always shown: what the viewer is looking at is a visual, not a computed result. */
  label: string;
}

/** UI-0 (Stage 9): a mark on a body's surface, in the BODY-LOCAL frame so it stays attached while the body rotates. */
export interface SurfaceMarkInput {
  key: string;
  bodyId: string;
  /** Unit vector in the body's own frame. */
  centerLocal: EffectPoint;
  /** Display size only (radians of arc). */
  angularRadiusRad: number;
  colorHex: string;
}

export interface TrajectoryInput {
  /** `${universeId}:${generation}:${bodyId}`: a stable React key, never reused across universes or generations. */
  key: string;
  universeId: string;
  bodyId: string;
  /** "reference" is the other Orbit Lab run: drawn dashed and muted. */
  role: 'active' | 'reference';
  colorHex: string;
  /** Ascending in time. */
  samples: readonly PositionSample[];
}
