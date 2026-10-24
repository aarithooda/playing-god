import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "./api/client";
import { UniverseCanvas, type FocusRequest } from "./components/canvas/UniverseCanvas";
import { ControlPanel } from "./components/ui/ControlPanel";
import { FirstUse } from "./components/ui/FirstUse";
import { Sidebar } from "./components/ui/Sidebar";
import { ViewLegend } from "./components/ui/ViewLegend";
import { ViewPanel } from "./components/ui/ViewPanel";
import { Wordmark } from "./components/ui/Wordmark";
import { enforceNarrow, insets, toggleSidebar, type SidebarState } from "./components/ui/layout";
import { btnStyle, panelStyle } from "./components/ui/styles";
import { theme } from "./components/ui/theme";
import { BodyInspector } from "./components/ui/BodyInspector";
import { DiagnosticsPanel } from "./components/ui/DiagnosticsPanel";
import { EventTimeline } from "./components/ui/EventTimeline";
import { SimulationHistory } from "./components/ui/SimulationHistory";
import { PlacementHint } from "./components/ui/PlacementHint";
import { UndoNotice } from "./components/ui/UndoNotice";
import {
  fitTransform,
  DEFAULT_METERS_PER_UNIT,
  displayRadiusUnits,
  toPhysicsPosition,
  type RenderTransform,
} from "./sim/renderTransform";
import { useSimulation } from "./sim/useSimulation";
import { toSceneBody } from "./sim/viewModel";
import { axisHalfLengthMeters } from "./sim/axes";
import { gridCell } from "./sim/gridScale";
import { useUndoableCreate } from "./sim/useUndoableCreate";

// Same-origin: in dev the Vite proxy forwards /api and /healthz to the backend unchanged.
const client = createApiClient();

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

export default function App() {
  const simulation = useSimulation(client);
  const { sim, loadStatus } = simulation;

  const [selectedBodyId, setSelectedBodyId] = useState<string | undefined>(undefined);
  const [transform, setTransform] = useState<RenderTransform>({ metersPerUnit: DEFAULT_METERS_PER_UNIT });
  const [frameEpoch, setFrameEpoch] = useState(0);
  const [focus, setFocus] = useState<FocusRequest | undefined>(undefined);
  // The body the camera is currently following (cleared when the camera lets go of it).
  const [focusedBodyId, setFocusedBodyId] = useState<string | undefined>(undefined);
  // Controls (right) are open on first use; History and diagnostics (left) are tucked away.
  const [sidebars, setSidebars] = useState<SidebarState>({ left: false, right: true });
  const windowWidth = useWindowWidth();
  // Shrinking the window with both sidebars open would leave almost no free area.
  useEffect(() => setSidebars((s) => enforceNarrow(s, windowWidth)), [windowWidth]);
  const [openCreateRequest, setOpenCreateRequest] = useState(0);
  // The user's own view choices; both start off. Placement may show the grid without changing them.
  const [showAxes, setShowAxes] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [placementRadiusM, setPlacementRadiusM] = useState(6.371e6);
  const [pickedPosition, setPickedPosition] = useState<{ position: { x: number; y: number; z: number }; nonce: number } | undefined>();
  const [placementPreview, setPlacementPreview] = useState<[number, number, number] | null>(null);
  // When set, the next layout change keeps the display scale (and camera) if it leaves this many bodies.
  const preserveSceneScaleRef = useRef<{ expectedBodyCount: number; layoutEpoch: number } | null>(null);

  const bodies = sim?.bodies ?? [];

  // Refit the display scale when the set of bodies changes through a user action (load, create,
  // delete, reset). The scale is then held fixed while the simulation runs.
  const { layoutEpoch } = simulation;
  useEffect(() => {
    if (layoutEpoch === 0) return;
    const preserve = preserveSceneScaleRef.current;
    if (preserve && layoutEpoch > preserve.layoutEpoch) {
      preserveSceneScaleRef.current = null;
      if (bodies.length === preserve.expectedBodyCount) return;
    }
    setTransform(fitTransform(bodies.map((b) => b.positionM)));
    setFrameEpoch((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEpoch]);

  // Selection follows authoritative state: a deleted or merged-away body simply stops being selected.
  const selectedBody = bodies.find((b) => b.id === selectedBodyId) ?? null;
  useEffect(() => {
    if (selectedBodyId && !selectedBody && sim) setSelectedBodyId(undefined);
  }, [selectedBodyId, selectedBody, sim]);
  const closeInspector = useCallback(() => setSelectedBodyId(undefined), []);

  const sceneBodies = useMemo(() => bodies.map((b) => toSceneBody(b, transform)), [bodies, transform]);

  const focusBody = (id: string) => {
    const body = bodies.find((b) => b.id === id);
    if (body) {
      const sceneBody = toSceneBody(body, transform);
      setFocus((f) => ({
        nonce: (f?.nonce ?? 0) + 1,
        bodyId: id,
        position: sceneBody.position,
        radius: sceneBody.radius,
      }));
      setFocusedBodyId(id);
    }
  };

  const confirmPlacement = useCallback((scenePosition: [number, number, number]) => {
    preserveSceneScaleRef.current = { expectedBodyCount: bodies.length + 1, layoutEpoch };
    setPickedPosition((current) => ({
      position: toPhysicsPosition(scenePosition, transform),
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setPlacementMode(false);
  }, [bodies.length, layoutEpoch, transform]);
  const cancelPlacement = useCallback(() => setPlacementMode(false), []);
  const placementCreateResult = useCallback((success: boolean) => {
    if (!success) preserveSceneScaleRef.current = null;
  }, []);

  // Undo deletes the body just created; keep the display scale so the camera does not jump.
  const deleteForUndo = useCallback(
    async (id: string) => {
      preserveSceneScaleRef.current = { expectedBodyCount: bodies.length - 1, layoutEpoch };
      const result = await simulation.deleteBody(id);
      if (!result.ok) preserveSceneScaleRef.current = null;
      return result;
    },
    [bodies.length, layoutEpoch, simulation.deleteBody],
  );
  const created = useUndoableCreate({
    createBody: simulation.createBody,
    deleteBody: deleteForUndo,
    simulationTimeS: sim?.simulationTimeS,
  });

  const ready = loadStatus === "ready";

  const setSidebar = (side: keyof SidebarState) => (open: boolean) =>
    setSidebars((s) => toggleSidebar(s, side, open, windowWidth));
  const selectBody = (id: string) => {
    setSelectedBodyId(id);
    setSidebars((s) => (s.right ? s : toggleSidebar(s, "right", true, windowWidth)));
  };
  const addFirstBody = () => {
    setSidebars((s) => (s.right ? s : toggleSidebar(s, "right", true, windowWidth)));
    setOpenCreateRequest((n) => n + 1);
  };
  const edge = insets(sidebars);
  // Placing a body shows the grid to help position it; the stored choice is never overwritten.
  const gridVisible = showGrid || placementMode;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", backgroundColor: theme.bg }}>
      {/* 3D scene: full-bleed under the sidebars, centred in the free area between them. */}
      <UniverseCanvas
        bodies={sceneBodies}
        selectedBodyId={selectedBodyId}
        onSelectBody={selectBody}
        onFocusBody={focusBody}
        onClearSelection={closeInspector}
        frameEpoch={frameEpoch}
        focus={focus}
        onFocusRelease={() => setFocusedBodyId(undefined)}
        placementMode={placementMode}
        placementRadius={displayRadiusUnits(Number.isFinite(placementRadiusM) && placementRadiusM > 0 ? placementRadiusM : 6.371e6)}
        onPlacementConfirm={confirmPlacement}
        onPlacementCancel={cancelPlacement}
        onPlacementPreview={setPlacementPreview}
        leftInset={edge.left}
        rightInset={edge.right}
        transform={transform}
        showAxes={showAxes}
        showGrid={gridVisible}
      />

      {/* Free area: everything that floats over the scene is laid out between the sidebars. */}
      <div
        data-testid="free-area"
        style={{
          position: "absolute", top: 0, bottom: 0, left: edge.left, right: edge.right,
          pointerEvents: "none", transition: "left 0.25s ease-in-out, right 0.25s ease-in-out",
        }}
      >
        <div style={{ position: "absolute", top: 16, left: 16, right: 16, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          <Wordmark health={simulation.health} />
          <ViewLegend
            showAxes={showAxes}
            showGrid={gridVisible}
            cellMeters={gridCell(transform.metersPerUnit).cellMeters}
            axisHalfLengthM={axisHalfLengthMeters(transform)}
          />
          {simulation.actionError && (
            <p role="alert" style={{ ...panelStyle, margin: 0, padding: "6px 10px", fontSize: 12, borderColor: theme.danger }}>
              {simulation.actionError}{" "}
              <button onClick={simulation.dismissError} style={{ ...btnStyle, fontSize: 11, padding: "2px 6px" }}>dismiss</button>
            </p>
          )}
        </div>

        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "auto" }}>
          {loadStatus === "loading" && (
            <p role="status" style={{ ...panelStyle, margin: 0 }}>
              {simulation.health === "ok" ? "Backend reachable. Loading the simulation state…" : "Waiting for the backend…"}
            </p>
          )}
          {loadStatus === "error" && (
            <div role="alert" style={{ ...panelStyle, borderColor: theme.danger, textAlign: "center", maxWidth: 360 }}>
              <p style={{ margin: "0 0 6px 0" }}>Cannot load the simulation: {simulation.loadError}</p>
              {simulation.health === "ok" && (
                <p style={{ margin: "0 0 10px 0", fontSize: 12, color: theme.textMuted }}>
                  The backend answers health checks, but the simulation itself did not respond. A step may still be
                  running or stuck; the simulation state on the backend is unchanged. Retry, or restart the backend
                  (restarting clears the in-memory universe).
                </p>
              )}
              <button style={btnStyle} onClick={() => void simulation.reload()}>Retry</button>
            </div>
          )}
          {ready && bodies.length === 0 && !placementMode && <FirstUse onAddFirstBody={addFirstBody} />}
        </div>

        {placementMode && <PlacementHint position={placementPreview ? toPhysicsPosition(placementPreview, transform) : null} />}
        {!placementMode && created.undoable && (
          <UndoNotice bodyName={created.undoable.name} onUndo={() => void created.undo()} onDismiss={created.dismiss} />
        )}
      </div>

      <Sidebar side="left" title="History & diagnostics" open={sidebars.left} onToggle={setSidebar("left")}>
        <SimulationHistory history={simulation.trajectoryHistory} />
        <EventTimeline events={simulation.events} bodyName={simulation.bodyName} />
        <DiagnosticsPanel loadStatus={loadStatus} diagnostics={sim?.diagnostics ?? null} issue={sim?.diagnosticsIssue ?? null} />
      </Sidebar>

      <Sidebar side="right" title="Controls" open={sidebars.right} onToggle={setSidebar("right")}>
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
          onCreate={created.create}
          placementMode={placementMode}
          onPlacementModeChange={setPlacementMode}
          pickedPosition={pickedPosition}
          onPlacementRadiusChange={setPlacementRadiusM}
          onPlacementCreateResult={placementCreateResult}
          openCreateRequest={openCreateRequest}
        />
        <ViewPanel
          axes={showAxes}
          grid={showGrid}
          gridShownForPlacement={placementMode}
          onAxesChange={setShowAxes}
          onGridChange={setShowGrid}
        />
        <BodyInspector
          body={selectedBody}
          focused={selectedBody !== null && selectedBody.id === focusedBodyId}
          onSave={simulation.updateBody}
          onDelete={simulation.deleteBody}
          onFocus={focusBody}
          onClose={closeInspector}
        />
      </Sidebar>
    </div>
  );
}
