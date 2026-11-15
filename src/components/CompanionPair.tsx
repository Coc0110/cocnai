import { useRef, useEffect, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as THREE from 'three';
import { useUniverseStore } from '../store/useUniverseStore';

interface CompanionEntityProps {
  id: 'froakie' | 'deerling';
  daeUrl: string;
  sparkleColor: string;
  initialPos: [number, number, number];
  targetHeight: number;
  deerlingPosRef: React.MutableRefObject<THREE.Vector3>;
}

interface EyeLayerConfig {
  url: string;
  rgb: [number, number, number];
}

// Bộ biến tạm tái sử dụng để tránh tạo rác bộ nhớ mỗi frame (60-120fps)
const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();

/**
 * Xoay xương an toàn trong không gian cục bộ (Local Space) dựa trên Quaternion gốc.
 * Tuyệt đối không bị Gimbal Lock hay lệch góc Bind-Pose của file .dae gốc.
 */
function rotateBoneLocal(bone: THREE.Bone | undefined, rx: number, ry: number, rz: number) {
  if (!bone || !bone.userData.restQuat) return;
  tempEuler.set(rx, ry, rz, 'XYZ');
  tempQuat.setFromEuler(tempEuler);
  bone.quaternion.copy(bone.userData.restQuat).multiply(tempQuat);
}

/**
 * Tạo CanvasTexture mắt chuẩn game Pokémon bằng cách pha màu 4 lớp mask (_lym_layer1..4.png)
 * trực tiếp trên mảng ImageData theo kênh Đỏ (Red mask: R = 0..255).
 * Tuyệt đối không dùng blend mode 'destination-in' để tránh bị lớp trắng layer4 đè xóa.
 */
async function generateEyeTexture(
  baseRgb: [number, number, number],
  layers: EyeLayerConfig[],
): Promise<THREE.CanvasTexture> {
  const loadedImages = await Promise.all(
    layers.map(
      (l) =>
        new Promise<HTMLImageElement>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img);
          img.src = l.url;
        }),
    ),
  );

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  // Khởi tạo toàn bộ pixel 256x256 bằng baseRgb (alpha = 255)
  const out = ctx.createImageData(256, 256);
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = baseRgb[0];
    out.data[i + 1] = baseRgb[1];
    out.data[i + 2] = baseRgb[2];
    out.data[i + 3] = 255;
  }

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 256;
  tempCanvas.height = 256;
  const tempCtx = tempCanvas.getContext('2d');

  if (tempCtx) {
    for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
      const img = loadedImages[layerIdx];
      const layer = layers[layerIdx];
      if (!img || !img.width) continue;

      tempCtx.clearRect(0, 0, 256, 256);
      tempCtx.drawImage(img, 0, 0, 256, 256);
      const maskData = tempCtx.getImageData(0, 0, 256, 256).data;

      // Trộn màu tuyến tính theo kênh Đỏ (maskData[i] / 255.0)
      for (let i = 0; i < out.data.length; i += 4) {
        const mask = maskData[i] / 255.0;
        out.data[i] = out.data[i] * (1 - mask) + layer.rgb[0] * mask;
        out.data[i + 1] = out.data[i + 1] * (1 - mask) + layer.rgb[1] * mask;
        out.data[i + 2] = out.data[i + 2] * (1 - mask) + layer.rgb[2] * mask;
      }
    }
  }

  ctx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function CompanionEntity({
  id,
  daeUrl,
  sparkleColor,
  initialPos,
  targetHeight,
  deerlingPosRef,
}: CompanionEntityProps) {
  const [modelScene, setModelScene] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const modelInnerRef = useRef<THREE.Group>(null);
  const bonesMapRef = useRef<Record<string, THREE.Bone>>({});

  const excitedCompanion = useUniverseStore((s) => s.excitedCompanion);
  const triggerCompanion = useUniverseStore((s) => s.triggerCompanion);

  const isExcited = excitedCompanion !== null;
  const currentPosRef = useRef<[number, number, number]>([...initialPos]);

  // Bộ biến trạng thái hành vi cho Deerling
  const deerlingTravelRef = useRef<number>(0.0);

  // Bộ biến trạng thái hành vi cho Froakie
  const hopStartPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...initialPos));
  const hopTargetPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...initialPos));
  const lastHopIndexRef = useRef<number>(-1);

  // Tải model Collada DAE và xử lý cấu trúc xương & texture chuẩn
  useEffect(() => {
    let isCancelled = false;
    const loader = new ColladaLoader();
    const texLoader = new THREE.TextureLoader();

    const eyePromise =
      id === 'froakie'
        ? generateEyeTexture([19, 14, 11], [
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer1.png', rgb: [181, 144, 32] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer2.png', rgb: [19, 14, 11] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer3.png', rgb: [3, 3, 3] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer4.png', rgb: [255, 255, 255] },
          ])
        : generateEyeTexture([65, 58, 53], [
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer1.png', rgb: [182, 179, 115] },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer2.png', rgb: [65, 58, 53] },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer3.png', rgb: [3, 3, 3] },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer4.png', rgb: [255, 255, 255] },
          ]);

    Promise.all([
      new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(daeUrl, (collada) => resolve(collada.scene), undefined, reject);
      }),
      eyePromise,
    ]).then(([scene, eyeTex]) => {
      if (isCancelled) return;

      // 1. Đặt scene.rotation.set(0, 0, 0) để nhân vật luôn đứng thẳng theo trục +Y
      scene.rotation.set(0, 0, 0);

      const bones: Record<string, THREE.Bone> = {};

      scene.traverse((child) => {
        const name = child.name.toLowerCase();

        // 2. Lưu góc xoay gốc bằng Quaternion cho từng xương thật
        if ((child as THREE.Bone).isBone || child.type === 'Bone') {
          child.userData.restQuat = child.quaternion.clone();
          bones[name] = child as THREE.Bone;
        }

        // 3. Ẩn LOD trùng (Deerling tuyệt đối KHÔNG ẩn var_tex vì là node cha của thân và hoa)
        if (id === 'froakie') {
          if (/lod1|lod2|eye_b|body_c/i.test(child.name)) {
            child.visible = false;
          }
        } else if (id === 'deerling') {
          if (/lod1|lod2/i.test(child.name)) {
            child.visible = false;
          }
        }

        // 4. Gán texture chuẩn cho mắt và thân
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material;

          const applyMatProps = (m: THREE.Material) => {
            const std = m as THREE.MeshStandardMaterial;
            const matName = m.name.toLowerCase();

            if (/eye/i.test(matName) || /eye/i.test(mesh.name)) {
              std.map = eyeTex;
              if (std.color) std.color.setHex(0xffffff);
              std.roughness = 0.15;
              std.metalness = 0.05;
              std.needsUpdate = true;
            } else if (id === 'froakie') {
              if (/body_a/i.test(matName) || /body_a/i.test(mesh.name)) {
                std.map = texLoader.load('/models/companions/froakie/pm0723_00_00_body_a_alb.png', (t) => {
                  t.colorSpace = THREE.SRGBColorSpace;
                });
                std.normalMap = texLoader.load('/models/companions/froakie/pm0723_00_00_body_a_nrm.png');
                std.aoMap = texLoader.load('/models/companions/froakie/pm0723_00_00_body_a_ao.png');
              } else if (/body_b/i.test(matName) || /body_b/i.test(mesh.name)) {
                std.map = texLoader.load('/models/companions/froakie/pm0723_00_00_body_b_alb.png', (t) => {
                  t.colorSpace = THREE.SRGBColorSpace;
                });
                std.normalMap = texLoader.load('/models/companions/froakie/pm0723_00_00_body_b_nrm.png');
                std.aoMap = texLoader.load('/models/companions/froakie/pm0723_00_00_body_b_ao.png');
              }
              if (std.color) std.color.setHex(0xffffff);
              std.roughness = 0.35;
              std.needsUpdate = true;
            } else if (id === 'deerling') {
              std.map = texLoader.load('/models/companions/deerling/pm0585_11_00_body_alb.png', (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
              });
              std.normalMap = texLoader.load('/models/companions/deerling/pm0585_11_00_body_nrm.png');
              std.aoMap = texLoader.load('/models/companions/deerling/pm0585_11_00_body_ao.png');
              if (std.color) std.color.setHex(0xffffff);
              std.roughness = 0.4;
              std.needsUpdate = true;
            }
          };

          if (Array.isArray(mat)) {
            mat.forEach(applyMatProps);
          } else if (mat) {
            applyMatProps(mat);
          }
        }
      });

      // 5. Chuẩn hóa kích thước & Căn tâm theo Box3 sau khi reset rotation
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const scale = targetHeight / (size.y || 1);
      scene.scale.setScalar(scale);
      scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

      bonesMapRef.current = bones;
      setModelScene(scene);
    });

    return () => {
      isCancelled = true;
    };
  }, [id, daeUrl, targetHeight]);

  useFrame((state, delta) => {
    if (!groupRef.current || !modelInnerRef.current) return;

    const elapsed = state.clock.getElapsedTime();
    const bones = bonesMapRef.current;

    // =========================================================================
    // TRẠNG THÁI HÀO HỨNG KHI ĐƯỢC CHẠM VÀO (EXCITED STATE)
    // =========================================================================
    if (isExcited) {
      const bounce = Math.abs(Math.sin(elapsed * 9.0)) * 0.28;
      modelInnerRef.current.position.y = bounce;

      if (id === 'froakie') {
        rotateBoneLocal(bones['left_arm_01'], 0, 0, Math.sin(elapsed * 12.0) * 0.35 + 0.45);
        rotateBoneLocal(bones['right_arm_01'], 0, 0, -Math.sin(elapsed * 12.0) * 0.35 - 0.45);
        rotateBoneLocal(bones['head'], 0, Math.sin(elapsed * 9.0) * 0.16, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, bounce * 0.4, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, -bounce * 0.4, 0);
      } else if (id === 'deerling') {
        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 14.0) * 0.32);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 14.0) * 0.32);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 12.0) * 0.42);
        rotateBoneLocal(bones['head'], 0, Math.sin(elapsed * 9.0) * 0.16, 0);
        rotateBoneLocal(bones['left_arm_01'], 0, bounce * 0.35, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, -bounce * 0.35, 0);
      }
      return;
    }

    // =========================================================================
    // MÁY TRẠNG THÁI HOẠT ẢNH CHO DEERLING (CHU KỲ 14 GIÂY)
    // =========================================================================
    if (id === 'deerling') {
      const cycleTime = elapsed % 14.0;

      if (cycleTime < 6.5) {
        // Giai đoạn 1 (0.0s .. 6.5s): ĐI BỘ THONG DONG (WALKING)
        deerlingTravelRef.current += delta * 0.42;
        const t = deerlingTravelRef.current;

        const posX = Math.cos(t) * 3.6;
        const posZ = Math.sin(t) * 3.6;
        const posY = Math.sin(t * 0.7) * 0.4;

        currentPosRef.current = [posX, posY, posZ];
        groupRef.current.position.set(posX, posY, posZ);
        deerlingPosRef.current.set(posX, posY, posZ);
        modelInnerRef.current.position.y = 0;

        // Xoay hướng mặt theo tiếp tuyến quỹ đạo di chuyển
        const targetYaw = Math.atan2(-Math.sin(t), Math.cos(t));
        let diffYaw = (targetYaw - groupRef.current.rotation.y) % (Math.PI * 2);
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 4.0);
        groupRef.current.rotation.x = 0; // Luôn đứng thẳng tự nhiên
        groupRef.current.rotation.z = 0;

        // 4 chân bước chéo nhịp nhàng
        const walkCycle = elapsed * 5.2;
        const swing = Math.sin(walkCycle) * 0.32;
        const kneeA = Math.max(0, Math.cos(walkCycle)) * 0.35;
        const kneeB = Math.max(0, -Math.cos(walkCycle)) * 0.35;

        rotateBoneLocal(bones['left_arm_01'], 0, swing, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, -kneeA, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, -swing, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, -kneeB, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, -swing * 0.9, 0);
        rotateBoneLocal(bones['left_leg_02'], 0, kneeB * 0.8, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, swing * 0.9, 0);
        rotateBoneLocal(bones['right_leg_02'], 0, kneeA * 0.8, 0);

        rotateBoneLocal(bones['spine_02'], 0, 0, 0);
        rotateBoneLocal(bones['neck'], 0, Math.sin(walkCycle * 2) * 0.06, 0);
        rotateBoneLocal(bones['head'], 0, Math.sin(walkCycle * 2 + 0.4) * 0.05, 0);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 4.5) * 0.25);
        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 3.0) * 0.12);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 3.0) * 0.12);
      } else if (cycleTime < 11.0) {
        // Giai đoạn 2 (6.5s .. 11.0s): DỪNG LẠI CÚI XUỐNG ĂN CỎ & NGỬI MÙI (GRAZING_SNIFFING)
        // Deerling dừng di chuyển vị trí, 4 chân đứng yên
        rotateBoneLocal(bones['left_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_02'], 0, 0, 0);

        // Tính hệ số cúi cổ mượt
        const bend =
          THREE.MathUtils.smoothstep(cycleTime, 6.5, 7.3) *
          (1.0 - THREE.MathUtils.smoothstep(cycleTime, 10.2, 11.0));

        rotateBoneLocal(bones['spine_02'], 0, -bend * 0.16, 0);
        rotateBoneLocal(bones['neck'], 0, -bend * 0.48, 0);

        const chew = Math.sin(elapsed * 7.5) * 0.11 * bend;
        const sniffYaw = Math.sin(elapsed * 2.8) * 0.14 * bend;
        rotateBoneLocal(bones['head'], 0, bend * 0.22 + chew, sniffYaw);

        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 3.5) * 0.15);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 3.5) * 0.15);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 3.0) * 0.18);
      } else {
        // Giai đoạn 3 (11.0s .. 14.0s): ĐỨNG NGẨNG ĐẦU NHÌN QUANH, VẪY TAI & NGOẮC ĐUÔI (LOOKING_AROUND)
        // 4 chân đứng yên
        rotateBoneLocal(bones['left_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_02'], 0, 0, 0);
        rotateBoneLocal(bones['spine_02'], 0, 0, 0);

        rotateBoneLocal(bones['neck'], 0, 0.08, 0);
        rotateBoneLocal(bones['head'], 0, 0.08, Math.sin(elapsed * 2.4) * 0.28);

        const earFlick = Math.sin(elapsed * 10.0) * 0.26;
        rotateBoneLocal(bones['left_ear'], 0, 0, earFlick);
        rotateBoneLocal(bones['right_ear'], 0, 0, -earFlick);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 6.0) * 0.35);
      }
    }

    // =========================================================================
    // MÁY TRẠNG THÁI HOẠT ẢNH CHO FROAKIE (CHU KỲ 2.2 GIÂY)
    // =========================================================================
    if (id === 'froakie') {
      const hopCycle = elapsed % 2.2;
      const currentHopIndex = Math.floor(elapsed / 2.2);

      // Khi bước sang một chu kỳ bật nhảy mới: xác định điểm đáp tiếp theo quanh Deerling
      if (currentHopIndex !== lastHopIndexRef.current) {
        lastHopIndexRef.current = currentHopIndex;
        hopStartPosRef.current.set(...currentPosRef.current);

        const dPos = deerlingPosRef.current;
        // Chọn góc đậu quanh Deerling để luôn bay nhảy kề bên bạn
        const angle = currentHopIndex * 1.85;
        const dist = 1.35 + Math.sin(currentHopIndex * 2.1) * 0.35;
        hopTargetPosRef.current.set(
          dPos.x + Math.cos(angle) * dist,
          dPos.y + Math.sin(currentHopIndex * 1.4) * 0.25,
          dPos.z + Math.sin(angle) * dist,
        );
      }

      if (hopCycle < 1.1) {
        // Pha 1 (0.0s .. 1.1s): ĐỨNG NGHỈ NHÚN THỞ, NGÓ NGHIÊNG & LẤY ĐÀ
        const startPos = hopStartPosRef.current;
        groupRef.current.position.set(startPos.x, startPos.y, startPos.z);
        currentPosRef.current = [startPos.x, startPos.y, startPos.z];

        // Quay mặt hướng về phía mục tiêu sắp nhảy tới
        const dx = hopTargetPosRef.current.x - startPos.x;
        const dz = hopTargetPosRef.current.z - startPos.z;
        if (Math.hypot(dx, dz) > 0.02) {
          const targetYaw = Math.atan2(dx, dz);
          let diffYaw = (targetYaw - groupRef.current.rotation.y) % (Math.PI * 2);
          if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
          if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
          groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 5.0);
        }
        groupRef.current.rotation.x = 0;
        groupRef.current.rotation.z = 0;

        // Dáng ếch đứng co chân
        rotateBoneLocal(bones['left_arm_01'], 0, -0.08, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, -0.08, 0);
        rotateBoneLocal(bones['head'], 0, Math.sin(elapsed * 3.0) * 0.08, Math.cos(elapsed * 2.2) * 0.22);

        if (hopCycle >= 0.8) {
          // Cuối pha 1 (0.8s .. 1.1s): nhún thấp thân và gập sâu khớp đùi để lấy đà
          const crouch = THREE.MathUtils.smoothstep(hopCycle, 0.8, 1.1);
          modelInnerRef.current.position.y = -0.08 * crouch;
          rotateBoneLocal(bones['spine'], 0, -0.12 * crouch, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, 0.12 + 0.35 * crouch, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, -0.15 - 0.45 * crouch, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, 0.12 + 0.35 * crouch, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, -0.15 - 0.45 * crouch, 0);
        } else {
          modelInnerRef.current.position.y = 0;
          rotateBoneLocal(bones['spine'], 0, 0, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, 0.12, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, -0.15, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, 0.12, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, -0.15, 0);
        }
      } else {
        // Pha 2 (1.1s .. 2.2s): BẬT NHẢY VỌT THEO ĐƯỜNG PARABOL (HOPPING)
        const p = (hopCycle - 1.1) / 1.1; // Tiến độ 0.0 -> 1.0
        const start = hopStartPosRef.current;
        const target = hopTargetPosRef.current;

        const curX = THREE.MathUtils.lerp(start.x, target.x, p);
        const curY = THREE.MathUtils.lerp(start.y, target.y, p);
        const curZ = THREE.MathUtils.lerp(start.z, target.z, p);

        groupRef.current.position.set(curX, curY, curZ);
        currentPosRef.current = [curX, curY, curZ];

        // Quỹ đạo bật vọt Parabol
        const jumpArc = Math.sin(p * Math.PI);
        modelInnerRef.current.position.y = jumpArc * 0.55;

        // Giữ hướng mặt cố định theo hướng bật nhảy
        const dx = target.x - start.x;
        const dz = target.z - start.z;
        if (Math.hypot(dx, dz) > 0.02) {
          groupRef.current.rotation.y = Math.atan2(dx, dz);
        }

        if (jumpArc > 0.3) {
          // Khi đang bay trên không: duỗi thẳng hai chân sau ra sau và vung tay giữ thăng bằng
          rotateBoneLocal(bones['left_leg_01'], 0, -jumpArc * 0.55, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, jumpArc * 0.65, 0);
          rotateBoneLocal(bones['left_foot'], 0, -jumpArc * 0.45, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, -jumpArc * 0.55, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, jumpArc * 0.65, 0);
          rotateBoneLocal(bones['right_foot'], 0, -jumpArc * 0.45, 0);

          rotateBoneLocal(bones['left_arm_01'], 0, 0, jumpArc * 0.25);
          rotateBoneLocal(bones['right_arm_01'], 0, 0, -jumpArc * 0.25);
        } else {
          // Co chân nhịp nhàng khi chạm đất
          const landCrouch = 1 - jumpArc / 0.3;
          rotateBoneLocal(bones['left_leg_01'], 0, 0.12 + 0.25 * landCrouch, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, -0.15 - 0.3 * landCrouch, 0);
          rotateBoneLocal(bones['left_foot'], 0, 0, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, 0.12 + 0.25 * landCrouch, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, -0.15 - 0.3 * landCrouch, 0);
          rotateBoneLocal(bones['right_foot'], 0, 0, 0);

          rotateBoneLocal(bones['left_arm_01'], 0, -0.08, 0);
          rotateBoneLocal(bones['right_arm_01'], 0, -0.08, 0);
        }
      }
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    triggerCompanion(id);
  };

  return (
    <group ref={groupRef} onClick={handleClick}>
      <group ref={modelInnerRef}>
        {modelScene ? <primitive object={modelScene} /> : null}

        {/* Vầng sáng lung linh bao quanh Cóc & Nai */}
        <Sparkles
          raycast={() => null}
          count={isExcited ? 42 : 16}
          scale={isExcited ? 2.8 : 1.4}
          size={isExcited ? 5.0 : 2.5}
          speed={isExcited ? 2.0 : 0.8}
          color={sparkleColor}
          opacity={0.85}
        />
      </group>
    </group>
  );
}

export function CompanionPair(): JSX.Element {
  // Điểm tham chiếu vị trí tức thời của Deerling để Froakie luôn bật nhảy kề bên
  const deerlingPosRef = useRef<THREE.Vector3>(new THREE.Vector3(2.2, -0.6, -1.0));

  return (
    <group>
      {/* Deerling (Nai) - Đi dạo thong dong, dừng lại ăn cỏ & ngửi mùi hương */}
      <CompanionEntity
        id="deerling"
        daeUrl="/models/companions/deerling/pm0585_11_00.dae"
        sparkleColor="#f472b6"
        initialPos={[2.2, -0.6, -1.0]}
        targetHeight={1.2}
        deerlingPosRef={deerlingPosRef}
      />

      {/* Froakie (Cóc) - Bật nhảy vòng cung Parabol quanh chú Nai */}
      <CompanionEntity
        id="froakie"
        daeUrl="/models/companions/froakie/pm0723_00_00.dae"
        sparkleColor="#38bdf8"
        initialPos={[-2.2, 0.8, 1.2]}
        targetHeight={1.05}
        deerlingPosRef={deerlingPosRef}
      />
    </group>
  );
}
