import { expect, test } from "@playwright/test";
import { legacyPath, universeLayer } from "./universeLayer";
import { openTool } from "./tools";

const sun = {
  id: "body-aaaaaaaaaaaa",
  name: "Sun",
  massKg: 1.989e30,
  radiusM: 6.957e8,
  positionM: { x: 0, y: 0, z: 0 },
  velocityMPerS: { x: 0, y: 0, z: 0 },
  colorHex: "#fdb813",
};
const earth = {
  id: "body-bbbbbbbbbbbb",
  name: "Earth",
  massKg: 5.972e24,
  radiusM: 6.371e6,
  positionM: { x: 1.496e11, y: 0, z: 0 },
  velocityMPerS: { x: 0, y: 29780, z: 0 },
  colorHex: "#3b82f6",
};
const diagnostics = {
  version: 1,
  totalMassKg: 1.989e30 + 5.972e24,
  totalMomentumKgMPerS: { x: 0, y: 1.7786e29, z: 0 },
  kineticEnergyJ: 2.6e33,
  potentialEnergyJ: -5.3e33,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 2.66e40 },
  bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};
const mergerEvent = {
  id: "evt-1",
  type: "merger",
  simulationTimeS: 7200,
  estimatedContactTimeS: 7000,
  bodyIds: [sun.id, earth.id],
  resultBodyId: sun.id,
  resultMassKg: sun.massKg + earth.massKg,
  relativeSpeedMPerS: 29780,
  kineticEnergyLostJ: 1e33,
  spinAddedKgM2PerS: { x: 0, y: 0, z: 1e40 },
};

function state(bodies: unknown[], simulationTimeS: number) {
  return { status: "paused", simulationTimeS, bodies, diagnostics };
}

test.beforeEach(async ({ page }) => {
  let stepped = false;
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const layer = universeLayer(url.pathname, route.request().method(), stepped ? 1 : 2);
    if (layer !== undefined) return route.fulfill({ json: layer });
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state" && route.request().method() === "GET") {
      return route.fulfill({ json: state(stepped ? [sun] : [sun, earth], stepped ? 7200 : 0) });
    }
    if (path === "/api/v1/events" && route.request().method() === "GET") {
      return route.fulfill({ json: { events: stepped ? [mergerEvent] : [] } });
    }
    if (path === "/api/v1/simulation/step" && route.request().method() === "POST") {
      stepped = true;
      const dtS = route.request().postDataJSON().dtS as number;
      return route.fulfill({ json: { ...state([sun], dtS), advancedS: dtS, events: [mergerEvent] } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled test route: ${url.pathname}` } });
  });
});

test("shows backend merger metadata and keeps the layout responsive", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await expect(page.getByText("Simulation", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Step Forward" }).click();
  await expect(page.getByText(/Sim time: 1.16 d/)).toBeVisible();
  await openTool(page, "Events");
  await expect(page.getByTestId("sidebar-left")).toHaveAttribute("data-tool", "events");
  await expect(page.getByTestId("sidebar-right")).toHaveAttribute("data-open", "false");

  await expect(page.getByTestId("event-item")).toContainText("estimated contact t = 1.94 h");
  await expect(page.getByTestId("event-item")).toContainText("spin booked");
  const highlightResult = page.getByRole("button", { name: "Highlight surviving body Sun" });
  await highlightResult.click();
  // At this viewport selecting a body opens the inspector and closes the tool drawer, so the event button
  // unmounts after selection. The inspector confirms that the active backend body was selected.
  await expect(page.getByRole("heading", { name: "Body Inspector" })).toBeVisible();
  await expect(page.getByTestId("sidebar-left")).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("sidebar-right")).toHaveAttribute("data-open", "true");
});

test("keeps a failed initial state load recoverable while health remains available", async ({ page }) => {
  await page.unrouteAll();
  let allowStateLoad = false;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/healthz") return route.fulfill({ json: { status: "ok" } });
    const layer = universeLayer(url.pathname, route.request().method(), 1);
    if (layer !== undefined) return route.fulfill({ json: layer });
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state") {
      if (!allowStateLoad) return route.fulfill({ status: 503, json: { detail: "simulation is busy" } });
      return route.fulfill({ json: state([sun], 0) });
    }
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    return route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Cannot load the simulation");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  allowStateLoad = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Simulation", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps core controls keyboard-operable without horizontal overflow on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");

  const step = page.getByRole("button", { name: "Step Forward" });
  await expect(step).toBeVisible();
  await step.focus();
  await step.press("Enter");
  await expect(page.getByText(/Sim time: 1.16 d/)).toBeVisible();

  const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(viewportFits).toBe(true);
});

test("shows disconnection separately and recovers after the backend returns", async ({ page }) => {
  let online = false;
  await page.unrouteAll();
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const path = legacyPath(url.pathname);
    // The universe list loads before the simulation, so it is the first request to fail while offline.
    if (!online && (url.pathname === "/healthz" || url.pathname === "/api/v1/universes" || path === "/api/v1/simulation/state")) {
      return route.abort("failed");
    }
    if (url.pathname === "/healthz") return route.fulfill({ json: { status: "ok" } });
    const layer = universeLayer(url.pathname, route.request().method(), 1);
    if (layer !== undefined) return route.fulfill({ json: layer });
    if (path === "/api/v1/simulation/state") return route.fulfill({ json: state([sun], 0) });
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    return route.continue();
  });

  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("unreachable");
  await expect(page.getByRole("alert")).toContainText(/Cannot load the (universes|simulation)/);

  online = true;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await expect(page.getByText("Simulation", { exact: true })).toBeVisible();
});
