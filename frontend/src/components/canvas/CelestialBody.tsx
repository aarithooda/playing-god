import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Outlines, Sphere } from '@react-three/drei';
import { AdditiveBlending, BackSide, Color, DoubleSide, Group, PerspectiveCamera, ShaderMaterial } from 'three';
import { useEffect, useMemo } from 'react';
import { bodyDisplayScale } from '../../sim/bodyVisibility';
import { displayBodyLabel } from '../../sim/bodyLabel';
import { useCelestialMaterial } from './CelestialMaterial';
import type { BodyKind, BodyType } from '../../api/types';

/** Selected-body silhouette: constant on-screen width (CSS px), whatever the body's size or the zoom. */
export const SELECTION_OUTLINE_PX = 1.5;
export const SELECTION_OUTLINE_COLOR = '#f2f7ff';

interface CelestialBodyProps {
  position: [number, number, number];
  radius: number;
  color: string;
  /** Stars glow; planets are lit by the scene. */
  kind?: BodyKind;
  name: string;
  bodyType?: BodyType;
  assetKey?: string;
  isSelected?: boolean;
  showLabel?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export const CelestialBody: React.FC<CelestialBodyProps> = ({
  position,
  radius,
  color,
  kind,
  name,
  bodyType = 'default',
  assetKey,
  isSelected = false,
  showLabel = false,
  onClick,
  onDoubleClick,
}) => {
  const body = useRef<Group>(null);
  const { assets, textures, material } = useCelestialMaterial(bodyType, assetKey, color);
  // drei's Outlines measures thickness in drawing-buffer pixels, so convert from CSS pixels.
  const dpr = useThree((s) => s.viewport.dpr);
  const haloMaterial = useMemo(() => new ShaderMaterial({
    uniforms: { glowColor: { value: new Color(color) } },
    vertexShader: `
      varying vec3 vNormalView;
      varying vec3 vViewDirection;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      varying vec3 vNormalView;
      varying vec3 vViewDirection;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewDirection))), 2.2);
        float alpha = rim * 0.20;
        gl_FragColor = vec4(glowColor * (0.55 + rim * 0.8), alpha);
      }
    `,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  }), [color]);
  useEffect(() => () => haloMaterial.dispose(), [haloMaterial]);

  // Display-only: lift the body to a minimum on-screen size when zoomed far out (sim/bodyVisibility.ts).
  // The scaled mesh is also what pointer picking ray-casts, so clicks match what is drawn.
  useFrame(({ camera, size }) => {
    if (!body.current || !(camera as PerspectiveCamera).isPerspectiveCamera) return;
    const [x, y, z] = position;
    const distance = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z);
    body.current.scale.setScalar(bodyDisplayScale(radius, distance, (camera as PerspectiveCamera).fov, size.height));
  });

  return (
    <group
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
    >
      <group ref={body}>
        {bodyType === 'star' && (
          <mesh scale={1.38} raycast={() => undefined} renderOrder={1}>
            <sphereGeometry args={[radius, 24, 20]} />
            <primitive object={haloMaterial} attach="material" />
          </mesh>
        )}
        <Sphere args={[radius, 32, 32]}>
          <primitive object={material} attach="material" />
          {/* Mounted only while selected, so deselecting (or selecting another body) leaves nothing behind.
              The outline is a back-face shell inside the body's scaled group: it follows the enlarged
              minimum on-screen size, is occluded by nearer bodies, and never changes the body itself. */}
          {isSelected && <Outlines thickness={SELECTION_OUTLINE_PX * dpr} color={SELECTION_OUTLINE_COLOR} />}
        </Sphere>
        {assets?.atmosphereColor && (
          <Sphere args={[radius * 1.045, 32, 32]} raycast={() => undefined}>
            <meshPhysicalMaterial
              color={assets.atmosphereColor}
              transparent
              opacity={assets.atmosphereOpacity ?? 0.12}
              side={BackSide}
              depthWrite={false}
              roughness={0.2}
              metalness={0}
            />
          </Sphere>
        )}
        {textures.rings && (
          <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => undefined}>
            <ringGeometry args={[radius * 1.35, radius * 2.15, 96]} />
            <meshBasicMaterial
              map={textures.rings}
              color="#ffffff"
              transparent
              opacity={0.9}
              side={DoubleSide}
              depthWrite={false}
              alphaTest={0.04}
            />
          </mesh>
        )}
      </group>
      {showLabel && (
        <Html
          position={[0, radius * 1.55, 0]}
          center
          zIndexRange={[20, 0]}
          style={{
            color: isSelected ? '#f0d4a5' : 'rgba(207, 218, 232, 0.78)',
            font: '500 11px/1.2 system-ui, sans-serif',
            letterSpacing: '0.015em',
            whiteSpace: 'nowrap',
            textShadow: '0 1px 4px #000, 0 0 7px rgba(0,0,0,0.9)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {displayBodyLabel(name)}
        </Html>
      )}
    </group>
  );
};
