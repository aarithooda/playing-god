import { useCallback, useEffect, useMemo, useState } from "react";
import { createApiClient } from "./api/client";
import { PresetPicker } from "./components/ui/PresetPicker";
import { UniverseSwitcher } from "./components/ui/UniverseSwitcher";
import { Wordmark } from "./components/ui/Wordmark";
import { enforceNarrow, type SidebarState } from "./components/ui/layout";
import { btnStyle, panelStyle } from "./components/ui/styles";
import { theme } from "./components/ui/theme";
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
  // Controls (right) are open on first use; History and diagnostics (left) are tucked away.
  const [sidebars, setSidebars] = useState<SidebarState>({ left: false, right: true });
  const windowWidth = useWindowWidth();
  // Shrinking the window with both sidebars open would leave almost no free area.
  useEffect(() => setSidebars((s) => enforceNarrow(s, windowWidth)), [windowWidth]);
  // The user's own view choices; both start off. Placement may show the grid without changing them.
  const [showAxes, setShowAxes] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [writePending, setWritePending] = useState(false);

  const { scope, refresh } = universes;
  const scopedClient = useMemo(
    () => (scope ? client.scoped(scope) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope?.universeId, scope?.activationEpoch],
  );
  // A refusal that means our idea of the active universe is stale: ask the backend and adopt its answer.
  const onScopeInvalid = useCallback(() => void refresh(), [refresh]);

  if (!scope || !scopedClient) {
    return (
      <div style={{ width: "100vw", height: "100vh", position: "relative", backgroundColor: theme.bg }}>
        <div style={{ position: "absolute", top: 16, left: 16 }}>
          <Wordmark health={universes.status === "error" ? "down" : "unknown"} />
        </div>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>
          {universes.status === "error" ? (
            <div role="alert" style={{ ...panelStyle, borderColor: theme.danger, textAlign: "center", maxWidth: 360 }}>
              <p style={{ margin: "0 0 10px 0" }}>Cannot load the universes: {universes.error}</p>
              <button style={btnStyle} onClick={() => void universes.retry()}>Retry</button>
            </div>
          ) : (
            <p role="status" style={{ ...panelStyle, margin: 0 }}>Waiting for the backend…</p>
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
    <p role="status" data-testid="universes-lost-notice" style={{ ...panelStyle, margin: 0, padding: "6px 10px", fontSize: 12, borderColor: theme.warn }}>
      {universes.notice}{" "}
      <button onClick={universes.dismissNotice} style={{ ...btnStyle, fontSize: 11, padding: "2px 6px" }}>dismiss</button>
    </p>
  ) : null;

  return (
    <UniverseWorkspace
      key={`${scope.universeId}:${scope.activationEpoch}`}
      client={scopedClient}
      universe={active}
      universePanel={universePanel}
      notices={notices}
      sidebars={sidebars}
      setSidebars={setSidebars}
      windowWidth={windowWidth}
      showAxes={showAxes}
      showGrid={showGrid}
      onAxesChange={setShowAxes}
      onGridChange={setShowGrid}
      onScopeInvalid={onScopeInvalid}
      onBusyWriteChange={setWritePending}
    />
  );
}
