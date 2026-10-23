import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import { UniverseCanvas, type FocusRequest } from "./components/canvas/UniverseCanvas";
import { ControlPanel } from "./components/ui/ControlPanel";
import { BodyInspector } from "./components/ui/BodyInspector";
import { EventTimeline } from "./components/ui/EventTimeline";
import {
  fitTransform,
  DEFAULT_METERS_PER_UNIT,
  displayRadiusUnits,
  toPhysicsPosition,
  type RenderTransform,
} from "./sim/renderTransform";
import { useSimulation, type Health } from "./sim/useSimulation";
import { toSceneBody } from "./sim/viewModel";

// Same-origin: in dev the Vite proxy forwards /api and /healthz to the backend unchanged.
const client = createApiClient();

const HEALTH_LABEL: Record<Health, string> = { unknown: "checking…", ok: "connected", down: "unreachable" };
const HEALTH_COLOR: Record<Health, string> = { unknown: "#aaa", ok: "#44dd66", down: "#ff5555" };

export default function App() {
  const simulation = useSimulation(client);
  const { sim, loadStatus } = simulation;

  const [selectedBodyId, setSelectedBodyId] = useState<string | undefined>(undefined);
  const [transform, setTransform] = useState<RenderTransform>({ metersPerUnit: DEFAULT_METERS_PER_UNIT });
  const [frameEpoch, setFrameEpoch] = useState(0);
  const [focus, setFocus] = useState<FocusRequest | undefined>(undefined);
  const [placementMode, setPlacementMode] = useState(false);
  const [placementRadiusM, setPlacementRadiusM] = useState(6.371e6);
  const [pickedPosition, setPickedPosition] = useState<{ position: { x: number; y: number; z: number }; nonce: number } | undefined>();

  const bodies = sim?.bodies ?? [];

  // Refit the display scale when the set of bodies changes through a user action (load, create,
  // delete, reset). The scale is then held fixed while the simulation runs.
  const { layoutEpoch } = simulation;
  useEffect(() => {
    if (layoutEpoch === 0) return;
    setTransform(fitTransform(bodies.map((b) => b.positionM)));
    setFrameEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEpoch]);

  // Selection follows authoritative state: a deleted or merged-away body simply stops being selected.
  const selectedBody = bodies.find((b) => b.id === selectedBodyId) ?? null;
  useEffect(() => {
    if (selectedBodyId && !selectedBody && sim) setSelectedBodyId(undefined);
  }, [selectedBodyId, selectedBody, sim]);

  const sceneBodies = useMemo(() => bodies.map((b) => toSceneBody(b, transform)), [bodies, transform]);

  const focusBody = (id: string) => {
    const body = bodies.find((b) => b.id === id);
    if (body) {
      const sceneBody = toSceneBody(body, transform);
      setFocus((f) => ({
        nonce: (f?.nonce ?? 0) + 1,
        position: sceneBody.position,
        radius: sceneBody.radius,
      }));
    }
  };

  const confirmPlacement = useCallback((scenePosition: [number, number, number]) => {
    setPickedPosition((current) => ({
      position: toPhysicsPosition(scenePosition, transform),
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setPlacementMode(false);
  }, [transform]);
  const cancelPlacement = useCallback(() => setPlacementMode(false), []);

  const ready = loadStatus === "ready";

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", backgroundColor: "#000" }}>
      {/* 3D Scene */}
      <UniverseCanvas
        bodies={sceneBodies}
        selectedBodyId={selectedBodyId}
        onSelectBody={setSelectedBodyId}
        onFocusBody={focusBody}
        frameEpoch={frameEpoch}
        focus={focus}
        placementMode={placementMode}
        placementRadius={displayRadiusUnits(Number.isFinite(placementRadiusM) && placementRadiusM > 0 ? placementRadiusM : 6.371e6)}
        onPlacementConfirm={confirmPlacement}
        onPlacementCancel={cancelPlacement}
      />

      {/* UI Overlay Wrapper with Safe Zone */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        padding: "30px", // Safe zone margin
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between"
      }}>
        {/* Top Section: Header and side panels */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>

          {/* Left: Timeline */}
          <div style={{ pointerEvents: "auto" }}>
            <EventTimeline events={simulation.events} bodyName={simulation.bodyName} />
          </div>

          {/* Center: Header */}
          <div style={{
            pointerEvents: "auto",
            background: "rgba(0,0,0,0.6)",
            padding: "15px 30px",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(10px)",
            textAlign: "center"
          }}>
            <h1 style={{ margin: 0, fontSize: "24px", letterSpacing: "2px" }}>PLAYING GOD</h1>
            <p style={{ margin: "5px 0 0 0", fontSize: "14px", opacity: 0.7 }}>Gravitational universe sandbox</p>
            <p data-testid="backend-status" style={{ fontSize: "11px", marginTop: "5px", color: HEALTH_COLOR[simulation.health] }}>
              Backend: {HEALTH_LABEL[simulation.health]}
            </p>
            {simulation.actionError && (
              <p role="alert" style={{ fontSize: "11px", color: "#ff7777", margin: "5px 0 0 0" }}>
                {simulation.actionError}{" "}
                <button onClick={simulation.dismissError} style={{ fontSize: "10px" }}>dismiss</button>
              </p>
            )}
          </div>

          {/* Right: Controls */}
          <div style={{ pointerEvents: "auto" }}>
            <ControlPanel
              bodies={bodies}
              playing={simulation.playing}
              stepping={simulation.stepping}
              canRun={bodies.length > 0}
              disabled={!ready}
              simulationTimeS={sim ? sim.simulationTimeS : null}
              speedExp={simulation.speedExp}
              stepSeconds={simulation.stepSeconds}
              onSpeedChange={simulation.setSpeedExp}
              onPlay={simulation.play}
              onPause={simulation.pause}
              onStep={() => void simulation.stepOnce()}
              onReset={() => void simulation.reset()}
              onFit={() => {
                setTransform(fitTransform(bodies.map((b) => b.positionM)));
                setFrameEpoch((n) => n + 1);
              }}
              onCreate={simulation.createBody}
              placementMode={placementMode}
              onPlacementModeChange={setPlacementMode}
              pickedPosition={pickedPosition}
              onPlacementRadiusChange={setPlacementRadiusM}
            />
          </div>
        </div>

        {/* Center status: loading / error / empty */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "auto" }}>
          {loadStatus === "loading" && <p role="status">Connecting to the simulation backend…</p>}
          {loadStatus === "error" && (
            <div role="alert" style={{ background: "rgba(0,0,0,0.8)", padding: "20px", borderRadius: "8px", border: "1px solid #a33" }}>
              <p style={{ margin: "0 0 10px 0" }}>Cannot load the simulation: {simulation.loadError}</p>
              <button onClick={() => void simulation.reload()}>Retry</button>
            </div>
          )}
          {ready && bodies.length === 0 && (
            <p role="status" style={{ opacity: 0.7 }}>The universe is empty. Use "Add body…" to create one.</p>
          )}
        </div>

        {/* Bottom Section: Inspector */}
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <div style={{ pointerEvents: "auto" }}>
            <BodyInspector
              body={selectedBody}
              onSave={simulation.updateBody}
              onDelete={simulation.deleteBody}
              onFocus={focusBody}
              onClose={() => setSelectedBodyId(undefined)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
