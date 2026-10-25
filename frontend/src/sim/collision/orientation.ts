/** Body orientation in the renderer's frame (pure, so it is unit-tested; jsdom has no WebGL).
 *
 *  The backend gives a unit quaternion (w, x, y, z) that rotates body-local vectors into the simulation frame. The scene uses
 *  toScenePosition: (x, y, z) -> (x, z, -y), a proper rotation M (-90 degrees about x). A mesh built in scene axes has local
 *  coordinates l_mesh = M l, and the scene orientation that places it correctly is q_scene = q_M q q_M^-1. A surface mark given by a
 *  body-local direction l is drawn at l_mesh = M l inside the oriented group, so it follows the rotation. */

export type QuatWxyz = readonly [number, number, number, number];
export type QuatXyzw = [number, number, number, number];
export type Vec = readonly [number, number, number];

const S = Math.SQRT1_2;
const Q_M: QuatWxyz = [S, -S, 0, 0]; // -90 degrees about x

function mul(a: QuatWxyz, b: QuatWxyz): QuatWxyz {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

function conj(q: QuatWxyz): QuatWxyz {
  return [q[0], -q[1], -q[2], -q[3]];
}

/** True for a finite unit quaternion (within 1e-6): anything else is not applied (the body is drawn unrotated). */
export function isUnitQuaternion(q: ArrayLike<number> | undefined): q is QuatWxyz {
  if (!q || q.length !== 4) return false;
  let n = 0;
  for (let i = 0; i < 4; i += 1) {
    if (!Number.isFinite(q[i]!)) return false;
    n += q[i]! * q[i]!;
  }
  return Math.abs(Math.sqrt(n) - 1) < 1e-6;
}

/** The three.js quaternion (x, y, z, w) of a body whose simulation orientation is `q` (w, x, y, z). */
export function sceneQuaternion(q: QuatWxyz): QuatXyzw {
  const r = mul(mul(Q_M, q), conj(Q_M));
  return [r[1], r[2], r[3], r[0]];
}

/** Body-local direction (simulation axes) -> mesh-local direction (scene axes). */
export function localToMesh(l: Vec): [number, number, number] {
  return [l[0], l[2], -l[1]];
}

/** Rotate a vector by a three.js-style (x, y, z, w) quaternion. */
export function rotate(q: QuatXyzw, v: Vec): [number, number, number] {
  const p: QuatWxyz = [0, v[0], v[1], v[2]];
  const qw: QuatWxyz = [q[3], q[0], q[1], q[2]];
  const r = mul(mul(qw, p), conj(qw));
  return [r[1], r[2], r[3]];
}
