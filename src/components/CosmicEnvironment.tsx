import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * TẦNG 1 - Đám mây bụi sao li ti tạo chiều sâu xa xăm (8.500 hạt)
 * - gl_PointSize: 0.7px .. 1.8px (nhân với uPixelRatio)
 * - Độ sáng alpha: pow(Math.random(), 3.2) trong khoảng 0.06 .. 0.45
 * - 55% rải đều vòm cầu xa (r: 30..70), 45% tập trung cụm bụi sao sâu ở trung tâm (r: 20..50)
 */
function DeepStardustLayer() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, opacities, sizes } = useMemo(() => {
    const count = 8500;
    const pos = new Float32Array(count * 3);
    const op = new Float32Array(count);
    const sz = new Float32Array(count);

    let pIdx = 0;
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, z = 0;

      if (i < 4675) {
        // 55% rải đều khắp vòm cầu ở bán kính xa (30..70)
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = 30 + Math.random() * 40;

        x = r * Math.sin(phi) * Math.cos(theta);
        y = r * Math.sin(phi) * Math.sin(theta);
        z = r * Math.cos(phi);
      } else {
        // 45% tập trung dày hơn thành một cụm bụi sao sâu ở vùng trung tâm (r: 20..50)
        const r = 20 + Math.random() * 30;
        // Phân bố Gaussian nhẹ quanh hướng nhìn trung tâm (hơi lệch nhẹ về trục -z)
        const u1 = Math.max(0.0001, Math.random());
        const u2 = Math.random();
        const gRadius = Math.sqrt(-2.0 * Math.log(u1)) * 0.45;
        const gAngle = u2 * 2.0 * Math.PI;

        const dirX = gRadius * Math.cos(gAngle);
        const dirY = gRadius * Math.sin(gAngle);
        const dirZ = -1.0 + (Math.random() - 0.5) * 0.35;
        const dir = new THREE.Vector3(dirX, dirY, dirZ).normalize().multiplyScalar(r);

        x = dir.x;
        y = dir.y;
        z = dir.z;
      }

      pos[pIdx] = x;
      pos[pIdx + 1] = y;
      pos[pIdx + 2] = z;

      // Alpha phân bố hàm mũ (phần lớn rất mờ, tạo chiều sâu thăm thẳm)
      op[i] = 0.06 + Math.pow(Math.random(), 3.2) * 0.39;
      // Kích thước 0.7px .. 1.8px
      sz[i] = 0.7 + Math.random() * 1.1;

      pIdx += 3;
    }

    return { positions: pos, opacities: op, sizes: sz };
  }, []);

  const uniforms = useMemo(
    () => ({
      uPixelRatio: {
        value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2.0) : 1.0,
      },
    }),
    [],
  );

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aOpacity" args={[opacities, 1]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`
          attribute float aOpacity;
          attribute float aSize;
          uniform float uPixelRatio;
          varying float vAlpha;

          void main() {
            vAlpha = aOpacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPixelRatio;
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying float vAlpha;

          void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;

            // Đầu kim sắc gọn (pinpoint), không quầng mờ to
            float core = exp(-dist * dist * 95.0);
            float rim = exp(-dist * dist * 22.0) * 0.25;
            float intensity = (core + rim) * vAlpha;

            gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), intensity);
          }
        `}
      />
    </points>
  );
}

/**
 * TẦNG 2 - Sao tầm trung sắc nét (1.400 hạt)
 * - gl_PointSize: 1.8px .. 3.8px (phân bố theo pow(Math.random(), 3.5))
 * - Bán kính r: 14..45 bao quanh 360 độ
 * - Màu sắc: Trắng kim cương (#ffffff), trắng xanh băng (#e2eeff), trắng ngà (#fff6e8)
 * - Nhịp lấp lánh (Twinkle): 2 sóng sin lệch tần số, dao động mượt từ 0.4 .. 1.0
 */
function MidgroundStarsLayer() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds } = useMemo(() => {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const ph = new Float32Array(count);
    const sp = new Float32Array(count);

    const starHues = [
      [1.0, 1.0, 1.0],      // Trắng kim cương
      [0.88, 0.93, 1.0],    // Trắng xanh băng nhạt (#e2eeff)
      [1.0, 0.96, 0.91],    // Trắng ngà (#fff6e8)
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 14 + Math.random() * 31;

      pos[pIdx] = r * Math.sin(phi) * Math.cos(theta);
      pos[pIdx + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[pIdx + 2] = r * Math.cos(phi);

      const color = starHues[Math.floor(Math.random() * starHues.length)];
      col[cIdx] = color[0];
      col[cIdx + 1] = color[1];
      col[cIdx + 2] = color[2];

      // Kích thước 1.8px .. 3.8px, phân bố pow(Math.random(), 3.5)
      sz[i] = 1.8 + Math.pow(Math.random(), 3.5) * 2.0;

      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.8 + Math.random() * 1.4; // Tốc độ 0.8 .. 2.2

      pIdx += 3;
      cIdx += 3;
    }

    return { positions: pos, colors: col, sizes: sz, phases: ph, speeds: sp };
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
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = aColor;

            // Kết hợp 2 sóng sin lệch tần số tạo nhịp lấp lánh tự nhiên từ 0.4 .. 1.0
            float w1 = sin(uTime * aSpeed + aPhase);
            float w2 = sin(uTime * (aSpeed * 1.57) + aPhase * 2.3);
            float twinkle = 0.70 + 0.30 * (0.65 * w1 + 0.35 * w2);
            vAlpha = twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPixelRatio;
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

            // Điểm sao sắc gọn như đầu kim
            float core = exp(-dist * dist * 95.0);
            float rim = exp(-dist * dist * 22.0) * 0.25;
            float intensity = (core + rim) * vAlpha;

            gl_FragColor = vec4(vColor, intensity);
          }
        `}
      />
    </points>
  );
}

/**
 * TẦNG 3 - Sao sáng điểm xuyến có nháy lóe nhỏ thi thoảng (80 hạt)
 * - Kích thước tâm sao: 3.5px .. 5.5px (gl_PointSize 10.0px .. 14.0px để chứa micro-glint)
 * - Bình thường (90% thời gian): Chấm sao tròn sắc nét, trong trẻo
 * - Thi thoảng (sát đỉnh sóng lấp lánh): Lóe nhẹ một tia chữ thập siêu mảnh rồi dịu ngay
 */
function HeroGlintStarsLayer() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds } = useMemo(() => {
    const count = 80;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const ph = new Float32Array(count);
    const sp = new Float32Array(count);

    const brightHues = [
      [1.0, 1.0, 1.0],      // Trắng kim cương rực rỡ
      [0.91, 0.95, 1.0],    // Trắng xanh băng
      [1.0, 0.97, 0.92],    // Trắng ngà ấm
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 12 + Math.random() * 23; // r: 12..35

      pos[pIdx] = r * Math.sin(phi) * Math.cos(theta);
      pos[pIdx + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[pIdx + 2] = r * Math.cos(phi);

      const color = brightHues[Math.floor(Math.random() * brightHues.length)];
      col[cIdx] = color[0];
      col[cIdx + 1] = color[1];
      col[cIdx + 2] = color[2];

      // Kích thước quad gl_PointSize 10.0px .. 14.0px
      sz[i] = 10.0 + Math.random() * 4.0;

      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.5 + Math.random() * 0.9; // Sóng lấp lánh chậm và tự nhiên

      pIdx += 3;
      cIdx += 3;
    }

    return { positions: pos, colors: col, sizes: sz, phases: ph, speeds: sp };
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
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vAlpha;
          varying float vGlint;

          void main() {
            vColor = aColor;

            // Sóng lấp lánh chậm
            float wave1 = sin(uTime * aSpeed + aPhase);
            float wave2 = sin(uTime * aSpeed * 0.43 + aPhase * 1.7);
            float twinkle = 0.75 + 0.25 * wave1;
            vAlpha = twinkle;

            // Chỉ kích hoạt tia lóe cực nhỏ khi 2 sóng gần đạt sát đỉnh tuyệt đối (khoảng 10% thời gian)
            float glintWave = wave1 * wave2;
            vGlint = smoothstep(0.85, 0.98, glintWave);

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPixelRatio;
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;
          varying float vGlint;

          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float dist = length(uv);
            if (dist > 0.5) discard;

            // Tâm sao tròn sắc nét (tỉ lệ tâm nhỏ trong quad 10-14px)
            float core = exp(-dist * dist * 140.0);
            float rim = exp(-dist * dist * 35.0) * 0.25;

            // Tia nháy chữ thập CỰC NHỎ và SIÊU MẢNH sát tâm, chỉ hiện khi vGlint > 0.0
            float tinySpike = 0.0;
            if (vGlint > 0.01) {
              tinySpike = (exp(-abs(uv.x) * 45.0) * exp(-abs(uv.y) * 9.0)
                         + exp(-abs(uv.y) * 45.0) * exp(-abs(uv.x) * 9.0)) * vGlint * 0.65;
            }

            float intensity = (core + rim + tinySpike) * vAlpha;
            vec3 finalColor = vColor * (1.0 + tinySpike * 0.4);

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
      {/* Nền đen tuyền tuyệt đối chuẩn thiên văn học */}
      <color attach="background" args={['#000000']} />

      {/* Ánh sáng dịu dàng, trong trẻo tôn khối các kỷ vật và nhân vật */}
      <ambientLight intensity={0.65} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.5} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.75} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.0} color="#f8fafc" />

      {/* TẦNG 1: 8.500 hạt bụi sao li ti tạo độ sâu vô cực */}
      <DeepStardustLayer />

      {/* TẦNG 2: 1.400 ngôi sao tầm trung sắc nét nhấp nháy êm dịu */}
      <MidgroundStarsLayer />

      {/* TẦNG 3: 80 ngôi sao điểm xuyết sáng trong với tia nháy lóe nhỏ thi thoảng */}
      <HeroGlintStarsLayer />
    </>
  );
}
