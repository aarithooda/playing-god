import { describe, expect, it, vi } from "vitest";
import { Group, PerspectiveCamera, Vector3, Vector4 } from "three";
import {
  BASE_CAMERA_FAR,
  MAX_STARFIELD_DISTANCE,
  requiredCameraFar,
  STAR_SHADER_W,
  STARFIELD_OUTER_RADIUS,
  STARFIELD_REFERENCE_DISTANCE,
  starfieldScale,
  syncStarfieldToCamera,
} from "./starfieldScale";

const angularRadius = (distance: number) =>
  Math.asin((STARFIELD_OUTER_RADIUS * starfieldScale(distance)) / distance);

describe("starfield scale", () => {
  it("leaves the starfield untouched up to the reference distance", () => {
    for (const d of [0, 1, 79, 300, 500, STARFIELD_REFERENCE_DISTANCE]) expect(starfieldScale(d)).toBe(1);
  });

  it("is continuous at the threshold", () => {
    const e = 1e-6;
    expect(starfieldScale(STARFIELD_REFERENCE_DISTANCE + e) - 1).toBeLessThan(1e-8);
  });

  it("grows linearly beyond the threshold and never shrinks as the camera moves out", () => {
    expect(starfieldScale(2 * STARFIELD_REFERENCE_DISTANCE)).toBeCloseTo(2, 12);
    let prev = 0;
    for (let d = 1; d < 1e6; d *= 1.3) {
      const s = starfieldScale(d);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("holds the apparent angular radius constant beyond the threshold", () => {
    const ref = angularRadius(STARFIELD_REFERENCE_DISTANCE);
    for (const d of [1e3, 1e4, 1e6]) expect(angularRadius(d)).toBeCloseTo(ref, 10);
  });

  it("stays finite and >= 1 for zero, negative, non-finite and astronomically large distances", () => {
    for (const d of [0, -5, NaN, Infinity, -Infinity, 1e300, Number.MAX_VALUE]) {
      expect(Number.isFinite(starfieldScale(d))).toBe(true);
      expect(starfieldScale(d)).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(requiredCameraFar(d))).toBe(true);
    }
    expect(starfieldScale(MAX_STARFIELD_DISTANCE * 10)).toBe(starfieldScale(MAX_STARFIELD_DISTANCE));
  });
});

describe("required camera far plane", () => {
  it("keeps the original far plane at ordinary distances", () => {
    expect(requiredCameraFar(80)).toBe(BASE_CAMERA_FAR);
    expect(requiredCameraFar(STARFIELD_REFERENCE_DISTANCE)).toBe(BASE_CAMERA_FAR);
  });

  it("is a power of two once it grows, and never decreases with distance", () => {
    let prev = 0;
    for (let d = 1; d < 1e12; d *= 1.07) {
      const far = requiredCameraFar(d);
      if (far > BASE_CAMERA_FAR) expect(Math.log2(far) % 1).toBe(0);
      expect(far).toBeGreaterThanOrEqual(prev);
      prev = far;
    }
  });

  // Regression: drei's shader positions stars with w = 0.5, which halves the effective far plane. A far
  // plane sized for the raw distance clipped a large share of the stars for d in roughly 4200..5100.
  it("never clips the farthest star of the scaled shell, as drei's shader (w = 0.5) projects it", () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, BASE_CAMERA_FAR);
    for (let d = 1; d < 1e12; d *= 1.01) {
      camera.far = requiredCameraFar(d);
      camera.updateProjectionMatrix();
      const farthestDepth = STAR_SHADER_W * d + STARFIELD_OUTER_RADIUS * starfieldScale(d);
      const clip = new Vector4(0, 0, -farthestDepth, STAR_SHADER_W).applyMatrix4(camera.projectionMatrix);
      expect(clip.z, `d=${d}`).toBeLessThanOrEqual(clip.w);
    }
  });
});

/** Projects a star the way drei's vertex shader does and returns NDC x, y and attenuated point size. */
function projectStar(camera: PerspectiveCamera, group: Group, sizeScale: number, star: Vector3) {
  camera.updateMatrixWorld();
  group.updateMatrixWorld();
  const modelView = camera.matrixWorldInverse.clone().multiply(group.matrixWorld);
  const mv = new Vector4(star.x, star.y, star.z, STAR_SHADER_W).applyMatrix4(modelView);
  const clip = mv.clone().applyMatrix4(camera.projectionMatrix);
  return { x: clip.x / clip.w, y: clip.y / clip.w, pointSize: (30 * sizeScale) / -mv.z, visible: Math.abs(clip.z) <= clip.w };
}

describe("syncStarfieldToCamera", () => {
  const setup = (distance: number) => {
    const group = new Group();
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, BASE_CAMERA_FAR);
    const sizeScale = { value: 1 };
    const place = (d: number) => {
      camera.position.set(0, 0.45, 0.89).normalize().multiplyScalar(d);
      camera.lookAt(0, 0, 0);
      syncStarfieldToCamera({ group, camera, sizeScale });
    };
    place(distance);
    return { group, camera, sizeScale, place };
  };

  it("renders a star identically (position, size, visibility) at any distance beyond the threshold", () => {
    const { group, camera, sizeScale, place } = setup(STARFIELD_REFERENCE_DISTANCE);
    const stars = [new Vector3(150, 100, -300), new Vector3(-200, 50, 280), new Vector3(10, -330, 20), new Vector3(0, 0, 340)];
    const ref = stars.map((s) => projectStar(camera, group, sizeScale.value, s));
    for (const d of [701, 1500, 4600, 5000, 20000, 1e6, 1e9]) {
      place(d);
      stars.forEach((s, i) => {
        const p = projectStar(camera, group, sizeScale.value, s);
        expect(p.visible, `d=${d} star ${i}`).toBe(true);
        expect(p.x).toBeCloseTo(ref[i].x, 6);
        expect(p.y).toBeCloseTo(ref[i].y, 6);
        expect(p.pointSize / ref[i].pointSize).toBeCloseTo(1, 6);
      });
    }
  });

  it("keeps the shell a uniform sphere", () => {
    const { group } = setup(12345);
    expect(group.scale.x).toBeGreaterThan(1);
    expect(group.scale.y).toBe(group.scale.x);
    expect(group.scale.z).toBe(group.scale.x);
  });

  it("restores the original rendering when the camera moves back inside the threshold", () => {
    const { group, camera, sizeScale, place } = setup(80);
    const original = projectStar(camera, group, sizeScale.value, new Vector3(100, 50, -300));
    place(1e6);
    expect(group.scale.x).toBeGreaterThan(1000);
    place(80);
    expect(group.scale.toArray()).toEqual([1, 1, 1]);
    expect(sizeScale.value).toBe(1);
    expect(camera.far).toBe(BASE_CAMERA_FAR);
    expect(projectStar(camera, group, sizeScale.value, new Vector3(100, 50, -300))).toEqual(original);
  });

  it("rebuilds the projection matrix only when the far plane changes", () => {
    const { camera, place } = setup(80);
    const spy = vi.spyOn(camera, "updateProjectionMatrix");
    place(90);
    place(100);
    expect(spy).not.toHaveBeenCalled();
    place(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    place(5001);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("is safe with the camera at the origin and with invalid positions", () => {
    const { group, camera, sizeScale } = setup(80);
    camera.position.set(0, 0, 0);
    syncStarfieldToCamera({ group, camera, sizeScale });
    expect(group.scale.x).toBe(1);
    camera.position.set(NaN, 0, 0);
    syncStarfieldToCamera({ group, camera, sizeScale });
    expect(Number.isFinite(group.scale.x)).toBe(true);
    expect(Number.isFinite(camera.far)).toBe(true);
  });
});
