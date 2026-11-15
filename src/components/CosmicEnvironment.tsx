import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Photorealistic deep-space starfield:
 * - Pure pitch-black void (background #000000).
 * - Stars distributed evenly around the scene and in the central viewing field.
 * - Substantially larger, clearly visible star sizes (up to 32px on screen).
 * - High-contrast dynamic diamond sparkling (twinkle pulsation in both size & brightness).
 * - Subtle 4-axis cross shimmer on bright stars when they reach twinkle peaks.
 */
function SparklingCosmicStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds, isBrightArr } = useMemo(() => {
    const totalStars = 1500;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const sp = new Float32Array(totalStars);
    const br = new Float32Array(totalStars);

    // Natural brilliant star colors (pure diamond, cyan-white, warm gold, crystal white)
    const starHues = [
      [1.0, 1.0, 1.0],      // Pure white diamond
      [0.92, 0.96, 1.0],    // Crisp icy white
      [1.0, 0.96, 0.88],    // Warm celestial gold
      [0.85, 0.94, 1.0],    // Starlight cyan
      [0.96, 0.98, 1.0],    // Crystal silver
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
      let isBright = 0.0;
      let twinkleSpeed = 1.2 + Math.random() * 2.0;

      if (i < 180) {
        // Prominent hero stars (large, bold, brilliant sparkling with cross flares)
        radius = 7 + Math.random() * 20;
        starSize = 18.0 + Math.random() * 14.0; // 18px to 32px base size!
        isBright = 1.0;
        twinkleSpeed = 1.8 + Math.random() * 2.2;
      } else if (i < 700) {
        // Medium distinct stars
        radius = 6 + Math.random() * 26;
        starSize = 9.0 + Math.random() * 7.0; // 9px to 16px
        isBright = 0.4;
        twinkleSpeed = 1.4 + Math.random() * 1.8;
      } else {
        // Background field stars
        radius = 10 + Math.random() * 28;
        starSize = 4.5 + Math.random() * 4.0; // 4.5px to 8.5px
        isBright = 0.0;
        twinkleSpeed = 1.0 + Math.random() * 1.5;
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
      br[i] = isBright;

      pIdx += 3;
      cIdx += 3;
    }

    return {
      positions: pos,
      colors: col,
      sizes: sz,
      phases: ph,
      speeds: sp,
      isBrightArr: br,
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
        <bufferAttribute attach="attributes-aIsBright" args={[isBrightArr, 1]} />
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
          attribute float aIsBright;
          uniform float uTime;
          varying vec3 vColor;
          varying float vAlpha;
          varying float vIsBright;

          void main() {
            vColor = aColor;
            vIsBright = aIsBright;

            // Noticeable dynamic sparkling twinkle:
            // Sinusoidal wave squared creates sharp, glistening sparkle flashes
            float wave = sin(uTime * aSpeed + aPhase);
            float twinkle = pow(0.5 + 0.5 * wave, 2.0) * 1.35 + 0.25;

            vAlpha = twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

            // Size dynamically breathes and pulses with the twinkle flash
            // Ensuring stars at the center and foreground are clearly large and prominent
            float pSize = aSize * (100.0 / -mvPosition.z) * (0.65 + 0.45 * wave);
            gl_PointSize = clamp(pSize, 4.0, 34.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;
          varying float vIsBright;

          void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;

            // 1. Concentrated brilliant jewel core
            float core = exp(-dist * dist * 32.0);

            // 2. Soft glowing atmospheric halo
            float halo = exp(-dist * dist * 7.5) * 0.5;

            // 3. Four-point sparkling cross shimmer on prominent stars
            float rayH = max(0.0, 1.0 - abs(coord.y) * 18.0) * max(0.0, 1.0 - abs(coord.x) * 2.8);
            float rayV = max(0.0, 1.0 - abs(coord.x) * 18.0) * max(0.0, 1.0 - abs(coord.y) * 2.8);
            float crossSparkle = (rayH + rayV) * 0.9 * vIsBright;

            float intensity = (core + halo + crossSparkle) * vAlpha;
            vec3 finalColor = vColor * (1.0 + crossSparkle * 0.6);

            gl_FragColor = vec4(finalColor, intensity);
          }
        `}
      />
    </points>
  );
}

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      {/* Pure deep black space - Nền đen tuyền tuyệt đối */}
      <color attach="background" args={['#000000']} />

      {/* Balanced, crisp lighting for floating keepsakes and companions */}
      <ambientLight intensity={0.7} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.8} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#f8fafc" />

      {/* Sparkling cosmic starfield with large, clearly visible, sparkling stars */}
      <SparklingCosmicStarfield />
    </>
  );
}
