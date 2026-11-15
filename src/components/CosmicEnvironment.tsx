import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Uniformly distributed, gentle 3D starfield:
 * - Positioned close enough to envelop the scene and camera (radius 14 to 45) for rich 3D parallax.
 * - Perfectly isotropic and evenly scattered across 360 degrees (no clustering, no eye strain).
 * - Soft Gaussian circular points that look calm, crisp, and comfortable.
 */
function UniformPeacefulStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, opacities } = useMemo(() => {
    // 2,600 stars is optimal: rich and starry without high-frequency visual clutter
    const totalStars = 2600;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const op = new Float32Array(totalStars);

    // Natural soothing starry hues (soft white, pale ice white, warm silvery ivory)
    const starHues = [
      [0.96, 0.98, 1.0],   // Soft diamond white
      [0.88, 0.94, 1.0],   // Pale cool white
      [1.0, 0.98, 0.94],   // Faint warm ivory
      [0.92, 0.95, 0.98],  // Silvery white
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      // 100% uniform isotropic distribution on a 3D spherical volume (radius 14 to 46)
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      // Distance distribution: 65% mid-sphere (20-45), 35% closer sphere (14-22)
      let radius: number;
      let starSize: number;
      let baseOpacity: number;

      if (i < 900) {
        // Closer shell (14 to 22) - smooth parallax as camera orbits
        radius = 14 + Math.random() * 8;
        starSize = 1.0 + Math.random() * 0.8;
        baseOpacity = 0.45 + Math.random() * 0.35;
      } else {
        // Enveloping celestial dome (22 to 46)
        radius = 22 + Math.random() * 24;
        starSize = 0.8 + Math.random() * 0.9;
        baseOpacity = 0.4 + Math.random() * 0.4;
      }

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      pos[pIdx] = x;
      pos[pIdx + 1] = y;
      pos[pIdx + 2] = z;

      const c = starHues[Math.floor(Math.random() * starHues.length)];
      col[cIdx] = c[0];
      col[cIdx + 1] = c[1];
      col[cIdx + 2] = c[2];

      sz[i] = starSize;
      ph[i] = Math.random() * Math.PI * 2;
      op[i] = baseOpacity;

      pIdx += 3;
      cIdx += 3;
    }

    return { positions: pos, colors: col, sizes: sz, phases: ph, opacities: op };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
        <bufferAttribute attach="attributes-aOpacity" args={[opacities, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          attribute float aOpacity;
          uniform float uTime;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = aColor;
            // Extremely calm and subtle breathing twinkle (no flickering)
            float twinkle = 0.88 + 0.12 * sin(uTime * 0.9 + aPhase * 2.0);
            vAlpha = aOpacity * twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Proportional size with safe clamps to remain comfortable and clear
            float pSize = aSize * (75.0 / -mvPosition.z);
            gl_PointSize = clamp(pSize, 2.0, 5.5);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;

            // Soft Gaussian circular point: smooth, non-pixelated and very comfortable to look at
            float alpha = exp(-dist * dist * 10.0) * vAlpha;
            gl_FragColor = vec4(vColor, alpha);
          }
        `}
      />
    </points>
  );
}

/**
 * Very gentle floating stellar dust in the immediate foreground (radius 4 to 12)
 * for natural depth perception without clutter.
 */
function GentleForegroundDust() {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, originalPositions } = useMemo(() => {
    const count = 60;
    const pos = new Float32Array(count * 3);
    const orig = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 4 + Math.random() * 8;

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      orig[i * 3] = x;
      orig[i * 3 + 1] = y;
      orig[i * 3 + 2] = z;
    }
    return { positions: pos, originalPositions: orig };
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const t = state.clock.getElapsedTime() * 0.05;

    for (let i = 0; i < 60; i++) {
      const ox = originalPositions[i * 3];
      const oy = originalPositions[i * 3 + 1];
      const oz = originalPositions[i * 3 + 2];

      posAttr.setXYZ(
        i,
        ox + Math.sin(t + i * 0.3) * 0.15,
        oy + Math.cos(t * 0.8 + i * 0.4) * 0.15,
        oz + Math.sin(t * 0.6 + i * 0.5) * 0.15,
      );
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#f1f5f9"
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      {/* Pure deep black space */}
      <color attach="background" args={['#000000']} />

      {/* Balanced, soft studio lighting for floating keepsakes and companions */}
      <ambientLight intensity={0.65} color="#e2e8f0" />
      <directionalLight position={[5, 8, 6]} intensity={1.5} color="#fffcf5" />
      <directionalLight position={[-6, -4, -4]} intensity={0.7} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.0} color="#e2e8f0" />

      {/* 1. Evenly distributed, soothing 360-degree starfield enveloping the scene */}
      <UniformPeacefulStarfield />

      {/* 2. Soft foreground stardust providing tactile 3D parallax */}
      <GentleForegroundDust />
    </>
  );
}
