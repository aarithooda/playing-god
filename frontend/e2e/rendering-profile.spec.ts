import { expect, test } from "@playwright/test";

const diagnostics = {
  version: 1,
  totalMassKg: 1e22,
  totalMomentumKgMPerS: { x: 0, y: 0, z: 0 },
  kineticEnergyJ: 0,
  potentialEnergyJ: 0,
  angularMomentumAboutOriginKgM2PerS: { x: 0, y: 0, z: 0 },
  bookedSpinKgM2PerS: { x: 0, y: 0, z: 0 },
};

const bodies = Array.from({ length: 64 }, (_, index) => ({
  id: `body-${String(index).padStart(12, "0")}`,
  name: `Profile body ${index + 1}`,
  massKg: 1e20,
  radiusM: 1e7,
  positionM: {
    x: ((index % 8) - 3.5) * 2e9,
    y: (Math.floor(index / 8) - 3.5) * 2e9,
    z: ((index % 3) - 1) * 5e8,
  },
  velocityMPerS: { x: 0, y: 0, z: 0 },
  colorHex: index % 2 === 0 ? "#3b82f6" : "#f97316",
}));

test("profiles browser frame pacing with 64 visible bodies", async ({ page }, testInfo) => {
  let activeBodyCount = 1;
  await page.route("**/healthz", (route) => route.fulfill({ json: { status: "ok" } }));
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/simulation/state") {
      return route.fulfill({ json: { status: "paused", simulationTimeS: 0, bodies: bodies.slice(0, activeBodyCount), diagnostics } });
    }
    if (url.pathname === "/api/v1/events") return route.fulfill({ json: { events: [] } });
    return route.fulfill({ status: 404, json: { detail: `Unhandled profile route: ${url.pathname}` } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  const profiles = [];
  for (const count of [1, 16, 64]) {
    activeBodyCount = count;
    await page.goto("/");
    await expect(page.getByTestId("backend-status")).toContainText("connected");
    await expect(page.getByText("Simulation", { exact: true })).toBeVisible();
    // Let the initial layout and WebGL scene settle before collecting frame intervals.
    await page.waitForTimeout(500);
    const sample = await page.evaluate(async () => {
      const intervals: number[] = [];
      let previous = 0;
      const endAt = performance.now() + 1500;
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          if (previous > 0) intervals.push(now - previous);
          previous = now;
          if (now >= endAt) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      intervals.sort((a, b) => a - b);
      const percentile = (p: number) => intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))];
      return {
        frameCount: intervals.length,
        medianFrameMs: percentile(0.5),
        p95FrameMs: percentile(0.95),
        maxFrameMs: intervals.at(-1),
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
      };
    });

    expect(sample.frameCount).toBeGreaterThan(10);
    expect(sample.medianFrameMs).toBeGreaterThan(0);
    profiles.push({ bodyCount: count, ...sample });
    console.info(`[render-profile] bodies=${count} viewport=1440x900 ${JSON.stringify(sample)}`);
  }
  await testInfo.attach("render-profile.json", {
    body: Buffer.from(JSON.stringify({ viewport: "1440x900", profiles }, null, 2)),
    contentType: "application/json",
  });
});
