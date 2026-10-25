// UI-0 boundary checks that need no WebGL: what the canvas accepts, and that features stay off it.
import { describe, expect, it } from "vitest";
import { materialForKind } from "./bodyMaterial";

// Every source file of the app, as text, keyed by its path relative to src/.
const raw = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const sources = new Map(Object.entries(raw).map(([k, v]) => [k.replace("/src/", ""), v]));
const canvasSource = sources.get("components/canvas/UniverseCanvas.tsx")!;

function propNames(source: string): string[] {
  const block = source.match(/interface UniverseCanvasProps \{([\s\S]*?)\n\}/)![1]!;
  return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
}

describe("UI-0 renderer boundary", () => {
  it("the canvas gains exactly seven inputs beyond the props it had before: trajectories, labeledBodyIds, overviewZoom, (CP-3 / D-053) collisionEffects, surfaceMarks and (Ring World, display only) presetId, ringWorldAnimate", () => {
    const before = [
      "bodies", "selectedBodyId", "onSelectBody", "onFocusBody", "onClearSelection", "frameEpoch", "focus", "onFocusRelease",
      "placementMode", "placementRadius", "onPlacementConfirm", "onPlacementCancel", "onPlacementPreview", "leftInset",
      "rightInset", "transform", "showAxes", "showGrid", "viewControls", // viewControls: the UI view-toolbar contract (UI foundation)
    ];
    // D-064 adds the display-only Solar System reference orbits; Ring World adds presetId and ringWorldAnimate.
    expect(propNames(canvasSource).sort()).toEqual([...before, "trajectories", "labeledBodyIds", "overviewZoom", "collisionEffects", "surfaceMarks", "referenceOrbits", "presetId", "ringWorldAnimate"].sort());
    expect(canvasSource).toMatch(/referenceOrbits\?: ReferenceOrbitsInput/);
    expect(canvasSource).toMatch(/referenceOrbits && \(\s*<ReferenceOrbitLayer/);
    expect(canvasSource).toMatch(/trajectories\?: readonly TrajectoryInput\[\]/);
    // the two Stage 9 inputs are optional and typed by the contract; the layer is conditional
    expect(canvasSource).toMatch(/collisionEffects\?: readonly CollisionEffectInput\[\]/);
    expect(canvasSource).toMatch(/surfaceMarks\?: readonly SurfaceMarkInput\[\]/);
    expect(canvasSource).toMatch(/collisionEffects\.length > 0 && <CollisionEffectsLayer/);
  });

  it("the Stage 9 contract types carry no mass and the effect layers import nothing that reaches the simulation", () => {
    const contract = sources.get("render/contract.ts")!;
    const effectTypes = contract.slice(contract.indexOf("export interface CollisionEffectInput"), contract.indexOf("export interface TrajectoryInput"));
    expect(effectTypes).not.toMatch(/mass\w*\??\s*:/i); // no mass property on either input type
    const referenceTypes = contract.slice(contract.indexOf("export interface ReferenceOrbitsInput"), contract.indexOf("export interface PositionSample"));
    expect(referenceTypes).not.toMatch(/mass\w*\??\s*:/i);
    for (const file of ["CollisionEffectsLayer", "DebrisParticles", "SurfaceMarks", "ReferenceOrbitLayer", "MainBeltLayer"]) {
      const text = sources.get(`components/canvas/${file}.tsx`)!;
      expect(text).not.toMatch(/api\/client|useSimulation|backend/);
    }
  });

  it("canvas renders without trajectories exactly as before (the prop is optional and the layer is conditional)", () => {
    expect(canvasSource).toMatch(/trajectories = \[\]|trajectories,/);
    expect(canvasSource).toMatch(/trajectories\.length > 0 && <TrajectoryLayer/);
  });

  it("the render contract imports nothing from the canvas or the app", () => {
    expect(sources.get("render/contract.ts")).toBeDefined();
    expect(sources.get("render/contract.ts")).not.toMatch(/^import /m);
  });

  it("history modules do not import canvas components", () => {
    const history = [...sources].filter(([k]) => /^sim\/history\/[^/]+\.ts$/.test(k) && !k.endsWith(".test.ts"));
    const timeline = sources.get("components/ui/HistoryTimeline.tsx");
    for (const [, text] of [...history, ...(timeline ? [["HistoryTimeline", timeline] as [string, string]] : [])]) {
      expect(text).not.toMatch(/components\/canvas|UniverseCanvas/);
    }
  });
});

describe("body materials (renderer-owned)", () => {
  it("stars are emissive in their own colour; planets are not", () => {
    expect(materialForKind("star", "#fdb813")).toEqual({ color: "#fdb813", emissive: "#fdb813", emissiveIntensity: 1 });
    expect(materialForKind("planet", "#3b82f6")).toEqual({ color: "#3b82f6", emissive: "#000000", emissiveIntensity: 0 });
    expect(materialForKind(undefined, "#3b82f6").emissiveIntensity).toBe(0);
  });
});
