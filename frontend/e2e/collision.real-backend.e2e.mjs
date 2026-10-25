// Real-backend collision journey (NOT stubbed). Not part of vitest or CI by default:
//     cd frontend && npm run e2e:collision
// Starts its OWN backend (default :8012) and Vite (default :5184) - never the developer's :8000 backend - and drives a real Chromium through
// the real UI against the real API: a controlled rock-on-rock impact in the default sandbox universe (collision mode outcome-v1) is advanced
// with the UI's Step Forward button; the script then checks the backend's collision event, record, visual description, conservation numbers
// and diagnostics over HTTP, that the UI lists the event and opens the inspector, that a dry-run replay does not change the universe, that the
// simulation continues, that a collision-free second universe is isolated, and that Reset returns to the initial state.
// Software acceptance only: the outcome models are provisional (D-059); nothing here claims an outcome is physically correct.
// Browser: E2E_CHROMIUM=<path>, else Playwright's own, else an installed Chrome/Edge. Python: E2E_PYTHON, else ../.venv, else `python`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const root = resolve(frontend, "..");
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8012);
const VITE_PORT = Number(process.env.E2E_VITE_PORT ?? 5184);
if (BACKEND_PORT === 8000) throw new Error("refusing to use port 8000 (the developer's own backend)");
const API = `http://127.0.0.1:${BACKEND_PORT}`;
const APP = `http://localhost:${VITE_PORT}`;
const UID = "uni-default";
const G = 6.6743e-11;

const procs = [];
const log = (m) => console.log(`  ${m}`);
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`PASS ${name} (${Date.now() - t0} ms)`);
};

async function until(fn, what, timeoutMs = 30000) {
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
    await new Promise((r) => setTimeout(r, 50));
  }
}
const j = async (path, init) => {
  const r = await fetch(API + path, init);
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const post = (path, body) => j(path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
// Mutations of one universe echo the current activation epoch (API contract); the universe list is the source for it.
const mutate = async (path, body) => {
  const epoch = (await j("/api/v1/universes")).body.activationEpoch;
  return post(`${path}${path.includes("?") ? "&" : "?"}activationEpoch=${epoch}`, body);
};

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
      for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
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
      const b = await chromium.launch({
        ...candidate,
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      });
      log(`browser: ${candidate.executablePath ?? candidate.channel} (${b.version()})`);
      return b;
    } catch (e) {
      errors.push(`${candidate.executablePath ?? candidate.channel}: ${String(e.message).split(/\r?\n/)[0]}`);
    }
  }
  throw new Error(`no launchable Chromium/Chrome/Edge found; set E2E_CHROMIUM. Tried: ${errors.join(" | ")}`);
}

const body = (name, m, r, x, v) => ({
  name, massKg: m, radiusM: r, positionM: { x: x[0], y: x[1], z: x[2] }, velocityMPerS: { x: v[0], y: v[1], z: v[2] },
  colorHex: "#aa8866", material: { profileId: "silicate-rock" },
});

let browser;
let page;
let failed = false;
try {
  console.log(`Collision real-backend journey (backend :${BACKEND_PORT}, app :${VITE_PORT})`);
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

  // Controlled impact: target at rest, projectile aimed at it at 3 x the mutual escape speed at contact (head-on, b = 0).
  const mT = 1e22, mP = 5e21, rT = 1e6;
  const rP = rT * (mP / mT) ** (1 / 3);
  const R = rT + rP;
  const vEsc = Math.sqrt((2 * G * (mT + mP)) / R);
  const d0 = 4 * R;
  const vC = 3 * vEsc;
  const vStart = Math.sqrt(vC ** 2 - 2 * G * (mT + mP) * (1 / R - 1 / d0));

  let before; // state before the impact
  let col; // the collision event
  let effectShown;
  const stateOf = async (uid) => (await j(`/api/v1/universes/${uid}/state`)).body;
  const eventsOf = async (uid) => (await j(`/api/v1/universes/${uid}/events`)).body.events;

  await step("the default sandbox universe is in outcome-v1 mode: bodies with materials are created over the real API", async () => {
    const t = await mutate(`/api/v1/universes/${UID}/bodies`, body("Target", mT, rT, [0, 0, 0], [0, 0, 0]));
    assert.equal(t.status, 201, JSON.stringify(t.body));
    const p = await mutate(`/api/v1/universes/${UID}/bodies`, body("Projectile", mP, rP, [d0, 0, 0], [-vStart, 0, 0]));
    assert.equal(p.status, 201, JSON.stringify(p.body));
    before = await stateOf(UID);
    assert.equal(before.bodies.length, 2);
    assert.deepEqual(before.events ?? [], []);
  });

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/WebGL|GPU stall|Context Lost|Failed to load resource/i.test(m.text()) && consoleErrors.push(m.text()));
  if (process.env.E2E_DEBUG) page.on("response", async (r) => r.url().includes("/api/") && console.log("  net", r.status(), r.request().method(), r.url().replace(APP, ""), (await r.text().catch(() => "")).slice(0, 200)));
  page.on("response", (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  await page.goto(APP);

  await step("the UI loads the universe from the real backend (connected, Step Forward enabled, a canvas mounted)", async () => {
    await page.getByText("Backend: connected").waitFor();
    await until(async () => (await page.getByRole("button", { name: "Step Forward" }).isEnabled()), "Step Forward to be enabled");
    await page.locator("canvas").first().waitFor();
    await page.getByRole("button", { name: /^Expand Body catalogue & history/ }).click(); // the left sidebar (events, diagnostics) starts collapsed
  });

  await step("Step Forward (10^3.5 s each, at most 3) advances through the real API and the backend resolves the collision", async () => {
    await page.getByLabel(/Sim Speed/).fill("3.5"); // about 3162 s per step; contact is expected after about 2500 s
    // the frontend fetches the visual description from the real API and draws the effect: its labelled marker must appear (it is short-lived)
    effectShown = page.getByTestId("collision-effect-label").first().waitFor({ state: "attached", timeout: 15000 }).then(() => true, () => false);
    for (let k = 0; k < 3 && !col; k += 1) {
      const rev0 = (await stateOf(UID)).revision;
      await page.getByRole("button", { name: "Step Forward" }).click();
      await until(async () => (await stateOf(UID)).revision > rev0, "the step to commit");
      col = (await eventsOf(UID)).find((e) => e.type === "collision");
    }
    assert.ok(col, `a collision event within 3 UI steps`);
    assert.equal(col.hasVisual, true);
    assert.ok(Math.abs(col.massResidualRel) <= 1e-12, `mass residual ${col.massResidualRel}`);
    assert.ok(col.momentumResidualRel <= 1e-9, `momentum residual ${col.momentumResidualRel}`);
    assert.equal(await effectShown, true, "the collision effect marker was rendered from the backend's visual description");
    log(`outcome=${col.outcome} impact=${col.impactSpeedMPerS.toFixed(0)} m/s angle=${col.impactAngleDeg.toFixed(2)} deg ids=${col.id}`);
  });

  let after;
  await step("resulting body state, ids and diagnostics are consistent with the event and conserve mass", async () => {
    after = await stateOf(UID);
    const ids = new Set(after.bodies.map((b) => b.id));
    for (const id of col.removedBodyIds) assert.ok(!ids.has(id), `removed ${id} is gone`);
    for (const id of [...col.survivingBodyIds, ...col.createdBodyIds]) assert.ok(ids.has(id), `${id} exists`);
    const mass = after.bodies.reduce((s, b) => s + b.massKg, 0);
    assert.ok(Math.abs(mass - (mT + mP)) / (mT + mP) < 1e-12, `body mass total ${mass}`);
    assert.ok(Math.abs(after.diagnostics.totalMassKg - (mT + mP)) / (mT + mP) < 1e-12);
    assert.ok(after.simulationTimeS >= col.simulationTimeS - 1e-9);
  });

  await step("the collision record, replay-free detail and visual description are served by the real API", async () => {
    const list = (await j(`/api/v1/universes/${UID}/collisions`)).body;
    assert.equal(list.total, 1);
    assert.equal(list.records[0].eventId, col.id);
    const detail = (await j(`/api/v1/universes/${UID}/collisions/${col.id}`)).body;
    assert.equal(detail.record.result ? true : false, true);
    const visual = (await j(`/api/v1/universes/${UID}/collisions/${col.id}/visual`)).body;
    assert.equal(visual.eventId, col.id);
    assert.ok(visual.phases.length > 0);
    assert.ok(visual.visualOnly.every((v) => !("massKg" in v)));
  });

  await step("the UI lists the collision event and opens the inspector with the provisional caveat", async () => {
    await page.getByRole("button", { name: `Inspect collision ${col.id}` }).click();
    const insp = page.getByTestId("collision-inspector");
    await insp.waitFor();
    await insp.getByText(/provisional/i).first().waitFor();
    await until(async () => (await page.getByTestId("collision-inspector").innerText()).includes(col.outcome.replace(/_/g, " ")) || (await page.getByTestId("collision-inspector").innerText()).includes(col.outcome), "the record text");
  });

  await step("the dry-run replay is requested from the UI and does not change the universe", async () => {
    const snapshotBefore = JSON.stringify(await stateOf(UID));
    const replayResponse = page.waitForResponse((r) => r.url().includes(`/collisions/${col.id}/replay`) && r.request().method() === "POST");
    await page.getByTestId("collision-inspector").getByRole("button", { name: /replay/i }).click();
    const r = await replayResponse;
    assert.equal(r.status(), 200);
    const report = await r.json();
    assert.equal(report.mutatesState, false);
    assert.equal(report.reproduced, true, JSON.stringify(report.differingFields));
    assert.equal(JSON.stringify(await stateOf(UID)), snapshotBefore, "state (incl. revision) unchanged by the replay");
  });

  await step("the simulation continues after the collision", async () => {
    await page.getByTestId("collision-inspector").getByRole("button", { name: "Close collision inspector" }).click();
    const s0 = await stateOf(UID);
    for (let k = 0; k < 3; k += 1) {
      const rev = (await stateOf(UID)).revision;
      await page.getByRole("button", { name: "Step Forward" }).click();
      await until(async () => (await stateOf(UID)).revision > rev, "the step to commit");
    }
    const s1 = await stateOf(UID);
    assert.ok(s1.simulationTimeS > s0.simulationTimeS + 2500);
    assert.ok(Math.abs(s1.diagnostics.totalMassKg - s0.diagnostics.totalMassKg) / s0.diagnostics.totalMassKg < 1e-12);
  });

  await step("a collision-free second universe is isolated and unaffected", async () => {
    const u = await post("/api/v1/universes", { name: "Free flight", source: { kind: "empty" }, activate: true });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    const id = u.body.id;
    await mutate(`/api/v1/universes/${id}/bodies`, body("A", 1e22, 1e6, [0, 0, 0], [0, 0, 0]));
    await mutate(`/api/v1/universes/${id}/bodies`, body("B", 1e20, 1e5, [1e9, 0, 0], [0, 1000, 0]));
    const r = await mutate(`/api/v1/universes/${id}/step`, { dtS: 1000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual((r.body.events ?? []).filter((e) => e.type !== undefined), []);
    assert.equal((await j(`/api/v1/universes/${id}/collisions`)).body.total, 0);
    assert.equal((await j(`/api/v1/universes/${UID}/collisions`)).body.total, 1, "the first universe's record is untouched");
    assert.equal((await stateOf(id)).bodies.length, 2);
    const back = await post(`/api/v1/universes/${UID}/activate`); // only the active universe accepts mutations; the default one is needed again below
    assert.equal(back.status, 200, JSON.stringify(back.body));
  });

  await step("Reset empties the universe as documented (time 0, no bodies) and clears the collision record", async () => {
    const r = await mutate(`/api/v1/universes/${UID}/reset`);
    assert.ok(r.status === 200 || r.status === 204, `reset status ${r.status}`);
    const s = await stateOf(UID);
    assert.equal(s.simulationTimeS, 0);
    assert.equal(s.bodies.length, 0);
    assert.equal((await j(`/api/v1/universes/${UID}/collisions`)).body.total, 0);
  });

  assert.deepEqual(consoleErrors, [], `browser errors: ${consoleErrors.join(" | ")}`);
  const unexpected = failedRequests.filter((x) => !/\/collisions\/.+\/visual/.test(x));
  assert.deepEqual(unexpected, [], `failed requests: ${unexpected.join(" | ")}`);
  console.log("ALL PASSED");
} catch (e) {
  failed = true;
  console.error("FAILED:", e && e.stack ? e.stack : e);
  if (page) {
    await page.screenshot({ path: join(frontend, "test-results", "collision-real-backend-failure.png") }).catch(() => {});
    console.error("page text:", (await page.locator("body").innerText().catch(() => "")).slice(0, 1500));
  }
  for (const p of procs) if (p.exited !== undefined) console.error("server output:", p.output().slice(-1500));
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const p of procs) p.kill();
  process.exit(failed ? 1 : 0);
}
