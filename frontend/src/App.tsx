import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import { PresetPicker } from "./components/ui/PresetPicker";
import { UniverseSwitcher } from "./components/ui/UniverseSwitcher";
import { Wordmark } from "./components/ui/Wordmark";
import { EntrySequence, shouldShowIntro } from "./components/ui/EntrySequence";
import type { ToolId } from "./components/ui/ToolRail";
import { enforceNarrow, initialSidebars, type SidebarState } from "./components/ui/layout";
import { btnStyle, panelStyle } from "./components/ui/styles";
import { theme } from "./components/ui/theme";
import { useAmbientSound } from "./sim/ambientSound";
import { useCatalogue } from "./sim/useCatalogue";
import { useOrbitLab } from "./sim/useOrbitLab";
import { useUniverses } from "./sim/useUniverses";
import { UniverseWorkspace } from "./UniverseWorkspace";

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

/**
 * App owns what outlives a universe: the list of universes and which is active, the sidebars, and the axes/grid
 * choices. Everything about the active universe lives in one UniverseWorkspace, remounted whenever the active
 * universe or its activation epoch changes.
 */
export default function App() {
  const universes = useUniverses(client);
  const catalogue = useCatalogue(client);
  const orbitLab = useOrbitLab(client, universes.refresh);
  // The drawer opens on the Add tool (not on a phone); the inspector appears only once a body is selected.
  const [sidebars, setSidebars] = useState<SidebarState>(() => initialSidebars(window.innerWidth));
  const [tool, setTool] = useState<ToolId>("create");
  const [intro, setIntro] = useState(shouldShowIntro);
  const sound = useAmbientSound();
  const windowWidth = useWindowWidth();
  // Shrinking the window with the drawer and the inspector both open would leave almost no free area.
  useEffect(() => setSidebars((s) => enforceNarrow(s, windowWidth)), [windowWidth]);
  // The user's own view choices; both start off. Placement may show the grid without changing them.
  const [showAxes, setShowAxes] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [writePending, setWritePending] = useState(false);
  const [speedExp, setSpeedExp] = useState(5); // log10 simulated seconds per step; kept across universe switches

  const { scope, refresh } = universes;
  const scopedClient = useMemo(
    () => (scope ? client.scoped(scope) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope?.universeId, scope?.activationEpoch],
  );
  // A refusal that means our idea of the active universe is stale: ask the backend and adopt its answer.
  const onScopeInvalid = useCallback(() => void refresh(), [refresh]);

  const introLayer = intro ? <EntrySequence onDone={() => setIntro(false)} /> : null;

  if (!scope || !scopedClient) {
    return (
      <div style={{ width: "100vw", height: "100vh", position: "relative", backgroundColor: theme.bg }}>
        {introLayer}
        <div style={{ position: "absolute", top: 18, left: 20 }}>
          <Wordmark health={universes.status === "error" ? "down" : "unknown"} />
        </div>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
          {universes.status === "error" ? (
            <div role="alert" style={{ ...panelStyle, background: theme.glass, borderColor: theme.danger, textAlign: "center", maxWidth: 380, padding: 18 }}>
              <p style={{ margin: "0 0 10px 0" }}>Cannot load the universes: {universes.error}</p>
              <button style={btnStyle} onClick={() => void universes.retry()}>Retry</button>
            </div>
          ) : (
            <p role="status" style={{ ...panelStyle, background: theme.glass, margin: 0 }}>Waiting for the backend…</p>
          )}
        </div>
      </div>
    );
  }

  const active = universes.universes.find((u) => u.id === scope.universeId);
  const switchDisabled = writePending || universes.busy;
  const universePanel = (
    <>
      <UniverseSwitcher
        universes={universes.universes}
        switchDisabled={switchDisabled}
        switchDisabledReason={
          writePending ? "A change is still being saved; switching is blocked until it finishes." : undefined
        }
        busy={universes.busy}
        error={universes.actionError}
        onActivate={(id) => void universes.activate(id)}
        onCreateEmpty={() => void universes.createUniverse({ source: { kind: "empty" }, activate: true })}
        onDelete={(id) => void universes.deleteUniverse(id)}
        onDismissError={universes.dismissActionError}
      />
      <PresetPicker
        presets={universes.presets}
        disabled={switchDisabled}
        onLoad={(presetId) => void universes.createUniverse({ source: { kind: "preset", presetId }, activate: true })}
      />
    </>
  );
  const notices = universes.notice ? (
    <p role="status" data-testid="universes-lost-notice" style={{ ...panelStyle, background: theme.glass, margin: 0, padding: "6px 10px", fontSize: 12, borderColor: theme.warn, maxWidth: 520 }}>
      {universes.notice}{" "}
      <button onClick={universes.dismissNotice} style={{ ...btnStyle, fontSize: 11, padding: "2px 8px" }}>Dismiss</button>
    </p>
  ) : null;

  return (
    <>
    {introLayer}
    <UniverseWorkspace
      key={`${scope.universeId}:${scope.activationEpoch}`}
      client={scopedClient}
      universe={active}
      universePanel={universePanel}
      notices={notices}
      catalogue={catalogue}
      orbitLab={orbitLab}
      apiClient={client}
      switchDisabled={switchDisabled}
      onActivateUniverse={(id) => void universes.activate(id)}
      speedExp={speedExp}
      onSpeedExpChange={setSpeedExp}
      sidebars={sidebars}
      setSidebars={setSidebars}
      tool={tool}
      onToolChange={setTool}
      sound={sound}
      windowWidth={windowWidth}
      showAxes={showAxes}
      showGrid={showGrid}
      onAxesChange={setShowAxes}
      onGridChange={setShowGrid}
      onScopeInvalid={onScopeInvalid}
      onBusyWriteChange={setWritePending}
    />
    </>
  );
}
