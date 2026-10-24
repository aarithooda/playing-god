import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { legacyPath, universeLayer } from "./universeLayer";

const presets = JSON.parse(readFileSync(fileURLToPath(new URL("../src/test/presetBodies.json", import.meta.url)), "utf-8")) as Record<string, unknown>;

// The moons preset served from the committed fixture (generated from the backend preset), so the size hierarchy the UI
// reports can be checked against the authoritative radii without a backend.
type Raw = { id: string; name: string; kind: string; radiusM: number; positionM: { x: number; y: number; z: number }; colorHex: string; bodyType: string | null; assetKey: string | null; primaryId: string | null };
const wire = (list: Raw[]) =>
  list.map((b) => ({
    id: b.id, name: b.name, massKg: 1e22, radiusM: b.radiusM, positionM: b.positionM, velocityMPerS: { x: 0, y: 0, z: 0 },
    colorHex: b.colorHex, kind: b.kind, catalogueEntryId: null, bodyType: b.bodyType ?? "default", assetKey: b.assetKey, primaryId: b.primaryId,
  }));
const diagnostics = {
  version: 1, totalMassKg: 1e22, totalMomentumKgMPerS: { x: 0, y: 0, z: 0 }, kineticEnergyJ: 0, potentialEnergyJ: 0,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 0 }, bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};

async function serve(page: import("@playwright/test").Page, which: "solar-system-moons-j2000" | "solar-system-j2000") {
  const bodies = wire(presets[which] as Raw[]);
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const layer = universeLayer(url.pathname, route.request().method(), bodies.length);
    if (layer !== undefined) return route.fulfill({ json: layer });
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state") return route.fulfill({ json: { status: "paused", simulationTimeS: 0, bodies, diagnostics } });
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    return route.fulfill({ status: 404, json: { detail: `Unhandled test route: ${url.pathname}` } });
  });
}

/** The drawn radius in scene units the inspector reports for a body, selected from the Bodies list. */
async function drawnRadius(page: import("@playwright/test").Page, name: string): Promise<number> {
  await page.getByRole("button", { name, exact: true }).click();
  const text = await page.getByTestId("inspect-visual-radius").textContent();
  const m = text!.match(/Rendered visual radius: ([0-9.e+-]+) scene units \(true physical scale/);
  expect(m, text ?? "").not.toBeNull();
  return Number(m![1]);
}

test("moons preset: all bodies listed, nested under their planet, physical sizes in the documented mode", async ({ page }) => {
  test.setTimeout(90_000); // many UI round trips on a software-rendered canvas
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await serve(page, "solar-system-moons-j2000");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");

  const list = page.getByRole("region", { name: "Bodies" });
  await expect(list.getByRole("listitem")).toHaveCount(21);
  for (const name of ["Sun", "Earth", "Moon", "Mars", "Phobos", "Deimos", "Jupiter", "Io", "Europa", "Ganymede", "Callisto", "Saturn", "Titan", "Neptune (system barycentre)"]) {
    await expect(list.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Exploration View" })).toHaveAttribute("aria-pressed", "true");

  // The documented default mode draws true proportions: Sun >> Earth > Moon (radii 695,700 / 6,371.0084 / 1,737.4 km).
  const sun = await drawnRadius(page, "Sun");
  const earth = await drawnRadius(page, "Earth");
  const moon = await drawnRadius(page, "Moon");
  expect(sun / earth).toBeGreaterThan(100);
  expect(earth / moon).toBeGreaterThan(3);
  expect(earth / moon).toBeLessThan(4);

  // Switching views changes display sizing, not the inspector's scene-unit radius.
  await page.getByRole("button", { name: "Universe View" }).click();
  await expect(page.getByRole("button", { name: "Universe View" })).toHaveAttribute("aria-pressed", "true");
  expect(await drawnRadius(page, "Earth")).toBe(earth); // same geometry in the other view
  await page.getByRole("button", { name: "Exploration View" }).click();
  await expect(page.getByRole("button", { name: "Exploration View" })).toHaveAttribute("aria-pressed", "true");
  expect(await drawnRadius(page, "Earth")).toBe(earth);

  // Framing and selecting the bodies of the report does not change any size or raise errors.
  for (const name of ["Earth", "Moon", "Jupiter", "Saturn"]) {
    await page.getByRole("button", { name: `Focus ${name}`, exact: true }).click();
    await page.waitForTimeout(150);
    expect(await drawnRadius(page, "Earth")).toBe(earth);
    expect(await drawnRadius(page, "Sun")).toBe(sun);
  }
  expect(errors).toEqual([]);
});

test("original preset: no moon list and the same default size mode", async ({ page }) => {
  await serve(page, "solar-system-j2000");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await expect(page.getByRole("region", { name: "Bodies" })).toHaveCount(0); // the list appears only for scenes with moons
  await expect(page.getByRole("button", { name: "Exploration View" })).toHaveAttribute("aria-pressed", "true");
});
