import type { EffectPoint } from "../../render/contract";

/** Visual samples of a debris parcel. A parcel is a statistical aggregate; these points are drawn inside its sphere to show that, they
 *  are deterministic for a parcel id (same id, same samples, in any session or after a replay) and they carry NO mass: nothing here is
 *  summed, weighted or sent back to the simulation. */

/** FNV-1a 32-bit hash of the id: the seed. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` points uniformly inside the sphere of the parcel (centre and radius from its body state at the displayed time). */
export function sampleParcel(parcelId: string, centreM: EffectPoint, radiusM: number, count: number): EffectPoint[] {
  const next = rng(hashId(parcelId));
  const out: EffectPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const u = next() * 2 - 1;
    const phi = next() * 2 * Math.PI;
    const r = radiusM * Math.cbrt(next());
    const s = Math.sqrt(1 - u * u);
    out.push({ x: centreM.x + r * s * Math.cos(phi), y: centreM.y + r * s * Math.sin(phi), z: centreM.z + r * u });
  }
  return out;
}
