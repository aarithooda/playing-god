import React from 'react';
import type { SurfaceMarkInput } from '../../render/contract';
import { localToMesh } from '../../sim/collision/orientation';

interface SurfaceMarksProps {
  marks: readonly SurfaceMarkInput[];
  /** Radius of the body in scene units. The component is rendered INSIDE the body's oriented group, so the marks turn with it. */
  radius: number;
}

/** Marks at body-local directions (UI-0, Stage 9). A small flat disc just above the surface, facing outward. Display only. */
export const SurfaceMarks: React.FC<SurfaceMarksProps> = ({ marks, radius }) => (
  <group name="surface-marks">
    {marks.map((m) => {
      const [x, y, z] = localToMesh([m.centerLocal.x, m.centerLocal.y, m.centerLocal.z]);
      const size = Math.max(radius * Math.tan(m.angularRadiusRad), 1e-6);
      return (
        <mesh key={m.key} position={[x * radius * 1.003, y * radius * 1.003, z * radius * 1.003]} raycast={() => undefined}
          onUpdate={(self) => self.lookAt(x * radius * 2, y * radius * 2, z * radius * 2)}>
          <circleGeometry args={[size, 24]} />
          <meshBasicMaterial color={m.colorHex} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      );
    })}
  </group>
);
