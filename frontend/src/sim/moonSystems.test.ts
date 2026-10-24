import { describe, expect, it } from "vitest";
import { focusRadiusFor, systemIds } from "./moonSystems";
import { nearPlaneForDistance, DEFAULT_NEAR, MIN_NEAR } from "./framing";
import type { SceneBody } from "./viewModel";

const body = (id: string, x: number, radius: number, primaryId?: string, kind: "star" | "planet" = "planet"): SceneBody => ({
  id, name: id, color: "#fff", kind, bodyType: "default", position: [x, 0, 0], radius, ...(primaryId ? { primaryId } : {}),
});

// A Sun, an Earth 30 units out with a Moon 0.0035 units from it, and a Mars well beyond.
const scene = () => [body("sun", 0, 0.007, undefined, "star"), body("earth", 30, 6.4e-5), body("moon", 30.0035, 1.7e-5, "earth"), body("mars", 45, 3.4e-5)];

describe("planet systems (labels and focus)", () => {
  const bodies = ([...scene(), body("phobos", 45.00001, 1e-8, "mars"), body("deimos", 45.00002, 1e-8, "mars")]);

  it("selecting a moon or its planet names the whole system; others name nothing", () => {
    expect(systemIds(bodies, "moon")).toEqual(["earth", "moon"]);
    expect(systemIds(bodies, "earth")).toEqual(["earth", "moon"]);
    expect(systemIds(bodies, "mars")).toEqual(["mars", "phobos", "deimos"]);
    expect(systemIds(bodies, "sun")).toEqual([]);
    expect(systemIds(bodies, undefined)).toEqual([]);
    expect(systemIds(bodies, "missing")).toEqual([]);
  });

  it("focusing a planet frames its farthest moon; a moon or a lone body frames itself", () => {
    expect(focusRadiusFor(bodies, "earth")).toBeCloseTo(0.0035 * 1.1);
    expect(focusRadiusFor(bodies, "moon")).toBe(bodies.find((b) => b.id === "moon")!.radius);
    expect(focusRadiusFor(bodies, "sun")).toBe(0.007);
    expect(focusRadiusFor(bodies, "nope")).toBeUndefined();
  });
});

describe("nearPlaneForDistance", () => {
  it("keeps the default near plane for a far camera and shrinks it only when a body is close", () => {
    expect(nearPlaneForDistance(80)).toBe(DEFAULT_NEAR);
    expect(nearPlaneForDistance(0.01)).toBeCloseTo(0.001);
    expect(nearPlaneForDistance(1e-9)).toBe(MIN_NEAR);
    expect(nearPlaneForDistance(Infinity)).toBe(DEFAULT_NEAR);
  });
});
