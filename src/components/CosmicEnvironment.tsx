import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Photorealistic deep-sky starfield matching telescope astrophotography:
 * pure natural pinpoint stars across multiple depth spheres,
 * with subtle brightness distribution and gentle twinkle, without any over-bright stars.
 */
function NaturalDeepStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, opacities } = useMemo(() => {
    const totalStars = 18000;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const op = new Float32Array(totalStars);

    // Natural astronomical white hues
    const starHues = [
      [1.0, 1.0, 1.0],     // Neutral white
      [0.93, 0.96, 1.0],   // Faint cool white
      [0.98, 0.98, 0.95],  // Faint warm white
      [0.88, 0.94, 1.0],   // Soft ice white
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      let x = 0, y = 0, z = 0;
      let starSize = 0.4;
      let baseOpacity = 0.6;

      if (i < 8000) {
        // Deep background celestial sphere (r: 70 -> 180) - dense faint micro-stars
        const radius = 70 + Math.random() * 110;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);

        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.sin(phi) * Math.sin(theta);
        z = radius * Math.cos(phi);

        starSize = 0.3 + Math.random() * 0.4;
        baseOpacity = 0.35 + Math.random() * 0.45;
      } else if (i < 14000) {
        // Subtle galactic star cluster concentration (mimicking the central cluster in reference photo)
        const clusterRadius = 50 + Math.random() * 70;
        const spread = 0.65;
        const cx = 0.08 + (Math.random() - 0.5) * spread;
        const cy = 0.12 + (Math.random() - 0.5) * spread;
        const cz = -1.0 + (Math.random() - 0.5) * 0.4;
        const dir = new THREE.Vector3(cx, cy, cz).normalize();

        const jitter = (Math.random() - 0.5) * 0.38;
        dir.x += jitter;
        dir.y += jitter;
        dir.normalize().multiplyScalar(clusterRadius);

        x = dir.x;
        y = dir.y;
        z = dir.z;

        starSize = 0.35 + Math.random() * 0.45;
        baseOpacity = 0.4 + Math.random() * 0.5;
      } else {
        // Mid-space cosmic volume (r: 25 -> 70) for realistic 3D motion parallax
        const radius = 25 + Math.random() * 45;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);

        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.sin(phi) * Math.sin(theta);
        z = radius * Math.cos(phi);

        starSize = 0.4 + Math.random() * 0.45;
        baseOpacity = 0.5 + Math.random() * 0.45;
      }

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
            // Very gentle, calm natural twinkling without jarring flashes
            float twinkle = 0.82 + 0.18 * sin(uTime * 1.2 + aPhase * 2.0);
            vAlpha = aOpacity * twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Sharp pinpoint point-size, proportional to distance
            gl_PointSize = max(1.2, aSize * (110.0 / -mvPosition.z));
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

            // Clean crisp circular dot with subtle anti-aliasing edge
            float edge = smoothstep(0.5, 0.1, dist);
            gl_FragColor = vec4(vColor, edge * vAlpha);
          }
        `}
      />
    </points>
  );
}

/**
 * Very subtle near-space dust motes drifting in zero gravity,
 * providing tactile 3D parallax without being bright or distracting.
 */
function SubtleDriftingMotes() {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, originalPositions } = useMemo(() => {
    const count = 90;
    const pos = new Float32Array(count * 3);
    const orig = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 14;
      const y = (Math.random() - 0.5) * 14;
      const z = (Math.random() - 0.5) * 14;

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
    const t = state.clock.getElapsedTime() * 0.08;

    for (let i = 0; i < 90; i++) {
      const ox = originalPositions[i * 3];
      const oy = originalPositions[i * 3 + 1];
      const oz = originalPositions[i * 3 + 2];

      posAttr.setXYZ(
        i,
        ox + Math.sin(t + i * 0.3) * 0.25,
        oy + Math.cos(t * 0.7 + i * 0.4) * 0.25,
        oz + Math.sin(t * 0.5 + i * 0.5) * 0.25,
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
        size={0.035}
        color="#e2e8f0"
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      {/* Pure deep black void of deep space */}
      <color attach="background" args={['#000000']} />

      {/* Balanced, natural illumination for floating keepsakes and companions */}
      <ambientLight intensity={0.6} color="#e2e8f0" />
      <directionalLight position={[5, 8, 6]} intensity={1.5} color="#fffcf5" />
      <directionalLight position={[-6, -4, -4]} intensity={0.7} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.0} color="#e2e8f0" />

      {/* 1. Realistic deep-sky 18,000 pinpoint starfield matching telescope photography */}
      <NaturalDeepStarfield />

      {/* 2. Gentle floating motes for tactile 3D parallax */}
      <SubtleDriftingMotes />
    </>
  );
}
