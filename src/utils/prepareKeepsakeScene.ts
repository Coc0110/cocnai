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

    // Độ sáng tương đối của từng điểm ảnh (giữ nguyên khối sáng tối 3D và hạt đá)
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const redness = r - (g * 0.65 + b * 0.35);

    if (redness > 15) {
      // VÙNG CÁNH HOA CỎ 4 LÁ Ở GIỮA:
      // Chuyển từ màu nâu gạch sang màu Hồng Phấn Thạch Anh (Rose Quartz Pink) trong trẻo như ảnh mẫu
      const t = Math.min(1, (redness - 15) / 45);
      const shade = 0.78 + lum * 0.34;
      const pinkR = Math.min(255, Math.round(248 * shade));
      const pinkG = Math.min(255, Math.round(182 * shade));
      const pinkB = Math.min(255, Math.round(206 * shade));

      // Pha mượt ở viền tiếp giáp với khung bạc
      const silverVal = Math.min(255, Math.round(215 + lum * 45));
      data[i] = Math.round(silverVal * (1 - t) + pinkR * t);
      data[i + 1] = Math.round(silverVal * (1 - t) + pinkG * t);
      data[i + 2] = Math.round(silverVal * (1 - t) + pinkB * t);
    } else {
      // VÙNG DÂY BẠC, CHẤU BẠC & CỎ 4 LÁ ĐÍNH ĐÁ KIM CƯƠNG:
      // Đổi từ xám đục sang Bạc Bạch Kim (Platinum Silver) & Kim Cương Trắng lấp lánh
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

export function prepareKeepsakeScene(
  sourceScene: THREE.Object3D,
  item: KeepsakeManifestItem,
): THREE.Group {
  const cloned = sourceScene.clone(true);

  // 1. CHIẾC LỌ THỦY TINH: Bỏ toàn bộ phần nước và bọt nước bên trong + làm trong suốt vỏ thủy tinh
  if (item.id === 'glass-bottle') {
    const toRemove: THREE.Object3D[] = [];

    cloned.traverse((child) => {
      const name = child.name.toLowerCase();
      if (/liquid|cube|object_8|object_12|object_14|object_16|object_18|object_20|object_22|object_24|object_26/i.test(name)) {
        toRemove.push(child);
        return;
      }

      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const matName = mat?.name?.toLowerCase() || '';

        if (/liquid/i.test(matName)) {
          toRemove.push(mesh);
          return;
        }

        if (/glass/i.test(matName)) {
          const isInterior = /interior/i.test(matName);
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(isInterior ? '#bae6fd' : '#e0f2fe'),
            transparent: true,
            opacity: isInterior ? 0.18 : 0.32,
            roughness: 0.08,
            metalness: 0.05,
            transmission: 0.65,
            ior: 1.48,
            reflectivity: 0.9,
            clearcoat: 1.0,
            clearcoatRoughness: 0.06,
            emissive: new THREE.Color('#7dd3fc'),
            emissiveIntensity: 0.12,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
        } else if (/cork/i.test(matName)) {
          const corkMat = mat.clone();
          corkMat.roughness = 0.75;
          corkMat.metalness = 0.05;
          mesh.material = corkMat;
        }
      }
    });

    toRemove.forEach((obj) => {
      obj.visible = false;
      if (obj.parent) obj.parent.remove(obj);
    });
  }

  // 2. CHIẾC VÒNG TAY CỎ 4 LÁ: Tính lại Vertex Normals & đổi màu Bạc Bạch Kim + Hồng Phấn Thạch Anh
  if (item.id === 'clover-bracelet') {
    cloned.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry && !mesh.geometry.attributes.normal) {
          mesh.geometry.computeVertexNormals();
        }

        const oldMat = mesh.material as THREE.MeshStandardMaterial;
        const remappedMap = oldMat?.map ? recolorBraceletTexture(oldMat.map) : null;

        mesh.material = new THREE.MeshPhysicalMaterial({
          map: remappedMap,
          color: new THREE.Color('#ffffff'),
          metalness: 0.38,
          roughness: 0.18,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          reflectivity: 1.0,
          emissiveMap: remappedMap,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 0.30,
          side: THREE.DoubleSide,
        });
      }
    });

    // Nghiêng nhẹ chiếc vòng để mặt cỏ 4 lá hồng phấn hướng đẹp về phía người xem
    cloned.rotation.set(0.65, 0, 0);
  }

  // 3. Tự động căn tâm (0, 0, 0) và chuẩn hóa kích thước đồng đều theo item.radius * 2.1
  cloned.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(cloned);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const targetSize = (item.radius || 0.55) * 2.1;
  const scale = targetSize / maxDim;

  cloned.scale.multiplyScalar(scale);
  cloned.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

  const wrapper = new THREE.Group();
  wrapper.add(cloned);
  return wrapper;
}
