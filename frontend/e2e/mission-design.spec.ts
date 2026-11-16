import { expect, test, type Page } from "@playwright/test";
import { legacyPath, universeLayer, UNIVERSE_ID } from "./universeLayer";
import { openTool } from "./tools";

// Space Mission Design in the browser, against a stubbed API (so it runs in the regular CI browser job without a backend):
// a spacecraft is its own kind of entity in the scene and the inspector, a planned mission is shown as a plan and not as a result,
// the planned trajectory is drawn, and a collision halt stops Play and says why. The real-backend journey is `npm run e2e:mission`.
const v0 = { x: 0, y: 0, z: 0 };
const earth = { id: "body-earth", name: "Earth", massKg: 5.9722e24, radiusM: 6.371e6, positionM: { x: -4.7e6, y: 0, z: 0 }, velocityMPerS: v0, colorHex: "#3b82f6", kind: "planet", catalogueEntryId: null, bodyType: "rocky-planet", assetKey: "earth" };
const moon = { id: "body-moon", name: "Moon", massKg: 7.346e22, radiusM: 1.7374e6, positionM: { x: 3.8e8, y: 0, z: 0 }, velocityMPerS: v0, colorHex: "#9ca3af", kind: "planet", catalogueEntryId: null, bodyType: "moon", assetKey: "moon", primaryId: "body-earth" };
const orbit = {
  referenceBodyId: "body-earth", referenceBodyName: "Earth", regime: "bound", radiusM: 6.671e6, altitudeM: 300e3, speedMPerS: 7729.9, semiMajorAxisM: 6.671e6,
  eccentricity: 0, inclinationDeg: 5.24, raanDeg: 124, argPeriapsisDeg: 0, trueAnomalyDeg: 0, periapsisRadiusM: 6.671e6, apoapsisRadiusM: 6.671e6,
  periapsisAltitudeM: 300e3, apoapsisAltitudeM: 300e3, periodS: 5422.5, timeToPeriapsisS: 0, timeToApoapsisS: 2711, specificEnergyJPerKg: -2.99e7,
  circularSpeedMPerS: 7729.9, escapeSpeedMPerS: 10931.7, sphereOfInfluenceM: null, gravitationalParameterM3PerS2: 3.986e14,
};
const craft = {
  id: "craft-e2e000000001", name: "Explorer 1", massKg: 15000, radiusM: 5, positionM: { x: -4.7e6 + 6.671e6, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 7729.9, z: 0 },
  colorHex: "#8fd3ff", kind: "spacecraft", catalogueEntryId: null, bodyType: "spacecraft", assetKey: null,
  spacecraft: { dryMassKg: 3000, propellantKg: 12000, propellantCapacityKg: 12000, thrustN: 50000, ispS: 450, massFlowKgPerS: 11.33, deltaVRemainingMPerS: 7102.4, thrusting: false, homeBodyId: "body-earth", orbit },
};
const plan = {
  originBodyId: "body-earth", destinationBodyId: "body-moon", designedAtS: 0,
  model: { method: "n-body shooting", bodiesInFinalFlight: 2, reducedModelForBracketing: false, burnModel: "impulsive", trialFlights: 6, rootIterations: 4, periapsisResidualM: 0.4, planningWallTimeS: 0.6 },
  parkingOrbit: { radiusM: 6.671e6, eccentricity: 0, periodS: 5422, speedMPerS: 7730, planeMismatchDeg: 0 },
  patchedConic: { note: "two-body", departureDeltaVMPerS: 3112, transferTimeS: 430000, hohmannDepartureDeltaVMPerS: 3112, hohmannTransferTimeS: 460000 },
  departure: { epochS: 4745, ignitionS: 4745, cutoffS: 4745, deltaVMPerS: 3115, mode: "impulsive", propellantKg: 7595 },
  arrival: { epochS: 300000, transferTimeS: 295255, periapsisRadiusM: 1837400, periapsisAltitudeM: 100000, periapsisSpeedMPerS: 2449, direction: "prograde", inclinationToDestinationOrbitDeg: 0, hyperbolicExcessSpeedMPerS: 813, sphereOfInfluenceM: 6.9e7 },
  insertion: { epochS: 300000, deltaVMPerS: 815.6, mode: "impulsive", ignitionS: 300000, cutoffS: 300000, propellantKg: 1250 },
  predictedOrbit: { bound: true, semiMajorAxisM: 1837400, eccentricity: 0, periodS: 7067, minAltitudeM: 99990, maxAltitudeM: 100080 },
  totals: { deltaVMPerS: 3930.6, propellantRequiredKg: 8845, propellantAvailableKg: 12000, deltaVAvailableMPerS: 7102, feasible: true },
  trajectoryEndS: 320000,
};
const mission = {
  id: "msn-1", name: "Explorer 1 to Moon", spacecraftId: craft.id, originBodyId: "body-earth", destinationBodyId: "body-moon",
  objective: { type: "orbit", periapsisAltitudeM: 100e3, apoapsisAltitudeM: null, direction: "prograde", toleranceM: 50e3 },
  status: "planned", phase: "proposed (not committed)", reasons: [], committed: false, planRevision: 1, planStale: false, plan, maneuverIds: [], checks: [], agreement: [],
  outcome: null, createdAtS: 0, updatedAtS: 0,
};
// a planned path that bends from the Earth out to where the Moon will be
const N = 60;
const trajectory = {
  missionId: "msn-1", planRevision: 1, frame: "inertial",
  timesS: Array.from({ length: N }, (_, k) => (k * 300000) / (N - 1)),
  originM: Array.from({ length: N }, () => [-4.7e6, 0, 0]),
  destinationM: Array.from({ length: N }, (_, k) => [3.8e8 * Math.cos((0.7 * k) / (N - 1)), 3.8e8 * Math.sin((0.7 * k) / (N - 1)), 0]),
  spacecraftM: Array.from({ length: N }, (_, k) => { const u = k / (N - 1); const r = 6.671e6 + u * 3.7e8; const a = 0.7 * u * u + 0.3 * u; return [r * Math.cos(a), r * Math.sin(a), 0]; }),
};
const diagnostics = {
  version: 1, totalMassKg: 6e24, totalMomentumKgMPerS: v0, kineticEnergyJ: 0, potentialEnergyJ: 0, angularMomentumAboutOriginKgM2PerS: v0, bookedSpinKgM2PerS: v0,
};
const halt = {
  eventId: "halt-1", reason: "collision", bodyIds: [craft.id, "body-earth"], simulationTimeS: 1265, relativeSpeedMPerS: 7933, refined: true,
  message: "Explorer 1 and Earth collided at t = 1265 s (relative speed 7933 m/s). The simulation is stopped at the contact. Reset, restore a snapshot, or move or delete one of the two bodies to continue.",
};

async function serve(page: Page, options: { missions?: unknown[]; haltOnStep?: boolean } = {}) {
  const calls = { step: 0 };
  const state = (extra: object = {}) => ({
    status: "paused", simulationTimeS: 0, bodies: [earth, moon, craft], diagnostics,
    ...(options.missions ? { spaceflight: { maneuvers: [], missions: options.missions } } : {}), ...extra,
  });
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const layer = universeLayer(url.pathname, method, 3);
    if (layer !== undefined) return route.fulfill({ json: layer });
    if (url.pathname === `/api/v1/universes/${UNIVERSE_ID}/missions/msn-1/trajectory`) return route.fulfill({ json: trajectory });
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state") return route.fulfill({ json: state() });
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    if (path === "/api/v1/simulation/step" && method === "POST") {
      calls.step += 1;
      if (options.haltOnStep) {
        const contact = { id: "halt-1", type: "contact", simulationTimeS: 1265, estimatedContactTimeS: 1265, bodyIds: halt.bodyIds, relativeSpeedMPerS: 7933, refined: true, involvesSpacecraft: true };
        return route.fulfill({ json: { ...state({ simulationTimeS: 1265, halt }), advancedS: 1265, events: [contact], warnings: ["collision_stopped"] } });
      }
      return route.fulfill({ json: { ...state({ simulationTimeS: calls.step * 1000 }), advancedS: 1000, events: [] } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled test route: ${url.pathname}` } });
  });
  return calls;
}

test("a spacecraft is its own kind of entity: marker in the scene, its own inspector, the mission-design tool", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await serve(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await expect(page.getByTestId(`spacecraft-label-${craft.id}`)).toHaveText("Explorer 1"); // drawn as a labelled marker, not a sphere
  await openTool(page, "Missions");
  const row = page.getByTestId("spacecraft-row");
  await expect(row).toContainText("Earth · 300 km × 300 km");
  await expect(row).toContainText("Δv 7.102 km/s");
  await row.click();
  await expect(page.getByTestId("spacecraft-kind")).toHaveText("Spacecraft · orbiting Earth");
  await expect(page.getByTestId("readout-altitude")).toHaveText("300 km");
  await expect(page.getByTestId("readout-period")).toHaveText("1 h 30 min");
  await expect(page.getByTestId("readout-orbital-speed")).toHaveText("7.730 km/s");
  await expect(page.getByTestId("readout-delta-v")).toHaveText("7.102 km/s");
  await expect(page.getByTestId("inspect-visual-radius")).toHaveCount(0); // not the body inspector with its planet fields
  await expect(page.getByRole("heading", { name: "Manoeuvres · Explorer 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Burn now" })).toBeDisabled(); // no delta-v entered yet
  await expect(page.getByRole("button", { name: "New mission…" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("a designed mission is shown as a proposal with its planned trajectory, never as a result", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await serve(page, { missions: [mission] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openTool(page, "Missions");
  await expect(page.getByTestId("mission-status")).toHaveText("Planned · proposal");
  await expect(page.getByTestId("mission-plan")).toContainText("Proposed plan (a prediction; nothing is scheduled yet)");
  await expect(page.getByTestId("plan-departure")).toContainText("3.115 km/s");
  await expect(page.getByTestId("plan-insertion")).toHaveText("815.6 m/s");
  await expect(page.getByRole("button", { name: "Commit plan" })).toBeEnabled();
  await expect(page.getByTestId("mission-outcome")).toHaveCount(0);
  await expect(page.getByTestId("mission-checks")).toHaveCount(0);
  // the planned trajectory is in the scene: its arrival marker and both burn tags, and the legend explains the line styles
  await expect(page.getByTestId("planned-arrival-label")).toHaveText(/Moon at arrival/);
  await expect(page.getByTestId("planned-node-label")).toHaveCount(2);
  await expect(page.getByTestId("trajectory-legend")).toContainText("planned trajectory (a prediction)");
  await expect(page.getByRole("button", { name: "Missions (1)" })).toBeVisible(); // the open mission is counted on the rail
  expect(errors).toEqual([]);
});

test("a collision halt stops Play, is explained, and disables running until it is cleared", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const calls = await serve(page, { haltOnStep: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await page.getByRole("button", { name: "Play" }).click();
  const banner = page.getByTestId("halt-banner");
  await expect(banner).toContainText("Simulation stopped: collision");
  await expect(banner).toContainText("Explorer 1 and Earth collided");
  await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Step Forward" })).toBeDisabled();
  await page.waitForTimeout(800);
  expect(calls.step).toBe(1); // the halting step was the last one requested
  await openTool(page, "Events (1)".replace(" (1)", ""));
  await expect(page.getByTestId("event-item")).toContainText("came into contact");
  await expect(page.getByTestId("event-item")).toContainText("nothing was merged or broken");
  expect(errors).toEqual([]);
});
