// Main-belt asteroid sample for the Solar System presets (D-064). DISPLAY ONLY: these asteroids are not simulated, they
// neither feel nor exert gravity, and their positions are two-body propagation of JPL SBDB osculating elements from the
// database epoch. The data (src/data/mainBelt.json, ~440 kB) is loaded on demand so other universes never pay for it.
import { perifocalBasis } from "./keplerOrbit";

const DEG = Math.PI / 180;

/** Per-asteroid GPU attributes: (a [au], e), (M at epoch [rad], n [rad/day]) and the perifocal unit vectors p, q. */
export interface MainBeltAttributes {
  count: number;
  epochJd: number;
  ae: Float32Array;
  mn: Float32Array;
  p: Float32Array;
  q: Float32Array;
}

interface MainBeltSource {
  count: number;
  epochJdTdb: number[];
  epochIndex: number[] | null;
  a: number[];
  e: number[];
  i: number[];
  om: number[];
  w: number[];
  ma: number[];
  n: number[];
}

/**
 * Builds the attributes. Every asteroid is referred to one epoch (the first): when SBDB serves several epochs, each
 * mean anomaly is moved to it along its own two-body orbit, the same propagation used for display.
 */
export function buildMainBeltAttributes(src: MainBeltSource): MainBeltAttributes {
  const n = src.count;
  const epochJd = src.epochJdTdb[0]!;
  const ae = new Float32Array(2 * n);
  const mn = new Float32Array(2 * n);
  const p = new Float32Array(3 * n);
  const q = new Float32Array(3 * n);
  for (let k = 0; k < n; k += 1) {
    const motion = src.n[k]! * DEG;
    const ownEpoch = src.epochIndex ? src.epochJdTdb[src.epochIndex[k]!]! : epochJd;
    const m = (src.ma[k]! * DEG + motion * (epochJd - ownEpoch)) % (2 * Math.PI);
    ae[2 * k] = src.a[k]!;
    ae[2 * k + 1] = src.e[k]!;
    mn[2 * k] = m;
    mn[2 * k + 1] = motion;
    const basis = perifocalBasis(src.i[k]! * DEG, src.om[k]! * DEG, src.w[k]! * DEG);
    p.set([basis.p.x, basis.p.y, basis.p.z], 3 * k);
    q.set([basis.q.x, basis.q.y, basis.q.z], 3 * k);
  }
  return { count: n, epochJd, ae, mn, p, q };
}

let pending: Promise<MainBeltAttributes> | null = null;

/** Loads and builds the sample once per page. */
export function loadMainBelt(): Promise<MainBeltAttributes> {
  pending ??= import("../data/mainBelt.json")
    .then((m) => buildMainBeltAttributes(m.default as MainBeltSource))
    .catch((error: unknown) => {
      pending = null; // a failed chunk load may be retried by the next mount
      throw error;
    });
  return pending;
}
