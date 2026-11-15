import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Procedural deep-space nebula dome:
 * Renders subtle, breathing, volumetric cosmic dust clouds (mystic indigo, violet, cyan)
 * on a background sphere (radius 68), giving the universe immense organic depth
 * instead of a flat dry black void.
 */
function CosmicNebulaDome() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

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
    <mesh position={[0, 0, 0]}>
      <sphereGeometry args={[68, 36, 24]} />
      <shaderMaterial
        ref={materialRef}
        side={THREE.BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `}
        fragmentShader={`
          varying vec3 vWorldPosition;
          uniform float uTime;

          // 3D Simplex noise
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
            vec3 dir = normalize(vWorldPosition);

            // Ethereal slow cosmic drift
            vec3 p = dir * 1.5 + vec3(0.0, uTime * 0.012, uTime * 0.008);
            float n1 = fbm(p);
            float n2 = fbm(p + vec3(3.8, 1.4, 2.1));

            // Deep background void
            vec3 baseVoid = vec3(0.002, 0.003, 0.007);

            // Deep cosmic dust colors (rich indigo, starlight violet, ethereal cyan)
            vec3 indigoDust = vec3(0.024, 0.042, 0.10);
            vec3 violetDust = vec3(0.048, 0.018, 0.088);
            vec3 cyanDust   = vec3(0.012, 0.055, 0.075);

            float wisp1 = smoothstep(0.05, 0.72, n1) * 0.85;
            float wisp2 = smoothstep(0.12, 0.78, n2) * 0.75;

            vec3 color = baseVoid;
            color += mix(indigoDust, cyanDust, n1 * 0.5 + 0.5) * wisp1;
            color += violetDust * wisp2;

            // Subtle galactic horizon
            float band = 1.0 - abs(dir.y * 0.75 + dir.x * 0.25);
            color += vec3(0.010, 0.016, 0.032) * max(0.0, band);

            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
}

/**
 * Sparkling 3D Starfield:
 * - Varied star sizes from delicate pinpoints to prominent sparkling stars (clamped up to 9.5px).
 * - Multi-harmonic twinkle for lively, shimmering diamond sparkle.
 * - Uniformly scattered on surrounding 3D shells (radius 15 to 48) for rich parallax.
 */
function Sparkling3DStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases, opacities } = useMemo(() => {
    const totalStars = 2800;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);
    const op = new Float32Array(totalStars);

    const starHues = [
      [1.0, 1.0, 1.0],     // Diamond pure white
      [0.90, 0.95, 1.0],   // Icy blue-white
      [1.0, 0.97, 0.92],   // Warm golden white
      [0.94, 0.96, 1.0],   // Crystal white
      [0.85, 0.92, 1.0],   // Starlight cyan-white
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      // 100% uniform 3D spherical scattering
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      // Distance shells
      let radius: number;
      let starSize: number;
      let baseOpacity: number;

      if (i < 200) {
        // Prominent hero sparkling stars (larger, bright, captivating twinkle)
        radius = 16 + Math.random() * 26;
        starSize = 3.6 + Math.random() * 3.2; // Allows larger sparkling size!
        baseOpacity = 0.85 + Math.random() * 0.15;
      } else if (i < 1000) {
        // Mid-sized crisp stars
        radius = 15 + Math.random() * 30;
        starSize = 1.8 + Math.random() * 1.6;
        baseOpacity = 0.6 + Math.random() * 0.3;
      } else {
        // Delicate background pinpoints
        radius = 18 + Math.random() * 30;
        starSize = 0.9 + Math.random() * 0.8;
        baseOpacity = 0.45 + Math.random() * 0.35;
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
          varying float vTwinkle;

          void main() {
            vColor = aColor;

            // Multi-frequency lively diamond twinkling
            float speed = 1.6 + sin(aPhase * 5.0) * 0.9;
            float tw1 = sin(uTime * speed + aPhase);
            float tw2 = cos(uTime * (speed * 1.5) + aPhase * 2.3);
            float twinkle = 0.70 + 0.30 * (tw1 * 0.65 + tw2 * 0.35);

            vAlpha = aOpacity * twinkle;
            vTwinkle = twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            // Size attenuation with generous max limit up to 9.5px
            float pSize = aSize * (88.0 / -mvPosition.z) * (0.8 + 0.35 * twinkle);
            gl_PointSize = clamp(pSize, 2.0, 9.5);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;
          varying float vTwinkle;

          void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;

            // Concentrated intense jewel core
            float core = exp(-dist * dist * 32.0);
            // Soft glowing atmospheric aura
            float halo = exp(-dist * dist * 7.5) * 0.65;
            float alpha = (core + halo) * vAlpha;

            // Extra sparkling diamond shimmer in the center
            vec3 finalColor = vColor + vec3(0.35 * core * vTwinkle);
            gl_FragColor = vec4(finalColor, alpha);
          }
        `}
      />
    </points>
  );
}

/**
 * Gentle floating stardust motes close to the camera for immediate 3D parallax.
 */
function GentleForegroundDust() {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, originalPositions } = useMemo(() => {
    const count = 75;
    const pos = new Float32Array(count * 3);
    const orig = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = 4.5 + Math.random() * 8.5;

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
    const t = state.clock.getElapsedTime() * 0.06;

    for (let i = 0; i < 75; i++) {
      const ox = originalPositions[i * 3];
      const oy = originalPositions[i * 3 + 1];
      const oz = originalPositions[i * 3 + 2];

      posAttr.setXYZ(
        i,
        ox + Math.sin(t + i * 0.3) * 0.18,
        oy + Math.cos(t * 0.8 + i * 0.4) * 0.18,
        oz + Math.sin(t * 0.6 + i * 0.5) * 0.18,
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
        size={0.055}
        color="#f8fafc"
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
      {/* 1. Deep ethereal cosmic nebula clouds in the background (depth horizon) */}
      <CosmicNebulaDome />

      {/* Balanced, crisp lighting for floating keepsakes and companions */}
      <ambientLight intensity={0.65} color="#e2e8f0" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#fffcf5" />
      <directionalLight position={[-6, -4, -4]} intensity={0.75} color="#cbd5e1" />
      <directionalLight position={[0, 6, -8]} intensity={1.1} color="#e2e8f0" />

      {/* 2. Sparkling 3D starfield with larger max size & lively diamond twinkle */}
      <Sparkling3DStarfield />

      {/* 3. Soft foreground stardust providing tactile 3D parallax */}
      <GentleForegroundDust />
    </>
  );
}
