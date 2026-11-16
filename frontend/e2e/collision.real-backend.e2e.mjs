// Real-backend collision journey (NOT stubbed). Not part of vitest or CI by default:
//     cd frontend && npm run e2e:collision
// Starts its OWN backend (default :8012) and Vite (default :5184) - never the developer's :8000 backend - and drives a real Chromium through
// the real UI against the real API. The collision policy of every universe is STOP ON CONTACT (owner decision D-071): a controlled
// rock-on-rock impact in the default sandbox universe is advanced with the UI's Step Forward button, and the script checks that the
// backend stops at the instant of first contact and reports it; that the stopped state is consistent (both bodies, their masses,
// touching, energy and momentum as before); that nothing was merged or broken and no collision record, fragment or debris exists;
// that the UI shows the stop and blocks Play; that the contact can be resolved and the simulation continues; that a second universe
// is isolated; and that Reset returns to the initial state.
// (Until D-071 this journey drove the provisional collision-outcome engine: outcome, record, visual description, replay. That
// engine is dormant; its behaviour is still pinned by the backend tests marked `dormant_collisions`.)
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
// Opens a tool of the left rail (its accessible name may carry a count, e.g. "Events (1)") unless it is already open.
async function openTool(page, label) {
  const button = page.getByRole("button", { name: new RegExp(`^${label}( \\(\\d+\\))?$`) });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  await page.locator('[data-testid="sidebar-left"][data-open="true"]').waitFor();
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
  let contact; // the contact event
  let halted; // state at the halt
  let ids;
  const stateOf = async (uid) => (await j(`/api/v1/universes/${uid}/state`)).body;
  const eventsOf = async (uid) => (await j(`/api/v1/universes/${uid}/events`)).body.events;
  const energyOf = (s) => s.diagnostics.kineticEnergyJ + s.diagnostics.potentialEnergyJ;

  await step("the default sandbox universe stops on contact; bodies with materials are created over the real API", async () => {
    const summary = (await j(`/api/v1/universes/${UID}`)).body;
    assert.equal(summary.collisionMode, "stop-on-contact");
    const t = await mutate(`/api/v1/universes/${UID}/bodies`, body("Target", mT, rT, [0, 0, 0], [0, 0, 0]));
    assert.equal(t.status, 201, JSON.stringify(t.body));
    const p = await mutate(`/api/v1/universes/${UID}/bodies`, body("Projectile", mP, rP, [d0, 0, 0], [-vStart, 0, 0]));
    assert.equal(p.status, 201, JSON.stringify(p.body));
    ids = { target: t.body.id, projectile: p.body.id };
    before = await stateOf(UID);
    assert.equal(before.bodies.length, 2);
    assert.deepEqual(await eventsOf(UID), []);
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
    await openTool(page, "Events"); // the events list is one tool of the left rail
  });

  await step("Step Forward (10^3.5 s each, at most 3) advances through the real API and the backend stops at the contact", async () => {
    await page.getByLabel(/Sim Speed/).fill("3.5"); // about 3162 s per step; contact is expected after about 2500 s
    for (let k = 0; k < 3 && !contact; k += 1) {
      const rev0 = (await stateOf(UID)).revision;
      await page.getByRole("button", { name: "Step Forward" }).click();
      await until(async () => (await stateOf(UID)).revision > rev0, "the step to commit");
      contact = (await eventsOf(UID)).find((e) => e.type === "contact");
    }
    assert.ok(contact, "a contact event within 3 UI steps");
    assert.deepEqual([...contact.bodyIds].sort(), [ids.target, ids.projectile].sort());
    assert.equal(contact.involvesSpacecraft, false);
    assert.equal(contact.refined, true, "the state was put back to the instant of first contact");
    // impact speed by energy conservation from the start (the approach was set up for 3 x the mutual escape speed at contact)
    assert.ok(Math.abs(contact.relativeSpeedMPerS - vC) / vC < 1e-6, `impact speed ${contact.relativeSpeedMPerS} vs ${vC}`);
    log(`contact at t = ${contact.simulationTimeS.toFixed(3)} s, relative speed ${contact.relativeSpeedMPerS.toFixed(1)} m/s, id ${contact.id}`);
  });

  await step("the stopped state is the state at first contact: both bodies, touching, mass, momentum and energy as before", async () => {
    halted = await stateOf(UID);
    assert.equal(halted.simulationTimeS, contact.simulationTimeS, "time stopped at the contact, not at the end of the requested step");
    assert.equal(halted.halt.eventId, contact.id);
    assert.equal(halted.halt.reason, "collision");
    assert.deepEqual(halted.bodies.map((b) => [b.id, b.name, b.massKg, b.radiusM]), before.bodies.map((b) => [b.id, b.name, b.massKg, b.radiusM]));
    const [t, p] = [ids.target, ids.projectile].map((id) => halted.bodies.find((b) => b.id === id));
    const sep = Math.hypot(p.positionM.x - t.positionM.x, p.positionM.y - t.positionM.y, p.positionM.z - t.positionM.z);
    assert.ok(Math.abs(sep - R) / R < 1e-8, `separation ${sep} vs contact distance ${R}: touching, not overlapping`);
    assert.equal(halted.diagnostics.totalMassKg, before.diagnostics.totalMassKg);
    assert.ok(Math.abs(energyOf(halted) - energyOf(before)) / Math.abs(energyOf(before)) < 1e-9, "nothing was dissipated");
    const px = (s) => s.bodies.reduce((a, b) => a + b.massKg * b.velocityMPerS.x, 0);
    assert.ok(Math.abs(px(halted) - px(before)) / Math.abs(px(before)) < 1e-12, "momentum unchanged");
    assert.deepEqual(halted.bodies.map((b) => b.material && b.material.profileId), ["silicate-rock", "silicate-rock"]);
  });

  await step("nothing was merged or broken: no merger or collision event, no record, no fragment, no debris", async () => {
    assert.deepEqual((await eventsOf(UID)).map((e) => e.type), ["contact"]);
    const list = (await j(`/api/v1/universes/${UID}/collisions`)).body;
    assert.equal(list.total, 0);
    assert.deepEqual(list.records, []);
    assert.equal((await j(`/api/v1/universes/${UID}/collisions/${contact.id}`)).status, 404);
    for (const b of halted.bodies) for (const k of ["representation", "originEventId", "debris", "fragmentClass"]) assert.ok(!(k in b), `${b.name} has no ${k}`);
    assert.ok(!("escaped" in halted.diagnostics));
    assert.equal(await page.getByTestId("collision-effect-label").count(), 0, "no collision effect is drawn");
  });

  await step("the UI says so: a stop banner naming the bodies, the contact in Events, Play and Step Forward blocked", async () => {
    const banner = page.getByTestId("halt-banner");
    await banner.waitFor();
    const text = await banner.innerText();
    assert.match(text, /Simulation stopped: collision/);
    assert.ok(text.includes("Target") && text.includes("Projectile"), text);
    await page.getByText(/The simulation stopped there; nothing was merged or broken/).first().waitFor();
    await until(async () => (await page.getByRole("button", { name: "Play" }).isDisabled()), "Play to be disabled while stopped");
    assert.equal(await page.getByRole("button", { name: "Step Forward" }).isDisabled(), true);
    assert.match(await page.getByRole("button", { name: "Play" }).getAttribute("title"), /collision/i);
  });

  await step("the API refuses to advance while the contact is unresolved, and changes nothing", async () => {
    const snapshotBefore = JSON.stringify(await stateOf(UID));
    const r = await mutate(`/api/v1/universes/${UID}/step`, { dtS: 100 });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.code, "simulation_halted");
    assert.equal(JSON.stringify(await stateOf(UID)), snapshotBefore, "state (incl. revision) unchanged by the refused step");
  });

  await step("resolving the contact in the UI (Show it, Delete) clears the stop and the simulation continues", async () => {
    // the banner's button selects one of the two bodies; the inspector deletes it (with its confirmation)
    await page.getByTestId("halt-banner").getByRole("button", { name: "Show it" }).click();
    const inspector = page.getByTestId("sidebar-right");
    await inspector.getByRole("button", { name: /^Delete(?! body)/ }).click();
    await inspector.getByRole("button", { name: "Delete body" }).click();
    await page.getByTestId("halt-banner").waitFor({ state: "detached" });
    await until(async () => (await page.getByRole("button", { name: "Step Forward" }).isEnabled()), "Step Forward to be enabled again");
    const s0 = await stateOf(UID);
    assert.ok(!("halt" in s0));
    assert.equal(s0.bodies.length, 1, "exactly the body the user deleted is gone");
    const kept = s0.bodies[0];
    assert.ok([ids.target, ids.projectile].includes(kept.id));
    for (let k = 0; k < 3; k += 1) {
      const rev = (await stateOf(UID)).revision;
      await page.getByRole("button", { name: "Step Forward" }).click();
      await until(async () => (await stateOf(UID)).revision > rev, "the step to commit");
    }
    const s1 = await stateOf(UID);
    assert.ok(s1.simulationTimeS > s0.simulationTimeS + 2500);
    assert.equal(s1.bodies.length, 1);
    assert.equal(s1.diagnostics.totalMassKg, kept.massKg);
    assert.deepEqual((await eventsOf(UID)).map((e) => e.type), ["contact"], "the log keeps the contact; nothing new was reported");
  });

  await step("a second universe is isolated and unaffected", async () => {
    const u = await post("/api/v1/universes", { name: "Free flight", source: { kind: "empty" }, activate: true });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    assert.equal(u.body.collisionMode, "stop-on-contact");
    const id = u.body.id;
    await mutate(`/api/v1/universes/${id}/bodies`, body("A", 1e22, 1e6, [0, 0, 0], [0, 0, 0]));
    await mutate(`/api/v1/universes/${id}/bodies`, body("B", 1e20, 1e5, [1e9, 0, 0], [0, 1000, 0]));
    const r = await mutate(`/api/v1/universes/${id}/step`, { dtS: 1000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.events ?? [], []);
    assert.ok(!("halt" in r.body));
    assert.deepEqual(await eventsOf(id), []);
    assert.equal((await eventsOf(UID)).length, 1, "the first universe's contact is untouched");
    assert.equal((await stateOf(id)).bodies.length, 2);
    const back = await post(`/api/v1/universes/${UID}/activate`); // only the active universe accepts mutations; the default one is needed again below
    assert.equal(back.status, 200, JSON.stringify(back.body));
  });

  await step("Reset empties the universe as documented (time 0, no bodies, no stop, no events)", async () => {
    const r = await mutate(`/api/v1/universes/${UID}/reset`);
    assert.ok(r.status === 200 || r.status === 204, `reset status ${r.status}`);
    const s = await stateOf(UID);
    assert.equal(s.simulationTimeS, 0);
    assert.equal(s.bodies.length, 0);
    assert.ok(!("halt" in s));
    assert.deepEqual(await eventsOf(UID), []);
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
