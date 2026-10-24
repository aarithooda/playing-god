import React from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { CelestialVisualTestScene } from "./components/canvas/CelestialVisualTestScene";

function VisualTestPage() {
  const [selectedBodyName, setSelectedBodyName] = React.useState("Rocky planet");
  return (
    <main style={{ width: "100vw", height: "100vh", background: "#050505", color: "#e2e8f0" }}>
      <header style={{ position: "absolute", zIndex: 1, top: 12, left: 12, font: "13px system-ui, sans-serif" }}>
        Celestial asset test · selected body: {selectedBodyName} · click a body, drag to orbit, scroll to zoom
      </header>
      <Canvas camera={{ position: [0, 9, 27], fov: 50, near: 0.1, far: 200 }}>
        <color attach="background" args={["#050505"]} />
        <CelestialVisualTestScene selectedBodyName={selectedBodyName} onSelectBody={setSelectedBodyName} />
        <OrbitControls makeDefault target={[0, 0, -1]} />
      </Canvas>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<VisualTestPage />);
