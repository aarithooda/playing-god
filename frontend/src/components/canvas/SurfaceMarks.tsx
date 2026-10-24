import React from 'react';
import { Vector3 } from 'three';
import type { SurfaceMarkInput } from '../../render/contract';
import { localToMesh } from '../../sim/collision/orientation';

/** How far above the surface a mark floats (a fraction of the radius): enough to avoid z-fighting with the sphere at the camera's depth resolution. */
const LIFT = 1.012;
// A disc faces +z; it is turned to face outward along its own (body-local) direction. Not lookAt(): that takes WORLD coordinates and the
// body group is scaled (minimum on-screen size), so a world-space target ends up behind the disc and the disc is culled (found in the browser).
const FORWARD = new Vector3(0, 0, 1);

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
        <mesh key={m.key} position={[x * radius * LIFT, y * radius * LIFT, z * radius * LIFT]} raycast={() => undefined}
          onUpdate={(self) => self.quaternion.setFromUnitVectors(FORWARD, new Vector3(x, y, z).normalize())}>
          <circleGeometry args={[size, 24]} />
          <meshBasicMaterial color={m.colorHex} transparent opacity={0.9} depthWrite={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
      );
    })}
  </group>
);
