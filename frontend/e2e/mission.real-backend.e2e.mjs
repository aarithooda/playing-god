// Real-backend Space Mission Design journey (NOT stubbed). Not part of vitest; run with:
//     cd frontend && npm run e2e:mission
// Starts its OWN backend (default :8014) and Vite (default :5186) - never the developer's :8000 backend - and drives a real Chromium
// through the real UI against the real API, following the acceptance journey of the feature:
//   open the sandbox -> create Earth -> create a spacecraft in Earth orbit -> inspect its orbit -> execute a manoeuvre -> see the
//   orbit change -> (in the Earth-Moon mission universe) design an Earth-to-Moon transfer -> commit and run it -> inspect the outcome,
//   then a deliberate crash to see the simulation stop at the contact.
// Everything the UI shows is cross-checked against the backend over HTTP, and the final orbit is recomputed here from the raw state
// vectors (so "completed" is not taken on the UI's or the mission bookkeeping's word). Screenshots go to test-results/mission/; with
// PG_UPDATE_EVIDENCE=1 they are also copied to docs/evidence/space-mission-design/.
// Browser: E2E_CHROMIUM=<path>, else Playwright's own, else an installed Chrome/Edge. Python: E2E_PYTHON, else ../.venv, else `python`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const root = resolve(frontend, "..");
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8014);
const VITE_PORT = Number(process.env.E2E_VITE_PORT ?? 5186);
if (BACKEND_PORT === 8000) throw new Error("refusing to use port 8000 (the developer's own backend)");
const API = `http://127.0.0.1:${BACKEND_PORT}`;
const APP = `http://localhost:${VITE_PORT}`;
const SHOTS = join(frontend, "test-results", "mission");
const EVIDENCE = join(root, "docs", "evidence", "space-mission-design");
const G = 6.6743e-11;
const EARTH = { massKg: 5.9722e24, radiusM: 6.3710084e6 };
const MOON_RADIUS_M = 1737400;

const procs = [];
const log = (m) => console.log(`  ${m}`);
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`PASS ${name} (${Date.now() - t0} ms)`);
};
async function until(fn, what, timeoutMs = 30000, everyMs = 100) {
  const end = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      if (e && e.fatal) throw e;
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${last})`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
const j = async (path, init) => {
  const r = await fetch(API + path, init);
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function pythonPath() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  for (const p of [join(root, ".venv", "Scripts", "python.exe"), join(root, ".venv", "bin", "python")]) if (existsSync(p)) return p;
  return "python";
}
function spawnServer(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.output = () => out;
  p.on("error", (e) => (p.failure = e));
  p.on("exit", (code) => (p.exited = code));
  procs.push(p);
  return p;
}
function browserCandidates() {
  const out = [];
  if (process.env.E2E_CHROMIUM) out.push({ executablePath: process.env.E2E_CHROMIUM });
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) out.push({ executablePath: p });
  } catch {
    /* no bundled browser */
  }
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? "", ".cache"), "ms-playwright");
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        if (existsSync(join(cache, d, rel))) out.push({ executablePath: join(cache, d, rel) });
      }
    }
  }
  out.push({ channel: "chrome" }, { channel: "msedge" });
  return out;
}
async function launchBrowser() {
  const errors = [];
  for (const candidate of browserCandidates()) {
    try {
      const b = await chromium.launch({ ...candidate, headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
      log(`browser: ${candidate.executablePath ?? candidate.channel} (${b.version()})`);
      return b;
    } catch (e) {
      errors.push(`${candidate.executablePath ?? candidate.channel}: ${String(e.message).split(/\r?\n/)[0]}`);
    }
  }
  throw new Error(`no launchable Chromium/Chrome/Edge found; set E2E_CHROMIUM. Tried: ${errors.join(" | ")}`);
}
async function openTool(page, label) {
  const button = page.getByRole("button", { name: new RegExp(`^${label}( \\(\\d+\\))?$`) });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await page.locator('[data-testid="sidebar-left"][data-open="true"]').waitFor();
}
/** Number of canvas pixels close to a colour (the dashed planned path is the only thing drawn in its violet). */
async function countPixels(page, [r, g, b], tolerance = 40) {
  const png = await page.locator("canvas").first().screenshot();
  return page.evaluate(async ({ data, r, g, b, tolerance }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(data)], { type: "image/png" }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(0, 0, image.width, image.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      // a line drawn over black is the colour dimmed: compare the hue (ratios), requiring some brightness
      const m = Math.max(px[i], px[i + 1], px[i + 2]);
      if (m < 70) continue;
      const k = 255 / m;
      const m0 = Math.max(r, g, b);
      if (Math.abs(px[i] * k - (r * 255) / m0) < tolerance && Math.abs(px[i + 1] * k - (g * 255) / m0) < tolerance && Math.abs(px[i + 2] * k - (b * 255) / m0) < tolerance) n += 1;
    }
    return n;
  }, { data: [...png], r, g, b, tolerance });
}

let browser;
let page;
let failed = false;
try {
  console.log(`Space Mission Design real-backend journey (backend :${BACKEND_PORT}, app :${VITE_PORT})`);
  mkdirSync(SHOTS, { recursive: true });
  spawnServer(pythonPath(), ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT), "--log-level", "warning"], { cwd: root });
  spawnServer(process.execPath, [join(frontend, "node_modules", "vite", "bin", "vite.js"), "--port", String(VITE_PORT), "--strictPort"], {
    cwd: frontend,
    env: { ...process.env, BACKEND_URL: API },
  });
  const alive = () => {
    for (const p of procs) {
      if (p.failure) throw Object.assign(new Error(`a server could not be started: ${p.failure.message}`), { fatal: true });
      if (p.exited !== undefined) throw Object.assign(new Error(`a server exited early (code ${p.exited}): ${p.output().slice(-800)}`), { fatal: true });
    }
  };
  await until(async () => (alive(), (await fetch(`${API}/healthz`)).ok), "backend health", 60000);
  await until(async () => (alive(), (await fetch(`${APP}/healthz`)).ok), "vite proxy to the backend", 60000);

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const failedRequests = [];
  // Ignored: the browser's own line for a refused request (asserted separately below), and a React development-mode style warning
  // of the existing create-body form (its button switches between two styles that mix `border` and `borderColor`; present before
  // this feature and unrelated to it).
  const ignorable = /Failed to load resource|don't mix shorthand and non-shorthand properties[\s\S]*CreateBodyPanel/;
  page.on("console", (m) => { if (m.type() === "error" && !ignorable.test(m.text())) consoleErrors.push(m.text().slice(0, 900)); });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failedRequests.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  const shot = async (name) => {
    await page.waitForTimeout(600);
    const file = join(SHOTS, `${name}.png`);
    await page.screenshot({ path: file });
    if (process.env.PG_UPDATE_EVIDENCE === "1") {
      mkdirSync(EVIDENCE, { recursive: true });
      copyFileSync(file, join(EVIDENCE, `${name}.png`));
    }
  };
  const active = async () => (await j("/api/v1/universes")).body;
  const stateOf = async (uid) => (await j(`/api/v1/universes/${uid}/state`)).body;
  const craftIn = (state, name) => state.bodies.find((b) => b.kind === "spacecraft" && b.name === name);
  const readout = async (testId) => (await page.getByTestId(testId).innerText()).trim();

  // ------------------------------------------------------------------ 1-2: the sandbox and Earth
  await step("1-2. the universe sandbox opens empty and Earth is created through the Add form", async () => {
    await page.goto(APP);
    await page.getByRole("button", { name: "Add your first body" }).click();
    await page.getByRole("form", { name: "Create body" }).waitFor();
    await page.fill("#create-name", "Earth");
    await page.fill("#create-mass", String(EARTH.massKg));
    await page.fill("#create-radius", String(EARTH.radiusM));
    for (const what of ["Position", "Velocity"]) for (const axis of ["X", "Y", "Z"]) await page.getByRole("textbox", { name: new RegExp(`^${what}.* ${axis}$`) }).fill("0");
    await page.getByRole("form", { name: "Create body" }).getByRole("button", { name: /^(Create|Add)/ }).click();
    const state = await until(async () => { const s = await stateOf("uni-default"); return s.bodies.length === 1 && s; }, "Earth in the backend state");
    assert.equal(state.bodies[0].name, "Earth");
    assert.equal(state.bodies[0].kind, "planet");
    assert.equal((await active()).universes[0].collisionMode, "stop-on-contact", "the sandbox stops on contact like every universe (D-071)");
  });

  // ------------------------------------------------------------------ 3-5: a spacecraft in Earth orbit, inspected
  let craft;
  await step("3-4. a spacecraft is created in a 400 km, 51.6 degree orbit about Earth; the preview is the backend's", async () => {
    await openTool(page, "Missions");
    await page.getByRole("button", { name: "New spacecraft…" }).click();
    await page.fill("#craft-name", "Sandbox Sat");
    await page.fill("#craft-altitude", "400");
    await page.fill("#craft-inc", "51.6");
    await page.getByTestId("orbit-preview").waitFor();
    await until(async () => /1 h 32 min/.test(await readout("preview-period")), "the orbit preview for 400 km");
    assert.match(await readout("preview-speed"), /^7\.67\d km\/s$/);
    await page.getByRole("button", { name: "Create spacecraft" }).click();
    craft = await until(async () => craftIn(await stateOf("uni-default"), "Sandbox Sat"), "the spacecraft in the backend state");
    assert.equal(craft.bodyType, "spacecraft");
    assert.ok(craft.id.startsWith("craft-"));
    // analytic values, computed here: v = sqrt(mu / r), T = 2 pi sqrt(r^3 / mu)
    const r = EARTH.radiusM + 400e3;
    const mu = G * (EARTH.massKg + craft.massKg);
    const orbit = craft.spacecraft.orbit;
    assert.ok(Math.abs(orbit.speedMPerS / Math.sqrt(mu / r) - 1) < 1e-10, `speed ${orbit.speedMPerS}`);
    assert.ok(Math.abs(orbit.periodS / (2 * Math.PI * Math.sqrt(r ** 3 / mu)) - 1) < 1e-10, `period ${orbit.periodS}`);
    assert.ok(Math.abs(orbit.inclinationDeg - 51.6) < 1e-9);
    log(`analytic check: v = ${orbit.speedMPerS.toFixed(3)} m/s, T = ${orbit.periodS.toFixed(3)} s`);
  });

  await step("5. the spacecraft inspector shows its orbital parameters (and it is a spacecraft, not a planet)", async () => {
    await page.getByTestId("sidebar-right").getByText("Spacecraft Inspector").waitFor({ state: "attached" });
    assert.equal(await readout("inspector-name"), "Sandbox Sat");
    assert.match(await readout("spacecraft-kind"), /^Spacecraft · orbiting Earth/);
    assert.equal(await readout("readout-altitude"), "400 km");
    assert.equal(await readout("readout-periapsis"), "400 km");
    assert.equal(await readout("readout-apoapsis"), "400 km");
    assert.equal(await readout("readout-period"), "1 h 32 min");
    assert.match(await readout("readout-orbital-speed"), /^7\.67\d km\/s$/);
    assert.equal(await readout("readout-eccentricity"), "0.00000");
    assert.match(await readout("readout-delta-v"), /^7\.102 km\/s$/); // 450 s * g0 * ln(15000 / 3000)
    assert.ok(await page.getByTestId(`spacecraft-label-${craft.id}`).isVisible(), "the spacecraft has a marker label in the scene");
    await shot("01-sandbox-spacecraft-in-earth-orbit");
  });

  // ------------------------------------------------------------------ 6-7: a manoeuvre and the changed orbit
  await step("6-7. a 150 m/s prograde burn is previewed, executed, and changes the actual orbit as previewed", async () => {
    await page.fill("#mnv-prograde", "150");
    await page.getByTestId("maneuver-preview").waitFor();
    const previewed = await until(async () => { const t = await readout("preview-apoapsis"); return /→ \d/.test(t) && t; }, "the manoeuvre preview");
    await page.getByRole("button", { name: "Burn now" }).click();
    const after = await until(async () => { const c = craftIn(await stateOf("uni-default"), "Sandbox Sat"); return c.spacecraft.orbit.eccentricity > 0.01 && c; }, "the burn in the backend state");
    // vis-viva for the new speed at the same radius gives the new apoapsis (computed here)
    const r = EARTH.radiusM + 400e3;
    const mu = G * (EARTH.massKg + after.massKg);
    const v = after.spacecraft.orbit.speedMPerS;
    const a = 1 / (2 / r - (v * v) / mu);
    assert.ok(Math.abs(after.spacecraft.orbit.apoapsisRadiusM / (2 * a - r) - 1) < 1e-9);
    assert.ok(Math.abs(v - (craft.spacecraft.orbit.speedMPerS + 150)) < 1e-6, "the speed rose by exactly the delta-v");
    assert.ok(after.massKg < craft.massKg, "propellant was spent");
    const shown = await until(async () => { const t = await readout("readout-apoapsis"); return t !== "400 km" && t; }, "the inspector to show the new orbit");
    assert.ok(previewed.endsWith(shown), `the inspector (${shown}) shows the previewed apoapsis (${previewed})`);
    const events = (await j("/api/v1/universes/uni-default/events")).body.events;
    assert.deepEqual(events.map((e) => [e.type, e.phase]), [["maneuver", "impulse"]]);
    assert.equal(await page.getByTestId("maneuver-node").first().getAttribute("data-status"), "executed");
    log(`apoapsis after the burn: ${shown}`);
    await shot("02-sandbox-after-prograde-burn");
  });

  // ------------------------------------------------------------------ 8: the Earth-Moon mission universe and the transfer design
  let uid;
  let probe;
  let mission;
  await step("8a. the Earth-Moon mission universe loads (Moon is a real body) and a spacecraft is placed in the Moon's orbit plane", async () => {
    await openTool(page, "Universes");
    await page.getByRole("button", { name: /Load Earth and Moon: mission design/ }).click();
    const list = await until(async () => { const l = await active(); const u = l.universes.find((x) => x.presetId === "earth-moon-j2000" && x.active); return u && l; }, "the preset universe to be active");
    uid = list.activeUniverseId;
    assert.equal(list.universes.find((u) => u.id === uid).collisionMode, "stop-on-contact");
    const state = await stateOf(uid);
    assert.deepEqual(state.bodies.map((b) => b.id), ["body-earth", "body-moon"]);
    assert.ok(state.bodies[1].massKg > 7e22, "the Moon has its mass: it is a gravitating body, not a marker");
    await openTool(page, "Missions");
    await page.getByRole("button", { name: "New spacecraft…" }).click();
    await page.fill("#craft-name", "Lunar Explorer");
    await page.selectOption("#craft-plane", { label: "Match the plane of Moon's orbit" });
    await page.getByTestId("orbit-preview").waitFor();
    await page.getByRole("button", { name: "Create spacecraft" }).click();
    probe = await until(async () => craftIn(await stateOf(uid), "Lunar Explorer"), "the lunar spacecraft");
    assert.ok(Math.abs(probe.spacecraft.orbit.altitudeM - 300e3) < 1);
    await shot("03-mission-universe-parking-orbit");
  });

  await step("8b. a mission to the Moon is created and its transfer designed: a proposal, nothing scheduled, the simulation untouched", async () => {
    const before = await stateOf(uid);
    const violetBefore = await countPixels(page, [196, 181, 253]);
    await page.getByRole("button", { name: "New mission…" }).click();
    await page.getByRole("button", { name: "Create mission" }).click();
    await until(async () => (await page.getByTestId("mission-status").first().getAttribute("data-status")) === "draft", "the draft mission");
    await page.getByRole("button", { name: "Design transfer" }).click();
    await page.getByTestId("mission-plan").waitFor({ timeout: 60000 });
    assert.equal(await page.getByTestId("mission-status").first().innerText(), "Planned · proposal");
    const state = await stateOf(uid);
    mission = state.spaceflight.missions[0];
    assert.equal(mission.status, "planned");
    assert.equal(mission.committed, false);
    assert.deepEqual(state.spaceflight.maneuvers, [], "designing schedules nothing");
    assert.equal(state.simulationTimeS, before.simulationTimeS);
    assert.deepEqual(state.bodies.map((b) => b.positionM), before.bodies.map((b) => b.positionM));
    const plan = mission.plan;
    assert.ok(plan.departure.deltaVMPerS > 3050 && plan.departure.deltaVMPerS < 3200, `departure ${plan.departure.deltaVMPerS}`);
    assert.ok(plan.insertion.deltaVMPerS > 750 && plan.insertion.deltaVMPerS < 900, `insertion ${plan.insertion.deltaVMPerS}`);
    assert.ok(Math.abs(plan.arrival.periapsisAltitudeM - 100e3) <= 1, `periapsis ${plan.arrival.periapsisAltitudeM}`);
    assert.ok(plan.arrival.transferTimeS > 3.5 * 86400 && plan.arrival.transferTimeS < 5.5 * 86400);
    assert.ok(plan.totals.feasible);
    assert.match(await readout("plan-departure"), /^3\.1\d\d km\/s · T − /);
    assert.match(await readout("plan-insertion"), /^8\d\d(\.\d)? m\/s$/);
    // the planned trajectory is drawn (dashed violet): the overview is refitted and violet pixels appear
    await page.getByRole("button", { name: /Fit view/ }).click();
    const violet = await until(async () => { const n = await countPixels(page, [196, 181, 253]); return n > violetBefore + 60 && n; }, "the planned trajectory to be drawn", 15000, 500);
    log(`planned path: ${violet} violet pixels (before the design: ${violetBefore}); departure ${plan.departure.deltaVMPerS.toFixed(1)} m/s, insertion ${plan.insertion.deltaVMPerS.toFixed(1)} m/s, flight ${(plan.arrival.transferTimeS / 86400).toFixed(2)} d, ${plan.model.trialFlights} trial flights`);
    assert.ok(await page.getByTestId("planned-arrival-label").isVisible());
    await shot("04-transfer-designed-proposal");
  });

  // ------------------------------------------------------------------ 9: execute
  await step("9. the plan is committed and flown by the simulation: departure burn, coast, insertion burn", async () => {
    await page.getByRole("button", { name: "Commit plan" }).click();
    await until(async () => (await page.getByTestId("mission-status").first().innerText()) === "Planned · scheduled", "the committed mission");
    const scheduled = (await stateOf(uid)).spaceflight;
    assert.deepEqual(scheduled.maneuvers.map((m) => [m.role, m.status]), [["departure", "planned"], ["insertion", "planned"]]);
    assert.equal(scheduled.missions[0].phase, "awaiting departure");
    // a larger step for the four-day coast (the bar's slider: log10 of seconds per step)
    const slider = page.locator("#sim-speed");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.getByRole("button", { name: "Run the simulation" }).click();
    const seen = new Set();
    let shotCoast = false;
    await until(async () => {
      const m = (await stateOf(uid)).spaceflight.missions[0];
      seen.add(`${m.status}:${m.phase.split(" (")[0]}`);
      if (!shotCoast && m.phase.startsWith("coasting") && (await stateOf(uid)).simulationTimeS > 1.5 * 86400) {
        shotCoast = true;
        await shot("05-coasting-to-the-moon");
      }
      if (m.status === "failed") throw Object.assign(new Error(`the mission failed: ${m.reasons.join("; ")}`), { fatal: true });
      return m.status === "completed";
    }, "the mission to complete", 420000, 1000);
    log(`phases seen: ${[...seen].join(" -> ")}`);
    assert.ok(seen.has("in_progress:coasting to Moon"));
    assert.ok(seen.has("in_progress:verifying the orbit"));
    await page.getByRole("button", { name: "Pause" }).click().catch(() => {});
  });

  // ------------------------------------------------------------------ 10: the actual outcome
  await step("10. the outcome is the ACTUAL orbit about the Moon: recomputed here from the state vectors", async () => {
    await until(async () => (await page.getByTestId("mission-status").first().innerText()) === "Completed", "the UI to show the mission completed");
    const state = await stateOf(uid);
    const done = state.spaceflight.missions[0];
    assert.equal(done.status, "completed");
    assert.equal(done.phase, "orbit verified");
    assert.ok(done.checks.length >= 5 && done.checks.every((c) => c.ok), JSON.stringify(done.checks));
    assert.deepEqual(done.agreement.map((a) => a.role), ["departure", "insertion"]);
    for (const a of done.agreement) assert.ok(a.ok && a.positionDifferenceM < 1 && a.velocityDifferenceMPerS < 1e-3, JSON.stringify(a));
    assert.deepEqual(state.spaceflight.maneuvers.map((m) => m.status), ["executed", "executed"]);
    // independent of the mission bookkeeping: specific energy and angular momentum about the Moon from the raw state
    const c = craftIn(state, "Lunar Explorer");
    const moon = state.bodies.find((b) => b.id === "body-moon");
    const r = sub(c.positionM, moon.positionM);
    const v = sub(c.velocityMPerS, moon.velocityMPerS);
    const mu = G * (moon.massKg + c.massKg);
    const energy = 0.5 * norm(v) ** 2 - mu / norm(r);
    const h = norm({ x: r.y * v.z - r.z * v.y, y: r.z * v.x - r.x * v.z, z: r.x * v.y - r.y * v.x });
    const a = -mu / (2 * energy);
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
    const periapsisKm = (a * (1 - e) - MOON_RADIUS_M) / 1000;
    const apoapsisKm = (a * (1 + e) - MOON_RADIUS_M) / 1000;
    log(`actual lunar orbit from the state vectors: ${periapsisKm.toFixed(2)} x ${apoapsisKm.toFixed(2)} km, e = ${e.toExponential(2)}; plan vs simulation at insertion ${done.agreement[1].positionDifferenceM.toExponential(2)} m`);
    assert.ok(energy < 0, "bound to the Moon");
    assert.ok(periapsisKm > 95 && apoapsisKm < 105, `orbit ${periapsisKm} x ${apoapsisKm} km`);
    assert.equal(c.spacecraft.orbit.referenceBodyId, "body-moon");
    // the UI says the same
    await page.getByTestId("spacecraft-row").filter({ hasText: "Lunar Explorer" }).click();
    await until(async () => /orbiting Moon/.test(await readout("spacecraft-kind")), "the inspector to show the lunar orbit");
    assert.match(await readout("readout-periapsis"), /^(99\.\d+|100(\.\d+)?) km$/);
    assert.ok(await page.getByTestId("mission-outcome").isVisible());
    assert.equal(await page.getByTestId("mission-checks").locator('li[data-ok="false"]').count(), 0);
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await page.waitForTimeout(2500);
    await shot("06-lunar-orbit-verified");
    // the recorded history holds the path actually flown
    const history = (await j(`/api/v1/universes/${uid}/history?bodyIds=${c.id}&limit=5000`)).body;
    assert.ok(history.samples.length > 1000, `history samples: ${history.samples.length}`);
  });

  // ------------------------------------------------------------------ collision policy
  await step("collision policy: a spacecraft sent into the Earth stops the simulation at the contact, and says so", async () => {
    await page.getByRole("button", { name: "New spacecraft…" }).click();
    await page.fill("#craft-name", "Impactor");
    await page.getByTestId("orbit-preview").waitFor();
    await page.getByRole("button", { name: "Create spacecraft" }).click();
    const impactor = await until(async () => craftIn(await stateOf(uid), "Impactor"), "the impactor");
    await page.fill("#mnv-prograde", "-400");
    await page.getByTestId("maneuver-preview").waitFor();
    await until(async () => /impact/.test(await page.getByTestId("maneuver-preview").innerText()), "the impact warning in the preview");
    await page.getByRole("button", { name: "Burn now" }).click();
    await until(async () => craftIn(await stateOf(uid), "Impactor").spacecraft.orbit.regime === "suborbital", "the suborbital trajectory");
    await page.getByRole("button", { name: "Play" }).click();
    const halted = await until(async () => { const s = await stateOf(uid); return s.halt && s; }, "the simulation to stop at the contact", 120000, 500);
    assert.deepEqual(halted.halt.bodyIds, [impactor.id, "body-earth"]);
    assert.equal(halted.bodies.length, 4, "nothing was merged or removed");
    const c = halted.bodies.find((b) => b.id === impactor.id);
    const earth = halted.bodies.find((b) => b.id === "body-earth");
    const distance = norm(sub(c.positionM, earth.positionM));
    assert.ok(Math.abs(distance - (earth.radiusM + c.radiusM)) < 1, `the spacecraft is at the surface: ${distance - earth.radiusM} m above the centre distance of contact`);
    await page.getByTestId("halt-banner").waitFor();
    assert.match(await page.getByTestId("halt-banner").innerText(), /Simulation stopped: collision[\s\S]*Impactor and Earth collided/);
    await until(async () => (await page.getByRole("button", { name: "Play" }).isDisabled()), "Play to be disabled while halted");
    const epoch = (await active()).activationEpoch;
    const refused = await j(`/api/v1/universes/${uid}/step?activationEpoch=${epoch}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dtS: 10 }) });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "simulation_halted");
    const events = (await j(`/api/v1/universes/${uid}/events`)).body.events;
    assert.equal(events[events.length - 1].type, "contact");
    // the lunar mission is untouched by another spacecraft's crash
    assert.equal(halted.spaceflight.missions[0].status, "completed");
    await shot("07-collision-stops-the-simulation");
  });

  assert.deepEqual(consoleErrors, [], `browser errors: ${consoleErrors.join(" | ")}`);
  const unexpected = failedRequests.filter((x) => !/^409 POST .*\/step$/.test(x));
  assert.deepEqual(unexpected, [], `failed requests: ${unexpected.join(" | ")}`);
  console.log("ALL PASSED");
} catch (e) {
  failed = true;
  console.error("FAILED:", e && e.stack ? e.stack : e);
  if (page) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, "failure.png") }).catch(() => {});
    console.error("page text:", (await page.locator("body").innerText().catch(() => "")).slice(0, 1500));
  }
  for (const p of procs) if (p.exited !== undefined) console.error("server output:", p.output().slice(-1500));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) p.kill();
  process.exit(failed ? 1 : 0);
}
