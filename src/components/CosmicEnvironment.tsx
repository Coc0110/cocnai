import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Deep-space starfield:
 * - Pure pitch-black void (background #000000).
 * - Stars distributed evenly around the scene and in the central viewing field.
 * - Clear, prominent star sizes that are comfortable and beautiful to view.
 * - Gentle, soothing, subtle twinkling (lấp lánh nhẹ nhàng, êm dịu).
 */
function PeacefulSparklingStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds } = useMemo(() => {
    const totalStars = 1500;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const sp = new Float32Array(totalStars);

    // Natural calming star tones
    const starHues = [
      [1.0, 1.0, 1.0],      // Pure diamond white
      [0.93, 0.96, 1.0],    // Soft ice white
      [1.0, 0.97, 0.92],    // Gentle warm ivory
      [0.88, 0.94, 1.0],    // Faint starlight cyan
      [0.96, 0.98, 1.0],    // Silvery white
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      // 100% uniform 3D spherical scattering
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      // Distance from center:
      // Includes closer stars (6 to 18) around the central objects, and outer stars (18 to 38)
      let radius: number;
      let starSize: number;
      // Gentle, serene twinkle speed (0.6s to 1.4s cycle)
      const twinkleSpeed = 0.6 + Math.random() * 0.8;

      if (i < 180) {
        // Prominent stars around center (clear, distinct, elegant)
        radius = 7 + Math.random() * 18;
        starSize = 14.0 + Math.random() * 9.0; // Clearly visible without being overwhelming
      } else if (i < 700) {
        // Medium stars
        radius = 6 + Math.random() * 24;
        starSize = 7.5 + Math.random() * 5.0;
      } else {
        // Faint background stars
        radius = 9 + Math.random() * 28;
        starSize = 4.0 + Math.random() * 3.0;
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
      sp[i] = twinkleSpeed;

      pIdx += 3;
      cIdx += 3;
    }

    return {
      positions: pos,
      colors: col,
      sizes: sz,
      phases: ph,
      speeds: sp,
    };
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
        <bufferAttribute attach="attributes-aSpeed" args={[speeds, 1]} />
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
          attribute float aSpeed;
          uniform float uTime;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = aColor;

            // Gentle, soothing sinusoidal twinkle (65% to 100% brightness)
            float wave = sin(uTime * aSpeed + aPhase);
            float twinkle = 0.82 + 0.18 * wave;

            vAlpha = twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

            // Subtle size breathing (gentle 8% expansion at peak)
            float pSize = aSize * (95.0 / -mvPosition.z) * (0.92 + 0.08 * wave);
            gl_PointSize = clamp(pSize, 3.5, 26.0);
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

            // Soft brilliant core
            float core = exp(-dist * dist * 32.0);

            // Soft soothing halo
            float halo = exp(-dist * dist * 8.0) * 0.5;

            float intensity = (core + halo) * vAlpha;
            gl_FragColor = vec4(vColor, intensity);
          }
        `}
      />
    </points>
  );
}

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      {/* Pure deep black space - Nền đen tuyền */}
      <color attach="background" args={['#000000']} />

      {/* Balanced, crisp lighting for floating keepsakes and companions */}
      <ambientLight intensity={0.7} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.8} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#f8fafc" />

      {/* Starfield with clearly visible central stars and gentle soothing twinkling */}
      <PeacefulSparklingStarfield />
    </>
  );
}
