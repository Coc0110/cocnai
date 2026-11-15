import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Vũ trụ 6.000 ngôi sao lấp lánh sắc nét bao quanh cụm kỷ vật trung tâm:
 * - Nền đen tuyền (#000000).
 * - Nhóm A (2.000 sao): Tập trung gần trung tâm (r: 3.5..16.0), kích thước 3.5..7.0.
 * - Nhóm B (3.750 sao): Tầng trung cảnh dày đặc (r: 10.0..26.0), kích thước 3.0..6.5.
 * - Nhóm C (250 sao): Sao sáng chủ đạo (r: 5.0..22.0), kích thước 7.5..13.0, nháy lóe vi mô.
 * - Công thức lấp lánh biên độ rộng (0.15..1.0) kết hợp dao động kích thước giúp mắt thấy sao lấp lánh rõ ràng.
 * - Công thức d = 1.0 - dist*2.0 giúp tâm sao sáng rực 100%, viền gọn gàng không bị bệt hay mất pixel.
 */
function SparklingDenseUniverse() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds, baseBrightness } = useMemo(() => {
    const totalStars = 6000;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const sp = new Float32Array(totalStars);
    const bb = new Float32Array(totalStars);

    // Bảng màu thiên văn tự nhiên
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
      // Phân bố đẳng hướng trên mặt cầu
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      let radius: number;
      let starSize: number;
      let brightness: number;
      let speed: number;

      if (i < 2000) {
        // Nhóm A: Cụm sao trung tâm bao quanh các kỷ vật (2.000 ngôi sao)
        // Ưu tiên tập trung gần tâm hơn bằng hàm lũy thừa
        radius = 3.5 + Math.pow(Math.random(), 1.4) * 12.5; // r: 3.5 .. 16.0
        starSize = 3.5 + Math.random() * 3.5;              // size: 3.5 .. 7.0
        brightness = 0.65 + Math.random() * 0.35;           // baseBrightness: 0.65 .. 1.0
        speed = 1.8 + Math.random() * 2.2;                  // speed: 1.8 .. 4.0
      } else if (i < 5750) {
        // Nhóm B: Tầng sao trung cảnh dày đặc (3.750 ngôi sao)
        radius = 10.0 + Math.random() * 16.0;               // r: 10.0 .. 26.0
        starSize = 3.0 + Math.random() * 3.5;               // size: 3.0 .. 6.5
        brightness = 0.55 + Math.random() * 0.40;           // baseBrightness: 0.55 .. 0.95
        speed = 1.8 + Math.random() * 2.4;                  // speed: 1.8 .. 4.2
      } else {
        // Nhóm C: Ngôi sao sáng chủ đạo lấp lánh mạnh (250 ngôi sao)
        // Ít nhất 100 ngôi sao nằm ở vùng trung tâm (5.0..14.0)
        if (i < 5850) {
          radius = 5.0 + Math.random() * 9.0;               // r: 5.0 .. 14.0 (100 sao trung tâm)
        } else {
          radius = 14.0 + Math.random() * 8.0;              // r: 14.0 .. 22.0 (150 sao)
        }
        starSize = 7.5 + Math.random() * 5.5;               // size: 7.5 .. 13.0
        brightness = 0.85 + Math.random() * 0.15;           // baseBrightness: 0.85 .. 1.0
        speed = 2.0 + Math.random() * 2.2;                  // speed: 2.0 .. 4.2
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
      sp[i] = speed;
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
    <points ref={pointsRef}>
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
            float pulse = pow(wave, 2.2); // Tạo nhịp lóe sáng rõ rệt
            vAlpha = aBaseBrightness * (0.15 + 0.85 * pulse);
            vPulse = pulse;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Nhân suy giảm khoảng cách vừa phải và phóng to nhẹ khi sao đạt đỉnh lấp lánh
            float distScale = clamp(14.0 / max(4.0, -mvPosition.z), 0.55, 1.8);
            gl_PointSize = aSize * distScale * (0.82 + 0.38 * pulse) * uPixelRatio;
            gl_PointSize = clamp(gl_PointSize, 2.5, 18.0);
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
            // Tâm kim cương sáng rõ 100%, viền gọn sắc nét không bị bệt như bông tuyết
            float core = pow(d, 2.6);
            float softGlow = pow(d, 1.4) * 0.35;

            // Hiệu ứng lóe sáng nhỏ (micro-glint) chỉ xuất hiện ở khoảnh khắc ngôi sao đạt đỉnh sáng (vPulse > 0.82)
            float glint = smoothstep(0.82, 1.0, vPulse);
            float microCross = (exp(-abs(uv.x) * 32.0) * exp(-abs(uv.y) * 7.0)
                              + exp(-abs(uv.y) * 32.0) * exp(-abs(uv.x) * 7.0)) * glint * 0.55;

            float intensity = clamp((core + softGlow + microCross) * vAlpha, 0.0, 1.0);
            // Làm tâm sao trắng rực lên khi đạt đỉnh lấp lánh
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

      {/* Ánh sáng dịu dàng, trong trẻo tôn khối các kỷ vật và Froakie & Deerling */}
      <ambientLight intensity={0.7} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.8} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#f8fafc" />

      {/* 6.000 ngôi sao dày đặc quanh khu vực trung tâm, lấp lánh sắc nét */}
      <SparklingDenseUniverse />
    </>
  );
}
