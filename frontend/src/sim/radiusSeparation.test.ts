import { describe, expect, it } from "vitest";
import { MAX_RADIUS_FRACTION_OF_GAP, separateDisplayRadii } from "./radiusSeparation";
import type { SceneBody } from "./viewModel";

const body = (id: string, x: number, radius: number, kind: "star" | "planet" = "planet"): SceneBody => ({
  id, name: id, color: "#fff", kind, position: [x, 0, 0], radius,
});

describe("separateDisplayRadii (display only)", () => {
  it("never lets two displayed spheres overlap", () => {
    // The Solar System at the fitted scale: display radii of 2-3 units against 0.7-unit spacing.
    const bodies = [body("sun", 0, 2.93, "star"), body("mercury", 0.7, 1.82), body("venus", 1.08, 2), body("earth", 1.47, 2.01)];
    const out = separateDisplayRadii(bodies);
    for (const a of out) for (const b of out) {
      if (a.id >= b.id) continue;
      expect(Math.abs(a.position[0] - b.position[0])).toBeGreaterThan(a.radius + b.radius);
    }
  });

  it("leaves radii that already fit untouched and never enlarges", () => {
    const bodies = [body("a", 0, 1), body("b", 100, 2)];
    expect(separateDisplayRadii(bodies).map((b) => b.radius)).toEqual([1, 2]);
  });

  it("shrinks every radius by the same factor, so relative sizes are preserved", () => {
    const bodies = [body("sun", 0, 3, "star"), body("near", 1, 1.5), body("far", 500, 2)];
    const out = separateDisplayRadii(bodies);
    const k = out[0].radius / 3;
    expect(k).toBeLessThan(1);
    expect(out[1].radius / 1.5).toBeCloseTo(k);
    expect(out[2].radius / 2).toBeCloseTo(k);
    expect(out[0].radius).toBeGreaterThan(out[2].radius); // the star is still the largest
    expect(out[1]).toMatchObject({ id: "near", position: [1, 0, 0], color: "#fff", kind: "planet" });
  });

  it("handles a single body and coincident bodies without NaN", () => {
    expect(separateDisplayRadii([body("a", 0, 2)])[0].radius).toBe(2);
    const out = separateDisplayRadii([body("a", 0, 2), body("b", 0, 2)]);
    for (const b of out) expect(Number.isFinite(b.radius) && b.radius > 0).toBe(true);
  });
});
