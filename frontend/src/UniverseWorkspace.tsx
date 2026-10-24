// Everything that belongs to ONE universe: its simulation hook, selection, focus, display scale, placement, panels and
// scene. App mounts exactly one workspace, keyed by `universeId:activationEpoch`, so switching universes (or the
// backend reporting a new epoch) discards every client-side task and cache of the old one: a late response from the
// old universe finds its hook unmounted and is dropped, and selection/focus/placement can never leak across.
// Layout choices that are not about a universe (sidebars, axes, grid) live in App and survive a switch.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ApiError } from "./api/errors";
import type { ApiClient, ScopedClient } from "./api/client";
import type { CatalogueDto, CatalogueEntryDto, UniverseSummaryDto } from "./api/types";
import { UniverseCanvas, type FocusRequest } from "./components/canvas/UniverseCanvas";
import { BodyInspector } from "./components/ui/BodyInspector";
import { CataloguePanel } from "./components/ui/CataloguePanel";
import { ComparisonPanel } from "./components/ui/ComparisonPanel";
import { OrbitLabPanel } from "./components/ui/OrbitLabPanel";
import { RunBadge } from "./components/ui/RunBadge";
import { ControlPanel } from "./components/ui/ControlPanel";
import { DiagnosticsPanel } from "./components/ui/DiagnosticsPanel";
import { EventTimeline } from "./components/ui/EventTimeline";
import { HistoryTimeline } from "./components/ui/HistoryTimeline";
import { FirstUse } from "./components/ui/FirstUse";
import { PlacementHint } from "./components/ui/PlacementHint";
import { Sidebar } from "./components/ui/Sidebar";
import { SnapshotPanel } from "./components/ui/SnapshotPanel";
import { UndoNotice } from "./components/ui/UndoNotice";
import { ViewLegend } from "./components/ui/ViewLegend";
import { ViewPanel } from "./components/ui/ViewPanel";
import { Wordmark } from "./components/ui/Wordmark";
import { insets, toggleSidebar, type SidebarState } from "./components/ui/layout";
import { btnStyle, panelStyle } from "./components/ui/styles";
import { theme } from "./components/ui/theme";
import { axisHalfLengthMeters } from "./sim/axes";
import { gridCell } from "./sim/gridScale";
import { DEFAULT_METERS_PER_UNIT, displayRadiusUnits, fitTransform, toPhysicsPosition, type RenderTransform } from "./sim/renderTransform";
import { isScopeInvalid, useSimulation } from "./sim/useSimulation";
import { useUndoableCreate } from "./sim/useUndoableCreate";
import { useComparison, type OrbitLabApi } from "./sim/useOrbitLab";
import { useProvenance } from "./sim/useProvenance";
import { pathsNote, pathTargets } from "./sim/history/pathSelection";
import { frameAt, trajectoryOf } from "./sim/history/historyModel";
import { useHistory } from "./sim/history/useHistory";
import { useHistoryNavigation } from "./sim/history/useHistoryNavigation";
import { toSceneBody, type DisplayBody } from "./sim/viewModel";

export interface UniverseWorkspaceProps {
  client: ScopedClient;
  universe: UniverseSummaryDto | undefined;
  /** The universe switcher and preset picker, built by App (they act on the list of universes, not on this one). */
  universePanel: ReactNode;
  /** Notices about the universes themselves (for example "universes were lost"). */
  notices: ReactNode;
  /** The sourced body catalogue (empty until loaded; the app works without it). */
  catalogue: CatalogueDto;
  /** Orbit Lab: the experiments and their actions (they span two universes, so App owns them). */
  orbitLab: OrbitLabApi;
  /** For the read-only Orbit Lab queries and for reading the other run's history. */
  apiClient: ApiClient;
  /** Switching universes is blocked (a write is pending). */
  switchDisabled: boolean;
  onActivateUniverse: (universeId: string) => void;
  /** The simulation speed is a user preference that survives a universe switch, so App owns it. */
  speedExp: number;
  onSpeedExpChange: (exp: number) => void;
  sidebars: SidebarState;
  setSidebars: Dispatch<SetStateAction<SidebarState>>;
  windowWidth: number;
  showAxes: boolean;
  showGrid: boolean;
  onAxesChange: (on: boolean) => void;
  onGridChange: (on: boolean) => void;
  onScopeInvalid: (error: ApiError) => void;
  onBusyWriteChange: (pending: boolean) => void;
}

const BASELINE_LOCK = "The Orbit Lab baseline is an immutable reference: its bodies cannot be added, edited or deleted.";

export function UniverseWorkspace(props: UniverseWorkspaceProps) {
  const { client, universe, sidebars, setSidebars, windowWidth, showAxes, showGrid } = props;
  const simulation = useSimulation(client, {
    onScopeInvalid: props.onScopeInvalid,
    initialSpeedExp: props.speedExp,
    onSpeedExpChange: props.onSpeedExpChange,
  });
  const { sim, loadStatus } = simulation;

  const [selectedBodyId, setSelectedBodyId] = useState<string | undefined>(undefined);
  const [transform, setTransform] = useState<RenderTransform>({ metersPerUnit: DEFAULT_METERS_PER_UNIT });
  const [frameEpoch, setFrameEpoch] = useState(0);
  const [focus, setFocus] = useState<FocusRequest | undefined>(undefined);
  // The body the camera is currently following (cleared when the camera lets go of it).
  const [focusedBodyId, setFocusedBodyId] = useState<string | undefined>(undefined);
  const [openCreateRequest, setOpenCreateRequest] = useState(0);
  const [placementMode, setPlacementMode] = useState(false);
  const [placementRadiusM, setPlacementRadiusM] = useState(6.371e6);
  const [pickedPosition, setPickedPosition] = useState<{ position: { x: number; y: number; z: number }; nonce: number } | undefined>();
  const [placementPreview, setPlacementPreview] = useState<[number, number, number] | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [showPaths, setShowPaths] = useState(false);

  // Orbit Lab: the experiment this universe belongs to, its other run, and the provenance of the active run.
  const { orbitLab, apiClient } = props;
  const experiment = orbitLab.experimentById(universe?.experimentId);
  const isRun = universe?.role === "baseline" || universe?.role === "modified";
  useEffect(() => {
    if (universe?.experimentId && !experiment) void orbitLab.refresh(); // an experiment the list does not know yet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe?.experimentId, experiment === undefined]);
  const provenance = useProvenance(client, simulation.revision, isRun);
  const hasRun = !!experiment && experiment.modifiedUniverseId !== null;
  const otherRunId = !experiment || !hasRun ? null : client.scope.universeId === experiment.baselineUniverseId ? experiment.modifiedUniverseId : experiment.baselineUniverseId;
  const comparisonBody = experiment?.system.selectableBodyIds[0] ?? null;
  const comparison = useComparison(
    apiClient, hasRun && isRun ? experiment!.id : null, comparisonBody,
    `${simulation.revision ?? "-"}:${experiment?.modifiedUniverseId ?? "-"}:${experiment?.modification?.createdAtIso ?? "-"}`,
  );
  const [catalogueRequest, setCatalogueRequest] = useState<{ entry: CatalogueEntryDto; nonce: number } | undefined>();
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

  // Recorded history (UI-2). The backend recorded it; this only displays it. While a recorded sample is viewed, the
  // simulation is paused and the scene shows that sample through the very same display path as live bodies.
  const history = useHistory(client, simulation.revision);
  // The other run's history is its own cache (never merged with this one): it is drawn as the dashed reference path.
  const referenceClient = useMemo(
    () => apiClient.scoped({ universeId: otherRunId ?? "uni-none", activationEpoch: client.scope.activationEpoch }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiClient, otherRunId, client.scope.activationEpoch],
  );
  const referenceHistory = useHistory(referenceClient, otherRunId ? 0 : null);
  const nav = useHistoryNavigation(history.cache, { onEnter: simulation.pause });
  const viewingHistory = nav.mode === "history";
  const frame = viewingHistory && history.cache && nav.position !== null ? frameAt(history.cache, nav.position) : null;
  const displayBodies = useMemo<DisplayBody[]>(
    () =>
      frame
        ? frame.bodies.map((b) => ({
            id: b.id, name: b.meta.name, colorHex: b.meta.colorHex, kind: b.meta.kind === "star" ? "star" : "planet",
            positionM: b.positionM, radiusM: b.meta.radiusM,
          }))
        : bodies,
    [frame, bodies],
  );
  const sceneBodies = useMemo(() => displayBodies.map((b) => toSceneBody(b, transform)), [displayBodies, transform]);

  // "Show paths": the selected body's recorded path, or every body's when there are at most 20 (UI-0 trajectories).
  const pathIds = pathTargets(displayBodies.map((b) => b.id), selectedBodyId);
  const trajectories = useMemo(
    () => {
      const out = showPaths && history.cache ? pathIds.map((id) => trajectoryOf(history.cache!, id, "active")) : [];
      if (hasRun && comparisonBody) {
        // Experiment 01 always overlays both runs' paths of the selected planet: the active run solid, the other dashed.
        if (history.cache && !out.some((t) => t.bodyId === comparisonBody)) out.push(trajectoryOf(history.cache, comparisonBody, "active"));
        if (referenceHistory.cache && referenceHistory.cache.universeId === otherRunId) out.push(trajectoryOf(referenceHistory.cache, comparisonBody, "reference"));
      }
      return out.filter((t) => t.samples.length > 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showPaths, history.cache, referenceHistory.cache, hasRun, comparisonBody, otherRunId, pathIds.join("|")],
  );
  useEffect(() => {
    if (viewingHistory) setPlacementMode(false);
  }, [viewingHistory]);

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

  // A switch is blocked while any non-step write of this universe is in flight (steps are rolled back by the backend).
  const { onBusyWriteChange } = props;
  const writePending = simulation.writePending || snapshotBusy;
  useEffect(() => {
    onBusyWriteChange(writePending);
    return () => onBusyWriteChange(false);
  }, [writePending, onBusyWriteChange]);

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
  const addFromCatalogue = (entry: CatalogueEntryDto) => {
    setSidebars((s) => (s.right ? s : toggleSidebar(s, "right", true, windowWidth)));
    setCatalogueRequest((r) => ({ entry, nonce: (r?.nonce ?? 0) + 1 }));
  };
  const edge = insets(sidebars);
  // Placing a body shows the grid to help position it; the stored choice is never overwritten.
  const gridVisible = showGrid || placementMode;

  const snapshotBlockedReason =
    universe?.role === "baseline"
      ? "The Orbit Lab baseline is an immutable reference: it cannot be snapshotted or restored."
      : undefined;

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
        trajectories={trajectories}
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
          {universe && (
            <div data-testid="universe-badge" style={{ ...panelStyle, padding: "4px 10px", fontSize: 12 }}>
              {universe.name}
            </div>
          )}
          {(universe?.role === "baseline" || universe?.role === "modified") && (
            <RunBadge
              role={universe.role}
              modification={experiment?.modification ?? null}
              controlled={provenance ? provenance.controlled : true}
              firstUncontrolledAtS={provenance ? provenance.firstUncontrolledAtS : null}
            />
          )}
          {props.notices}
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
        <EventTimeline events={simulation.events} bodyName={simulation.bodyName} />
        <HistoryTimeline
          cache={history.cache}
          status={history.status}
          error={history.error}
          nav={nav}
          liveTimeS={sim ? sim.simulationTimeS : null}
          events={simulation.events}
          onRefresh={() => void history.refresh()}
        />
        <DiagnosticsPanel loadStatus={loadStatus} diagnostics={sim?.diagnostics ?? null} issue={sim?.diagnosticsIssue ?? null} historyView={viewingHistory} />
      </Sidebar>

      <Sidebar side="right" title="Controls" open={sidebars.right} onToggle={setSidebar("right")}>
        {props.universePanel}
        <OrbitLabPanel
          systems={orbitLab.systems}
          systemsLoaded={orbitLab.systemsLoaded}
          experiment={experiment}
          experiments={orbitLab.experiments}
          activeUniverseId={client.scope.universeId}
          busy={orbitLab.busy}
          error={orbitLab.error}
          switchDisabled={props.switchDisabled}
          onStart={(systemId) => void orbitLab.startExperiment(systemId)}
          onCreateRun={(experimentId, factor, replace) => void orbitLab.createModifiedRun(experimentId, factor, replace)}
          onActivate={props.onActivateUniverse}
          onDelete={(experimentId) => void orbitLab.deleteExperiment(experimentId)}
          onDismissError={orbitLab.dismissError}
          getInitialDifferences={apiClient.getInitialDifferences}
        />
        {hasRun && isRun && <ComparisonPanel comparison={comparison.comparison} error={comparison.error} onRefresh={() => void comparison.refresh()} />}
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
          onPlay={() => {
            if (viewingHistory) nav.returnToLive(); // Play goes back to the live state first
            simulation.play();
          }}
          historyView={viewingHistory}
          addBlockedReason={universe?.role === "baseline" ? BASELINE_LOCK : undefined}
          onPause={simulation.pause}
          onStep={() => void simulation.stepOnce()}
          onReset={() => void simulation.reset()}
          confirmReset
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
          catalogueRequest={catalogueRequest}
        />
        <CataloguePanel entries={props.catalogue.entries} notes={props.catalogue.notes} onAdd={addFromCatalogue} disabled={!ready} />
        <ViewPanel
          axes={showAxes}
          grid={showGrid}
          gridShownForPlacement={placementMode}
          onAxesChange={props.onAxesChange}
          onGridChange={props.onGridChange}
          paths={showPaths}
          onPathsChange={setShowPaths}
          pathsNote={pathsNote(showPaths, displayBodies.length, selectedBodyId)}
        />
        <SnapshotPanel
          client={client}
          disabled={!ready || viewingHistory}
          blockedReason={snapshotBlockedReason}
          onBeforeRestore={simulation.pause}
          onRestored={() => void simulation.reload()}
          onBusyChange={setSnapshotBusy}
          onError={(e) => isScopeInvalid(e) && props.onScopeInvalid(e)}
        />
        <BodyInspector
          body={viewingHistory ? null : selectedBody}
          focused={selectedBody !== null && selectedBody.id === focusedBodyId}
          editBlockedReason={universe?.role === "baseline" ? BASELINE_LOCK : simulation.playing ? "Pause to edit: changes are applied between steps." : undefined}
          onSave={simulation.updateBody}
          onDelete={simulation.deleteBody}
          onFocus={focusBody}
          onClose={closeInspector}
        />
      </Sidebar>
    </div>
  );
}
