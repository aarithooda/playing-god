import { describe, expect, it } from "vitest";
import {
  FRONT_AZIMUTH,
  RING_EDGES,
  RING_GRAIN_COUNT,
  RING_WORLD_PRESET_ID,
  generateRingGrains,
  grainAngularSpeed,
  isRingWorldBody,
  planetBandPixels,
  ringDensity,
  ringWorldCameraOffset,
  RING_WORLD_MIN_DISTANCE_RADII,
} from "./ringWorld";

describe("ring grains are deterministic", () => {
  it("returns the requested count and the same data for the same seed", () => {
    const a = generateRingGrains(2000, 5);
    const b = generateRingGrains(2000, 5);
    expect(a.count).toBe(2000);
    expect(a.orbit).toEqual(b.orbit);
    expect(a.color).toEqual(b.color);
    expect(generateRingGrains(2000, 6).orbit).not.toEqual(a.orbit);
  });

  it("defaults to thousands of grains and handles degenerate counts", () => {
    expect(RING_GRAIN_COUNT).toBeGreaterThanOrEqual(5000);
    expect(generateRingGrains(0).count).toBe(0);
    expect(generateRingGrains(-3).count).toBe(0);
  });

  it("keeps every value finite, sizes small and rotations unit length", () => {
    const g = generateRingGrains(3000);
    for (const arr of [g.orbit, g.size, g.rotation, g.color]) expect(arr.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < g.count; i += 1) {
      const q = Math.hypot(g.rotation[4 * i], g.rotation[4 * i + 1], g.rotation[4 * i + 2], g.rotation[4 * i + 3]);
      expect(q).toBeCloseTo(1, 4);
      expect(Math.max(g.size[3 * i], g.size[3 * i + 1], g.size[3 * i + 2])).toBeLessThan(0.06);
    }
  });
});

describe("ring distribution", () => {
  const g = generateRingGrains(RING_GRAIN_COUNT);
  const radii = Array.from({ length: g.count }, (_, i) => g.orbit[4 * i]);

  it("has a dense B ring, an empty Cassini division and a thinner A ring", () => {
    const e = RING_EDGES;
    const inBand = (a: number, b: number) => radii.filter((r) => r >= a && r < b).length / (b - a);
    const b = inBand(e.bInner + 0.2, e.bOuter - 0.05);
    const cassini = inBand(e.bOuter + 0.01, e.aInner - 0.01);
    const a = inBand(e.aInner + 0.02, e.enckeGap - 0.03);
    expect(cassini).toBeLessThan(b * 0.15);
    expect(a).toBeLessThan(b);
    expect(a).toBeGreaterThan(b * 0.2);
  });

  it("leaves a gap in the A ring at the Encke position", () => {
    const e = RING_EDGES;
    const gap = radii.filter((r) => Math.abs(r - e.enckeGap) < 0.006).length / 0.012;
    const nearby = radii.filter((r) => Math.abs(r - (e.enckeGap - 0.05)) < 0.006).length / 0.012;
    expect(gap).toBeLessThan(nearby * 0.3);
  });

  it("stays between the inner C ring and the outer limit, with thin outer scatter", () => {
    expect(Math.min(...radii)).toBeGreaterThan(RING_EDGES.cInner - 0.1);
    expect(Math.max(...radii)).toBeLessThanOrEqual(RING_EDGES.outerLimit + 1e-6);
    expect(ringDensity(RING_EDGES.outerLimit + 1)).toBe(0);
    expect(ringDensity(0.5)).toBe(0);
  });

  it("concentrates grains in front and thins into side arcs: the front sector is denser than the sides and back", () => {
    const sector = (centre: number) => {
      let n = 0;
      for (let i = 0; i < g.count; i += 1) {
        let d = Math.abs(((g.orbit[4 * i + 1] - centre + Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d < 0) d += 2 * Math.PI;
        if (d < 0.35) n += 1;
      }
      return n;
    };
    const front = sector(FRONT_AZIMUTH);
    const left = sector(FRONT_AZIMUTH + 1.45);
    const right = sector(FRONT_AZIMUTH - 1.45);
    const back = sector(FRONT_AZIMUTH + Math.PI);
    expect(front).toBeGreaterThan(left * 1.5);
    expect(front).toBeGreaterThan(right * 1.5);
    expect(left).toBeGreaterThan(back * 1.2);
    expect(right).toBeGreaterThan(back * 1.2);
    expect(back).toBeGreaterThan(0);
  });

  it("varies grain size and brightness, and drifts slower further out", () => {
    const sizes = Array.from({ length: g.count }, (_, i) => g.size[3 * i]);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(3);
    const lum = Array.from({ length: g.count }, (_, i) => g.color[3 * i] + g.color[3 * i + 1] + g.color[3 * i + 2]);
    expect(Math.max(...lum) / Math.min(...lum)).toBeGreaterThan(2);
    expect(grainAngularSpeed(1.6)).toBeGreaterThan(grainAngularSpeed(2.3));
  });
});

describe("ring world preset detection", () => {
  it("only matches Saturn in the Ring World preset", () => {
    expect(isRingWorldBody(RING_WORLD_PRESET_ID, { assetKey: "saturn" })).toBe(true);
    expect(isRingWorldBody(RING_WORLD_PRESET_ID, { assetKey: "titan" })).toBe(false);
    expect(isRingWorldBody("solar-system-moons-j2000", { assetKey: "saturn" })).toBe(false);
    expect(isRingWorldBody(null, { assetKey: "saturn" })).toBe(false);
    expect(isRingWorldBody(undefined, { assetKey: "saturn" })).toBe(false);
  });
});

describe("opening camera", () => {
  const base = { radius: 0.58, fovDeg: 50, width: 1600, height: 900, leftInset: 0, rightInset: 0 };
  const dist = (o: number[]) => Math.hypot(o[0], o[1], o[2]);

  it("looks slightly down from in front, centred on the planet", () => {
    const o = ringWorldCameraOffset(base);
    expect(o[0]).toBe(0);
    expect(o[1]).toBeGreaterThan(0);
    expect(o[2]).toBeGreaterThan(o[1]);
  });

  it("puts the whole A ring inside the free width and makes the planet a large part of the view", () => {
    const o = ringWorldCameraOffset(base);
    const halfWidthAtPlanet = Math.tan((50 * Math.PI) / 360) * dist(o) * (1600 / 900);
    expect(RING_EDGES.aOuter * base.radius).toBeLessThanOrEqual(halfWidthAtPlanet);
    const planetFractionOfHeight = (base.radius / (Math.tan((50 * Math.PI) / 360) * dist(o)));
    expect(planetFractionOfHeight).toBeGreaterThan(0.3);
  });

  it("pulls back when sidebars narrow the free area, and never goes closer than the minimum", () => {
    const wide = dist(ringWorldCameraOffset(base));
    const narrow = dist(ringWorldCameraOffset({ ...base, leftInset: 500, rightInset: 400 }));
    expect(narrow).toBeGreaterThan(wide);
    const huge = dist(ringWorldCameraOffset({ ...base, width: 8000 }));
    expect(huge).toBeGreaterThanOrEqual(RING_WORLD_MIN_DISTANCE_RADII * base.radius - 1e-9);
  });

  it("bounds the pull-back when sidebars cover almost the whole canvas (phones)", () => {
    const covered = dist(ringWorldCameraOffset({ ...base, width: 375, height: 812, leftInset: 40, rightInset: 375 }));
    const half = dist(ringWorldCameraOffset({ ...base, width: 375, height: 812, leftInset: 0, rightInset: 187.5 }));
    expect(Number.isFinite(covered)).toBe(true);
    expect(covered).toBeCloseTo(half, 6);
  });

  it("falls back to finite values for invalid input", () => {
    const o = ringWorldCameraOffset({ ...base, width: 0 });
    expect(o.every(Number.isFinite)).toBe(true);
  });
});

describe("planet bands", () => {
  it("is deterministic, opaque, cream-coloured and banded", () => {
    const a = planetBandPixels(64, 32);
    expect(a).toEqual(planetBandPixels(64, 32));
    expect(a.length).toBe(64 * 32 * 4);
    let r = 0;
    let b = 0;
    const rowMeans: number[] = [];
    for (let y = 0; y < 32; y += 1) {
      let m = 0;
      for (let x = 0; x < 64; x += 1) {
        const o = (y * 64 + x) * 4;
        expect(a[o + 3]).toBe(255);
        r += a[o];
        b += a[o + 2];
        m += a[o];
      }
      rowMeans.push(m / 64);
    }
    expect(r).toBeGreaterThan(b * 1.15);
    expect(Math.max(...rowMeans) - Math.min(...rowMeans)).toBeGreaterThan(3);
    expect(Math.max(...rowMeans) - Math.min(...rowMeans)).toBeLessThan(60);
  });
});
