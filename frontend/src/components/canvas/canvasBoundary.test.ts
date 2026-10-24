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
  it("the canvas gains exactly one input, trajectories, beyond the props it had before", () => {
    const before = [
      "bodies", "selectedBodyId", "onSelectBody", "onFocusBody", "onClearSelection", "frameEpoch", "focus", "onFocusRelease",
      "placementMode", "placementRadius", "onPlacementConfirm", "onPlacementCancel", "onPlacementPreview", "leftInset",
      "rightInset", "transform", "showAxes", "showGrid", "viewControls", // viewControls: the UI view-toolbar contract (UI foundation)
    ];
    expect(propNames(canvasSource).sort()).toEqual([...before, "trajectories"].sort());
    expect(canvasSource).toMatch(/trajectories\?: readonly TrajectoryInput\[\]/);
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
