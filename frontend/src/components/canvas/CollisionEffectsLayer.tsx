import React from 'react';
import { Html } from '@react-three/drei';
import type { CollisionEffectInput } from '../../render/contract';
import { physicalRadiusUnits, toScenePosition, type RenderTransform } from '../../sim/renderTransform';
import { DebrisParticles } from './DebrisParticles';

interface CollisionEffectsLayerProps {
  effects: readonly CollisionEffectInput[];
  transform: RenderTransform;
}

/**
 * Draws collision effects (UI-0, Stage 9, D-053). Display only: it picks nothing, affects neither framing nor focus, and has no
 * mass. The cloud and the debris samples follow the displayed simulation time (they arrive already evaluated); the flash is a
 * visual-only effect whose remaining wall-clock life arrives as `remaining01`. The label says what the viewer is looking at.
 */
export const CollisionEffectsLayer: React.FC<CollisionEffectsLayerProps> = ({ effects, transform }) => (
  <group name="collision-effects">
    {effects.map((e) => {
      const centre = toScenePosition(e.centerM, transform);
      return (
        <group key={e.key}>
          <group position={centre}>
            {e.cloud && (
              <mesh raycast={() => undefined}>
                <sphereGeometry args={[Math.max(physicalRadiusUnits(e.cloud.radiusM, transform), 1e-6), 24, 24]} />
                <meshBasicMaterial color={e.cloud.colorHex} transparent opacity={e.cloud.opacity} depthWrite={false} />
              </mesh>
            )}
            {e.flash && (
              <mesh raycast={() => undefined} scale={0.4 + 0.6 * (1 - e.flash.remaining01)}>
                <sphereGeometry args={[Math.max(physicalRadiusUnits(e.cloud?.radiusM ?? 1e6, transform), 0.05), 16, 16]} />
                <meshBasicMaterial color="#fff6d8" transparent opacity={e.flash.intensity * e.flash.remaining01} depthWrite={false} />
              </mesh>
            )}
            <Html center distanceFactor={undefined} style={{ pointerEvents: 'none', fontSize: '10px', color: '#c8d1dc', whiteSpace: 'nowrap', transform: 'translateY(-18px)' }}>
              <span data-testid="collision-effect-label">{e.label}</span>
            </Html>
          </group>
          <DebrisParticles points={e.particles} transform={transform} colorHex={e.colorHex} />
        </group>
      );
    })}
  </group>
);
