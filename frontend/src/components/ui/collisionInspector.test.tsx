import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import { parseCollisionDetail, parseCollisionList, parseReplayReport } from "../../api/parse";
import type { CollisionDetailDto, CollisionRecordDto, ReplayReportDto } from "../../api/types";
import { describeProduct, describeRecord, describeReplay, fidelityLines, hasSoftFidelity } from "../../sim/collision/describe";
import { useCollisionInspector } from "../../sim/collision/useCollisionInspector";
import { fakeClient } from "../../test/fixtures";
import { CollisionInspector } from "./CollisionInspector";

afterEach(cleanup);

const rawDetail = {
  schemaVersion: 1,
  universeId: "uni-default",
  childEventIds: ["col-2"],
  products: [
    { bodyId: "frag-1-0", representation: "fragment", massKgAtEvent: 2e21, exists: true, fragmentClass: "escaping", massKgNow: 2e21 },
    { bodyId: "debris-1-0", representation: "debris-parcel", massKgAtEvent: 1e21, exists: false, fragmentClass: null, massKgNow: null },
  ],
  escapedLedger: null,
  note: "Fidelity labels state how each quantity was obtained. The science is provisional (CP-SCI-1 is not signed off).",
  record: {
    eventId: "col-1", legacyEventId: null, parentEventId: null, rootEventId: "col-1", generation: 0,
    selectionReasons: ["b = 0.30 < b_crit = 0.56; v_i > v_esc"], warnings: ["provisional:CP-SCI-1", "ejection_speed_provisional"],
    fidelity: { outcome: "model", debrisParcels: "statistical", fragments: "approximation" },
    inputDigest: "a".repeat(64), resultDigest: "b".repeat(64), detailDropped: false,
    input: {
      impact: {
        detectionTimeS: 2153, target: { id: "body-t", massKg: 1e22, materialProfile: { id: "silicate-rock" } },
        projectile: { id: "body-p", massKg: 5e21, materialProfile: null }, impactSpeedMPerS: 3176.5, impactAngleDeg: 17.4,
        specificImpactEnergyJPerKg: 8.1e5, contactPointM: { x: 1, y: 2, z: 3 },
      },
    },
    outcomeSpec: {
      outcome: "partial_accretion", modelId: "ls12", modelVersion: "1-provisional", regimeReasons: ["Q_R / Q'*_RD = 0.46: partial accretion"],
      parameters: { impactSpeed: { value: 3176.5, unit: "m/s", source: "computed" } }, debrisMassKg: 3e21,
    },
    result: {
      removedBodyIds: ["body-p"], transformed: [{ id: "body-t" }], created: [{ id: "frag-1-0" }], debrisParcels: [{ id: "debris-1-0" }],
      massLedger: { consumedBodiesKg: 1.5e22, remnantsKg: 1.2e22, fragmentsKg: 1.7e21, parcelsKg: 1.3e21, escapedKg: 0, returnedToRemnantKg: 0 },
      conservation: {
        massResidualRel: 0, momentumResidualRel: 7e-18, angularMomentumResidualRel: null, angularMomentumUnmodelled: "above break-up spin",
        energy: { dissipatedJ: 1.2e27, dissipatedNonNegative: true }, withinTolerance: true,
      },
    },
  },
};

const names = (id: string) => `«${id}»`;

describe("collision record parsing", () => {
  it("parses a record detail and keeps only the fields the inspector shows", () => {
    const d = parseCollisionDetail(rawDetail);
    expect(d.record.eventId).toBe("col-1");
    expect(d.record.impact.targetMaterialId).toBe("silicate-rock");
    expect(d.record.impact.projectileMaterialId).toBeNull();
    expect(d.record.outcome?.parameters).toEqual([{ name: "impactSpeed", value: 3176.5, unit: "m/s", source: "computed" }]);
    expect(d.record.result?.parcelIds).toEqual(["debris-1-0"]);
    expect(d.products[0].fragmentClass).toBe("escaping");
  });

  it("parses a legacy record without a result or an outcome spec", () => {
    const legacy = { ...rawDetail, record: { ...rawDetail.record, outcomeSpec: null, result: null, resultDigest: "" } };
    const d = parseCollisionDetail(legacy);
    expect(d.record.outcome).toBeNull();
    expect(d.record.result).toBeNull();
  });

  it("rejects malformed records instead of showing guesses", () => {
    const fail = (v: unknown, what: string) => {
      try {
        parseCollisionDetail(v);
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).message).toContain(what);
        return;
      }
      throw new Error(`expected a rejection mentioning ${what}`);
    };
    fail({ ...rawDetail, products: "x" }, "detail.products");
    fail({ ...rawDetail, products: [{ ...rawDetail.products[0], fragmentClass: "lost" }] }, "fragmentClass");
    fail({ ...rawDetail, record: { ...rawDetail.record, generation: "0" } }, "record.generation");
    fail({ ...rawDetail, record: { ...rawDetail.record, fidelity: { outcome: 3 } } }, "record.fidelity.outcome");
  });

  it("parses the list and the replay report", () => {
    const row = { eventId: "col-1", legacyEventId: null, parentEventId: null, rootEventId: "col-1", generation: 0, outcome: "perfect_merge", modelId: "m", modelVersion: "1",
      timeS: 5, bodyIds: ["a", "b"], warnings: [], hasResult: true, detailDropped: false, inputDigest: "x", resultDigest: "y" };
    const l = parseCollisionList({ total: 1, offset: 0, limit: 50, maxRecords: 1000, records: [row] });
    expect(l.records[0].generation).toBe(0);
    const r = parseReplayReport({ eventId: "col-1", reproduced: true, checks: [{ name: "result", ok: true, detail: "" }, { name: "selection", ok: null, detail: "n/a" }],
      recordedResultDigest: "y", replayedResultDigest: "y", differingFields: [], mutatesState: false });
    expect(r.checks[1].ok).toBeNull();
    expect(() => parseReplayReport({ ...r, checks: [{ name: "x", ok: "yes", detail: "" }] })).toThrow();
  });
});

describe("describing a record uses API fields only", () => {
  const detail = parseCollisionDetail(rawDetail);

  it("builds the headline, lineage and reasons from the record", () => {
    const t = describeRecord(detail, names);
    expect(t.headline).toContain("partial accretion");
    expect(t.headline).toContain("«body-p» hit «body-t»");
    expect(t.lineage).toContain("original impact");
    expect(t.lineage).toContain("col-2");
    expect(t.why).toEqual(["Q_R / Q'*_RD = 0.46: partial accretion"]);
    expect(t.materials).toContain("projectile no material (legacy merge)");
    expect(t.residuals.join(" ")).toContain("not fully represented: above break-up spin");
    expect(t.accounting[0]).toContain("tracked fragments");
    expect(t.warnings).toContain("ejection_speed_provisional");
  });

  it("says a secondary impact is a child of its parent", () => {
    const child: CollisionDetailDto = { ...detail, childEventIds: [], record: { ...detail.record, eventId: "col-4", parentEventId: "col-1", generation: 1 } };
    expect(describeRecord(child, names).lineage).toBe("col-4: a secondary impact (generation 1) of debris created by col-1; root col-1");
  });

  it("labels fidelity with its meaning and flags anything that is not computed or model", () => {
    expect(fidelityLines({ debrisParcels: "statistical" })[0]).toContain("a population representation, not individual objects");
    expect(hasSoftFidelity({ a: "computed", b: "model" })).toBe(false);
    expect(hasSoftFidelity({ a: "computed", b: "unsupported" })).toBe(true);
  });

  it("describes products that still exist or are gone, with their class", () => {
    expect(describeProduct(detail.products[0], names)).toContain("now escaping");
    expect(describeProduct(detail.products[1], names)).toContain("no longer exists");
  });

  it("describes a replay without overclaiming", () => {
    const ok: ReplayReportDto = { eventId: "col-1", reproduced: true, checks: [], recordedResultDigest: "b".repeat(64), replayedResultDigest: "b".repeat(64), differingFields: [], mutatesState: false };
    expect(describeReplay(ok)).toContain("Reproduced");
    expect(describeReplay(ok)).toContain("Nothing was changed");
    const no: ReplayReportDto = { ...ok, reproduced: false, checks: [{ name: "result", ok: false, detail: "" }], differingFields: ["massLedger"] };
    expect(describeReplay(no)).toContain("NOT reproduced (result)");
    expect(describeReplay(no)).toContain("massLedger");
  });
});

describe("the inspector component", () => {
  const detail = parseCollisionDetail(rawDetail);
  const base = { eventId: "col-1", detail, status: "ready" as const, replay: null, replayBusy: false, bodyName: names, onReplay: vi.fn(), onOpenEvent: vi.fn(), onClose: vi.fn() };

  it("shows the record, the soft-fidelity notice and the provisional caveat", () => {
    render(<CollisionInspector {...base} />);
    expect(screen.getByTestId("inspector-headline").textContent).toContain("partial accretion");
    expect(screen.getByTestId("inspector-soft-fidelity")).toBeTruthy();
    expect(screen.getByText(/not signed off/)).toBeTruthy();
    expect(screen.getByText(/debrisParcels: statistical/)).toBeTruthy();
  });

  it("hides the soft-fidelity notice when everything is computed", () => {
    const hard: CollisionRecordDto = { ...detail.record, fidelity: { outcome: "model", masses: "computed" } };
    render(<CollisionInspector {...base} detail={{ ...detail, record: hard }} />);
    expect(screen.queryByTestId("inspector-soft-fidelity")).toBeNull();
  });

  it("replays on request and reports a mismatch loudly", () => {
    const onReplay = vi.fn();
    const { rerender } = render(<CollisionInspector {...base} onReplay={onReplay} />);
    fireEvent.click(screen.getByText("Replay (dry run)"));
    expect(onReplay).toHaveBeenCalledOnce();
    const bad: ReplayReportDto = { eventId: "col-1", reproduced: false, checks: [{ name: "inputDigest", ok: false, detail: "" }], recordedResultDigest: "", replayedResultDigest: "", differingFields: [], mutatesState: false };
    rerender(<CollisionInspector {...base} replay={bad} />);
    expect(screen.getByTestId("inspector-replay").textContent).toContain("NOT reproduced (inputDigest)");
  });

  it("opens a child event and closes", () => {
    const onOpenEvent = vi.fn();
    const onClose = vi.fn();
    render(<CollisionInspector {...base} onOpenEvent={onOpenEvent} onClose={onClose} />);
    fireEvent.click(screen.getByText("Open col-2"));
    expect(onOpenEvent).toHaveBeenCalledWith("col-2");
    fireEvent.click(screen.getByLabelText("Close collision inspector"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("labels the headline speed as measured at detection, not at contact", () => {
    render(<CollisionInspector {...base} />);
    const headline = screen.getByTestId("inspector-headline").textContent ?? "";
    expect(headline).toContain("relative speed at detection");
    expect(headline).not.toMatch(/at (estimated )?contact/);
  });

  it("lists several identical products without duplicate React keys (the real backend emits equal debris parcels)", () => {
    const parcel = { bodyId: "debris-1-0", representation: "debris-parcel" as const, massKgAtEvent: 4.8e20, exists: true, fragmentClass: "escaping" as const, massKgNow: 4.8e20 };
    const twins = { ...detail, products: [parcel, { ...parcel, bodyId: "debris-1-1" }] };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<CollisionInspector {...base} detail={twins} bodyName={() => "Debris of Target"} />);
    expect(err.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    err.mockRestore();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(<CollisionInspector {...base} detail={null} status="loading" />);
    expect(screen.getByText(/Loading the record/)).toBeTruthy();
    rerender(<CollisionInspector {...base} detail={null} status="error" error="no collision record for col-9" />);
    expect(screen.getByRole("alert").textContent).toContain("col-9");
  });
});

describe("useCollisionInspector", () => {
  const detail = parseCollisionDetail(rawDetail);

  it("loads a record, runs the replay and discards a stale answer", async () => {
    let resolveFirst: (d: CollisionDetailDto) => void = () => undefined;
    const getCollision = vi.fn()
      .mockImplementationOnce(() => new Promise<CollisionDetailDto>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ ...detail, record: { ...detail.record, eventId: "col-2" } });
    const replayCollision = vi.fn().mockResolvedValue({ eventId: "col-2", reproduced: true, checks: [], recordedResultDigest: "", replayedResultDigest: "", differingFields: [], mutatesState: false });
    const client = fakeClient({ getCollision, replayCollision } as never).scoped({ universeId: "uni-1", activationEpoch: 1 });
    const { result } = renderHook(() => useCollisionInspector(client));
    act(() => result.current.open("col-1"));
    act(() => result.current.open("col-2"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.detail?.record.eventId).toBe("col-2");
    await act(async () => resolveFirst(detail)); // the older request answers late
    expect(result.current.detail?.record.eventId).toBe("col-2");
    await act(async () => result.current.runReplay());
    await waitFor(() => expect(result.current.replay?.reproduced).toBe(true));
    expect(replayCollision).toHaveBeenCalledWith("col-2");
    act(() => result.current.close());
    expect(result.current.eventId).toBeNull();
  });

  it("reports a failed load and closes when the universe changes", async () => {
    const getCollision = vi.fn().mockRejectedValue(new ApiError("http", "no collision record for col-9"));
    const base = fakeClient({ getCollision } as never);
    let scope = { universeId: "uni-1", activationEpoch: 1 };
    const { result, rerender } = renderHook(() => useCollisionInspector(base.scoped(scope)));
    act(() => result.current.open("col-9"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("col-9");
    scope = { universeId: "uni-2", activationEpoch: 1 };
    rerender();
    await waitFor(() => expect(result.current.eventId).toBeNull());
  });
});
