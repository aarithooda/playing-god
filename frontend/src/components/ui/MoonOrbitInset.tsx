import React, { useState } from "react";
import type { MoonRelativeOrbit } from "../../sim/moonOrbit";
import { theme } from "./theme";

interface MoonOrbitInsetProps {
  planetName: string;
  orbits: readonly MoonRelativeOrbit[];
  onClose: () => void;
}

const WIDTH = 280;
const HEIGHT = 170;
const PAD = 18;

export const MoonOrbitInset: React.FC<MoonOrbitInsetProps> = ({ planetName, orbits, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const maxExtent = Math.max(1, ...orbits.flatMap((orbit) => orbit.points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
  const scale = ((Math.min(WIDTH, HEIGHT) / 2 - PAD) / maxExtent) * zoom;
  const xy = (point: readonly [number, number]): [number, number] => [WIDTH / 2 + point[0] * scale, HEIGHT / 2 - point[1] * scale];
  const zoomButton: React.CSSProperties = {
    width: 22, height: 22, padding: 0, color: theme.text, background: "#172233", border: `1px solid ${theme.border}`,
    borderRadius: 4, cursor: "pointer", lineHeight: "20px",
  };

  return (
    <section
      aria-label={`${planetName} moon orbits`}
      style={{
        width: 300, padding: 10, color: theme.text, background: "#0b111bf2", border: `1px solid ${theme.borderStrong}`,
        borderRadius: 8, boxShadow: "0 8px 28px #0009", backdropFilter: "blur(8px)",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <strong style={{ display: "block", fontSize: 12 }}>{planetName} moon orbits</strong>
          <span style={{ fontSize: 10, color: theme.textMuted }}>Current planet-relative orbit estimates</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button type="button" aria-label="Zoom out moon orbits" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.65, z / 1.3))} style={zoomButton}>−</button>
          <button type="button" aria-label="Reset moon orbit zoom" title="Reset zoom" onClick={() => setZoom(1)} style={{ ...zoomButton, width: 34, fontSize: 9 }}>1:1</button>
          <button type="button" aria-label="Zoom in moon orbits" title="Zoom in" onClick={() => setZoom((z) => Math.min(6, z * 1.3))} style={zoomButton}>+</button>
          <button type="button" aria-label="Close moon orbit inset" onClick={onClose} style={{
            color: theme.textMuted, background: "transparent", border: `1px solid ${theme.border}`, borderRadius: 4,
            width: 24, height: 24, cursor: "pointer", marginLeft: 2,
          }}>×</button>
        </div>
      </header>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Live estimated orbits of ${orbits.map((orbit) => orbit.name).join(", ")}`} style={{ width: "100%", height: 156, display: "block", marginTop: 5 }}>
        <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={5} fill="#fff3b0" stroke="#fff" strokeWidth={1} />
        {orbits.map((orbit) => {
          const path = orbit.points.map((point, index) => {
            const [x, y] = xy(point);
            return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ");
          const current = xy(orbit.current);
          return (
            <g key={orbit.id}>
              <path d={path} fill="none" stroke={orbit.colorHex} strokeWidth={1.5} opacity={0.82} />
              <circle cx={current[0]} cy={current[1]} r={3} fill={orbit.colorHex} stroke="#fff" strokeWidth={0.7} />
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 10, color: theme.textMuted }}>
        {orbits.map((orbit) => (
          <span key={orbit.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: orbit.colorHex }} />{orbit.name}
          </span>
        ))}
      </div>
    </section>
  );
};
