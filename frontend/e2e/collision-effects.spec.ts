// Stage 9 browser checks of the collision effects (stubbed API, real Chromium, real WebGL when the browser provides it).
//
// What this spec can show: the effect layers mount and draw without runtime errors, the displayed values of the effect (read from the data-*
// attributes of the effect label) follow the pause / play / seek rules of DQ-12 (a), the inspector works against the stubbed records, the
// empty and error states are quiet, and a body-local surface mark follows the body's orientation on screen (pixel centroid check, with
// screenshots written to the test's own output directory; set PG_UPDATE_EVIDENCE=1 to refresh the committed
// copies under context/evidence/stage9-webgl/ on purpose, they are never rewritten by an ordinary run).
// What it does NOT show: that the physics is right, nor any visual quality beyond these checks.
// Run: PW_CHROMIUM_PATH=<an installed chromium> npx playwright test e2e/collision-effects.spec.ts   (see context/HANDOFF.md)
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { legacyPath, UNIVERSE_ID, universeLayer } from "./universeLayer";
import { openTool } from "./tools";

// Committed evidence screenshots. Ordinary runs write to test.info().outputPath() (test-results/, git-ignored); only an explicit
// PG_UPDATE_EVIDENCE=1 run refreshes these, so a routine test run can never dirty tracked files.
const EVIDENCE = path.resolve(process.cwd(), "..", "context", "evidence", "stage9-webgl"); // run from frontend/
const UPDATE_EVIDENCE = process.env.PG_UPDATE_EVIDENCE === "1";
const diagnostics = {
  version: 1, totalMassKg: 6e24, totalMomentumKgMPerS: { x: 0, y: 0, z: 0 }, kineticEnergyJ: 0, potentialEnergyJ: 0,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 0 }, bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};
const EVENT_TIME_S = 1000;

function target(orientation?: [number, number, number, number]) {
  return {
    id: "body-target", name: "Target", massKg: 6e24, radiusM: 6.4e6, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#3b82f6",
    ...(orientation ? { material: { profileId: "silicate-rock", layers: null }, spinRadPerS: { x: 0, y: 0, z: 7e-5 }, orientation: { quaternion: orientation, epochS: 1500 } } : {}),
  };
}
const parcel = {
  id: "debris-1-0", name: "Debris of Target", massKg: 1e21, radiusM: 4e5, positionM: { x: 3e7, y: 0, z: 0 }, velocityMPerS: { x: 100, y: 0, z: 0 }, colorHex: "#888888",
  representation: "debris-parcel", originEventId: "col-1",
  debris: { totalMassKg: 1e21, sizeDistribution: null, velocityDispersionMPerS: 0, materialProfileId: "silicate-rock", sampleSeed: 1 },
  fragmentClass: "orbiting_system",
};

const collisionEvent = {
  id: "col-1", type: "collision", schemaVersion: 1, outcome: "partial_accretion", simulationTimeS: 1001, estimatedContactTimeS: 1000, bodyIds: ["body-target", "body-proj"],
  survivingBodyIds: ["body-target"], createdBodyIds: ["debris-1-0"], removedBodyIds: ["body-proj"], parentEventId: null, rootEventId: "col-1", generation: 0,
  modelId: "ls12", modelVersion: "1-provisional", impactSpeedMPerS: 3000, impactAngleDeg: 20, specificImpactEnergyJPerKg: 1e6, largestRemnantMassKg: 5e24, debrisMassKg: 1e21,
  massResidualRel: 0, momentumResidualRel: 1e-17, warnings: ["provisional:CP-SCI-1"], fidelitySummary: { outcome: "model", debrisParcels: "statistical" }, hasVisual: true,
};

function visual(appearance = "molten", centerLocal = { x: 0, y: -1, z: 0 }) {
  return {
    schemaVersion: 1, universeId: UNIVERSE_ID, eventId: "col-1", outcome: "partial_accretion", timeS: EVENT_TIME_S,
    impactSite: { bodyId: "body-target", centerLocal, centerWorldAtContactM: { x: 0, y: -6.4e6, z: 0 }, normalWorld: { x: 0, y: -1, z: 0 } },
    phases: [
      { name: "contact", startS: EVENT_TIME_S, endS: 1001, basis: "simulation-time" },
      { name: "flash", startS: EVENT_TIME_S, endS: null, basis: "visual-wall-clock", durationWallS: 0.8 },
      { name: "ejecta", startS: EVENT_TIME_S, endS: null, basis: "simulation-time" },
      { name: "aftermath", startS: 1001, endS: null, basis: "simulation-time" },
    ],
    ejectaSources: [], fragmentBodyIds: [], debrisParcelIds: ["debris-1-0"], cloud: null,
    visualOnly: [{ kind: "flash", intensity: 0.7, lifetimeWallS: 0.8 }], materialAppearance: { "body-target": appearance },
    fidelityNotes: ["The flash is a visual-only effect with no physical meaning."],
  };
}

const detail = {
  schemaVersion: 1, universeId: UNIVERSE_ID, childEventIds: [], note: "The science is provisional (CP-SCI-1 is not signed off).", escapedLedger: null,
  products: [{ bodyId: "debris-1-0", representation: "debris-parcel", massKgAtEvent: 1e21, exists: true, fragmentClass: "orbiting_system", massKgNow: 1e21 }],
  record: {
    eventId: "col-1", legacyEventId: null, parentEventId: null, rootEventId: "col-1", generation: 0, selectionReasons: ["b = 0.34 < b_crit"], warnings: ["provisional:CP-SCI-1"],
    fidelity: { outcome: "model", debrisParcels: "statistical" }, inputDigest: "a".repeat(64), resultDigest: "b".repeat(64),
    input: { impact: { detectionTimeS: 1001, target: { id: "body-target", massKg: 6e24, materialProfile: { id: "silicate-rock" } }, projectile: { id: "body-proj", massKg: 1e22, materialProfile: null },
      impactSpeedMPerS: 3000, impactAngleDeg: 20, specificImpactEnergyJPerKg: 1e6, contactPointM: { x: 0, y: -6.4e6, z: 0 } } },
    outcomeSpec: { outcome: "partial_accretion", modelId: "ls12", modelVersion: "1-provisional", regimeReasons: ["Q_R / Q'*_RD = 0.46: partial accretion"], parameters: {}, debrisMassKg: 1e21 },
    result: { removedBodyIds: ["body-proj"], transformed: [{ id: "body-target" }], created: [], debrisParcels: [{ id: "debris-1-0" }],
      massLedger: { consumedBodiesKg: 6.01e24, remnantsKg: 6e24, fragmentsKg: 0, parcelsKg: 1e21, escapedKg: 0, returnedToRemnantKg: 0 },
      conservation: { massResidualRel: 0, momentumResidualRel: 1e-17, angularMomentumResidualRel: 0, angularMomentumUnmodelled: null, energy: { dissipatedJ: 1e27, dissipatedNonNegative: true }, withinTolerance: true } },
  },
};
const replay = { schemaVersion: 1, universeId: UNIVERSE_ID, eventId: "col-1", reproduced: true, checks: [{ name: "result", ok: true, detail: "" }],
  recordedResultDigest: "b".repeat(64), replayedResultDigest: "b".repeat(64), differingFields: [], mutatesState: false };

interface Stub {
  bodies: unknown[];
  events: unknown[];
  timeS: number;
  visual: unknown;
  visualStatus?: number;
  history?: unknown;
}

async function install(page: Page, stub: Stub) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  let timeS = stub.timeS;
  await page.route("**/healthz", (r) => r.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === `/api/v1/universes/${UNIVERSE_ID}/history` && stub.history) return route.fulfill({ json: stub.history });
    const layer = universeLayer(url.pathname, method, stub.bodies.length);
    if (layer !== undefined) return route.fulfill({ json: layer });
    const p = url.pathname;
    if (p.endsWith("/collisions/col-1/visual")) {
      return stub.visualStatus ? route.fulfill({ status: stub.visualStatus, json: { detail: "no visual description", code: "collision_visual_unavailable" } }) : route.fulfill({ json: stub.visual });
    }
    if (p.endsWith("/collisions/col-1/replay") && method === "POST") return route.fulfill({ json: replay });
    if (p.endsWith("/collisions/col-1")) return route.fulfill({ json: detail });
    const legacy = legacyPath(p);
    if (legacy === "/api/v1/simulation/state" && method === "GET") return route.fulfill({ json: { status: "paused", simulationTimeS: timeS, bodies: stub.bodies, diagnostics, universeId: UNIVERSE_ID, revision: 1 } });
    if (legacy === "/api/v1/events" && method === "GET") return route.fulfill({ json: { events: stub.events } });
    if (legacy === "/api/v1/simulation/step" && method === "POST") {
      const dt = route.request().postDataJSON().dtS as number;
      timeS += dt;
      return route.fulfill({ json: { status: "paused", simulationTimeS: timeS, bodies: stub.bodies, diagnostics, advancedS: dt, events: [], universeId: UNIVERSE_ID, revision: 2 } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled test route: ${p}` } });
  });
  return errors;
}

async function webglAvailable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  });
}

const label = (page: Page) => page.getByTestId("collision-effect-label");

test.describe("collision effects in a browser", () => {
  test("WebGL is available to the scene and the canvas mounts without runtime errors", async ({ page }) => {
    const errors = await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual() });
    await page.goto("/");
    expect(await webglAvailable(page), "this browser gives no WebGL context: the scene cannot be checked here").toBe(true);
    await expect(page.locator("canvas")).toBeVisible();
    await expect(label(page)).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("draws the effect for a collision event, labelled as visual, with deterministic debris samples", async ({ page }) => {
    const errors = await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual() });
    await page.goto("/");
    await expect(label(page)).toContainText("visual");
    await expect(label(page)).toContainText("no physical meaning");
    const first = Number(await label(page).getAttribute("data-particles"));
    expect(first).toBeGreaterThan(0);
    await page.reload();
    await expect(label(page)).toHaveAttribute("data-particles", String(first)); // the same sample count after a reload (the samples themselves are unit-tested)
    expect(errors).toEqual([]);
  });

  test("a paused display keeps the flash's remaining life; playing lets it run out; pausing again freezes it", async ({ page }) => {
    const errors = await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual() });
    await page.goto("/");
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "1.000");
    await page.waitForTimeout(1500); // longer than the whole 0.8 s life: paused wall time must not count
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "1.000");
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "0", { timeout: 6000 });
    await page.getByRole("button", { name: /^Pause/ }).click();
    await page.waitForTimeout(600);
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "0");
    expect(errors).toEqual([]);
  });

  test("a history seek: before the event nothing is drawn, at the event the flash is fresh, past it there is none", async ({ page }) => {
    const sample = (index: number, t: number) => ({ index, simulationTimeS: t, segment: 0, positionsM: { "body-target": [0, 0, 0], "debris-1-0": [3e7, 0, 0] } });
    const history = {
      universeId: UNIVERSE_ID, mode: "step", sampleIntervalS: null, generation: 0, firstIndex: 0, nextIndex: 3, droppedBefore: 0, truncated: false,
      samples: [sample(0, 500), sample(1, EVENT_TIME_S), sample(2, 2000)],
      bodies: {
        "body-target": { name: "Target", colorHex: "#3b82f6", radiusM: 6.4e6, kind: "planet" },
        "debris-1-0": { name: "Debris of Target", colorHex: "#888888", radiusM: 4e5, kind: "planet" },
      },
    };
    const errors = await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual(), history });
    await page.goto("/");
    await expect(label(page)).toHaveCount(1);
    await openTool(page, "History");
    const slider = page.getByLabel("History position");
    await expect(slider).toBeVisible();
    const setPosition = async (v: number) => {
      await slider.evaluate((el, value) => {
        const input = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, String(value));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, v);
    };
    await setPosition(0); // t = 500, before the event
    await expect(label(page)).toHaveCount(0);
    await setPosition(1); // t = 1000, the event time: the flash plays again from the start
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "1.000");
    await setPosition(0);
    await expect(label(page)).toHaveCount(0);
    await setPosition(2); // t = 2000, a jump past the event: no flash, the material effects stay
    await expect(label(page)).toHaveAttribute("data-flash-remaining", "0");
    expect(Number(await label(page).getAttribute("data-particles"))).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("empty and error states are quiet: no events, a legacy merge without a description, a failing record", async ({ page }) => {
    const none = await install(page, { bodies: [target(), parcel], events: [], timeS: 1500, visual: visual() });
    await page.goto("/");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(label(page)).toHaveCount(0);
    expect(none).toEqual([]);
    await page.unrouteAll();
    const legacy = await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual(), visualStatus: 404 });
    await page.reload();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(label(page)).toHaveCount(0); // a missing description draws nothing and breaks nothing
    expect(legacy).toEqual([]);
  });

  test("the inspector opens from the event, shows the provisional caveat and runs a dry-run replay", async ({ page }) => {
    await install(page, { bodies: [target(), parcel], events: [collisionEvent], timeS: 1500, visual: visual() });
    await page.goto("/");
    await openTool(page, "Events");
    await page.getByRole("button", { name: "Inspect collision col-1" }).click();
    const inspector = page.getByTestId("collision-inspector");
    await expect(inspector).toContainText("partial accretion");
    await expect(inspector).toContainText("not signed off");
    await expect(page.getByTestId("inspector-soft-fidelity")).toBeVisible();
    await inspector.getByRole("button", { name: "Replay (dry run)" }).click();
    await expect(page.getByTestId("inspector-replay")).toContainText("Reproduced");
    await expect(page.getByTestId("inspector-replay")).toContainText("Nothing was changed");
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The manual WebGL alignment check, automated: a body with a body-local mark, drawn with two orientations, must show the mark where the
// rotation puts it. The mark is orange (appearance "molten"), the body blue; the centroid of the orange pixels is read from a screenshot.
// ---------------------------------------------------------------------------------------------------------------------------------
const S = Math.SQRT1_2;
const IDENTITY: [number, number, number, number] = [1, 0, 0, 0];
const HALF = Math.PI / 8; // half of 45 degrees
const EIGHTH_TURN_ABOUT_Z: [number, number, number, number] = [Math.cos(HALF), 0, 0, Math.sin(HALF)]; // +45 degrees about the simulation z axis

// The scene area between the panels, as the workspace lays it out at the moment of the screenshot (the panels have blue
// buttons of their own). The band at the top holds the wordmark and the universe chip.
const TOP_BAND_PX = 85;

async function sceneRegion(page: Page) {
  const box = await page.getByTestId("free-area").boundingBox();
  expect(box, "the free area between the panels exists").not.toBeNull();
  return { x0: Math.ceil(box!.x), x1: Math.floor(box!.x + box!.width), y0: Math.ceil(box!.y) + TOP_BAND_PX, y1: Math.floor(box!.y + box!.height) };
}

async function pixelCentroids(page: Page, png: Buffer) {
  const region = await sceneRegion(page);
  return page.evaluate(async ({ b64, region }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sx = 0, sy = 0, n = 0, bx = 0, by = 0, bn = 0;
    for (let y = region.y0; y < Math.min(c.height, region.y1); y += 1) {
      for (let x = region.x0; x < Math.min(c.width, region.x1); x += 1) {
        const i = 4 * (y * c.width + x);
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
        if (r > 200 && g > 100 && g < 190 && b < 110) { sx += x; sy += y; n += 1; } // orange mark (#ff8a3d)
        else if (b > 150 && r < 120 && g > 60 && g < 160) { bx += x; by += y; bn += 1; } // blue body (#3b82f6)
      }
    }
    return { mark: n ? { x: sx / n, y: sy / n, n } : null, body: bn ? { x: bx / bn, y: by / bn, n: bn } : null };
  }, { b64: png.toString("base64"), region });
}

async function markCentroid(page: Page, name: string, orientation: [number, number, number, number]) {
  await page.unrouteAll();
  const lone = { ...target(orientation), radiusM: 6.4e6 };
  await install(page, { bodies: [lone], events: [collisionEvent], timeS: 1500, visual: visual("molten", { x: 0, y: -1, z: 0 }) });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.reload();
  await expect(label(page)).toHaveCount(1);
  await page.waitForTimeout(800);
  // the lone body is a few pixels across in the Universe View: switch to the Exploration View (a larger minimum size), click the body where
  // it is drawn and press Focus, which frames it closely
  await page.getByRole("button", { name: "Exploration View" }).click();
  await page.waitForTimeout(800);
  const overview = await pixelCentroids(page, await page.screenshot());
  expect(overview.body, "the body is drawn at the overview").not.toBeNull();
  await page.mouse.click(overview.body!.x, overview.body!.y);
  await expect(page.getByRole("button", { name: "Focus selected body" })).toBeEnabled();
  await page.getByRole("button", { name: "Focus selected body" }).click();
  await page.waitForTimeout(3000);
  const png = await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  if (UPDATE_EVIDENCE) {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, `${name}.png`), png);
  }
  return pixelCentroids(page, png);
}

test.describe("WebGL alignment of a body-local surface mark", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

  test("the mark follows the body's orientation on screen", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    test.skip(!(await webglAvailable(page)), "no WebGL context in this browser");
    const a = await markCentroid(page, "mark-identity", IDENTITY);
    const b = await markCentroid(page, "mark-eighth-turn", EIGHTH_TURN_ABOUT_Z);
    expect(a.body, "the blue body is visible").not.toBeNull();
    expect(b.body, "the blue body is visible").not.toBeNull();
    expect(a.mark, "the mark is visible with the identity orientation").not.toBeNull();
    expect(b.mark, "the mark is visible after a 45 degree turn").not.toBeNull();
    const radius = Math.sqrt(a.body!.n / Math.PI); // the body's disc radius in pixels
    // The mark is at local -y. Identity: simulation -y = scene +z, straight at the camera's horizontal: no sideways offset on screen.
    expect(Math.abs(a.mark!.x - a.body!.x)).toBeLessThan(0.12 * radius);
    // A +45 degree turn about the simulation z axis takes local -y to simulation (sin 45, -cos 45, 0) = scene (0.707, 0, 0.707): the mark moves
    // to the right by about 0.707 of the disc radius (the camera's right is the scene +x axis; perspective makes this approximate).
    const shift = (b.mark!.x - b.body!.x) / radius;
    expect(shift).toBeGreaterThan(0.55);
    expect(shift).toBeLessThan(0.85);
    test.info().annotations.push({ type: "alignment", description: JSON.stringify({ identity: a, quarterTurn: b }) });
  });
});
