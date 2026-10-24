// Stubs for the Simulation Lab's universe layer, so browser specs written against the single-simulation API keep
// working. The app first loads the universe list (and presets, catalogue and Orbit Lab systems), then talks to
// `/api/v1/universes/{id}/...`. `legacyPath` maps those scoped URLs back to the old paths the specs already handle
// (`/api/v1/simulation/state`, `/api/v1/events`, `/api/v1/simulation/step`, `/api/v1/bodies`).

export const UNIVERSE_ID = "uni-e2e";

/** `/api/v1/universes/uni-e2e/state` -> `/api/v1/simulation/state`; other paths are returned unchanged. */
export function legacyPath(pathname: string): string {
  const m = pathname.match(/^\/api\/v1\/universes\/[^/]+\/(.+)$/);
  if (!m) return pathname;
  const rest = m[1];
  if (rest === "state" || rest === "step" || rest === "reset") return `/api/v1/simulation/${rest}`;
  return `/api/v1/${rest}`;
}

/** JSON for the universe-layer routes the app loads on start-up, or undefined when the path is not one of them. */
export function universeLayer(pathname: string, method: string, bodyCount: number): unknown | undefined {
  if (method !== "GET") return undefined;
  if (pathname === "/api/v1/universes") {
    return {
      universes: [
        {
          id: UNIVERSE_ID, name: "Sandbox", role: "sandbox", presetId: null, experimentId: null, active: true,
          simulationTimeS: 0, bodyCount, revision: 0, status: "idle", lastFailure: null, createdAtIso: "2026-01-01T00:00:00Z", epochLabel: null, historyMode: "step",
        },
      ],
      activeUniverseId: UNIVERSE_ID,
      activationEpoch: 1,
    };
  }
  if (pathname === `/api/v1/universes/${UNIVERSE_ID}/history`) {
    return {
      universeId: UNIVERSE_ID, mode: "step", sampleIntervalS: null, generation: 0, firstIndex: 0, nextIndex: 0,
      droppedBefore: 0, truncated: false, samples: [], bodies: {},
    };
  }
  if (pathname === `/api/v1/universes/${UNIVERSE_ID}/provenance`) {
    return { sourceKind: "sandbox", controlled: true, firstUncontrolledAtS: null, audit: [] };
  }
  if (pathname === `/api/v1/universes/${UNIVERSE_ID}/snapshots`) return { snapshots: [] };
  if (pathname === "/api/v1/presets") return { presets: [] };
  if (pathname === "/api/v1/catalogue") return { notes: [], entries: [] };
  if (pathname === "/api/v1/orbit-lab/systems") return { systems: [] };
  if (pathname === "/api/v1/orbit-lab/experiments") return { experiments: [] };
  return undefined;
}
