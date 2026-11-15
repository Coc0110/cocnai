import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Bầu trời đêm vũ trụ thoáng đãng, phân bố đều đẳng hướng 360 độ (1.800 ngôi sao):
 * - Vùng trung tâm (r: 0..7.5) được chừa trống để các kỷ vật và Froakie & Deerling tỏa sáng rõ nét.
 * - Nhóm 1 (1.350 sao nhỏ): r: 16.0..42.0, aSize: 2.2..4.2, aBaseBrightness: 0.45..0.85.
 * - Nhóm 2 (380 sao tầm trung): r: 8.0..24.0, aSize: 3.8..6.2, aBaseBrightness: 0.65..0.95.
 * - Nhóm 3 (70 sao sáng điểm xuyết): r: 9.0..28.0, aSize: 6.5..10.5, aBaseBrightness: 0.85..1.0.
 * - Tắt raycast (raycast={() => null}) để hoàn toàn không chặn thao tác kéo xoay Camera.
 */
function BalancedSpaciousStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds, baseBrightness } = useMemo(() => {
    const totalStars = 1800;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const sp = new Float32Array(totalStars);
    const bb = new Float32Array(totalStars);

    const starHues = [
      [1.0, 1.0, 1.0],      // Trắng kim cương rực rỡ
      [0.90, 0.95, 1.0],    // Trắng xanh băng
      [1.0, 0.96, 0.88],    // Vàng ánh kim thiên văn ấm áp
      [0.85, 0.94, 1.0],    // Ánh lam sao thanh khiết
      [0.96, 0.98, 1.0],    // Bạc tinh thể
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      // Phân bố hoàn toàn đẳng hướng trên mặt cầu 360 độ (không dồn cụm)
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      let radius: number;
      let starSize: number;
      let brightness: number;

      if (i < 1350) {
        // Nhóm 1: 1.350 ngôi sao nhỏ tạo chiều sâu nền
        radius = 16.0 + Math.random() * 26.0;               // r: 16.0 .. 42.0
        starSize = 2.2 + Math.random() * 2.0;               // aSize: 2.2 .. 4.2
        brightness = 0.45 + Math.random() * 0.40;           // aBaseBrightness: 0.45 .. 0.85
      } else if (i < 1730) {
        // Nhóm 2: 380 ngôi sao tầm trung
        radius = 8.0 + Math.random() * 16.0;                // r: 8.0 .. 24.0
        starSize = 3.8 + Math.random() * 2.4;               // aSize: 3.8 .. 6.2
        brightness = 0.65 + Math.random() * 0.30;           // aBaseBrightness: 0.65 .. 0.95
      } else {
        // Nhóm 3: 70 ngôi sao sáng điểm xuyết
        radius = 9.0 + Math.random() * 19.0;                // r: 9.0 .. 28.0
        starSize = 6.5 + Math.random() * 4.0;               // aSize: 6.5 .. 10.5
        brightness = 0.85 + Math.random() * 0.15;           // aBaseBrightness: 0.85 .. 1.0
      }

      pos[pIdx] = radius * Math.sin(phi) * Math.cos(theta);
      pos[pIdx + 1] = radius * Math.sin(phi) * Math.sin(theta);
      pos[pIdx + 2] = radius * Math.cos(phi);

      const color = starHues[Math.floor(Math.random() * starHues.length)];
      col[cIdx] = color[0];
      col[cIdx + 1] = color[1];
      col[cIdx + 2] = color[2];

      sz[i] = starSize;
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 1.6 + Math.random() * 2.4;
      bb[i] = brightness;

      pIdx += 3;
      cIdx += 3;
    }

    return {
      positions: pos,
      colors: col,
      sizes: sz,
      phases: ph,
      speeds: sp,
      baseBrightness: bb,
    };
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: {
        value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.0) : 1.0,
      },
    }),
    [],
  );

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <points ref={pointsRef} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aPhase" args={[phases, 1]} />
        <bufferAttribute attach="attributes-aSpeed" args={[speeds, 1]} />
        <bufferAttribute attach="attributes-aBaseBrightness" args={[baseBrightness, 1]} />
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
          attribute float aBaseBrightness;

          uniform float uTime;
          uniform float uPixelRatio;

          varying vec3 vColor;
          varying float vAlpha;
          varying float vPulse;

          void main() {
            vColor = aColor;

            float wave = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
            float pulse = pow(wave, 2.2);
            vAlpha = aBaseBrightness * (0.15 + 0.85 * pulse);
            vPulse = pulse;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float distScale = clamp(14.0 / max(4.0, -mvPosition.z), 0.55, 1.8);
            gl_PointSize = aSize * distScale * (0.82 + 0.38 * pulse) * uPixelRatio;
            gl_PointSize = clamp(gl_PointSize, 2.0, 16.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;
          varying float vPulse;

          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float dist = length(uv);
            if (dist > 0.5) discard;

            float d = clamp(1.0 - dist * 2.0, 0.0, 1.0);
            float core = pow(d, 2.6);
            float softGlow = pow(d, 1.4) * 0.35;

            float glint = smoothstep(0.82, 1.0, vPulse);
            float microCross = (exp(-abs(uv.x) * 32.0) * exp(-abs(uv.y) * 7.0)
                              + exp(-abs(uv.y) * 32.0) * exp(-abs(uv.x) * 7.0)) * glint * 0.55;

            float intensity = clamp((core + softGlow + microCross) * vAlpha, 0.0, 1.0);
            vec3 finalColor = mix(vColor, vec3(1.0), core * 0.6 + glint * 0.4);
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
      {/* Nền đen tuyền chuẩn vũ trụ */}
      <color attach="background" args={['#000000']} />

      {/* Ánh sáng dịu dàng, trong trẻo tôn khối các kỷ vật và Cóc & Nai */}
      <ambientLight intensity={0.7} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.8} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#f8fafc" />

      {/* Bầu trời sao rải đều 360 độ thoáng đãng, không chặn thao tác xoay camera */}
      <BalancedSpaciousStarfield />
    </>
  );
}
