import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KeepsakeManifestItem, LetterItem } from '../types/universe';
import lettersData from '../data/letters.json';

const braceletTextureCache = new WeakMap<THREE.Texture, THREE.CanvasTexture>();

function recolorBraceletTexture(origTex: THREE.Texture): THREE.CanvasTexture {
  const cached = braceletTextureCache.get(origTex);
  if (cached) return cached;

  if (typeof document === 'undefined') return origTex as unknown as THREE.CanvasTexture;

  const img = origTex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
  if (!img) return origTex as unknown as THREE.CanvasTexture;

  const w = img.width || 1024;
  const h = img.height || 1024;
  if (w <= 0 || h <= 0) return origTex as unknown as THREE.CanvasTexture;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return origTex as unknown as THREE.CanvasTexture;

  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const redness = r - (g * 0.65 + b * 0.35);

    if (redness > 15) {
      const t = Math.min(1, (redness - 15) / 45);
      const shade = 0.78 + lum * 0.34;
      const pinkR = Math.min(255, Math.round(248 * shade));
      const pinkG = Math.min(255, Math.round(182 * shade));
      const pinkB = Math.min(255, Math.round(206 * shade));

      const silverVal = Math.min(255, Math.round(215 + lum * 45));
      data[i] = Math.round(silverVal * (1 - t) + pinkR * t);
      data[i + 1] = Math.round(silverVal * (1 - t) + pinkG * t);
      data[i + 2] = Math.round(silverVal * (1 - t) + pinkB * t);
    } else {
      const contrastLum = Math.pow(Math.max(0, Math.min(1, (lum - 0.35) / 0.55)), 0.75);
      const baseSilver = 205 + contrastLum * 50;
      data[i] = Math.min(255, Math.round(baseSilver));
      data[i + 1] = Math.min(255, Math.round(baseSilver + 2));
      data[i + 2] = Math.min(255, Math.round(baseSilver + 7));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const newTex = new THREE.CanvasTexture(canvas);
  newTex.flipY = origTex.flipY;
  newTex.colorSpace = THREE.SRGBColorSpace;
  newTex.needsUpdate = true;

  braceletTextureCache.set(origTex, newTex);
  return newTex;
}

// Shader Thủy tinh Pha lê trong vắt (nhìn xuyên thấu 96% ở tâm, phản quang sắc nét ở viền Fresnel)
function createCrystalGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uRimColor: { value: new THREE.Color('#e0f7ff') },
      uTint: { value: new THREE.Color('#bae6fd') },
    },
    vertexShader: `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uRimColor;
      uniform vec3 uTint;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocalPos;
      void main() {
        vec3 N = normalize(gl_FrontFacing ? vNormalW : -vNormalW);
        vec3 V = normalize(vViewDir);
        float ndotv = clamp(abs(dot(N, V)), 0.0, 1.0);

        // Hiệu ứng Fresnel: ở giữa trong vắt, sát mép kính sáng long lanh
        float fresnel = pow(1.0 - ndotv, 2.8);

        // 2 nguồn phản quang (specular highlight) sắc nét dọc thân lọ thủy tinh
        vec3 L1 = normalize(vec3(0.6, 0.8, 0.7));
        vec3 L2 = normalize(vec3(-0.7, 0.4, -0.5));
        vec3 H1 = normalize(L1 + V);
        vec3 H2 = normalize(L2 + V);
        float spec1 = pow(max(dot(N, H1), 0.0), 96.0);
        float spec2 = pow(max(dot(N, H2), 0.0), 48.0) * 0.45;

        // Vệt sáng dọc mảnh trên thành bình trụ
        float streak = pow(max(0.0, dot(normalize(vec2(N.x, N.z)), normalize(vec2(0.75, 0.66)))), 18.0) * (1.0 - ndotv) * 0.35;

        vec3 col = mix(uTint, uRimColor, fresnel) + vec3(1.0) * (spec1 + spec2 + streak);
        float alpha = clamp(0.035 + fresnel * 0.62 + spec1 * 0.9 + spec2 * 0.5 + streak, 0.035, 0.92);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// Hàm cập nhật độ rủ và chuyển động mềm mại liên tục khắp không gian cho chiếc vòng tay
export function animateSuppleBracelet(root: THREE.Object3D, elapsed: number): void {
  const mesh = root.userData.braceletMesh as THREE.Mesh | undefined;
  if (!mesh) return;

  const geo = mesh.geometry as THREE.BufferGeometry;
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const rest = geo.userData.restPositions as Float32Array | undefined;
  if (!rest || !posAttr) return;

  const arr = posAttr.array as Float32Array;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    const rx = rest[idx];
    const ry = rest[idx + 1];
    const rz = rest[idx + 2];

    // Cụm cỏ 4 lá và kim cương phía trước (rz > 0.25) giữ cứng form trang sức (flex = 0),
    // phần dây xích hai bên và khóa phía sau (rz <= 0.25) mềm mại lỏng lẻo (flex -> 1.0)
    const tChain = Math.max(0, Math.min(1, (0.26 - rz) / 0.55));
    const flex = tChain * tChain * (3 - 2 * tChain); // smoothstep

    // 1. Độ võng tự nhiên (catenary drape) của sợi dây bạc lỏng lẻo
    const sideSag = -flex * 0.14 * (1.0 - Math.min(1, rz * rz * 2.2));
    const tailDrop = rz < -0.22 ? -Math.pow(-rz - 0.22, 1.35) * 0.35 * flex : 0;

    // 2. Chuyển động đung đưa mềm mại liên tục khắp không gian (không có điểm gãy)
    const waveY =
      Math.sin(elapsed * 2.0 + rz * 5.5 + rx * 3.5) * 0.032 * flex +
      Math.cos(elapsed * 1.4 - rx * 5.0) * 0.02 * flex;
    const waveX = Math.sin(elapsed * 1.7 + rz * 4.5) * 0.018 * flex;
    const waveZ = Math.cos(elapsed * 1.5 + rx * 4.5) * 0.014 * flex;

    const inwardPinch = 1.0 - flex * 0.06;

    arr[idx] = rx * inwardPinch + waveX;
    arr[idx + 1] = ry + sideSag + tailDrop + waveY;
    arr[idx + 2] = rz + waveZ;
  }

  posAttr.needsUpdate = true;
}

let cachedRopeTexture: THREE.CanvasTexture | null = null;

function getJuteRopeTexture(): THREE.CanvasTexture | null {
  if (cachedRopeTexture) return cachedRopeTexture;

  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Nền màu sợi đay/thừng tự nhiên nhạt (Pale Straw / Unbleached Natural Jute)
  ctx.fillStyle = '#ebdcc6';
  ctx.fillRect(0, 0, 512, 512);

  // Vẽ các thớ sợi gai mịn li ti xoắn chéo
  const fiberColors = ['#dfceb0', '#f5ebd6', '#d4c19c', '#fffaf0', '#c9b58f'];
  for (let i = -512; i < 1024; i += 4) {
    ctx.strokeStyle = fiberColors[Math.abs(i) % fiberColors.length];
    ctx.lineWidth = 1.5 + (Math.abs(i * 7) % 3) * 0.8;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 512, 512);
    ctx.stroke();
  }

  // Thêm độ sần hạt xơ sợi thực vật
  const imgData = ctx.getImageData(0, 0, 512, 512);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const delta = (grain - 0.5) * 22;
    data[i] = Math.min(255, Math.max(0, data[i] + delta));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + delta));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + delta));
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  cachedRopeTexture = tex;
  return tex;
}

// Tạo cấu trúc dây thừng bện từ 7 tao sợi nhỏ (1 lõi ở tâm + 6 sợi mảnh xoắn ốc quanh lõi)
function createMultiStrandBraidedCord(
  centerCurve: THREE.Curve<THREE.Vector3>,
  segs: number,
  strandRadius: number,
  basePlyOffset: number,
  twistTurns: number,
  material: THREE.Material,
  group: THREE.Group,
  closed = false,
  isTail = false,
) {
  const frames = centerCurve.computeFrenetFrames(segs, closed);
  const geos: THREE.BufferGeometry[] = [];

  // 1 tao sợi lõi ở tâm
  const corePts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    corePts.push(centerCurve.getPointAt(i / segs));
  }
  const coreCurve = new THREE.CatmullRomCurve3(corePts, closed);
  geos.push(new THREE.TubeGeometry(coreCurve, segs * 2, strandRadius, 6, closed));

  // 6 tao sợi mảnh xoắn ốc đều quanh lõi
  for (let k = 0; k < 6; k++) {
    const phase = (k / 6) * Math.PI * 2;
    const strandPts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const pt = centerCurve.getPointAt(u);
      const N = frames.normals[i];
      const B = frames.binormals[i];

      // Ở 6% cuối cùng của 2 đuôi dây (u > 0.94), chỉ mở rộng nhẹ plyOffset thêm 1.0 -> 1.6
      const taper = isTail && u > 0.94 ? 1.0 + THREE.MathUtils.smoothstep(u, 0.94, 1.0) * 0.6 : 1.0;
      const curOffset = basePlyOffset * taper;
      const angle = u * twistTurns * Math.PI * 2 + phase;

      const offset = new THREE.Vector3()
        .copy(N)
        .multiplyScalar(Math.cos(angle) * curOffset)
        .addScaledVector(B, Math.sin(angle) * curOffset);

      strandPts.push(pt.clone().add(offset));
    }
    const strandCurve = new THREE.CatmullRomCurve3(strandPts, closed);
    geos.push(new THREE.TubeGeometry(strandCurve, segs * 2, strandRadius, 6, closed));
  }

  const merged = mergeGeometries(geos);
  if (merged) {
    group.add(new THREE.Mesh(merged, material));
  } else {
    geos.forEach((g) => group.add(new THREE.Mesh(g, material)));
  }
}

function createNeckRopeBow(neckY: number, neckRadius: number): { ropeGroup: THREE.Group; bowLooseGroup: THREE.Group } {
  const ropeGroup = new THREE.Group();
  const ropeTex = getJuteRopeTexture();

  // Vật liệu dây thừng màu rơm/đay nhạt tự nhiên, nhám mờ không bóng nhựa
  const ropeMat = new THREE.MeshStandardMaterial({
    map: ropeTex,
    bumpMap: ropeTex,
    bumpScale: 0.04,
    color: new THREE.Color('#f2e5d0'),
    roughness: 0.94,
    metalness: 0.0,
  });

  const strandRadius = 0.024;
  const plyOffset = 0.038;

  // 1. Quấn cổ chai: Chỉ dùng 2 vòng dây ôm hơi trễ tự nhiên quanh eo cổ chai (hơi võng nhẹ ở phía trước)
  const wrapPts: THREE.Vector3[] = [];
  const wrapSteps = 72;
  const turns = 2.0;
  for (let i = 0; i <= wrapSteps; i++) {
    const u = i / wrapSteps;
    const a = u * turns * Math.PI * 2;
    const frontSag = Math.max(0, Math.cos(a)) * -0.07;
    const y = neckY - 0.08 + u * 0.16 + frontSag;
    const r = neckRadius + 0.03;
    wrapPts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
  }
  const wrapCurve = new THREE.CatmullRomCurve3(wrapPts, false);
  createMultiStrandBraidedCord(wrapCurve, 56, strandRadius, plyOffset, 30, ropeMat, ropeGroup, false, false);

  const knotZ = neckRadius + 0.10;

  // 2. Nút thắt quấn ở chính giữa mặt trước cổ chai
  const knotCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.10, neckY - 0.08, knotZ),
    new THREE.Vector3(0.0, neckY + 0.09, knotZ + 0.07),
    new THREE.Vector3(0.10, neckY - 0.06, knotZ),
    new THREE.Vector3(0.0, neckY - 0.10, knotZ - 0.02),
    new THREE.Vector3(-0.10, neckY - 0.08, knotZ),
  ], true);
  createMultiStrandBraidedCord(knotCurve, 24, strandRadius, plyOffset, 6, ropeMat, ropeGroup, true, false);

  // 3. bowLooseGroup: Tâm xoay đặt tại đúng nút thắt (0, neckY, knotZ)
  const bowLooseGroup = new THREE.Group();
  bowLooseGroup.position.set(0, neckY, knotZ);

  // Cánh nơ (Bow Loop): Mỗi bên trái/phải chỉ có ĐÚNG 1 vòng cánh nơ duy nhất.
  // Đường cong rủ trễ mềm mại theo trọng lực: vồng nhẹ rồi rủ trễ sâu xuống dưới tại đầu mút (neckY - 0.95 -> y_local = -0.95), hơi cong ôm thân bình.
  [-1, 1].forEach((dir) => {
    const loopCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(dir * 0.04, 0.01, 0.02),
      new THREE.Vector3(dir * 0.50, 0.14, 0.06),
      new THREE.Vector3(dir * 1.10, -0.18, -0.02),
      new THREE.Vector3(dir * 1.45, -0.95, -0.12),
      new THREE.Vector3(dir * 1.05, -0.80, -0.02),
      new THREE.Vector3(dir * 0.45, -0.42, 0.05),
      new THREE.Vector3(dir * 0.04, -0.04, 0.02),
    ], true);
    createMultiStrandBraidedCord(loopCurve, 36, strandRadius, plyOffset, 24, ropeMat, bowLooseGroup, true, false);
  });

  // 4. Hai đuôi dây rủ xuống: Đường cong chữ S mềm mại buông rủ theo trọng lực, hơi lượn dọc theo mặt kính
  const leftTail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.04, -0.04, 0.03),
    new THREE.Vector3(-0.14, -0.65, 0.06),
    new THREE.Vector3(-0.28, -1.45, 0.05),
    new THREE.Vector3(-0.18, -2.25, 0.02),
    new THREE.Vector3(-0.25, -2.85, 0.01),
  ], false);
  createMultiStrandBraidedCord(leftTail, 42, strandRadius, plyOffset, 28, ropeMat, bowLooseGroup, false, true);

  const rightTail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, -0.04, 0.03),
    new THREE.Vector3(0.16, -0.70, 0.07),
    new THREE.Vector3(0.32, -1.55, 0.06),
    new THREE.Vector3(0.24, -2.35, 0.02),
    new THREE.Vector3(0.35, -3.05, 0.00),
  ], false);
  createMultiStrandBraidedCord(rightTail, 42, strandRadius, plyOffset, 28, ropeMat, bowLooseGroup, false, true);

  ropeGroup.add(bowLooseGroup);
  ropeGroup.userData.ropeBowGroup = bowLooseGroup;

  return { ropeGroup, bowLooseGroup };
}

export function animateGlassBottleRope(scene: THREE.Object3D, elapsed: number) {
  const bowLooseGroup = scene.userData.ropeBowGroup as THREE.Group | undefined;
  if (!bowLooseGroup) return;
  bowLooseGroup.rotation.z = Math.sin(elapsed * 1.5) * 0.035;
  bowLooseGroup.rotation.x = Math.cos(elapsed * 1.2) * 0.025;
}

const backTextureCache: Record<number, THREE.Texture> = {};

export function getBackTexture(designNum: number): THREE.Texture {
  if (!backTextureCache[designNum]) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(`/letters/back_0${designNum}.webp`);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    backTextureCache[designNum] = tex;
  }
  return backTextureCache[designNum];
}

// Tạo cấu trúc 1 viên nang con nhộng (capsule) chứa cuộn thư hoa văn và vòng vàng
export function createSingleCapsule(letter: LetterItem): THREE.Group {
  const capsule = new THREE.Group();
  capsule.userData.capsuleId = letter.id;

  // 1. Cuộn giấy thư bên trong (scrollRoll)
  const scrollRoll = new THREE.Group();
  scrollRoll.name = 'scrollRoll';

  const outerGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.94, 24, 1, true);
  const rawBackTex = getBackTexture(letter.backDesign);
  const rollBackTex = rawBackTex.clone();
  rollBackTex.wrapS = THREE.RepeatWrapping;
  rollBackTex.wrapT = THREE.ClampToEdgeWrapping;
  rollBackTex.repeat.set(0.28, 1.0);
  rollBackTex.offset.set(0.15, 0);
  rollBackTex.needsUpdate = true;

  const outerMat = new THREE.MeshStandardMaterial({
    map: rollBackTex,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.FrontSide,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  scrollRoll.add(outerMesh);

  // Mặt trong màu kem giấy
  const innerGeo = new THREE.CylinderGeometry(0.176, 0.176, 0.94, 24, 1, true);
  const innerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fdf6e7'),
    roughness: 0.9,
    side: THREE.BackSide,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  scrollRoll.add(innerMesh);

  // 2 vòng xoắn giấy ở 2 đầu (y = +0.47 và -0.47)
  const ringGeo = new THREE.RingGeometry(0.03, 0.178, 24);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f5eedb'),
    roughness: 0.85,
    side: THREE.DoubleSide,
  });
  const topRing = new THREE.Mesh(ringGeo, ringMat);
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = 0.47;
  scrollRoll.add(topRing);

  const botRing = new THREE.Mesh(ringGeo, ringMat);
  botRing.rotation.x = Math.PI / 2;
  botRing.position.y = -0.47;
  scrollRoll.add(botRing);

  capsule.add(scrollRoll);

  // 2. Vòng vàng cột giữa cuộn thư (goldRing)
  const goldRingGeo = new THREE.TorusGeometry(0.198, 0.026, 12, 28);
  const goldMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fbbf24'),
    metalness: 0.88,
    roughness: 0.15,
    emissive: new THREE.Color('#d97706'),
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 1.0,
  });
  const goldRing = new THREE.Mesh(goldRingGeo, goldMat);
  goldRing.name = 'goldRing';
  goldRing.rotation.x = Math.PI / 2;
  goldRing.position.y = 0;
  capsule.add(goldRing);

  // 3. Nửa vỏ nhựa dày và đục hơn (nhựa mờ chất lượng cao)
  const plasticMatTop = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#f1f5f9'),
    transparent: true,
    opacity: 0.45,
    roughness: 0.22,
    transmission: 0.35,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const plasticMatBot = plasticMatTop.clone();

  // topShell (y >= 0): Ống trụ (radius 0.235, length 0.38) + Chỏm bán cầu ở đỉnh (y = 0.38 -> 0.61)
  const topShell = new THREE.Group();
  topShell.name = 'topShell';
  const topCylGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.38, 24, 1, true);
  const topCylMesh = new THREE.Mesh(topCylGeo, plasticMatTop);
  topCylMesh.position.y = 0.19;
  topShell.add(topCylMesh);

  // Gờ nối dày dặn ở khớp giữa
  const topLipGeo = new THREE.TorusGeometry(0.238, 0.022, 12, 28);
  const topLipMesh = new THREE.Mesh(topLipGeo, plasticMatTop);
  topLipMesh.rotation.x = Math.PI / 2;
  topLipMesh.position.y = 0.01;
  topShell.add(topLipMesh);

  const topDomeGeo = new THREE.SphereGeometry(0.235, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const topDomeMesh = new THREE.Mesh(topDomeGeo, plasticMatTop);
  topDomeMesh.position.y = 0.38;
  topShell.add(topDomeMesh);
  capsule.add(topShell);

  // bottomShell (y <= 0): Ống trụ (radius 0.23, length 0.38) + Chỏm bán cầu ở đáy (y = -0.38 -> -0.61)
  const bottomShell = new THREE.Group();
  bottomShell.name = 'bottomShell';
  const botCylGeo = new THREE.CylinderGeometry(0.23, 0.23, 0.38, 24, 1, true);
  const botCylMesh = new THREE.Mesh(botCylGeo, plasticMatBot);
  botCylMesh.position.y = -0.19;
  bottomShell.add(botCylMesh);

  const botDomeGeo = new THREE.SphereGeometry(0.23, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const botDomeMesh = new THREE.Mesh(botDomeGeo, plasticMatBot);
  botDomeMesh.position.y = -0.38;
  bottomShell.add(botDomeMesh);
  capsule.add(bottomShell);

  // Tăng kích thước viên nang lên 1.18x
  capsule.scale.setScalar(1.18);

  return capsule;
}

// Scratch vectors cho thuật toán khoảng cách 2 đoạn thẳng 3D
const _segU = new THREE.Vector3();
const _segV = new THREE.Vector3();
const _segW = new THREE.Vector3();

// Tính khoảng cách ngắn nhất giữa 2 đoạn thẳng 3D (A0 -> A1) và (B0 -> B1)
function closestPointsSegmentSegment(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  q0: THREE.Vector3,
  q1: THREE.Vector3,
  c1: THREE.Vector3,
  c2: THREE.Vector3,
): number {
  _segU.subVectors(p1, p0);
  _segV.subVectors(q1, q0);
  _segW.subVectors(p0, q0);

  const a = _segU.dot(_segU);
  const b = _segU.dot(_segV);
  const c = _segV.dot(_segV);
  const d = _segU.dot(_segW);
  const e = _segV.dot(_segW);
  const D = a * c - b * b;

  let sN = 0;
  let sD = D;
  let tN = 0;
  let tD = D;

  if (D < 1e-6) {
    sN = 0.0;
    sD = 1.0;
    tN = e;
    tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0.0) {
      sN = 0.0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  let sc = 0;
  let tc = 0;

  if (tN < 0.0) {
    tc = 0.0;
    if (-d < 0.0) sc = 0.0;
    else if (-d > a) sc = 1.0;
    else sc = -d / a;
  } else if (tN > tD) {
    tc = 1.0;
    if (-d + b < 0.0) sc = 0.0;
    else if (-d + b > a) sc = 1.0;
    else sc = (-d + b) / a;
  } else {
    tc = Math.abs(tN) < 1e-6 ? 0.0 : tN / tD;
    sc = Math.abs(sN) < 1e-6 ? 0.0 : sN / sD;
  }

  c1.copy(p0).addScaledVector(_segU, sc);
  c2.copy(q0).addScaledVector(_segV, tc);
  return c1.distanceTo(c2);
}

// Scratch vectors cho vòng lặp giải va chạm Segment-to-Segment
const _pA0 = new THREE.Vector3();
const _pA1 = new THREE.Vector3();
const _pB0 = new THREE.Vector3();
const _pB1 = new THREE.Vector3();
const _dirA = new THREE.Vector3();
const _dirB = new THREE.Vector3();
const _cA = new THREE.Vector3();
const _cB = new THREE.Vector3();
const _deltaVec = new THREE.Vector3();
const _vRel = new THREE.Vector3();
const _impulse = new THREE.Vector3();
const _armA = new THREE.Vector3();
const _armB = new THREE.Vector3();
const _torqueA = new THREE.Vector3();
const _torqueB = new THREE.Vector3();

// Giải va chạm Hình trụ Đoạn thẳng 3D (Capsule Segment-to-Segment)
function solveCapsulesCollision(
  capsules: THREE.Group[],
  iterations: number,
  applyDynamics: boolean = false,
) {
  const len = capsules.length;
  const H = 0.44;
  const R = 0.28;
  const minSep = 2 * R + 0.03; // 0.59
  const wallRadius = 1.62 - R; // 1.34
  const minY = 1.15 + R; // 1.43
  const maxY = 5.45 - R; // 5.17

  for (let it = 0; it < iterations; it++) {
    // 1. Kiểm tra 2 đầu mút A0, A1 của từng viên nang với thành và đáy/đỉnh bình thủy tinh
    for (let i = 0; i < len; i++) {
      const cap = capsules[i];
      if (!cap.visible) continue;

      _dirA.set(0, 1, 0).applyEuler(cap.rotation).normalize();
      _pA0.copy(cap.position).addScaledVector(_dirA, -H);
      _pA1.copy(cap.position).addScaledVector(_dirA, H);

      // Đầu mút A0 với thành trụ
      const rA0 = Math.hypot(_pA0.x, _pA0.z);
      if (rA0 > wallRadius && rA0 > 1e-4) {
        const pen = rA0 - wallRadius;
        const invR = 1 / rA0;
        cap.position.x -= _pA0.x * invR * pen;
        cap.position.z -= _pA0.z * invR * pen;
      }

      // Đầu mút A1 với thành trụ
      _pA1.copy(cap.position).addScaledVector(_dirA, H);
      const rA1 = Math.hypot(_pA1.x, _pA1.z);
      if (rA1 > wallRadius && rA1 > 1e-4) {
        const pen = rA1 - wallRadius;
        const invR = 1 / rA1;
        cap.position.x -= _pA1.x * invR * pen;
        cap.position.z -= _pA1.z * invR * pen;
      }

      // Cả 2 đầu mút với độ cao đáy/đỉnh minY..maxY
      _pA0.copy(cap.position).addScaledVector(_dirA, -H);
      _pA1.copy(cap.position).addScaledVector(_dirA, H);

      if (_pA0.y < minY) cap.position.y += minY - _pA0.y;
      if (_pA0.y > maxY) cap.position.y -= _pA0.y - maxY;

      _pA1.copy(cap.position).addScaledVector(_dirA, H);
      if (_pA1.y < minY) cap.position.y += minY - _pA1.y;
      if (_pA1.y > maxY) cap.position.y -= _pA1.y - maxY;
    }

    // 2. Kiểm tra va chạm từng cặp đoạn thẳng (A0, A1) và (B0, B1) giữa 2 viên nang i và j
    for (let i = 0; i < len; i++) {
      const capA = capsules[i];
      if (!capA.visible) continue;
      _dirA.set(0, 1, 0).applyEuler(capA.rotation).normalize();
      _pA0.copy(capA.position).addScaledVector(_dirA, -H);
      _pA1.copy(capA.position).addScaledVector(_dirA, H);

      for (let j = i + 1; j < len; j++) {
        const capB = capsules[j];
        if (!capB.visible) continue;
        _dirB.set(0, 1, 0).applyEuler(capB.rotation).normalize();
        _pB0.copy(capB.position).addScaledVector(_dirB, -H);
        _pB1.copy(capB.position).addScaledVector(_dirB, H);

        const dist = closestPointsSegmentSegment(_pA0, _pA1, _pB0, _pB1, _cA, _cB);
        if (dist < minSep) {
          _deltaVec.subVectors(_cA, _cB);
          let dLen = _deltaVec.length();
          if (dLen < 1e-4) {
            _deltaVec.subVectors(capA.position, capB.position);
            dLen = _deltaVec.length();
            if (dLen < 1e-4) {
              _deltaVec.set(Math.sin(i * 3.1 + it), 0.1, Math.cos(j * 2.7 + it));
              dLen = _deltaVec.length();
            }
          }
          _deltaVec.multiplyScalar(1 / dLen);
          const push = (minSep - dist) * 0.52;
          capA.position.addScaledVector(_deltaVec, push);
          capB.position.addScaledVector(_deltaVec, -push);

          if (applyDynamics) {
            const velA = capA.userData.vel as THREE.Vector3 | undefined;
            const velB = capB.userData.vel as THREE.Vector3 | undefined;
            if (velA && velB) {
              _vRel.subVectors(velA, velB);
              const vDot = _vRel.dot(_deltaVec);
              if (vDot < 0) {
                _impulse.copy(_deltaVec).multiplyScalar(vDot * 0.5);
                velA.sub(_impulse);
                velB.add(_impulse);
              }
            }

            // Xoay nhẹ góc nghiêng tránh nhau nếu va chạm ở đầu mút
            _armA.subVectors(_cA, capA.position);
            _torqueA.crossVectors(_armA, _deltaVec);
            capA.rotation.x += _torqueA.x * 0.05;
            capA.rotation.z += _torqueA.z * 0.05;

            _armB.subVectors(_cB, capB.position);
            _torqueB.crossVectors(_armB, _deltaVec);
            capB.rotation.x -= _torqueB.x * 0.05;
            capB.rotation.z -= _torqueB.z * 0.05;
          }
        }
      }
    }
  }
}

// Cập nhật bay lơ lửng đa hướng & Giải va chạm 3D Segment-to-Segment mỗi frame
export function animateGlassBottleCapsules(root: THREE.Object3D, elapsed: number, delta?: number) {
  const capsules = (root.userData.capsules as THREE.Group[]) || [];
  if (!capsules || capsules.length === 0) return;

  const dt = Math.min(delta || 0.016, 0.033);

  // =========================================================================
  // Bước A: Trôi & xoay tự do theo các hướng khác nhau
  // =========================================================================
  for (let i = 0; i < capsules.length; i++) {
    const cap = capsules[i];
    if (!cap.visible) continue;

    const vel = cap.userData.vel as THREE.Vector3 | undefined;
    const angVel = cap.userData.angVel as THREE.Vector3 | undefined;
    const phaseOffset = (cap.userData.phaseOffset as number) || 0;
    if (!vel || !angVel) continue;

    // Lực trôi uốn lượn nhẹ theo hướng riêng
    const wobbleX = Math.sin(elapsed * 1.5 + phaseOffset) * 0.04;
    const wobbleY = Math.cos(elapsed * 1.8 + phaseOffset * 1.3) * 0.04;
    const wobbleZ = Math.sin(elapsed * 1.4 + phaseOffset * 0.7) * 0.04;

    cap.position.x += (vel.x + wobbleX) * dt;
    cap.position.y += (vel.y + wobbleY) * dt;
    cap.position.z += (vel.z + wobbleZ) * dt;

    // Xoay chậm tự nhiên theo hướng riêng
    cap.rotation.x += angVel.x * dt;
    cap.rotation.y += angVel.y * dt;
    cap.rotation.z += angVel.z * dt;

    // Đảo chiều vận tốc nếu chạm biên lòng bình
    const rXZ = Math.hypot(cap.position.x, cap.position.z);
    if (rXZ > 1.25) {
      const nx = cap.position.x / rXZ;
      const nz = cap.position.z / rXZ;
      const dot = vel.x * nx + vel.z * nz;
      if (dot > 0) {
        vel.x -= 2 * dot * nx;
        vel.z -= 2 * dot * nz;
      }
    }
    if (cap.position.y < 1.50 && vel.y < 0) vel.y = -vel.y;
    if (cap.position.y > 5.10 && vel.y > 0) vel.y = -vel.y;
  }

  // =========================================================================
  // Bước B: Giải va chạm Hình trụ Đoạn thẳng 3D (6 vòng lặp mỗi frame)
  // =========================================================================
  solveCapsulesCollision(capsules, 6, true);
}

// Khởi tạo 31 viên nang nằm LỘN XỘN đủ mọi góc độ 3D, bay lơ lửng đa hướng
export function createLetterCapsulesGroup(): { capsulesGroup: THREE.Group; capsulesList: THREE.Group[] } {
  const capsulesGroup = new THREE.Group();
  capsulesGroup.name = 'letterCapsulesGroup';
  const capsulesList: THREE.Group[] = [];

  const totalLetters = Math.min(31, (lettersData as LetterItem[]).length);
  const goldenAngle = 2.39996322972865332; // phi * 2pi

  for (let i = 0; i < totalLetters; i++) {
    const letter = (lettersData as LetterItem[])[i];
    const capsule = createSingleCapsule(letter);
    capsule.scale.setScalar(1.18);

    // Phân bố độ cao y và bán kính r rải đều trong lòng bình
    const y = 1.65 + (i / (totalLetters - 1 || 1)) * 3.3 + Math.sin(i * 2.3) * 0.12;
    const angle = (i * goldenAngle) % (Math.PI * 2);
    const r = 0.25 + ((i * 7) % 5) * 0.17; // 0.25 -> 0.93

    capsule.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

    // Góc xoay 3D ngẫu nhiên hoàn toàn trên cả 3 trục (viên nằm ngang, chéo 45 độ, dựng đứng, chúc đầu...)
    capsule.rotation.order = 'YXZ';
    capsule.rotation.x = ((i * 4.1 + 0.8) % (Math.PI * 2)) - Math.PI;
    capsule.rotation.y = ((i * 2.7 + 1.5) % (Math.PI * 2)) - Math.PI;
    capsule.rotation.z = ((i * 5.3 + 2.3) % (Math.PI * 2)) - Math.PI;

    // Vector vận tốc trôi 3D riêng biệt (tốc độ nhỏ ~0.18 đv/s)
    const speed = 0.16 + ((i * 3) % 4) * 0.02; // 0.16 -> 0.22
    const vTheta = (i * 3.7 + 1.1) % (Math.PI * 2);
    const vPhi = (((i * 2.9) % 2.0) - 1.0) * 0.45;
    const cosP = Math.cos(vPhi);
    const vx = Math.cos(vTheta) * cosP * speed;
    const vy = Math.sin(vPhi) * speed;
    const vz = Math.sin(vTheta) * cosP * speed;
    capsule.userData.vel = new THREE.Vector3(vx, vy, vz);

    // Vector vận tốc xoay chậm riêng (~0.25 rad/s)
    const wx = (((i * 7.1 + 0.5) % 2.0) - 1.0) * 0.25;
    const wy = (((i * 3.9 + 1.2) % 2.0) - 1.0) * 0.25;
    const wz = (((i * 5.7 + 2.1) % 2.0) - 1.0) * 0.25;
    capsule.userData.angVel = new THREE.Vector3(wx, wy, wz);

    capsule.userData.phaseOffset = (i * 1.618) % (Math.PI * 2);

    capsulesGroup.add(capsule);
    capsulesList.push(capsule);
  }

  // Giải va chạm ban đầu 35 vòng lặp để các viên nang tách rời hoàn toàn ngay từ frame đầu tiên
  solveCapsulesCollision(capsulesList, 35, false);

  for (const cap of capsulesList) {
    cap.userData.initialPosition = cap.position.clone();
    cap.userData.initialRotation = cap.rotation.clone();
  }

  return { capsulesGroup, capsulesList };
}

export function prepareKeepsakeScene(
  sourceScene: THREE.Object3D,
  item: KeepsakeManifestItem,
): THREE.Group {
  const cloned = sourceScene.clone(true);
  const wrapper = new THREE.Group();

  // 1. CHIẾC LỌ THỦY TINH: Bỏ nước + kéo dài thân hình trụ 1.5x + thắt nơ dây thừng ở cổ chai
  if (item.id === 'glass-bottle') {
    const toRemove: THREE.Object3D[] = [];
    const yCylBot = 0.63;
    const yCylTop = 3.60; // Đỉnh phần thân hình trụ
    const stretchFactor = 1.5; // Kéo dài phần thân hình trụ gấp 1.5 lần
    const newCylTop = yCylBot + (yCylTop - yCylBot) * stretchFactor; // 0.63 + 2.97 * 1.5 = 5.085
    const totalDeltaY = newCylTop - yCylTop; // +1.485

    let bottleParentNode: THREE.Object3D | null = null;

    cloned.traverse((child) => {
      const name = child.name.toLowerCase();
      if (
        /liquid|cube|interior|object_8|object_10|object_12|object_14|object_16|object_18|object_20|object_22|object_24|object_26/i.test(
          name,
        )
      ) {
        toRemove.push(child);
        return;
      }

      // Giữ nguyên kích thước gốc của nút bần (Cork_3), chỉ tịnh tiến lên theo độ giãn thân trụ (+1.485)
      if (/cork_3/i.test(name)) {
        child.position.y += totalDeltaY;
        child.updateMatrix();
        child.userData.closedPos = child.position.clone();
        child.userData.closedRot = child.rotation.clone();
        wrapper.userData.corkNode = child;
        cloned.userData.corkNode = child;
      }

      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const matName = mat?.name?.toLowerCase() || '';

        if (/liquid|interior/i.test(matName)) {
          toRemove.push(mesh);
          return;
        }

        if (/glass/i.test(matName)) {
          bottleParentNode = mesh.parent || cloned;

          // Giữ nguyên bán kính ngang (X, Z) và hình dáng cổ/miệng lọ gốc, chỉ kéo dài đoạn hình trụ (0.63 -> 3.60) gấp 1.5x
          const geo = mesh.geometry.clone();
          const pos = geo.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > yCylBot && y <= yCylTop) {
              pos.setY(i, yCylBot + (y - yCylBot) * stretchFactor);
            } else if (y > yCylTop) {
              pos.setY(i, y + totalDeltaY);
            }
          }
          pos.needsUpdate = true;
          geo.computeVertexNormals();
          geo.computeBoundingBox();
          geo.computeBoundingSphere();
          mesh.geometry = geo;

          mesh.material = createCrystalGlassMaterial();
        } else if (/cork/i.test(matName)) {
          const corkMat = mat.clone();
          corkMat.roughness = 0.72;
          corkMat.metalness = 0.05;
          mesh.material = corkMat;
        }
      }
    });

    toRemove.forEach((obj) => {
      obj.visible = false;
      if (obj.parent) obj.parent.remove(obj);
    });

    // Thêm sợi dây thừng thắt nơ ở eo cổ chai (tại y = 5.45 + 1.485 = 6.935, bán kính cổ chai = 2.11)
    const { ropeGroup, bowLooseGroup } = createNeckRopeBow(5.45 + totalDeltaY, 2.11);
    if (bottleParentNode) {
      (bottleParentNode as THREE.Object3D).add(ropeGroup);
    } else {
      cloned.add(ropeGroup);
    }
    wrapper.userData.ropeBowGroup = bowLooseGroup;
    cloned.userData.ropeBowGroup = bowLooseGroup;

    // Dựng 31 viên nang thư đặt trong lòng phần thân hình trụ của lọ (y từ 1.15 đến 4.75, r <= 1.55)
    const { capsulesGroup, capsulesList } = createLetterCapsulesGroup();
    if (bottleParentNode) {
      (bottleParentNode as THREE.Object3D).add(capsulesGroup);
    } else {
      cloned.add(capsulesGroup);
    }
    wrapper.userData.capsules = capsulesList;
    cloned.userData.capsules = capsulesList;
  }

  // 2. CHIẾC VÒNG TAY CỎ 4 LÁ: Tách InterleavedBuffer thành BufferAttribute độc lập + Dây mềm mại lỏng lẻo
  if (item.id === 'clover-bracelet') {
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const srcGeo = mesh.geometry;
        const srcPos = srcGeo.attributes.position;
        const srcUv = srcGeo.attributes.uv;
        const count = srcPos.count;

        // Tách rời InterleavedBuffer (stride = 5) thành BufferAttribute chuẩn (stride = 3 cho position, stride = 2 cho uv)
        const cleanPos = new Float32Array(count * 3);
        const cleanUv = new Float32Array(count * 2);

        for (let i = 0; i < count; i++) {
          cleanPos[i * 3] = srcPos.getX(i);
          cleanPos[i * 3 + 1] = srcPos.getY(i);
          cleanPos[i * 3 + 2] = srcPos.getZ(i);
          if (srcUv) {
            cleanUv[i * 2] = srcUv.getX(i);
            cleanUv[i * 2 + 1] = srcUv.getY(i);
          }
        }

        const geo = new THREE.BufferGeometry();
        if (srcGeo.index) {
          geo.setIndex(srcGeo.index.clone());
        }
        geo.setAttribute('position', new THREE.BufferAttribute(cleanPos, 3));
        if (srcUv) {
          geo.setAttribute('uv', new THREE.BufferAttribute(cleanUv, 2));
        }

        geo.userData.restPositions = new Float32Array(cleanPos);
        geo.computeVertexNormals();

        mesh.geometry = geo;
        wrapper.userData.braceletMesh = mesh;

        const oldMat = mesh.material as THREE.MeshStandardMaterial;
        const remappedMap = oldMat?.map ? recolorBraceletTexture(oldMat.map) : null;

        mesh.material = new THREE.MeshPhysicalMaterial({
          map: remappedMap,
          color: new THREE.Color('#ffffff'),
          metalness: 0.35,
          roughness: 0.2,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          reflectivity: 1.0,
          emissiveMap: remappedMap,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 0.32,
          side: THREE.DoubleSide,
        });
      }
    });

    // Áp dụng độ rủ ban đầu trước khi đo BoundingBox
    animateSuppleBracelet(wrapper, 0);
    cloned.rotation.set(0.55, 0, 0);
  }

  // 3. BỨC THƯ TÌNH YÊU: Giữ texture gốc, nâng cấp material sắc nét trong không gian tối
  if (item.id === 'love-letter') {
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const oldMat = mesh.material as THREE.MeshStandardMaterial;
        if (oldMat?.map) {
          oldMat.map.colorSpace = THREE.SRGBColorSpace;
          oldMat.map.needsUpdate = true;
        }
        mesh.material = new THREE.MeshStandardMaterial({
          map: oldMat?.map || null,
          color: new THREE.Color('#ffffff'),
          roughness: 0.42,
          metalness: 0.05,
          emissiveMap: oldMat?.map || null,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 0.22,
          side: THREE.DoubleSide,
        });
      }
    });
  }

  // 3. Căn tâm (0, 0, 0) và chuẩn hóa kích thước
  cloned.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cloned);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  // Lọ thủy tinh cao thon nên cho phép chiều dài tổng thể lớn hơn một chút (2.5x radius)
  const targetSize = (item.radius || 0.55) * (item.id === 'glass-bottle' ? 2.5 : 2.1);
  const scale = targetSize / maxDim;

  cloned.scale.multiplyScalar(scale);
  cloned.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

  wrapper.add(cloned);
  return wrapper;
}
