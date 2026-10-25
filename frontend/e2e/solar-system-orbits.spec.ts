import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { legacyPath, universeLayer } from "./universeLayer";

// D-064: the Solar System preset opens on the tilted overview with its display-only reference orbits, the labelled
// outer bodies and the main-belt sample; the guides never block selecting a body. Served from the committed preset
// fixture, so no backend is needed.
const presets = JSON.parse(readFileSync(fileURLToPath(new URL("../src/test/presetBodies.json", import.meta.url)), "utf-8")) as Record<string, unknown>;
type Raw = { id: string; name: string; kind: string; radiusM: number; positionM: { x: number; y: number; z: number }; colorHex: string; bodyType: string | null; assetKey: string | null; primaryId: string | null };
// The moons preset: its Bodies list (shown for scenes with moons) makes selection checkable without WebGL picking.
const bodies = (presets["solar-system-moons-j2000"] as Raw[]).map((b) => ({
  id: b.id, name: b.name, massKg: 1e24, radiusM: b.radiusM, positionM: b.positionM, velocityMPerS: { x: 0, y: 0, z: 0 },
  colorHex: b.colorHex, kind: b.kind, catalogueEntryId: null, bodyType: b.bodyType ?? "default", assetKey: b.assetKey,
  ...(b.primaryId ? { primaryId: b.primaryId } : {}),
}));
const diagnostics = {
  version: 1, totalMassKg: 1e24, totalMomentumKgMPerS: { x: 0, y: 0, z: 0 }, kineticEnergyJ: 0, potentialEnergyJ: 0,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 0 }, bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};
const OUTER = ["pluto", "haumea", "makemake", "quaoar", "orcus", "chiron", "2014-nw65", "chiminigagua"];

async function serve(page: import("@playwright/test").Page, presetId: string | null) {
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const layer = universeLayer(url.pathname, route.request().method(), bodies.length) as { universes?: { presetId: string | null }[] } | undefined;
    if (layer !== undefined) {
      if (url.pathname === "/api/v1/universes" && layer.universes) layer.universes[0]!.presetId = presetId;
      return route.fulfill({ json: layer });
    }
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state") return route.fulfill({ json: { status: "paused", simulationTimeS: 0, bodies, diagnostics } });
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    return route.fulfill({ status: 404, json: { detail: `Unhandled test route: ${url.pathname}` } });
  });
}

test("Solar System preset: labelled reference orbits, belt and guides toggle; selection still works", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await serve(page, "solar-system-moons-j2000");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");

  // Every requested outer body has a label in the scene, and on this window all of them are placed (visible).
  for (const id of OUTER) await expect(page.getByTestId(`orbit-label-${id}`)).toHaveCount(1);
  await expect.poll(async () => {
    const shown = await page.$$eval("[data-orbit-label=outer]", (els) => els.filter((e) => (e as HTMLElement).style.opacity === "1").length);
    return shown;
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(7);
  await expect(page.getByTestId("orbit-label-pluto")).toHaveText("Pluto");
  await expect(page.getByTestId("orbit-label-neptune")).toHaveText("Neptune");
  await expect(page.getByTestId("reference-orbits-note")).toContainText("not simulated");

  // Guides are display only: a body is still selected from the scene's list and the inspector opens.
  await page.getByRole("region", { name: "Bodies" }).getByRole("button", { name: "Saturn", exact: true }).click();
  await expect(page.getByTestId("inspect-visual-radius")).toBeVisible();

  // The toggles remove the guides and labels without touching the bodies.
  const guides = page.getByRole("button", { name: "Orbit guides" });
  await expect(guides).toHaveAttribute("aria-pressed", "true");
  await guides.click();
  await expect(guides).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("orbit-label-pluto")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Bodies" }).getByRole("listitem")).toHaveCount(21);
  await page.getByRole("button", { name: "Asteroid belt" }).click();
  await expect(page.getByRole("button", { name: "Asteroid belt" })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("a universe that is not a Solar System preset draws no reference orbits", async ({ page }) => {
  await serve(page, null);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await expect(page.getByRole("region", { name: "Bodies" }).getByRole("listitem")).toHaveCount(21);
  await expect(page.locator("[data-orbit-label]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Orbit guides" })).toHaveCount(0);
});
