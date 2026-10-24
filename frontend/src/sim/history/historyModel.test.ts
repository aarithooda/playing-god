import { describe, expect, it } from "vitest";
import type { HistoryPageDto, HistorySampleDto } from "../../api/types";
import { MAX_CLIENT_SAMPLES, applyHistoryPage, frameAt, trajectoryOf } from "./historyModel";

const meta = { name: "A", colorHex: "#ff0000", radiusM: 10, kind: "planet" };
const sample = (index: number, segment = 0, ids: string[] = ["a"]): HistorySampleDto => ({
  index, simulationTimeS: index * 100, segment,
  positionsM: Object.fromEntries(ids.map((id, k) => [id, [index * 1e9, k * 1e9, 0] as [number, number, number]])),
});
const page = (o: Partial<HistoryPageDto> & { samples: HistorySampleDto[] }): HistoryPageDto => ({
  universeId: "u1", mode: "grid", sampleIntervalS: 100, generation: 1, firstIndex: o.samples[0]?.index ?? 0,
  nextIndex: (o.samples[o.samples.length - 1]?.index ?? -1) + 1, droppedBefore: 0, truncated: false, bodies: { a: meta, b: { ...meta, name: "B" } }, ...o,
});
const run = (from: number, to: number, ids?: string[]) => Array.from({ length: to - from }, (_, i) => sample(from + i, 0, ids));

describe("historyModel", () => {
  it("history cache never mixes universes or generations", () => {
    const a = applyHistoryPage(null, page({ samples: run(0, 5) }));
    expect(a.samples).toHaveLength(5);
    // another generation of the same universe (reset or restore): the old samples are gone, not appended to
    const b = applyHistoryPage(a, page({ generation: 2, samples: run(0, 2) }));
    expect(b.generation).toBe(2);
    expect(b.samples.map((s) => s.index)).toEqual([0, 1]);
    expect(b.gaps).toEqual([]);
    // another universe entirely
    const c = applyHistoryPage(b, page({ universeId: "u2", generation: 2, samples: run(0, 3) }));
    expect(c.universeId).toBe("u2");
    expect(c.samples).toHaveLength(3);
    // a late page of the old generation after a newer one is adopted by that generation's rule only if it matches;
    // the cache is for exactly one (universe, generation)
    expect(new Set([c.universeId + ":" + c.generation]).size).toBe(1);
  });

  it("appends the next page and ignores samples it already has", () => {
    const a = applyHistoryPage(null, page({ samples: run(0, 5) }));
    const b = applyHistoryPage(a, page({ samples: run(3, 8) })); // overlaps 3 and 4
    expect(b.samples.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(b.nextIndex).toBe(8);
    expect(b.gaps).toEqual([]);
  });

  it("applyHistoryPage records gaps and never interpolates", () => {
    const a = applyHistoryPage(null, page({ samples: run(0, 3) }));
    const b = applyHistoryPage(a, page({ samples: run(7, 9) })); // 3..6 were never received
    expect(b.samples.map((s) => s.index)).toEqual([0, 1, 2, 7, 8]); // nothing was filled in
    expect(b.gaps).toEqual([3]);
  });

  it("client retention drops oldest and flags it", () => {
    const a = applyHistoryPage(null, page({ samples: run(0, MAX_CLIENT_SAMPLES) }));
    expect(a.clientTrimmed).toBe(false);
    const b = applyHistoryPage(a, page({ samples: run(MAX_CLIENT_SAMPLES, MAX_CLIENT_SAMPLES + 50) }));
    expect(b.samples).toHaveLength(MAX_CLIENT_SAMPLES);
    expect(b.samples[0]!.index).toBe(50);
    expect(b.droppedBefore).toBe(50);
    expect(b.clientTrimmed).toBe(true);
  });

  it("carries the backend's own truncation and drop flags", () => {
    const a = applyHistoryPage(null, page({ samples: run(5, 8), droppedBefore: 5, truncated: true }));
    expect(a.droppedBefore).toBe(5);
    expect(a.truncated).toBe(true);
    expect(a.clientTrimmed).toBe(false);
  });

  it("frameAt omits bodies absent at that sample", () => {
    const cache = applyHistoryPage(null, page({ samples: [sample(0, 0, ["a"]), sample(1, 0, ["a", "b"]), sample(2, 1, ["b"])] }));
    expect(frameAt(cache, 0)!.bodies.map((b) => b.id)).toEqual(["a"]);
    expect(frameAt(cache, 1)!.bodies.map((b) => b.id)).toEqual(["a", "b"]);
    const last = frameAt(cache, 2)!;
    expect(last.bodies.map((b) => b.id)).toEqual(["b"]);
    expect(last.bodies[0]!.meta.name).toBe("B");
    expect(last).toMatchObject({ universeId: "u1", generation: 1, index: 2, simulationTimeS: 200 });
    expect(frameAt(cache, 99)).toBeNull();
    expect(frameAt(cache, -1)).toBeNull();
  });

  it("keeps metadata of bodies that no longer exist so a frame can still name them", () => {
    const a = applyHistoryPage(null, page({ samples: run(0, 2), bodies: { a: meta, gone: { ...meta, name: "Merged away" } } }));
    const b = applyHistoryPage(a, page({ samples: run(2, 4), bodies: { a: meta } }));
    expect(b.bodies.gone!.name).toBe("Merged away");
  });

  it("trajectoryOf builds a UI-0 path keyed by universe, generation and body", () => {
    const cache = applyHistoryPage(null, page({ samples: [sample(0, 0), sample(1, 0), sample(2, 4)] }));
    const t = trajectoryOf(cache, "a", "active");
    expect(t).toMatchObject({ key: "u1:1:a", universeId: "u1", bodyId: "a", role: "active", colorHex: "#ff0000" });
    expect(t.samples.map((s) => s.simulationTimeS)).toEqual([0, 100, 200]);
    expect(t.samples[0]!.positionM).toEqual({ x: 0, y: 0, z: 0 });
    // a segment change is a break
    expect(new Set(t.samples.map((s) => s.segment)).size).toBe(2);
    expect(trajectoryOf(cache, "a", "reference").role).toBe("reference");
  });

  it("trajectoryOf breaks the path at a gap and where the body was absent", () => {
    const withGap = applyHistoryPage(applyHistoryPage(null, page({ samples: run(0, 3) })), page({ samples: run(6, 8) }));
    const segs = trajectoryOf(withGap, "a", "active").samples.map((s) => s.segment);
    expect(segs[2]).not.toBe(segs[3]); // the jump from sample 2 to 6 is not drawn
    const absent = applyHistoryPage(null, page({ samples: [sample(0, 0, ["a"]), sample(1, 0, ["b"]), sample(2, 0, ["a"])] }));
    const s = trajectoryOf(absent, "a", "active").samples.map((x) => x.segment);
    expect(s).toHaveLength(2);
    expect(s[0]).not.toBe(s[1]);
  });

  it("a body with no samples gives an empty path", () => {
    const cache = applyHistoryPage(null, page({ samples: run(0, 3) }));
    expect(trajectoryOf(cache, "nobody", "active").samples).toEqual([]);
  });
});
