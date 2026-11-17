import * as THREE from 'three';
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
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Nền màu dây thừng gai tự nhiên (Warm Burlap / Jute Twine)
  ctx.fillStyle = '#c69c6d';
  ctx.fillRect(0, 0, 256, 256);

  // Vẽ các thớ sợi gai xoắn chéo tạo hiệu ứng bện thừng 3D
  for (let i = -256; i < 512; i += 8) {
    ctx.strokeStyle = i % 16 === 0 ? '#9c7144' : '#dfc096';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
  }

  // Thêm nhiễu hạt sợi gai nhỏ
  const imgData = ctx.getImageData(0, 0, 256, 256);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grain = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const delta = (grain - 0.5) * 26;
    data[i] = Math.min(255, Math.max(0, data[i] + delta));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + delta));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + delta));
  }
  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  cachedRopeTexture = tex;
  return tex;
}

function createNeckRopeBow(neckY: number, neckRadius: number): THREE.Group {
  const ropeGroup = new THREE.Group();
  const ropeTex = getJuteRopeTexture();

  const ropeMat = new THREE.MeshStandardMaterial({
    map: ropeTex,
    bumpMap: ropeTex,
    bumpScale: 0.04,
    color: new THREE.Color('#d7b388'),
    roughness: 0.88,
    metalness: 0.02,
  });

  const ropeThickness = 0.095;

  // 1. Ba vòng dây thừng quấn sát quanh cổ chai
  const wrapOffsets = [-0.14, 0.0, 0.14];
  wrapOffsets.forEach((dy, idx) => {
    const pts: THREE.Vector3[] = [];
    const segs = 48;
    const r = neckRadius + (idx === 1 ? 0.045 : 0.015);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const wobbleY = Math.sin(a * 5 + idx * 1.7) * 0.03;
      const wobbleR = Math.cos(a * 4 + idx) * 0.02;
      pts.push(
        new THREE.Vector3(
          Math.sin(a) * (r + wobbleR),
          neckY + dy + wobbleY,
          Math.cos(a) * (r + wobbleR),
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, 72, ropeThickness, 10, true);
    ropeGroup.add(new THREE.Mesh(geo, ropeMat));
  });

  const knotZ = neckRadius + 0.16;

  // 2. Nút thắt dây thừng ở chính giữa mặt trước cổ chai
  const knotPts = [
    new THREE.Vector3(-0.22, neckY + 0.10, knotZ - 0.04),
    new THREE.Vector3(0.0, neckY + 0.16, knotZ + 0.10),
    new THREE.Vector3(0.22, neckY - 0.08, knotZ + 0.06),
    new THREE.Vector3(-0.18, neckY - 0.12, knotZ + 0.08),
    new THREE.Vector3(0.0, neckY + 0.06, knotZ + 0.14),
  ];
  const knotCurve = new THREE.CatmullRomCurve3(knotPts, true);
  ropeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(knotCurve, 32, ropeThickness * 1.18, 10, true), ropeMat));

  // 3. Hai cánh nơ (Bow Loops) xòe rộng sang hai bên trái & phải như hình mẫu
  [-1, 1].forEach((dir) => {
    // Tạo 2 sợi chập đôi cho mỗi bên cánh nơ giống hình chụp
    [0, 1].forEach((strand) => {
      const sOff = strand * 0.09;
      const loopCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(dir * 0.08, neckY + 0.02, knotZ + 0.05),
        new THREE.Vector3(dir * 1.35, neckY + 0.34 - sOff, knotZ + 0.18),
        new THREE.Vector3(dir * 2.85, neckY + 0.05 - sOff * 1.2, knotZ - 0.05),
        new THREE.Vector3(dir * 3.15, neckY - 0.45 - sOff, knotZ - 0.15),
        new THREE.Vector3(dir * 2.25, neckY - 0.72 + sOff, knotZ + 0.08),
        new THREE.Vector3(dir * 0.95, neckY - 0.35 + sOff * 0.5, knotZ + 0.14),
        new THREE.Vector3(dir * 0.08, neckY - 0.04, knotZ + 0.05),
      ]);
      const loopGeo = new THREE.TubeGeometry(loopCurve, 64, ropeThickness * 0.92, 10, false);
      ropeGroup.add(new THREE.Mesh(loopGeo, ropeMat));
    });
  });

  // 4. Hai đuôi dây thừng buông rủ tự nhiên xuống dọc mặt trước thân lọ
  // Đuôi bên trái
  const leftTail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.08, neckY - 0.06, knotZ + 0.08),
    new THREE.Vector3(-0.55, neckY - 0.85, knotZ + 0.48),
    new THREE.Vector3(-0.98, neckY - 1.95, knotZ + 0.55),
    new THREE.Vector3(-1.22, neckY - 3.10, knotZ + 0.42),
  ]);
  ropeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(leftTail, 48, ropeThickness * 0.95, 10, false), ropeMat));

  // Đuôi bên phải
  const rightTail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08, neckY - 0.06, knotZ + 0.08),
    new THREE.Vector3(0.62, neckY - 0.80, knotZ + 0.45),
    new THREE.Vector3(1.18, neckY - 1.85, knotZ + 0.48),
    new THREE.Vector3(1.58, neckY - 2.95, knotZ + 0.32),
  ]);
  ropeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(rightTail, 48, ropeThickness * 0.95, 10, false), ropeMat));

  return ropeGroup;
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
    const ropeBow = createNeckRopeBow(5.45 + totalDeltaY, 2.11);
    if (bottleParentNode) {
      (bottleParentNode as THREE.Object3D).add(ropeBow);
    } else {
      cloned.add(ropeBow);
    }
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
