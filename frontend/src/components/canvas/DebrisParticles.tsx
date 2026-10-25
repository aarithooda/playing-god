import React, { useMemo } from 'react';
import type { EffectPoint } from '../../render/contract';
import { toScenePosition, type RenderTransform } from '../../sim/renderTransform';

interface DebrisParticlesProps {
  points: readonly EffectPoint[];
  transform: RenderTransform;
  colorHex: string;
}

/** Visual samples of debris parcels (UI-0, Stage 9): massless points, statistical, never picked and never fed back. */
export const DebrisParticles: React.FC<DebrisParticlesProps> = ({ points, transform, colorHex }) => {
  const positions = useMemo(() => {
    const out = new Float32Array(points.length * 3);
    points.forEach((p, i) => {
      const s = toScenePosition(p, transform);
      out[3 * i] = s[0];
      out[3 * i + 1] = s[1];
      out[3 * i + 2] = s[2];
    });
    return out;
  }, [points, transform]);
  if (points.length === 0) return null;
  return (
    <points raycast={() => undefined} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={colorHex} size={1.6} sizeAttenuation={false} transparent opacity={0.8} depthWrite={false} />
    </points>
  );
};
