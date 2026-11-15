import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Vòm trời đêm & sương tinh vân dịu (Cosmic Nebula Sky Dome):
 * - Bán kính 90, side BackSide, depthWrite false, tắt raycast.
 * - Chuyển sắc đêm sâu thẳm: Đen Vũ Trụ (#020409) -> Xanh Đêm Thẳm (#071026) -> Tím Tinh Vân Trầm (#110a22).
 * - Dải sương ngân hà mềm mại, cường độ dịu nhẹ (0.08..0.16) mang sắc lam (#13294b) và tím hồng khói (#241438).
 */
function CosmicNebulaDome() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = elapsed;
    }
    if (meshRef.current) {
      meshRef.current.rotation.y = elapsed * 0.012;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} raycast={() => null}>
      <sphereGeometry args={[90, 48, 48]} />
      <shaderMaterial
        ref={materialRef}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vWorldDirection;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldDirection = normalize(worldPos.xyz);
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `}
        fragmentShader={`
          varying vec3 vWorldDirection;
          uniform float uTime;

          vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
          vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

          float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);

            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);

            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;

            i = mod289(i);
            vec4 p = permute(permute(permute(
                       i.z + vec4(0.0, i1.z, i2.z, 1.0))
                     + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                     + i.x + vec4(0.0, i1.x, i2.x, 1.0));

            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;

            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);

            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);

            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);

            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));

            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);

            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;

            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
          }

          float fbm(vec3 p) {
            float v = 0.0;
            v += 0.55 * snoise(p);
            v += 0.30 * snoise(p * 2.05);
            v += 0.15 * snoise(p * 4.1);
            return v;
          }

          void main() {
            vec3 dir = vWorldDirection;

            // Chuyển động sương khói chậm rãi
            vec3 p = dir * 1.4 + vec3(0.0, uTime * 0.015, uTime * 0.010);
            float n1 = fbm(p);
            float n2 = fbm(p + vec3(3.5, 1.8, 2.4));

            // Nền chuyển sắc thiên văn từ Đen Vũ Trụ (#020409) -> Xanh Đêm Thẳm (#071026) -> Tím Trầm (#110a22)
            vec3 cBlackSpace = vec3(0.008, 0.016, 0.035);
            vec3 cMidnight   = vec3(0.027, 0.063, 0.149);
            vec3 cDeepViolet = vec3(0.067, 0.039, 0.133);

            float skyGrad = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 baseSky = mix(cBlackSpace, mix(cMidnight, cDeepViolet, dir.x * 0.5 + 0.5), skyGrad * 0.65);

            // Dải sương ngân hà dịu nhẹ (độ sáng thấp 0.08..0.16)
            vec3 cGalacticBlue = vec3(0.075, 0.161, 0.294); // #13294b
            vec3 cSmokyViolet  = vec3(0.141, 0.078, 0.220); // #241438

            float wisp1 = smoothstep(0.05, 0.70, n1) * 0.14;
            float wisp2 = smoothstep(0.10, 0.75, n2) * 0.11;

            vec3 color = baseSky;
            color += cGalacticBlue * wisp1;
            color += cSmokyViolet * wisp2;

            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Bầu trời đêm vũ trụ phân bố đều 360 độ (2.060 ngôi sao) chuyển động tự xoay êm dịu:
 * - Vùng trung tâm (r < 7.5) được chừa trống để cụm kỷ vật và Cóc & Nai thoáng đãng.
 * - Nhóm 1 (1.540 sao nhỏ): r: 16.0..42.0, aSize: 2.2..4.2, aBaseBrightness: 0.45..0.85.
 * - Nhóm 2 (440 sao tầm trung): r: 8.0..24.0, aSize: 3.8..6.2, aBaseBrightness: 0.65..0.95.
 * - Nhóm 3 (80 sao sáng điểm xuyết): r: 9.0..28.0, aSize: 6.5..10.5, aBaseBrightness: 0.85..1.0.
 * - Toàn bộ hệ sao tự xoay nhẹ nhàng trên 3 trục theo thời gian.
 */
function FlowingCosmicStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, speeds, baseBrightness } = useMemo(() => {
    const totalStars = 2060;
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
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      let radius: number;
      let starSize: number;
      let brightness: number;

      if (i < 1540) {
        // Nhóm 1: 1.540 ngôi sao nhỏ tạo chiều sâu nền xa
        radius = 16.0 + Math.random() * 26.0;               // r: 16.0 .. 42.0
        starSize = 2.2 + Math.random() * 2.0;               // aSize: 2.2 .. 4.2
        brightness = 0.45 + Math.random() * 0.40;           // aBaseBrightness: 0.45 .. 0.85
      } else if (i < 1980) {
        // Nhóm 2: 440 ngôi sao tầm trung
        radius = 8.0 + Math.random() * 16.0;                // r: 8.0 .. 24.0
        starSize = 3.8 + Math.random() * 2.4;               // aSize: 3.8 .. 6.2
        brightness = 0.65 + Math.random() * 0.30;           // aBaseBrightness: 0.65 .. 0.95
      } else {
        // Nhóm 3: 80 ngôi sao sáng điểm xuyết
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
    const elapsed = state.clock.getElapsedTime();
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = elapsed;
    }
    // Chuyển động xoay tự nhiên liên tục của cả bầu trời sao
    if (pointsRef.current) {
      pointsRef.current.rotation.y = elapsed * 0.022;
      pointsRef.current.rotation.x = Math.sin(elapsed * 0.08) * 0.05;
      pointsRef.current.rotation.z = Math.cos(elapsed * 0.06) * 0.03;
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
      {/* Màu nền đêm vũ trụ */}
      <color attach="background" args={['#02040a']} />

      {/* Ánh sáng dịu dàng tôn khối các kỷ vật và Cóc & Nai */}
      <ambientLight intensity={0.7} color="#f1f5f9" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-6, -4, -4]} intensity={0.8} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#f8fafc" />

      {/* Vòm trời đêm & sương tinh vân dịu */}
      <CosmicNebulaDome />

      {/* Bầu trời sao 2.060 hạt tự xoay nhẹ nhàng 360 độ */}
      <FlowingCosmicStarfield />
    </>
  );
}
