// Strict parsing of the Space Mission Design payloads: what the backend sends is accepted exactly, anything malformed is refused.
import { describe, expect, it } from "vitest";
import { craft, halt, leoOrbit, maneuver, mission, plan } from "../test/flightFixtures";
import { diagnostics, earth, universe } from "../test/fixtures";
import { ApiError } from "./errors";
import { parseBodyDto, parseEventDto, parseManeuver, parseManeuverPreview, parseMission, parseMissionTrajectory, parseOrbitPreview, parseSpacecraftCreated,
  parseStateDto, parseStepResponse, parseUniverseSummary } from "./parse";

const wire = (bodies: unknown[], extra: object = {}) => ({ status: "paused", simulationTimeS: 10, bodies, diagnostics, ...extra });

describe("spacecraft bodies", () => {
  it("a spacecraft keeps its kind and its propulsion and orbit block", () => {
    const parsed = parseBodyDto(craft());
    expect(parsed.kind).toBe("spacecraft");
    expect(parsed.bodyType).toBe("spacecraft");
    expect(parsed.spacecraft?.deltaVRemainingMPerS).toBe(7102.4);
    expect(parsed.spacecraft?.orbit).toEqual(leoOrbit);
  });

  it("an escape orbit has null apoapsis and period, and a spacecraft with no body to orbit has a null orbit", () => {
    const escaping = { ...leoOrbit, regime: "escape", apoapsisRadiusM: null, apoapsisAltitudeM: null, periodS: null, timeToApoapsisS: null };
    const parsed = parseBodyDto(craft({ spacecraft: { ...craft().spacecraft!, orbit: escaping as never } }));
    expect(parsed.spacecraft?.orbit?.periodS).toBeNull();
    expect(parseBodyDto({ ...craft(), spacecraft: { ...craft().spacecraft, orbit: null } }).spacecraft?.orbit).toBeNull();
  });

  it("a spacecraft without its block, or with a malformed one, is refused (it could not be shown as what it is)", () => {
    const { spacecraft: _omit, ...bare } = craft();
    expect(() => parseBodyDto(bare)).toThrow(ApiError);
    expect(() => parseBodyDto({ ...craft(), spacecraft: { ...craft().spacecraft, propellantKg: "lots" } })).toThrow(/propellantKg/);
    expect(() => parseBodyDto({ ...craft(), spacecraft: { ...craft().spacecraft, orbit: { ...leoOrbit, regime: "wobbly" } } })).toThrow(/regime/);
  });

  it("an ordinary body is unchanged: no spacecraft key appears on it", () => {
    expect("spacecraft" in parseBodyDto(earth)).toBe(false);
    expect("spacecraft" in parseBodyDto({ ...earth, spacecraft: craft().spacecraft })).toBe(false); // the block only belongs to the kind
  });

  it("the create answer carries the body and the backend's warnings", () => {
    expect(parseSpacecraftCreated({ body: craft(), warnings: ["escape_trajectory"] })).toMatchObject({ warnings: ["escape_trajectory"], body: { kind: "spacecraft" } });
    expect(() => parseSpacecraftCreated({ body: craft() })).toThrow(ApiError);
  });
});

describe("state: manoeuvre nodes, missions and the collision halt", () => {
  it("a state without them parses as before, with no extra keys", () => {
    const parsed = parseStateDto(wire([earth]));
    expect("spaceflight" in parsed).toBe(false);
    expect("halt" in parsed).toBe(false);
  });

  it("nodes, missions and a halt are carried through", () => {
    const parsed = parseStepResponse(wire([earth, craft()], {
      advancedS: 4.2, events: [], warnings: ["collision_stopped"], halt,
      spaceflight: { maneuvers: [maneuver()], missions: [mission({ status: "planned", plan, planRevision: 1 })] },
    }));
    expect(parsed.halt?.bodyIds).toEqual(halt.bodyIds);
    expect(parsed.warnings).toEqual(["collision_stopped"]);
    expect(parsed.spaceflight?.maneuvers[0]).toEqual(maneuver());
    expect(parsed.spaceflight?.missions[0]?.plan?.departure.deltaVMPerS).toBe(3115);
    expect(parsed.spaceflight?.missions[0]?.plan?.insertion?.deltaVMPerS).toBe(815.6);
  });

  it("refuses unknown statuses and malformed plans instead of showing them", () => {
    expect(() => parseManeuver({ ...maneuver(), status: "pondering" })).toThrow(/status/);
    expect(() => parseMission({ ...mission(), status: "done" })).toThrow(/status/);
    expect(() => parseMission({ ...mission(), plan: { ...plan, departure: { ...plan.departure, deltaVMPerS: null } } })).toThrow(/deltaVMPerS/);
    expect(() => parseMission({ ...mission(), checks: "none" })).toThrow(/checks/);
  });

  it("a flyby plan has no insertion and no predicted orbit; checks and agreement keep their numbers", () => {
    const parsed = parseMission({
      ...mission({ status: "completed", committed: true }), plan: { ...plan, insertion: null, predictedOrbit: null },
      checks: [{ id: "bound", label: "Bound", ok: true, actual: 0.00004, target: "< 1", unit: "" },
        { id: "periapsis", label: "Periapsis", ok: true, actual: 99950, target: 100000, tolerance: 50000, unit: "m" }],
      agreement: [{ maneuverId: "mnv-1", role: "departure", epochS: 4745, positionDifferenceM: 3e-9, velocityDifferenceMPerS: 4e-12, positionToleranceM: 1000, velocityToleranceMPerS: 1, ok: true }],
      outcome: { bound: true, eccentricity: 0.00004, periodS: 7067, apoapsisAltitudeM: null },
    });
    expect(parsed.plan?.insertion).toBeNull();
    expect(parsed.checks.map((c) => [c.target, c.tolerance])).toEqual([["< 1", null], [100000, 50000]]);
    expect(parsed.agreement[0]?.positionDifferenceM).toBe(3e-9);
    expect(parsed.outcome).toEqual({ bound: true, eccentricity: 0.00004, periodS: 7067, apoapsisAltitudeM: null });
  });
});

describe("events", () => {
  const burn = { id: "burn-4", type: "maneuver", simulationTimeS: 4745, bodyIds: ["craft-1"], maneuverId: "mnv-2", phase: "impulse", mode: "impulsive",
    referenceBodyId: "body-earth", commandedDeltaVMPerS: 3115, deliveredDeltaVMPerS: 3115, propellantUsedKg: 7595, missionId: "msn-1", label: "Departure burn to Moon" };
  const contact = { id: "halt-9", type: "contact", simulationTimeS: 1265, estimatedContactTimeS: 1265, bodyIds: ["craft-1", "body-earth"], relativeSpeedMPerS: 7933, refined: true, involvesSpacecraft: true };

  it("a burn and a contact are events of their own type", () => {
    expect(parseEventDto(burn)).toEqual(burn);
    expect(parseEventDto(contact)).toEqual(contact);
    expect(parseEventDto({ ...contact, estimatedContactTimeS: null }).type).toBe("contact");
  });

  it("malformed or unknown events are still refused", () => {
    expect(() => parseEventDto({ ...burn, phase: "sputter" })).toThrow(/phase/);
    expect(() => parseEventDto({ ...contact, relativeSpeedMPerS: "fast" })).toThrow(/relativeSpeedMPerS/);
    expect(() => parseEventDto({ ...burn, type: "teleport" })).toThrow(/event.type/);
  });
});

describe("previews, trajectories and universe summaries", () => {
  it("orbit and manoeuvre previews", () => {
    expect(parseOrbitPreview({ orbit: leoOrbit, warnings: [], positionM: {}, velocityMPerS: {} }).orbit.periodS).toBe(5544.9);
    const preview = parseManeuverPreview({ epochS: 0, basis: "present state", deltaVMagnitudeMPerS: 100, propellantKg: 336, burnDurationS: 0, feasible: true, before: leoOrbit, after: { ...leoOrbit, apoapsisAltitudeM: 656728 } });
    expect(preview.after.apoapsisAltitudeM).toBe(656728);
    expect(() => parseManeuverPreview({ epochS: 0, basis: "x", before: leoOrbit, after: leoOrbit })).toThrow(ApiError);
  });

  it("a planned trajectory must have one position of each body per time", () => {
    const ok = { missionId: "msn-1", planRevision: 2, frame: "inertial", timesS: [0, 10], spacecraftM: [[1, 2, 3], [4, 5, 6]], originM: [[0, 0, 0], [0, 0, 0]], destinationM: [[9, 9, 9], [8, 8, 8]] };
    expect(parseMissionTrajectory(ok).spacecraftM[1]).toEqual([4, 5, 6]);
    expect(() => parseMissionTrajectory({ ...ok, originM: [[0, 0, 0]] })).toThrow(/originM/);
    expect(() => parseMissionTrajectory({ ...ok, spacecraftM: [[1, 2, 3], [4, 5]] })).toThrow(/spacecraftM/);
    expect(() => parseMissionTrajectory({ ...ok, timesS: [0, "later"] })).toThrow(/timesS/);
  });

  it("a universe summary reports its collision mode when the backend sends a known one", () => {
    expect(parseUniverseSummary({ ...universe(), collisionMode: "stop-on-contact" }).collisionMode).toBe("stop-on-contact");
    expect("collisionMode" in parseUniverseSummary(universe())).toBe(false);
    expect("collisionMode" in parseUniverseSummary({ ...universe(), collisionMode: "explode" })).toBe(false);
  });
});
