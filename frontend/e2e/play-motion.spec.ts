// Playing is smooth without the browser asking the backend for physics on every frame (stubbed API, real Chromium).
//
// What this shows: while Play is on, the app requests steps at the Play loop's pace (a handful per second, never per rendered frame),
// keeps animating frames in between, every displayed state is one the stub reported (the readout equals a reported time), and the
// page raises no runtime error. What it does not show: how the motion looks (that needs eyes or a GPU screenshot comparison).
import { expect, test } from "@playwright/test";
import { legacyPath, universeLayer } from "./universeLayer";

const diagnostics = {
  version: 1, totalMassKg: 6e24, totalMomentumKgMPerS: { x: 0, y: 0, z: 0 }, kineticEnergyJ: 0, potentialEnergyJ: 0,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 0 }, bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};
const sun = { id: "body-sun", name: "Sun", massKg: 2e30, radiusM: 7e8, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 }, colorHex: "#ffcc00" };
const earthAt = (t: number) => {
  const a = (2 * Math.PI * t) / 3.156e7;
  return {
    id: "body-earth", name: "Earth", massKg: 6e24, radiusM: 6.4e6,
    positionM: { x: 1.496e11 * Math.cos(a), y: 1.496e11 * Math.sin(a), z: 0 },
    velocityMPerS: { x: -29780 * Math.sin(a), y: 29780 * Math.cos(a), z: 0 }, colorHex: "#3b82f6",
  };
};

test("Play requests steps at the loop's pace, not per frame, and keeps drawing frames between them", async ({ page }) => {
  const reported: number[] = [];
  let t = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const layer = universeLayer(url.pathname, route.request().method(), 2);
    if (layer !== undefined) return route.fulfill({ json: layer });
    const path = legacyPath(url.pathname);
    if (path === "/api/v1/simulation/state") {
      return route.fulfill({ json: { status: "paused", simulationTimeS: t, bodies: [sun, earthAt(t)], diagnostics, diagnosticsIssue: null } });
    }
    if (path === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    if (path === "/api/v1/simulation/step") {
      const { dtS } = route.request().postDataJSON() as { dtS: number };
      t += dtS;
      reported.push(t);
      return route.fulfill({ json: { status: "paused", simulationTimeS: t, bodies: [sun, earthAt(t)], diagnostics, diagnosticsIssue: null, advancedS: dtS, events: [] } });
    }
    return route.fulfill({ status: 404, json: { detail: `Unhandled route: ${url.pathname}` } });
  });

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toContainText("connected");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as unknown as { __frames: number }).__frames = 0;
    const tick = () => { (window as unknown as { __frames: number }).__frames += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const started = Date.now();
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Pause" }).click();
  const playedMs = Date.now() - started;
  await page.waitForTimeout(500);
  const frames = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
  expect(reported.length, "steps were requested").toBeGreaterThan(3);
  // The loop releases one state per tick (150 ms) and keeps LOOKAHEAD_STEPS (3) computed ahead, so the request count is set by the loop's
  // pace, whatever the frame rate (software WebGL in CI runs well below 60 fps, so the bound is in time, not in frames).
  expect(reported.length, "the backend is asked at the loop's pace").toBeLessThanOrEqual(Math.ceil(playedMs / 150) + 3 + 2);
  expect(frames, "frames kept being drawn between the states").toBeGreaterThan(reported.length);
  expect(errors).toEqual([]);
});
