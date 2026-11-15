import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Creates a photorealistic 4-point diffraction spike texture (lens flare cross)
 * matching the bright celestial stars in deep-sky astrophotography.
 */
function createDiffractionStarTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;

  // 1. Soft radial glow
  const radialGlow = ctx.createRadialGradient(center, center, 0, center, center, size * 0.45);
  radialGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  radialGlow.addColorStop(0.12, 'rgba(220, 240, 255, 0.85)');
  radialGlow.addColorStop(0.35, 'rgba(160, 205, 255, 0.25)');
  radialGlow.addColorStop(1, 'rgba(100, 160, 255, 0)');
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, size, size);

  // 2. Sharp horizontal diffraction ray
  const gradH = ctx.createLinearGradient(0, center, size, center);
  gradH.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradH.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  gradH.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradH;
  ctx.fillRect(0, center - 1.2, size, 2.4);

  // 3. Sharp vertical diffraction ray
  const gradV = ctx.createLinearGradient(center, 0, center, size);
  gradV.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradV.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  gradV.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradV;
  ctx.fillRect(center - 1.2, 0, 2.4, size);

  // 4. Subtle diagonal secondary diffraction rays
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(Math.PI / 4);
  const gradDiag = ctx.createLinearGradient(-size * 0.32, 0, size * 0.32, 0);
  gradDiag.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradDiag.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
  gradDiag.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradDiag;
  ctx.fillRect(-size * 0.32, -0.6, size * 0.64, 1.2);
  ctx.restore();

  // 5. Brilliant pure-white core
  const core = ctx.createRadialGradient(center, center, 0, center, center, 4);
  core.addColorStop(0, 'rgba(255, 255, 255, 1)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0.4)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(center, center, 4, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Shader-based multi-tier deep starfield with exponential pinpoint point-spread,
 * size attenuation, subtle stellar color temperature and realistic scintillation (twinkle).
 */
function DeepSkyStarfield() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, colors, sizes, phases } = useMemo(() => {
    const totalStars = 12000;
    const pos = new Float32Array(totalStars * 3);
    const col = new Float32Array(totalStars * 3);
    const sz = new Float32Array(totalStars);
    const ph = new Float32Array(totalStars);

    // Stellar color temperatures (icy blue-white, pure diamond, pale warm silver)
    const colorPalette = [
      [0.98, 0.99, 1.0],   // Pure diamond white
      [0.85, 0.93, 1.0],   // Ice blue-white (B-type star)
      [0.92, 0.96, 1.0],   // Soft white-blue (A-type star)
      [1.0, 0.98, 0.92],   // Pale warm gold (F/G-type star)
      [0.8, 0.88, 1.0],    // Deep cyan-white
    ];

    let pIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < totalStars; i++) {
      let x = 0, y = 0, z = 0;
      let size = 0.8;

      if (i < 5000) {
        // Deep background celestial sphere (r: 60 -> 120)
        const radius = 60 + Math.random() * 60;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);

        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.sin(phi) * Math.sin(theta);
        z = radius * Math.cos(phi);
        size = 0.5 + Math.random() * 0.9;
      } else if (i < 9500) {
        // Open star cluster / galactic core density (reproducing the dense cluster in photo)
        const clusterRadius = 40 + Math.random() * 45;
        // Concentrated cone around [0.1, 0.2, -0.95]
        const spread = 0.55;
        const cx = 0.05 + (Math.random() - 0.5) * spread;
        const cy = 0.15 + (Math.random() - 0.5) * spread;
        const cz = -1.0 + (Math.random() - 0.5) * 0.3;
        const dir = new THREE.Vector3(cx, cy, cz).normalize();

        const jitter = (Math.random() - 0.5) * 0.35;
        dir.x += jitter;
        dir.y += jitter;
        dir.normalize().multiplyScalar(clusterRadius);

        x = dir.x;
        y = dir.y;
        z = dir.z;
        size = 0.4 + Math.random() * 1.3;
      } else {
        // Mid-field and foreground cosmic volume (r: 15 -> 55) for extreme parallax depth
        const radius = 15 + Math.random() * 40;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);

        x = radius * Math.sin(phi) * Math.cos(theta);
        y = radius * Math.sin(phi) * Math.sin(theta);
        z = radius * Math.cos(phi);
        size = 0.7 + Math.random() * 1.6;
      }

      pos[pIdx] = x;
      pos[pIdx + 1] = y;
      pos[pIdx + 2] = z;

      const c = colorPalette[Math.floor(Math.random() * colorPalette.length)];
      col[cIdx] = c[0];
      col[cIdx + 1] = c[1];
      col[cIdx + 2] = c[2];

      sz[i] = size;
      ph[i] = Math.random() * Math.PI * 2;

      pIdx += 3;
      cIdx += 3;
    }

    return { positions: pos, colors: col, sizes: sz, phases: ph };
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
          uniform float uTime;
          varying vec3 vColor;
          varying float vAlpha;

          void main() {
            vColor = aColor;
            // Realistic subtle scintillation (twinkle)
            float twinkle = 0.72 + 0.28 * sin(uTime * 1.8 + aPhase * 3.0);
            vAlpha = twinkle;

            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (135.0 / -mvPosition.z) * twinkle;
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

            // Exponential point-spread function for sharp pinpoints with soft edge
            float intensity = exp(-dist * dist * 22.0);
            gl_FragColor = vec4(vColor * (0.8 + 0.4 * intensity), intensity * vAlpha);
          }
        `}
      />
    </points>
  );
}

/**
 * Prominent bright hero stars with realistic optical 4-point cross diffraction spikes,
 * positioned across the sky matching the reference image.
 */
function SpikedHeroStars() {
  const texture = useMemo(() => createDiffractionStarTexture(), []);
  const groupRef = useRef<THREE.Group>(null);

  // Notable positions for prominent spiked stars (including the bright central-left star)
  const heroStars = useMemo(
    () => [
      { pos: [-1.2, 0.4, -28] as [number, number, number], scale: 3.6, color: '#f0f7ff' },
      { pos: [-14, 18, -42] as [number, number, number], scale: 2.8, color: '#e6f2ff' },
      { pos: [16, 22, -38] as [number, number, number], scale: 2.4, color: '#fff9ea' },
      { pos: [-22, -12, -45] as [number, number, number], scale: 2.5, color: '#e2f0fe' },
      { pos: [12, -16, -35] as [number, number, number], scale: 2.9, color: '#fefce8' },
      { pos: [2.5, -20, -32] as [number, number, number], scale: 2.2, color: '#f0f9ff' },
      { pos: [6, 2, -26] as [number, number, number], scale: 1.8, color: '#ffffff' },
      { pos: [-18, 6, 25] as [number, number, number], scale: 2.6, color: '#f8fafc' },
      { pos: [15, -10, 28] as [number, number, number], scale: 2.5, color: '#e0f2fe' },
      { pos: [0, 24, 26] as [number, number, number], scale: 2.7, color: '#fffbeb' },
    ],
    [],
  );

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.getElapsedTime();
    groupRef.current.children.forEach((child, idx) => {
      const baseScale = heroStars[idx].scale;
      const pulse = 1 + Math.sin(t * 1.5 + idx * 1.7) * 0.08;
      child.scale.set(baseScale * pulse, baseScale * pulse, 1);
    });
  });

  return (
    <group ref={groupRef}>
      {heroStars.map((star, idx) => (
        <sprite key={idx} position={star.pos} scale={[star.scale, star.scale, 1]}>
          <spriteMaterial
            map={texture}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            color={star.color}
          />
        </sprite>
      ))}
    </group>
  );
}

/**
 * Near-space floating stellar motes drifting slowly in zero-g,
 * producing immediate 3D parallax motion when the camera orbits.
 */
function NearSpaceMotes() {
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, originalPositions } = useMemo(() => {
    const count = 180;
    const pos = new Float32Array(count * 3);
    const orig = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 16;
      const y = (Math.random() - 0.5) * 16;
      const z = (Math.random() - 0.5) * 16;

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
    const t = state.clock.getElapsedTime() * 0.15;

    for (let i = 0; i < 180; i++) {
      const ox = originalPositions[i * 3];
      const oy = originalPositions[i * 3 + 1];
      const oz = originalPositions[i * 3 + 2];

      posAttr.setXYZ(
        i,
        ox + Math.sin(t + i * 0.2) * 0.3,
        oy + Math.cos(t * 0.8 + i * 0.3) * 0.3,
        oz + Math.sin(t * 0.6 + i * 0.4) * 0.3,
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
        size={0.065}
        color="#e0f2fe"
        transparent
        opacity={0.65}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      {/* Infinite deep celestial black void */}
      <color attach="background" args={['#010206']} />

      {/* Cinematic illumination for floating 3D keepsakes and companions */}
      <ambientLight intensity={0.55} color="#dbe5ff" />
      <directionalLight position={[6, 9, 6]} intensity={1.8} color="#fff8f0" />
      <directionalLight position={[-7, -4, -4]} intensity={0.85} color="#93c5fd" />
      <directionalLight position={[0, 6, -9]} intensity={1.3} color="#e9d5ff" />
      <pointLight position={[0, 0, 0]} intensity={0.9} color="#ffffff" distance={12} />

      {/* 1. Deep-sky 12,000-star field with stellar clustering & twinkling */}
      <DeepSkyStarfield />

      {/* 2. Optical 4-point diffraction spike hero stars matching reference astrophotography */}
      <SpikedHeroStars />

      {/* 3. Near-field floating stellar motes for maximum 3D parallax depth */}
      <NearSpaceMotes />
    </>
  );
}
