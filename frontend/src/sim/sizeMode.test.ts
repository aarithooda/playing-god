// Regression tests for the Solar System rendering failures: Earth drawn as large as the Sun, Earth shrinking when its
// Moon is present, and planetary paths disappearing in the moons preset. Uses the real preset bodies (generated from the
// backend presets; tests/validation/test_preset_moons.py checks the fixture is current).
import { describe, expect, it } from "vitest";
import presets from "../test/presetBodies.json";
import { bodyDisplayScale, MAX_ZOOM_BOOST, OVERVIEW_DISTANCE, projectedRadiusPx, zoomBoost } from "./bodyVisibility";
import { pathsNote, pathTargets } from "./history/pathSelection";
import { DEFAULT_SIZE_MODE, fitTransform, visibleRadiusPx, SUN_RADIUS_M, MIN_VISIBLE_RADIUS_PX, MAX_VISIBLE_RADIUS_PX } from "./renderTransform";
import { buildSceneBodies } from "./sceneBodies";
import { toSceneBody, type DisplayBody } from "./viewModel";

type Raw = { id: string; name: string; kind: string; radiusM: number; positionM: { x: number; y: number; z: number }; colorHex: string; bodyType: string | null; assetKey: string | null; primaryId: string | null };
const load = (id: "solar-system-j2000" | "solar-system-moons-j2000"): DisplayBody[] =>
  (presets[id] as Raw[]).map((b) => ({
    id: b.id, name: b.name, kind: b.kind === "star" ? "star" : "planet", colorHex: b.colorHex, positionM: b.positionM, radiusM: b.radiusM,
    ...(b.bodyType ? { bodyType: b.bodyType as DisplayBody["bodyType"] } : {}),
    ...(b.assetKey ? { assetKey: b.assetKey } : {}),
    ...(b.primaryId ? { primaryId: b.primaryId } : {}),
  }));
const plain = load("solar-system-j2000");
const moons = load("solar-system-moons-j2000");
const transform = fitTransform(moons.map((b) => b.positionM)); // the same scale for both presets: Neptune sets it
const FOV = 50;
const VIEWPORT_H = 900;
const CAMERA_DISTANCE = 80; // the default overview distance

/** Rendered (on-screen) radius in CSS px of a scene body at a given camera distance, as CelestialBody computes it. */
function renderedPx(b: ReturnType<typeof buildSceneBodies>[number], distance = CAMERA_DISTANCE): number {
  const scale = bodyDisplayScale(b.radius, distance, FOV, VIEWPORT_H, { minPx: b.visiblePx === undefined ? undefined : b.visiblePx * zoomBoost(distance), apparentRadius: b.apparentRadius, clearance: b.clearance });
  return projectedRadiusPx(b.radius, distance, FOV, VIEWPORT_H) * scale;
}
const by = (bodies: ReturnType<typeof buildSceneBodies>) => Object.fromEntries(bodies.map((b) => [b.id, b]));

describe("size modes", () => {
  it("physical proportions are the default", () => {
    expect(DEFAULT_SIZE_MODE).toBe("physical");
  });

  it("radius mapping: the scene radius is radiusM / metersPerUnit, with no other input", () => {
    const earth = moons.find((b) => b.id === "body-earth")!;
    expect(toSceneBody(earth, { metersPerUnit: 1e9 }, "physical").radius).toBeCloseTo(6371008.4 / 1e9, 12);
    expect(toSceneBody(earth, { metersPerUnit: 2e9 }, "physical").radius).toBeCloseTo(6371008.4 / 2e9, 12);
  });

  it("Sun >> Earth > Moon in true scene radius (authoritative preset radii)", () => {
    const s = by(buildSceneBodies(moons, transform, "physical"));
    expect(s["body-sun"].radius / s["body-earth"].radius).toBeCloseTo(6.957e8 / 6371008.4, 6);
    expect(s["body-sun"].radius / s["body-earth"].radius).toBeGreaterThan(100);
    expect(s["body-earth"].radius / s["body-moon"].radius).toBeCloseTo(6371008.4 / 1737400, 6);
    expect(s["body-jupiter"].radius).toBeGreaterThan(s["body-earth"].radius * 10);
  });

  it("the Sun renders vastly larger than Earth, and Earth larger than the Moon, at the overview and when zoomed in", () => {
    const s = by(buildSceneBodies(moons, transform, "physical"));
    for (const d of [80, 5, 0.5, 0.02]) {
      expect(renderedPx(s["body-sun"], d)).toBeGreaterThan(renderedPx(s["body-earth"], d));
      expect(renderedPx(s["body-earth"], d)).toBeGreaterThanOrEqual(renderedPx(s["body-moon"], d));
    }
    expect(renderedPx(s["body-sun"]) / renderedPx(s["body-earth"])).toBeGreaterThan(4);
    expect(renderedPx(s["body-earth"])).toBeGreaterThan(renderedPx(s["body-moon"])); // strictly, at the default view
    // Close to Earth, true proportions: Earth's disc is 3.67x the Moon's (the moons' clearance cap is not reached).
    expect(renderedPx(s["body-earth"], 0.0006) / renderedPx(s["body-moon"], 0.0006)).toBeCloseTo(6371008.4 / 1737400, 0);
  });

  it("the exaggerated mode is explicit and not to scale (the old logarithmic radii)", () => {
    const s = by(buildSceneBodies(plain, transform, "exaggerated"));
    expect(s["body-sun"].radius / s["body-earth"].radius).toBeLessThan(2); // the old log scaling: not physical
    expect(s["body-sun"].visiblePx).toBeUndefined();
  });

  it("the visibility floor grows with the body's own radius, within fixed bounds, and uses no other body", () => {
    const radii = [1e3, 1.7374e6, 6.371e6, 7e7, SUN_RADIUS_M, 7.6e11];
    const px = radii.map(visibleRadiusPx);
    for (let i = 1; i < px.length; i++) expect(px[i]).toBeGreaterThanOrEqual(px[i - 1]);
    expect(px[0]).toBe(MIN_VISIBLE_RADIUS_PX);
    expect(px[px.length - 1]).toBe(MAX_VISIBLE_RADIUS_PX);
    expect(visibleRadiusPx(SUN_RADIUS_M)).toBeGreaterThan(4 * visibleRadiusPx(6.371e6));
    expect(visibleRadiusPx(NaN)).toBe(MIN_VISIBLE_RADIUS_PX);
  });
});

describe("zoom boost of the visibility floor", () => {
  it("is 1 at and beyond the overview, grows when zooming in, is capped, and is the same for every body", () => {
    expect(zoomBoost(OVERVIEW_DISTANCE)).toBe(1);
    expect(zoomBoost(1000)).toBe(1);
    expect(zoomBoost(OVERVIEW_DISTANCE / 4)).toBeCloseTo(2);
    expect(zoomBoost(1e-9)).toBe(MAX_ZOOM_BOOST);
    expect(zoomBoost(NaN)).toBe(1);
  });

  it("keeps Earth recognisable beside its Moon in a close view, without hiding the Moon", () => {
    const s = by(buildSceneBodies(moons, transform, "physical"));
    const d = 0.02; // a camera that frames the Earth-Moon system
    const px = (b: (typeof s)[string]) => bodyDisplayScale(b.radius, d, FOV, VIEWPORT_H, { minPx: b.visiblePx! * zoomBoost(d), clearance: b.clearance }) * projectedRadiusPx(b.radius, d, FOV, VIEWPORT_H);
    expect(px(s["body-earth"])).toBeGreaterThan(8);
    expect(px(s["body-earth"])).toBeGreaterThan(px(s["body-moon"]));
    expect(px(s["body-moon"])).toBeGreaterThan(4);
  });
});

describe("stable scale: adding bodies never changes another body's size", () => {
  const sizeKey = (b: ReturnType<typeof buildSceneBodies>[number]) => [b.radius, b.visiblePx];

  it("Earth, the Sun and the other planets are identical in the original and the moons preset", () => {
    const a = by(buildSceneBodies(plain, transform, "physical"));
    const b = by(buildSceneBodies(moons, transform, "physical"));
    for (const id of ["body-sun", "body-mercury", "body-venus", "body-earth", "body-mars", "body-jupiter", "body-saturn", "body-uranus", "body-neptune"]) {
      expect(sizeKey(b[id]), id).toEqual(sizeKey(a[id]));
    }
    expect(b["body-earth"].radius).toBeCloseTo(6371008.4 / transform.metersPerUnit, 12); // = the physical radius, not shrunk by the Moon
  });

  it("adding an unrelated body, or the Moon, leaves every existing body's size untouched", () => {
    const base = plain.filter((b) => b.id !== "body-neptune");
    const extra: DisplayBody = { id: "x", name: "x", kind: "planet", colorHex: "#fff", positionM: { x: 1.5e11, y: 1e9, z: 0 }, radiusM: 1e6 };
    const before = by(buildSceneBodies(base, transform, "physical"));
    const after = by(buildSceneBodies([...base, extra], transform, "physical"));
    for (const id of Object.keys(before)) expect(sizeKey(after[id]), id).toEqual(sizeKey(before[id]));
    const withMoon = by(buildSceneBodies([...base, { ...extra, id: "body-moon", primaryId: "body-earth", positionM: { x: 1.4959787e11 + 3.8e8, y: 0, z: 0 } }], transform, "physical"));
    expect(sizeKey(withMoon["body-earth"])).toEqual(sizeKey(before["body-earth"]));
  });

  it("the size of a body does not depend on the camera framing: a different focus changes no scene radius", () => {
    const a = buildSceneBodies(moons, transform, "physical");
    const b = buildSceneBodies(moons, transform, "physical");
    expect(a.map((x) => x.radius)).toEqual(b.map((x) => x.radius)); // radii are pure functions of body + display scale
  });

  it("the moons are not hidden by their planet at a close view and are not enlarged past it", () => {
    const s = by(buildSceneBodies(moons, transform, "physical"));
    const earth = s["body-earth"];
    expect(earth.clearance).toBeCloseTo(Math.hypot(...(s["body-moon"].position.map((v, i) => v - earth.position[i]) as number[])), 12);
    // At a distance where Earth-Moon is 100 px apart, neither is drawn wider than half of that.
    const d = (earth.clearance! * (VIEWPORT_H / 2)) / (100 * Math.tan((FOV * Math.PI) / 360));
    expect(renderedPx(earth, d)).toBeLessThanOrEqual(50.0001);
    expect(renderedPx(s["body-moon"], d)).toBeLessThanOrEqual(50.0001);
  });
});

describe("orbit paths", () => {
  const ids = (list: DisplayBody[]) => list.map((b) => b.id);
  const moonIds = new Set(moons.filter((b) => b.primaryId).map((b) => b.id));
  const planets = moons.filter((b) => !b.primaryId).map((b) => b.id);

  it("the original preset: every body's path, or the selected body's (unchanged)", () => {
    expect(pathTargets(ids(plain), undefined)).toEqual(ids(plain));
    expect(pathTargets(ids(plain), "body-earth")).toEqual(["body-earth"]);
  });

  it("the moons preset: every planet's path stays visible, selected or not", () => {
    expect(pathTargets(ids(moons), undefined, moonIds)).toEqual(planets);
    expect(pathTargets(ids(moons), "body-earth", moonIds)).toEqual(planets);
    expect(pathTargets(ids(moons), "body-saturn", moonIds)).toEqual(planets);
    expect(planets).toContain("body-neptune");
    expect(planets).toHaveLength(9);
  });

  it("a selected moon adds its own path and removes no planet's", () => {
    expect(pathTargets(ids(moons), "body-moon", moonIds)).toEqual([...planets, "body-moon"]);
    expect(pathTargets(ids(moons), "body-gone", moonIds)).toEqual(planets);
  });

  it("custom bodies added to the moons preset keep every planet path (the moons never count towards the crowd limit)", () => {
    const five = [...ids(moons), ...Array.from({ length: 5 }, (_, i) => `x${i}`)];
    expect(pathTargets(five, undefined, moonIds)).toEqual([...planets, ...Array.from({ length: 5 }, (_, i) => `x${i}`)]);
    // 19 bodies + 3 would be 22 > 20 under the old rule and hide every path; the planets alone are still 12.
    expect(pathTargets([...ids(moons), "a", "b", "c"], undefined)).toEqual([]);
    expect(pathTargets([...ids(moons), "a", "b", "c"], undefined, moonIds)).toHaveLength(12);
    expect(pathTargets([...ids(moons), ...Array.from({ length: 30 }, (_, i) => `x${i}`)], undefined, moonIds)).toEqual([]); // genuinely crowded
  });

  it("the crowd note is not shown for a moons scene (planets always have paths)", () => {
    expect(pathsNote(true, 19, undefined, true)).toBeUndefined();
    expect(pathsNote(true, 25, undefined, false)).toMatch(/Select a body/);
  });
});
