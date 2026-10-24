// UI-0: the renderer integration boundary (plan section 11A).
//
// The 3D canvas consumes only defined inputs: bodies in display form (`SceneBody`), view options, and these
// trajectories. It owns every visual choice (displayed size, minimum on-screen size, materials, colours, camera,
// starfield). No other feature changes the renderer except through these inputs. Positions here are SI metres in the
// simulation frame; the renderer converts them with the current RenderTransform. Nothing in this file may import from
// `components/canvas/*`.

/** A position sample produced from backend state. The renderer converts it to scene units. */
export interface PositionSample {
  simulationTimeS: number;
  positionM: { x: number; y: number; z: number };
  /** A change of `segment` between neighbours means the path is discontinuous there: never connect across it. */
  segment: number;
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
