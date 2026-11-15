import { useRef, useEffect, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as THREE from 'three';
import { useUniverseStore } from '../store/useUniverseStore';
import {
  computeProceduralCompanionPose,
  stepCompanionPair,
} from '../utils/physicsMath';

interface CompanionEntityProps {
  id: 'froakie' | 'deerling';
  daeUrl: string;
  sparkleColor: string;
  initialPos: [number, number, number];
  targetHeight: number;
}

interface EyeLayerConfig {
  url: string;
  rgb: [number, number, number];
}

/**
 * Tạo CanvasTexture mắt chuẩn bằng cách pha màu 4 lớp mask (_lym_layer1..4.png)
 * trực tiếp trên mảng ImageData qua kênh Đỏ (Red mask).
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

  // Khởi tạo mảng outData 256x256 và tô bằng baseRgb (alpha = 255)
  const outData = ctx.createImageData(256, 256);
  for (let i = 0; i < outData.data.length; i += 4) {
    outData.data[i] = baseRgb[0];
    outData.data[i + 1] = baseRgb[1];
    outData.data[i + 2] = baseRgb[2];
    outData.data[i + 3] = 255;
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

      // Trộn màu tuyến tính dựa trên giá trị mặt nạ kênh Đỏ (maskData[i] / 255.0)
      for (let i = 0; i < outData.data.length; i += 4) {
        const mask = maskData[i] / 255.0;
        outData.data[i] = outData.data[i] * (1 - mask) + layer.rgb[0] * mask;
        outData.data[i + 1] = outData.data[i + 1] * (1 - mask) + layer.rgb[1] * mask;
        outData.data[i + 2] = outData.data[i + 2] * (1 - mask) + layer.rgb[2] * mask;
      }
    }
  }

  ctx.putImageData(outData, 0, 0);
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
}: CompanionEntityProps) {
  const [modelScene, setModelScene] = useState<THREE.Object3D | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const modelInnerRef = useRef<THREE.Group>(null);
  const bonesMapRef = useRef<Record<string, THREE.Bone>>({});

  const excitedCompanion = useUniverseStore((s) => s.excitedCompanion);
  const triggerCompanion = useUniverseStore((s) => s.triggerCompanion);

  const isExcited = excitedCompanion !== null;
  const currentPosRef = useRef<[number, number, number]>([...initialPos]);
  const currentVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // Nạp model Collada DAE và xử lý Texture, LOD, Bones
  useEffect(() => {
    let isCancelled = false;
    const loader = new ColladaLoader();
    const texLoader = new THREE.TextureLoader();

    // Chuẩn bị cấu hình pha màu mắt theo yêu cầu
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

      // 1. Đặt scene.rotation.set(0, 0, 0) trước khi tính Box3
      scene.rotation.set(0, 0, 0);

      const bones: Record<string, THREE.Bone> = {};

      scene.traverse((child) => {
        const name = child.name.toLowerCase();

        // 2. Chỉ thu thập node thực sự là Bone và lưu lại restRotation ban đầu
        if ((child as THREE.Bone).isBone || child.type === 'Bone') {
          child.userData.restRotation = child.rotation.clone();
          bones[name] = child as THREE.Bone;
        }

        // 3. Ẩn các lưới LOD bị trùng (Deerling giữ nguyên var_tex)
        if (id === 'froakie') {
          if (/lod1|lod2|eye_b|body_c/i.test(child.name)) {
            child.visible = false;
          }
        } else if (id === 'deerling') {
          if (/lod1|lod2/i.test(child.name)) {
            child.visible = false;
          }
        }

        // 4. Gán Texture chuẩn cho mắt và thân
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
    const { froakieTarget, deerlingTarget } = stepCompanionPair(
      currentPosRef.current,
      currentPosRef.current,
      elapsed,
    );

    const target = id === 'froakie' ? froakieTarget : deerlingTarget;

    // Di chuyển mượt mà tới mục tiêu bay lượn
    const lerpFactor = Math.min(1, delta * 2.2);
    const prevPos = new THREE.Vector3(...currentPosRef.current);
    const nextX = THREE.MathUtils.lerp(currentPosRef.current[0], target[0], lerpFactor);
    const nextY = THREE.MathUtils.lerp(currentPosRef.current[1], target[1], lerpFactor);
    const nextZ = THREE.MathUtils.lerp(currentPosRef.current[2], target[2], lerpFactor);

    currentPosRef.current = [nextX, nextY, nextZ];
    groupRef.current.position.set(nextX, nextY, nextZ);

    // Tính vector vận tốc
    const velocity = new THREE.Vector3(nextX - prevPos.x, nextY - prevPos.y, nextZ - prevPos.z);
    if (velocity.lengthSq() > 0.000001) {
      currentVelocityRef.current.lerp(velocity, Math.min(1, delta * 4.0));

      // Hướng mặt theo mặt phẳng ngang targetYaw = Math.atan2(velocity.x, velocity.z)
      const targetYaw = Math.atan2(currentVelocityRef.current.x, currentVelocityRef.current.z);
      let diffYaw = (targetYaw - groupRef.current.rotation.y) % (Math.PI * 2);
      if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
      if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
      groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 3.0);

      // Giới hạn góc chúc đầu / ngửa cổ trong khoảng [-0.15, 0.15] rad
      const targetPitch = THREE.MathUtils.clamp(-currentVelocityRef.current.y * 0.4, -0.15, 0.15);
      groupRef.current.rotation.x = THREE.MathUtils.lerp(
        groupRef.current.rotation.x,
        targetPitch,
        Math.min(1, delta * 3.0),
      );
      groupRef.current.rotation.z = 0;
    }

    // Lớp đàn hồi bập bềnh bổ trợ
    const pose = computeProceduralCompanionPose(elapsed, isExcited);
    modelInnerRef.current.position.y = pose.offsetY;

    // Điều khiển cử động khớp xương: CỘNG THÊM dao động nhỏ vào góc gốc restRotation
    const bones = bonesMapRef.current;
    const rotateBone = (name: string, dx = 0, dy = 0, dz = 0) => {
      const bone = bones[name];
      if (!bone) return;
      const rest = bone.userData.restRotation as THREE.Euler | undefined;
      if (rest) {
        bone.rotation.set(rest.x + dx, rest.y + dy, rest.z + dz);
      }
    };

    if (id === 'froakie') {
      rotateBone('spine', 0, Math.sin(elapsed * 2.2) * 0.08, 0);
      rotateBone('neck', Math.sin(elapsed * 2.2 + 0.3) * 0.06, 0, 0);
      rotateBone('head', Math.sin(elapsed * 2.2 + 0.6) * 0.08, 0, 0);

      if (isExcited) {
        // Vẫy 2 tay lên cao mừng rỡ
        rotateBone('left_arm_01', 0, 0, Math.sin(elapsed * 7.0) * 0.18 + 0.2);
        rotateBone('right_arm_01', 0, 0, -Math.sin(elapsed * 7.0) * 0.18 - 0.2);
      } else {
        // Khua tay bơi nhẹ nhàng
        rotateBone('left_arm_01', 0, 0, Math.sin(elapsed * 2.5) * 0.12 + 0.06);
        rotateBone('right_arm_01', 0, 0, -Math.sin(elapsed * 2.5) * 0.12 - 0.06);
      }

      // Đạp chân bơi lội
      const legSwim = Math.sin(elapsed * 2.5) * 0.18;
      rotateBone('left_leg_01', legSwim, 0, 0);
      rotateBone('right_leg_01', -legSwim, 0, 0);
      rotateBone('left_foot', Math.cos(elapsed * 2.5) * 0.12, 0, 0);
      rotateBone('right_foot', -Math.cos(elapsed * 2.5) * 0.12, 0, 0);
    } else if (id === 'deerling') {
      rotateBone('spine_01', Math.sin(elapsed * 2.4) * 0.05, 0, 0);
      rotateBone('neck', 0, Math.sin(elapsed * 2.4 + 0.3) * 0.06, 0);
      rotateBone('head', Math.sin(elapsed * 2.4 + 0.6) * 0.07, 0, 0);

      // Vẫy tai
      const earWave = Math.sin(elapsed * (isExcited ? 8.0 : 3.2)) * 0.15;
      rotateBone('left_ear', 0, 0, earWave);
      rotateBone('right_ear', 0, 0, -earWave);

      // Vẫy đuôi
      rotateBone('tail', 0, Math.sin(elapsed * 4.5) * 0.2, 0);

      // Bước chân nhẹ nhàng như lướt trong vũ trụ
      const legStep = Math.sin(elapsed * 2.6) * 0.18;
      rotateBone('left_arm_01', legStep, 0, 0);
      rotateBone('right_arm_01', -legStep, 0, 0);
      rotateBone('left_leg_01', -legStep, 0, 0);
      rotateBone('right_leg_01', legStep, 0, 0);
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

        {/* Trail / aura sparkles - tắt raycast để không chặn xoay camera */}
        <Sparkles
          raycast={() => null}
          count={isExcited ? 36 : 14}
          scale={isExcited ? 2.5 : 1.2}
          size={isExcited ? 4.5 : 2.5}
          speed={isExcited ? 1.8 : 0.6}
          color={sparkleColor}
          opacity={0.85}
        />
      </group>
    </group>
  );
}

export function CompanionPair(): JSX.Element {
  return (
    <group>
      {/* Froakie (Cóc) - Model thật Nintendo Switch DAE */}
      <CompanionEntity
        id="froakie"
        daeUrl="/models/companions/froakie/pm0723_00_00.dae"
        sparkleColor="#38bdf8"
        initialPos={[-2.2, 0.8, 1.2]}
        targetHeight={1.05}
      />

      {/* Deerling (Nai) - Model thật Nintendo Switch DAE bản mùa xuân */}
      <CompanionEntity
        id="deerling"
        daeUrl="/models/companions/deerling/pm0585_11_00.dae"
        sparkleColor="#f472b6"
        initialPos={[2.2, -0.6, -1.0]}
        targetHeight={1.2}
      />
    </group>
  );
}
