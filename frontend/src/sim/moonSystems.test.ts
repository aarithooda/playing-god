import { describe, expect, it } from "vitest";
import { MAX_RADIUS_FRACTION_OF_GAP, separateDisplayRadii } from "./radiusSeparation";
import { bodyDisplayScale, MIN_BODY_SCREEN_RADIUS_PX, MIN_CROWDED_BODY_PX, projectedRadiusPx } from "./bodyVisibility";
import { focusRadiusFor, systemIds } from "./moonSystems";
import { nearPlaneForDistance, DEFAULT_NEAR, MIN_NEAR } from "./framing";
import type { SceneBody } from "./viewModel";

const body = (id: string, x: number, radius: number, primaryId?: string, kind: "star" | "planet" = "planet"): SceneBody => ({
  id, name: id, color: "#fff", kind, bodyType: "default", position: [x, 0, 0], radius, ...(primaryId ? { primaryId } : {}),
});

// A Sun, an Earth 30 units out with a Moon 0.0035 units from it, and a Mars well beyond.
const scene = () => [body("sun", 0, 3, undefined, "star"), body("earth", 30, 2), body("moon", 30.0035, 1.7, "earth"), body("mars", 45, 1.2)];

describe("separateDisplayRadii with moons (display only)", () => {
  it("is exactly the old behaviour when no body has a primary", () => {
    const plain = [body("a", 0, 3), body("b", 1, 2)];
    const out = separateDisplayRadii(plain);
    const k = out[0].radius / 3;
    expect(k).toBeLessThan(1);
    expect(out[1].radius / 2).toBeCloseTo(k);
    expect(out.every((b) => b.apparentRadius === undefined && b.clearance === undefined)).toBe(true);
  });

  it("keeps planets at the planetary scale: moons do not shrink the Sun or Mars", () => {
    const out = separateDisplayRadii(scene());
    const by = Object.fromEntries(out.map((b) => [b.id, b]));
    expect(by.sun.radius).toBe(3);
    expect(by.mars.radius).toBe(1.2);
  });

  it("never lets a planet and its moon overlap, and keeps their relative sizes", () => {
    const by = Object.fromEntries(separateDisplayRadii(scene()).map((b) => [b.id, b]));
    const gap = 0.0035;
    expect(by.earth.radius + by.moon.radius).toBeLessThanOrEqual(MAX_RADIUS_FRACTION_OF_GAP * gap + 1e-12);
    expect(by.moon.radius / by.earth.radius).toBeCloseTo(1.7 / 2);
  });

  it("records the apparent size of the planet and the clearance of both, and never moves a body", () => {
    const input = scene();
    const out = separateDisplayRadii(input);
    const by = Object.fromEntries(out.map((b) => [b.id, b]));
    expect(by.earth.apparentRadius).toBe(2);
    expect(by.moon.apparentRadius).toBeUndefined();
    expect(by.earth.clearance).toBeCloseTo(0.0035);
    expect(by.moon.clearance).toBeCloseTo(0.0035);
    expect(out.map((b) => b.position)).toEqual(input.map((b) => b.position));
  });

  it("ignores a primaryId that is not in the scene (a deleted planet) and a self-reference", () => {
    const out = separateDisplayRadii([body("a", 0, 1, "gone"), body("b", 10, 1, "b")]);
    expect(out.map((b) => b.radius)).toEqual([1, 1]);
  });
});

describe("bodyDisplayScale with an apparent radius", () => {
  const fov = 50;
  const h = 1000;

  it("is unchanged without options (plain minimum on-screen size)", () => {
    expect(bodyDisplayScale(0.001, 80, fov, h)).toBeCloseTo(MIN_BODY_SCREEN_RADIUS_PX / projectedRadiusPx(0.001, 80, fov, h));
    expect(bodyDisplayScale(0.001, 80, fov, h, MIN_BODY_SCREEN_RADIUS_PX)).toBe(bodyDisplayScale(0.001, 80, fov, h));
  });

  it("draws a planet with moons at its apparent size from far away", () => {
    const s = bodyDisplayScale(0.001, 80, fov, h, { apparentRadius: 2, clearance: 10 });
    expect(projectedRadiusPx(0.001, 80, fov, h) * s).toBeCloseTo(projectedRadiusPx(2, 80, fov, h));
  });

  it("stops enlarging at half the moon distance on screen, so the moon can be seen", () => {
    const s = bodyDisplayScale(0.001, 5, fov, h, { apparentRadius: 2, clearance: 0.1 });
    const px = projectedRadiusPx(0.001, 5, fov, h) * s;
    expect(px).toBeCloseTo(0.5 * projectedRadiusPx(0.1, 5, fov, h));
    expect(px).toBeLessThan(projectedRadiusPx(2, 5, fov, h));
  });

  it("never goes below the minimum on-screen size and is 1 when the body is already big enough", () => {
    expect(bodyDisplayScale(0.001, 80, fov, h, { apparentRadius: 2, clearance: 1e-9 }) * projectedRadiusPx(0.001, 80, fov, h)).toBeCloseTo(MIN_CROWDED_BODY_PX);
    expect(bodyDisplayScale(5, 20, fov, h, { apparentRadius: 2, clearance: 1 })).toBe(1);
  });
});

describe("planet systems (labels and focus)", () => {
  const bodies = separateDisplayRadii([...scene(), body("phobos", 45.00001, 0.5, "mars"), body("deimos", 45.00002, 0.5, "mars")]);

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
    expect(focusRadiusFor(bodies, "sun")).toBe(3);
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
