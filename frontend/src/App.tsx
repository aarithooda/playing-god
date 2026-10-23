import { useEffect, useState } from "react";
import { UniverseCanvas } from "./components/canvas/UniverseCanvas";
import { ControlPanel } from "./components/ui/ControlPanel";
import { BodyInspector } from "./components/ui/BodyInspector";
import { EventTimeline } from "./components/ui/EventTimeline";

// Temporary sample data for Step 1 & 2
const SAMPLE_BODIES = [
  { id: "sun", name: "Sun", position: [0, 0, 0] as [number, number, number], radius: 5, color: "#fdb813", mass: 1.989e30, velocity: [0, 0, 0] as [number, number, number] },
  { id: "earth", name: "Earth", position: [20, 0, 0] as [number, number, number], radius: 1, color: "#2271b3", mass: 5.972e24, velocity: [0, 10, 0] as [number, number, number] },
  { id: "mars", name: "Mars", position: [-30, 5, 10] as [number, number, number], radius: 0.8, color: "#e27b58", mass: 6.39e23, velocity: [0, 8, 0] as [number, number, number] },
];

export default function App() {
  const [backend, setBackend] = useState("checking...");
  const [selectedBodyId, setSelectedBodyId] = useState<string | undefined>(undefined);
  const [bodies, setBodies] = useState(SAMPLE_BODIES);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setBackend(d.status))
      .catch(() => setBackend("unreachable"));
  }, []);

  const handleUpdateBody = (id: string, updates: any) => {
    setBodies(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const selectedBody = bodies.find(b => b.id === selectedBodyId);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", backgroundColor: "#000" }}>
      {/* 3D Scene */}
      <UniverseCanvas
        bodies={bodies}
        selectedBodyId={selectedBodyId}
        onSelectBody={setSelectedBodyId}
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
            <EventTimeline />
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
            <p style={{ fontSize: "11px", opacity: 0.5, marginTop: "5px" }}>Backend: {backend}</p>
          </div>

          {/* Right: Controls */}
          <div style={{ pointerEvents: "auto" }}>
            <ControlPanel />
          </div>
        </div>

        {/* Bottom Section: Inspector */}
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <div style={{ pointerEvents: "auto" }}>
            <BodyInspector
              body={selectedBody ? {
                name: selectedBody.name,
                mass: selectedBody.mass,
                radius: selectedBody.radius,
                position: selectedBody.position,
                velocity: selectedBody.velocity
              } : null}
              onUpdate={(updates) => {
                if (selectedBodyId) handleUpdateBody(selectedBodyId, updates);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

