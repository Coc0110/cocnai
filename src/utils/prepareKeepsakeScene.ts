import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KeepsakeManifestItem } from '../types/universe';

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
