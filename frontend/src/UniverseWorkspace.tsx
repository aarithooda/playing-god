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
import { CollisionInspector } from "./components/ui/CollisionInspector";
import { EventTimeline } from "./components/ui/EventTimeline";
import { useCollisionInspector } from "./sim/collision/useCollisionInspector";
import { useCollisionEffects } from "./sim/collision/useCollisionEffects";
import { HistoryTimeline } from "./components/ui/HistoryTimeline";
import { FirstUse } from "./components/ui/FirstUse";
import { PlacementHint } from "./components/ui/PlacementHint";
import { Sidebar } from "./components/ui/Sidebar";
import { SnapshotPanel } from "./components/ui/SnapshotPanel";
import { CrudFeedback, type CrudFeedbackTone } from "./components/ui/CrudFeedback";
import { ViewLegend } from "./components/ui/ViewLegend";
import { ViewPanel } from "./components/ui/ViewPanel";
import { Wordmark } from "./components/ui/Wordmark";
import { insets, toggleSidebar, type SidebarState } from "./components/ui/layout";
import { btnStyle, panelStyle } from "./components/ui/styles";
import { theme } from "./components/ui/theme";
import { gridCell } from "./sim/gridScale";
import { DEFAULT_METERS_PER_UNIT, DEFAULT_SIZE_MODE, fitTransform, minimumRadiusPx, physicalRadiusUnits, SIZE_LAWS, toPhysicsPosition, type RenderTransform, type SizeMode } from "./sim/renderTransform";
import { isScopeInvalid, useSimulation } from "./sim/useSimulation";
import { UNDO_WINDOW_MS, useUndoableCreate } from "./sim/useUndoableCreate";
import type { ViewControlContract } from "./sim/viewControlContract";
import { useComparison, type OrbitLabApi } from "./sim/useOrbitLab";
import { useProvenance } from "./sim/useProvenance";
import { pathsNote, pathTargets } from "./sim/history/pathSelection";
import { frameAt, trajectoryOf } from "./sim/history/historyModel";
import { useHistory } from "./sim/history/useHistory";
import { useHistoryNavigation } from "./sim/history/useHistoryNavigation";
import type { DisplayBody } from "./sim/viewModel";
import { buildSceneBodies } from "./sim/sceneBodies";
import { BodyList } from "./components/ui/BodyList";
import { MoonOrbitInset } from "./components/ui/MoonOrbitInset";
import { focusRadiusFor, systemIds } from "./sim/moonSystems";
import { moonRelativeOrbits } from "./sim/moonOrbit";

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

type CrudOperation = "add" | "edit" | "delete";
interface CrudFeedbackState {
  id: number;
  operation: CrudOperation;
  tone: CrudFeedbackTone;
  message: string;
}

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
  const [showPaths, setShowPaths] = useState(true);
  const [moonOrbitInsetOpen, setMoonOrbitInsetOpen] = useState(false);
  const [sizeMode, setSizeMode] = useState<SizeMode>(DEFAULT_SIZE_MODE);
  const [crudFeedback, setCrudFeedback] = useState<CrudFeedbackState | null>(null);
  const crudFeedbackId = useRef(0);
  const autoPlayedUniverseId = useRef<string | null>(null);

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

  // The moon-system preset opens as a running simulation. Remember the universe id so a normal render or
  // a user's later pause does not unexpectedly start it again.
  useEffect(() => {
    if (
      loadStatus !== "ready" ||
      !universe ||
      universe.presetId !== "solar-system-moons-j2000" ||
      !universe.id ||
      bodies.length === 0 ||
      autoPlayedUniverseId.current === universe.id
    ) return;
    autoPlayedUniverseId.current = universe.id;
    simulation.play();
  }, [loadStatus, universe?.id, universe?.presetId, bodies.length, simulation.play]);

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
  const selectedMoonOrbits = useMemo(
    () => selectedBody ? moonRelativeOrbits(selectedBody, bodies) : [],
    [selectedBody, bodies],
  );
  useEffect(() => {
    if (selectedBodyId && !selectedBody && sim) setSelectedBodyId(undefined);
  }, [selectedBodyId, selectedBody, sim]);
  const closeInspector = useCallback(() => setSelectedBodyId(undefined), []);

  // Recorded history (UI-2). The backend recorded it; this only displays it. While a recorded sample is viewed, the
  // simulation is paused and the scene shows that sample through the very same display path as live bodies.
  const history = useHistory(client, simulation.revision);
  const inspector = useCollisionInspector(client);
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
            ...(b.meta.bodyType === undefined ? {} : { bodyType: b.meta.bodyType }),
            ...(b.meta.assetKey === undefined ? {} : { assetKey: b.meta.assetKey }),
            ...(b.meta.primaryId === undefined ? {} : { primaryId: b.meta.primaryId }),
          }))
        : bodies,
    [frame, bodies],
  );
  // Display radii are capped by neighbour spacing so crowded systems (the inner planets) do not overlap; display only.
  const sceneBodies = useMemo(() => buildSceneBodies(displayBodies, transform, sizeMode), [displayBodies, transform, sizeMode]);

  // Collision effects (UI-0, Stage 9): the renderer gets only what the visual descriptions and the displayed body states say.
  const effectBodies = useMemo(() => displayBodies.map((b) => ({ id: b.id, positionM: b.positionM, radiusM: b.radiusM })), [displayBodies]);
  const collisionVisuals = useCollisionEffects({
    client,
    events: simulation.events,
    bodies: effectBodies,
    displayTimeS: frame ? frame.simulationTimeS : sim ? sim.simulationTimeS : null,
    seekKey: viewingHistory ? `history:${nav.position}` : "live",
    advancing: viewingHistory ? nav.replaying : simulation.playing,
    enabled: loadStatus === "ready",
  });

  // A selected moon or moon-bearing planet gets name tags for its whole system, so the moons can be told apart.
  const labeledBodyIds = useMemo(() => systemIds(sceneBodies, selectedBodyId), [sceneBodies, selectedBodyId]);

  // "Show paths" defaults on; moon systems keep every body's recorded path visible together.
  const moonIds = new Set(displayBodies.filter((b) => b.primaryId !== undefined && displayBodies.some((p) => p.id === b.primaryId)).map((b) => b.id));
  const pathIds = pathTargets(displayBodies.map((b) => b.id), selectedBodyId, moonIds);
  const trajectories = useMemo(
    () => {
      const out = showPaths && history.cache ? pathIds.map((id) => trajectoryOf(history.cache!, id, "active")) : [];
      if (hasRun && comparisonBody) {
        // Experiment 01 always overlays both runs' paths of the selected planet: the active run solid, the other dashed.
        if (history.cache && !out.some((t) => t.bodyId === comparisonBody)) out.push(trajectoryOf(history.cache, comparisonBody, "active"));
        if (referenceHistory.cache && referenceHistory.cache.universeId === otherRunId) out.push(trajectoryOf(referenceHistory.cache, comparisonBody, "reference"));
      }
      const livePositions = new Map(displayBodies.map((body) => [body.id, body.positionM]));
      return out.map((trajectory) => {
        // History is sampled discretely, but the active body is already moving between samples.
        // A history fetch can see a newly committed step before its state response reaches this component. Keep the
        // active path at or behind the displayed state, then extend it to that exact live position; otherwise the
        // trail can jump ahead and appear detached at high simulation speeds.
        if (trajectory.role !== "active" || viewingHistory) return trajectory;
        const currentTimeS = sim?.simulationTimeS;
        const visibleSamples = currentTimeS === undefined
          ? trajectory.samples
          : trajectory.samples.filter((sample) => sample.simulationTimeS <= currentTimeS);
        const visibleTrajectory = visibleSamples.length === trajectory.samples.length
          ? trajectory
          : { ...trajectory, samples: visibleSamples };
        const positionM = livePositions.get(trajectory.bodyId);
        const latest = visibleSamples[visibleSamples.length - 1];
        if (!positionM || !latest || (
          latest.positionM.x === positionM.x && latest.positionM.y === positionM.y && latest.positionM.z === positionM.z
        )) return visibleTrajectory;
        return {
          ...visibleTrajectory,
          samples: [...visibleSamples, {
            simulationTimeS: currentTimeS ?? latest.simulationTimeS,
            positionM: { ...positionM },
            segment: latest.segment,
          }],
        };
      }).filter((trajectory) => trajectory.samples.length > 0);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showPaths, history.cache, referenceHistory.cache, hasRun, comparisonBody, otherRunId, pathIds.join("|"), displayBodies, sim?.simulationTimeS, viewingHistory],
  );
  useEffect(() => {
    if (viewingHistory) setPlacementMode(false);
  }, [viewingHistory]);

  const focusBody = useCallback((id: string) => {
    const sceneBody = sceneBodies.find((b) => b.id === id);
    if (sceneBody) {
      setFocus((f) => ({
        nonce: (f?.nonce ?? 0) + 1,
        bodyId: id,
        position: sceneBody.position,
        radius: focusRadiusFor(sceneBodies, id) ?? sceneBody.radius,
      }));
      setFocusedBodyId(id);
    }
  }, [sceneBodies]);

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

  const reportCrudResult = useCallback((operation: CrudOperation, bodyName: string, result: { ok: true } | { ok: false; error: string }) => {
    if (!result.ok) simulation.dismissError();
    if (operation !== "add") created.dismiss();
    const action = operation === "add" ? "add" : operation === "edit" ? "update" : "delete";
    const past = operation === "add" ? "Added" : operation === "edit" ? "Updated" : "Deleted";
    setCrudFeedback({
      id: ++crudFeedbackId.current,
      operation,
      tone: result.ok ? "success" : "error",
      message: result.ok ? `${past} ${bodyName}.` : `Could not ${action} ${bodyName}: ${result.error}`,
    });
  }, [created.dismiss, simulation.dismissError]);

  const createWithFeedback = useCallback(async (body: Parameters<typeof created.create>[0]) => {
    const result = await created.create(body);
    reportCrudResult("add", body.name, result);
    return result;
  }, [created.create, reportCrudResult]);

  const updateWithFeedback = useCallback(async (id: string, patch: Parameters<typeof simulation.updateBody>[1]) => {
    const bodyName = patch.name ?? bodies.find((body) => body.id === id)?.name ?? id;
    const result = await simulation.updateBody(id, patch);
    reportCrudResult("edit", bodyName, result);
    return result;
  }, [bodies, reportCrudResult, simulation.updateBody]);

  const deleteWithFeedback = useCallback(async (id: string) => {
    const bodyName = bodies.find((body) => body.id === id)?.name ?? id;
    const result = await simulation.deleteBody(id);
    reportCrudResult("delete", bodyName, result);
    return result;
  }, [bodies, reportCrudResult, simulation.deleteBody]);

  const undoCreateWithFeedback = useCallback(async () => {
    const bodyName = created.undoable?.name ?? "body";
    const result = await created.undo();
    if (!result.ok) simulation.dismissError();
    setCrudFeedback({
      id: ++crudFeedbackId.current,
      operation: "delete",
      tone: result.ok ? "success" : "error",
      message: result.ok ? `Undid adding ${bodyName}.` : `Could not undo adding ${bodyName}: ${result.error}`,
    });
    return result;
  }, [created.undo, created.undoable, simulation.dismissError]);
  const dismissCrudFeedback = useCallback(() => setCrudFeedback(null), []);
  const activeBodyIds = useMemo(() => new Set(bodies.map((body) => body.id)), [bodies]);

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
    setMoonOrbitInsetOpen(bodies.some((body) => body.primaryId === id));
    setSidebars((s) => (s.right ? s : toggleSidebar(s, "right", true, windowWidth)));
  };
  const addFirstBody = () => {
    setSidebars((s) => (s.right ? s : toggleSidebar(s, "right", true, windowWidth)));
    setOpenCreateRequest((n) => n + 1);
  };
  const addFromCatalogue = (entry: CatalogueEntryDto) => {
    setCatalogueRequest((r) => ({ entry, nonce: (r?.nonce ?? 0) + 1 }));
  };
  const edge = insets(sidebars);
  // Placing a body shows the grid to help position it; the stored choice is never overwritten.
  const gridVisible = showGrid || placementMode;
  const fitView = useCallback(() => {
    setTransform(fitTransform(bodies.map((b) => b.positionM)));
    setFrameEpoch((n) => n + 1);
  }, [bodies]);
  const viewControls: ViewControlContract = {
    state: {
      axesVisible: showAxes,
      gridEnabled: showGrid,
      gridShownForPlacement: placementMode,
      canFitView: bodies.length > 0,
      canFocusSelected: selectedBody !== null,
    },
    actions: {
      setAxesVisible: props.onAxesChange,
      setGridVisible: props.onGridChange,
      fitView,
      focusSelected: () => { if (selectedBody) focusBody(selectedBody.id); },
    },
  };

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
        overviewZoom={universe?.presetId === "solar-system-moons-j2000" ? 1.2 : 1.8}
        focus={focus}
        onFocusRelease={() => setFocusedBodyId(undefined)}
        placementMode={placementMode}
        placementRadius={{
          radius: physicalRadiusUnits(Number.isFinite(placementRadiusM) && placementRadiusM > 0 ? placementRadiusM : 6.371e6, transform),
          visiblePx: minimumRadiusPx(Number.isFinite(placementRadiusM) && placementRadiusM > 0 ? placementRadiusM : 6.371e6, sizeMode),
          maxGrowth: SIZE_LAWS[sizeMode].maxZoomGrowth,
        }}
        onPlacementConfirm={confirmPlacement}
        onPlacementCancel={cancelPlacement}
        onPlacementPreview={setPlacementPreview}
        leftInset={edge.left}
        rightInset={edge.right}
        transform={transform}
        viewControls={viewControls}
        trajectories={trajectories}
        labeledBodyIds={labeledBodyIds}
        collisionEffects={collisionVisuals.effects}
        surfaceMarks={collisionVisuals.marks}
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
        {!viewingHistory && selectedMoonOrbits.length > 0 && (
          <div style={{ position: "absolute", right: 16, bottom: 16, pointerEvents: "auto", zIndex: 30 }}>
            {moonOrbitInsetOpen ? (
              <MoonOrbitInset planetName={selectedBody!.name} orbits={selectedMoonOrbits} onClose={() => setMoonOrbitInsetOpen(false)} />
            ) : (
              <button type="button" onClick={() => setMoonOrbitInsetOpen(true)} style={{ ...btnStyle, boxShadow: "0 4px 18px #0009" }}>
                Moon orbits ({selectedMoonOrbits.length})
              </button>
            )}
          </div>
        )}
      </div>

      <Sidebar side="left" title="Body catalogue & history" open={sidebars.left} onToggle={setSidebar("left")}>
        <CataloguePanel
          entries={props.catalogue.entries}
          onPlace={addFromCatalogue}
          disabled={!ready || viewingHistory || universe?.role === "baseline"}
        />
        <EventTimeline
          events={simulation.events}
          bodyName={simulation.bodyName}
          activeBodyIds={activeBodyIds}
          selectedBodyId={selectedBodyId}
          onSelectBody={selectBody}
          onInspect={inspector.open}
        />
        {inspector.eventId !== null && (
          <CollisionInspector
            eventId={inspector.eventId}
            detail={inspector.detail}
            status={inspector.status}
            error={inspector.error}
            replay={inspector.replay}
            replayBusy={inspector.replayBusy}
            bodyName={simulation.bodyName}
            onReplay={inspector.runReplay}
            onOpenEvent={inspector.open}
            onClose={inspector.close}
          />
        )}
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
          onFit={fitView}
          viewControls={viewControls}
          onCreate={createWithFeedback}
          placementMode={placementMode}
          onPlacementModeChange={setPlacementMode}
          pickedPosition={pickedPosition}
          onPlacementRadiusChange={setPlacementRadiusM}
          onPlacementCreateResult={placementCreateResult}
          openCreateRequest={openCreateRequest}
          catalogueRequest={catalogueRequest}
        />
        <ViewPanel
          paths={showPaths}
          onPathsChange={setShowPaths}
          pathsNote={pathsNote(showPaths, displayBodies.length, selectedBodyId, moonIds.size > 0)}
          sizeMode={sizeMode}
          onSizeModeChange={setSizeMode}
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
        <BodyList bodies={bodies} selectedBodyId={selectedBodyId} onSelect={selectBody} onFocus={focusBody} />
        <BodyInspector
          body={viewingHistory ? null : selectedBody}
          focused={selectedBody !== null && selectedBody.id === focusedBodyId}
          drawnRadiusUnits={sceneBodies.find((b) => b.id === selectedBodyId)?.radius}
          sizeMode={sizeMode}
          editBlockedReason={universe?.role === "baseline" ? BASELINE_LOCK : simulation.playing ? "Pause to edit: changes are applied between steps." : undefined}
          onSave={updateWithFeedback}
          onDelete={deleteWithFeedback}
          onFocus={focusBody}
          onClose={closeInspector}
        />
      </Sidebar>
      {crudFeedback && (
        <CrudFeedback
          key={crudFeedback.id}
          message={crudFeedback.message}
          tone={crudFeedback.tone}
          durationMs={UNDO_WINDOW_MS}
          onUndo={crudFeedback.operation === "add" && created.undoable ? undoCreateWithFeedback : undefined}
          onDismiss={dismissCrudFeedback}
        />
      )}
    </div>
  );
}
