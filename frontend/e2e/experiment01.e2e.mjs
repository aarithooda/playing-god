// Automated browser journey for Experiment 01 (closes T-010 for the critical path). Not part of vitest or CI by default:
//     cd frontend && npm run e2e
// It starts its OWN backend (default port 8011) and Vite (default 5183): never the usual :8000 backend. It drives a real
// Chromium through playwright-core and asserts on API state and DOM, not on sleeps: every wait polls a condition.
// Browser: E2E_CHROMIUM=<path to chrome/chromium>, else Playwright's own Chromium, else an installed Google Chrome or the
// newest Chromium in the Playwright cache. Python: E2E_PYTHON, else ../.venv, else `python`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const root = resolve(frontend, "..");
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8011);
const VITE_PORT = Number(process.env.E2E_VITE_PORT ?? 5183);
if (BACKEND_PORT === 8000) throw new Error("refusing to use port 8000 (the developer's own backend)");
const API = `http://127.0.0.1:${BACKEND_PORT}`;
const APP = `http://localhost:${VITE_PORT}`;
const DAY = 86400;

const procs = [];
const log = (m) => console.log(`  ${m}`);
const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  steps.push(name);
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
  procs.push(p);
  return p;
}

// Candidates in order: E2E_CHROMIUM, Playwright's own Chromium, the newest Chromium in the Playwright cache, an installed
// Google Chrome, an installed Microsoft Edge. The first one that actually launches is used (a cached copy can be
// unlaunchable, for example when its folder is virtualised by the OS).
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

// Counts blue-dominant pixels (path colour #3b82f6, including the muted dashed reference path, which is that colour at 55 % opacity) in a screenshot of the scene area, to see that
// paths were drawn. (The WebGL canvas cannot be read back directly, so the page's own screenshot is decoded in the page.)
async function blueish(page) {
  const png = (await page.screenshot({ clip: { x: 40, y: 0, width: 1500 - 40 - 340, height: 900 } })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 90 && d[i + 2] > d[i] + 45 && d[i + 2] > d[i + 1] + 15) n += 1;
    return n;
  }, png);
}

// Reads the scene until two consecutive readings agree (the scene renders continuously and eases while it settles).
async function stableBlue(page) {
  let prev = -1;
  return until(async () => {
    const n = await blueish(page);
    const ok = n === prev;
    prev = n;
    return ok ? Math.max(n, 1) : false;
  }, "the scene to settle");
}

let browser;
let page;
try {
  console.log(`Experiment 01 browser journey (backend :${BACKEND_PORT}, app :${VITE_PORT})`);
  spawnServer(pythonPath(), ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT), "--log-level", "warning"], { cwd: root });
  spawnServer(process.execPath, [join(frontend, "node_modules", "vite", "bin", "vite.js"), "--port", String(VITE_PORT), "--strictPort"], {
    cwd: frontend,
    env: { ...process.env, BACKEND_URL: API },
  });
  await until(async () => (await fetch(`${API}/healthz`)).ok, "backend health");
  await until(async () => (await fetch(`${APP}/healthz`)).ok, "vite proxy to the backend");

  browser = await launchBrowser();
  page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/WebGL|GPU stall|Context Lost|Failed to load resource/i.test(m.text()) && consoleErrors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  await page.goto(APP);

  const exp = { id: null, base: null, mod: null };
  const state = async (uid) => (await j(`/api/v1/universes/${uid}/state`)).body;
  const stepsUi = async (uid, n) => {
    for (let k = 0; k < n; k += 1) {
      const before = (await state(uid)).revision;
      await page.getByRole("button", { name: "Step Forward" }).click();
      await until(async () => (await state(uid)).revision > before, "the step to commit");
    }
  };
  // 1e6 s per step (about 11.6 days): a few clicks cover a visible arc
  await page.getByLabel(/Sim Speed/).fill("6");

  await step("start Experiment 01: baseline created and active", async () => {
    await page.getByRole("button", { name: "Start Experiment 01" }).click();
    await page.getByTestId("run-badge").getByText("Orbit Lab · BASELINE", { exact: true }).waitFor();
    const list = (await j("/api/v1/orbit-lab/experiments")).body.experiments;
    assert.equal(list.length, 1);
    exp.id = list[0].id;
    exp.base = list[0].baselineUniverseId;
    assert.equal(list[0].modifiedUniverseId, null);
    const u = (await j("/api/v1/universes")).body;
    assert.equal(u.activeUniverseId, exp.base);
    assert.match(await page.getByTestId("initial-speed").innerText(), /m\/s \(\d+\.\d{3} km\/s\)/);
  });

  await step("the x1.10 preview appears before anything is created, then exactly one run is created", async () => {
    await page.getByLabel("×1.10").check();
    assert.match(await page.getByTestId("velocity-preview").innerText(), /Nothing has been created yet/);
    assert.equal((await j(`/api/v1/orbit-lab/experiments/${exp.id}`)).body.modifiedUniverseId, null);
    await page.getByRole("button", { name: "Create modified run" }).click();
    await page.getByTestId("modification-record").waitFor();
    const e = (await j(`/api/v1/orbit-lab/experiments/${exp.id}`)).body;
    exp.mod = e.modifiedUniverseId;
    assert.ok(exp.mod);
    assert.equal(e.modification.speedFactor, 1.1);
    assert.equal((await j("/api/v1/universes")).body.activeUniverseId, exp.base, "creating a run must not switch universes");
    await page.getByText(/Exactly one difference: velocityMPerS of body-earth/).waitFor();
  });

  await step("the modified velocity is exactly 1.10 x the baseline's (direction kept)", async () => {
    const m = (await j(`/api/v1/orbit-lab/experiments/${exp.id}`)).body.modification;
    const [a, b] = [m.originalVelocityMPerS, m.modifiedVelocityMPerS];
    assert.deepEqual(b, a.map((c) => 1.1 * c));
    const bs = await state(exp.base);
    const ms = await state(exp.mod);
    const vb = bs.bodies.find((x) => x.id === "body-earth").velocityMPerS;
    const vm = ms.bodies.find((x) => x.id === "body-earth").velocityMPerS;
    assert.deepEqual([vm.x, vm.y, vm.z], [1.1 * vb.x, 1.1 * vb.y, 1.1 * vb.z]);
    assert.equal(bs.simulationTimeS, 0);
    assert.equal(ms.simulationTimeS, 0);
  });

  let pixelsOnePath = 0;
  await step("advancing the baseline leaves the modified run untouched (isolation)", async () => {
    const modBefore = JSON.stringify(await state(exp.mod));
    await stepsUi(exp.base, 5);
    const bs = await state(exp.base);
    assert.equal(bs.simulationTimeS, 5e6);
    assert.equal(JSON.stringify(await state(exp.mod)), modBefore);
    const hist = (await j(`/api/v1/universes/${exp.mod}/history`)).body;
    assert.equal(hist.nextIndex, 1, "the modified run recorded nothing while inactive");
    // one path is on screen now (the baseline's own, solid): remember how much path-coloured ink that is
    pixelsOnePath = await stableBlue(page);
    log(`path-coloured pixels with one path in the scene: ${pixelsOnePath}`);
    assert.ok(pixelsOnePath > 50, "the baseline's own path is drawn");
  });

  await step("switching to the modified run shows its own badge, time and state", async () => {
    await page.getByRole("button", { name: "Go to modified run" }).click();
    await page.getByTestId("run-badge").getByText("Orbit Lab · MODIFIED ×1.10 speed", { exact: true }).waitFor();
    assert.equal((await j("/api/v1/universes")).body.activeUniverseId, exp.mod);
    await page.getByText(/Sim time: 0 s/).waitFor();
    const baseAt = JSON.stringify(await state(exp.base));
    await stepsUi(exp.mod, 5);
    assert.equal((await state(exp.mod)).simulationTimeS, 5e6);
    assert.equal(JSON.stringify(await state(exp.base)), baseAt, "stepping the modified run must not change the baseline");
  });

  await step("the modified trajectory differs as ×1.10 predicts (larger orbit, growing separation)", async () => {
    const c = (await j(`/api/v1/orbit-lab/experiments/${exp.id}/comparison?bodyId=body-earth`)).body;
    assert.equal(c.commonSampleCount, 58); // daily samples k = 0 ... 57 up to t = 5e6 s (57.87 d)
    assert.deepEqual(c.timesS, Array.from({ length: 58 }, (_, k) => k * DAY));
    assert.ok(c.separationM[0] < 1e-6, "the runs start from the same positions");
    for (let i = 1; i < c.separationM.length; i += 1) assert.ok(c.separationM[i] > c.separationM[i - 1], "separation grows");
    assert.ok(c.separationM.at(-1) > 1e9);
    const rel = (p, s) => Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]);
    const sunB = (await state(exp.base)).bodies.find((x) => x.id === "body-sun").positionM;
    const sunM = (await state(exp.mod)).bodies.find((x) => x.id === "body-sun").positionM;
    const eB = (await state(exp.base)).bodies.find((x) => x.id === "body-earth").positionM;
    const eM = (await state(exp.mod)).bodies.find((x) => x.id === "body-earth").positionM;
    const rb = rel([eB.x, eB.y, eB.z], [sunB.x, sunB.y, sunB.z]);
    const rm = rel([eM.x, eM.y, eM.z], [sunM.x, sunM.y, sunM.z]);
    assert.ok(rm > rb, `the faster planet is farther from the Sun (${rm} vs ${rb})`);
    await page.getByTestId("comparison-times").waitFor();
    assert.match(await page.getByTestId("comparison-times").innerText(), /Baseline t = .* Modified t = /);
  });

  await step("both trajectories are drawn in the scene (solid and dashed)", async () => {
    // same view as when one path was measured (the baseline active, at the same time), now with the modified run's
    // dashed reference path as well: it adds ink that was not there before
    await page.getByRole("button", { name: "Go to baseline" }).click();
    await page.getByTestId("run-badge").getByText("Orbit Lab · BASELINE", { exact: true }).waitFor();
    const two = await until(async () => {
      const n = await stableBlue(page);
      globalThis.__pixels = { onePath: pixelsOnePath, bothPaths: n };
      return n >= pixelsOnePath + 40 ? n : false;
    }, "the reference path to add pixels");
    log(`path-coloured pixels: ${pixelsOnePath} with one path, ${two} with both`);
    await page.getByRole("button", { name: "Go to modified run" }).click();
    await page.getByTestId("run-badge").getByText("Orbit Lab · MODIFIED ×1.10 speed", { exact: true }).waitFor();
  });

  await step("snapshot, restore and reset act on the modified run only", async () => {
    const baseAt = JSON.stringify(await state(exp.base));
    await page.getByLabel("Snapshot name").fill("e2e");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByTestId("snapshot-item").waitFor();
    const gen0 = (await j(`/api/v1/universes/${exp.mod}/history?limit=1`)).body.generation;
    await stepsUi(exp.mod, 2);
    assert.equal((await state(exp.mod)).simulationTimeS, 7e6);
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    assert.equal((await state(exp.mod)).simulationTimeS, 7e6, "the first press only asks for confirmation");
    await page.getByRole("button", { name: /Restore \(discards the current state\)/ }).click();
    await until(async () => (await state(exp.mod)).simulationTimeS === 5e6, "the restore to commit");
    assert.notEqual((await j(`/api/v1/universes/${exp.mod}/history?limit=1`)).body.generation, gen0, "restore starts a new history generation");
    await page.getByRole("button", { name: "Reset Universe" }).click();
    await page.getByRole("button", { name: /Confirm reset/ }).click();
    await until(async () => (await state(exp.mod)).simulationTimeS === 0, "the reset to commit");
    assert.equal(JSON.stringify(await state(exp.base)), baseAt, "restore and reset never touch the baseline");
    assert.equal((await state(exp.base)).simulationTimeS, 5e6);
  });

  await step("a physical edit marks the modified run uncontrolled; reset makes it controlled again", async () => {
    const epoch = (await j("/api/v1/universes")).body.activationEpoch;
    const r = await j(`/api/v1/universes/${exp.mod}/bodies/body-earth?activationEpoch=${epoch}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ massKg: 6.5e24 }),
    });
    assert.equal(r.status, 200);
    await page.getByRole("button", { name: "Step Forward" }).click(); // the UI re-reads provenance when the revision moves
    await page.getByTestId("run-uncontrolled").waitFor();
    assert.match(await page.getByTestId("run-uncontrolled").innerText(), /^Uncontrolled since t = /);
    await page.getByRole("button", { name: "Reset Universe" }).click();
    await page.getByRole("button", { name: /Confirm reset/ }).click();
    await page.getByTestId("run-uncontrolled").waitFor({ state: "detached" });
    const prov = (await j(`/api/v1/universes/${exp.mod}/provenance`)).body;
    assert.equal(prov.controlled, true);
    assert.ok(prov.audit.length >= 1, "the audit record is kept");
  });

  await step("the baseline refuses edits through the API and the UI", async () => {
    await page.getByRole("button", { name: "Go to baseline" }).click();
    await page.getByTestId("run-badge").getByText("Orbit Lab · BASELINE", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Add body…" }).isDisabled(), true);
    const epoch = (await j("/api/v1/universes")).body.activationEpoch;
    const r = await j(`/api/v1/universes/${exp.base}/bodies/body-earth?activationEpoch=${epoch}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ massKg: 1 }),
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "baseline_protected");
  });

  await step("deleting the experiment from the sandbox removes both runs", async () => {
    await page.getByRole("button", { name: /Switch to Sandbox/ }).click();
    await page.getByRole("button", { name: "Delete experiment" }).click();
    await page.getByRole("button", { name: "Delete both runs" }).click();
    await until(async () => (await j("/api/v1/orbit-lab/experiments")).body.experiments.length === 0, "the experiment to disappear");
    assert.deepEqual((await j("/api/v1/universes")).body.universes.map((u) => u.id), ["uni-default"]);
  });

  // The browser's own favicon request (the app has no favicon) shows up only as a console line, never as a page response;
  // any failing API request would be listed here.
  assert.deepEqual(failedRequests, [], `the page made failing requests: ${failedRequests.join(" | ")}`);
  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
  console.log(`\nALL ${steps.length} STEPS PASSED`);
} catch (e) {
  console.error("\nFAILED:", e && e.stack ? e.stack : e);
  if (globalThis.__pixels) console.error(`path-coloured pixels: ${JSON.stringify(globalThis.__pixels)}`);
  if (page) {
    const shot = join(tmpdir(), "experiment01-e2e-failure.png");
    await page.screenshot({ path: shot }).then(() => console.error(`screenshot of the failing page: ${shot}`), () => {});
  }
  for (const p of procs) console.error(`--- server output ---\n${p.output().slice(-1500)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const p of procs) p.kill();
}
