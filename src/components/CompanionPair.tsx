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

/**
 * Tạo CanvasTexture mắt chuẩn game Pokémon bằng cách pha màu 4 lớp mask (_lym_layer1..4.png)
 */
async function generateEyeTexture(
  baseColor: string,
  layers: { url: string; color: string }[],
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

  // Tô nền mắt
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);

  const offscreen = document.createElement('canvas');
  offscreen.width = 256;
  offscreen.height = 256;
  const octx = offscreen.getContext('2d');

  if (octx) {
    for (let i = 0; i < layers.length; i++) {
      const img = loadedImages[i];
      if (!img || !img.width) continue;
      octx.clearRect(0, 0, 256, 256);
      octx.globalCompositeOperation = 'source-over';
      octx.fillStyle = layers[i].color;
      octx.fillRect(0, 0, 256, 256);

      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(img, 0, 0, 256, 256);

      ctx.drawImage(offscreen, 0, 0);
    }
  }

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

    // Chuẩn bị cấu hình pha màu mắt
    const eyePromise =
      id === 'froakie'
        ? generateEyeTexture('#130e0b', [
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer1.png', color: 'rgb(181, 144, 32)' },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer2.png', color: 'rgb(19, 14, 11)' },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer3.png', color: 'rgb(3, 3, 3)' },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer4.png', color: 'rgb(255, 255, 255)' },
          ])
        : generateEyeTexture('#413a35', [
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer1.png', color: 'rgb(182, 179, 115)' },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer2.png', color: 'rgb(65, 58, 53)' },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer3.png', color: 'rgb(3, 3, 3)' },
            { url: '/models/companions/deerling/pm0585_11_00_eye_lym_layer4.png', color: 'rgb(255, 255, 255)' },
          ]);

    Promise.all([
      new Promise<THREE.Object3D>((resolve, reject) => {
        loader.load(daeUrl, (collada) => resolve(collada.scene), undefined, reject);
      }),
      eyePromise,
    ]).then(([scene, eyeTex]) => {
      if (isCancelled) return;

      const bones: Record<string, THREE.Bone> = {};

      scene.traverse((child) => {
        const name = child.name.toLowerCase();

        // Thu thập xương để điều khiển cử động
        if ((child as THREE.Bone).isBone || child.type === 'Bone' || name) {
          bones[name] = child as THREE.Bone;
        }

        // BƯỚC 3.1: Ẩn các lưới LOD bị trùng
        if (id === 'froakie') {
          if (/lod1|lod2|eye_b|body_c/i.test(child.name)) {
            child.visible = false;
          }
        } else if (id === 'deerling') {
          if (/lod1|lod2|var_tex/i.test(child.name)) {
            child.visible = false;
          }
        }

        // BƯỚC 3.2: Gán Texture mắt và thân chuẩn
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material;

          const applyMatProps = (m: THREE.Material) => {
            const std = m as THREE.MeshStandardMaterial;
            const matName = m.name.toLowerCase();

            if (/eye/i.test(matName) || /eye/i.test(mesh.name)) {
              std.map = eyeTex;
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
              std.roughness = 0.35;
              std.needsUpdate = true;
            } else if (id === 'deerling') {
              std.map = texLoader.load('/models/companions/deerling/pm0585_11_00_body_alb.png', (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
              });
              std.normalMap = texLoader.load('/models/companions/deerling/pm0585_11_00_body_nrm.png');
              std.aoMap = texLoader.load('/models/companions/deerling/pm0585_11_00_body_ao.png');
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

      // BƯỚC 3.3: Chuẩn hóa kích thước & Căn tâm
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

    // Hướng nhìn theo vector vận tốc
    const nextPos = new THREE.Vector3(nextX, nextY, nextZ);
    const velocity = nextPos.clone().sub(prevPos);
    if (velocity.lengthSq() > 0.00001) {
      currentVelocityRef.current.lerp(velocity.normalize(), 0.1);
      const lookTarget = nextPos.clone().add(currentVelocityRef.current);
      groupRef.current.lookAt(lookTarget);
    }

    // Lớp đàn hồi bập bềnh bổ trợ
    const pose = computeProceduralCompanionPose(elapsed, isExcited);
    modelInnerRef.current.position.y = pose.offsetY;

    // BƯỚC 3.4: Điều khiển cử động trực tiếp trên khớp xương thật (THREE.Bone)
    const bones = bonesMapRef.current;

    if (id === 'froakie') {
      const spine = bones['spine'] || bones['waist'];
      const neck = bones['neck'];
      const head = bones['head'];
      const leftArm = bones['left_arm_01'];
      const rightArm = bones['right_arm_01'];
      const leftLeg = bones['left_leg_01'];
      const rightLeg = bones['right_leg_01'];
      const leftFoot = bones['left_foot'];
      const rightFoot = bones['right_foot'];

      if (spine) spine.rotation.y = Math.sin(elapsed * 2.2) * 0.08;
      if (neck) neck.rotation.x = Math.sin(elapsed * 2.2 + 0.3) * 0.06;
      if (head) head.rotation.x = Math.sin(elapsed * 2.2 + 0.6) * 0.09;

      if (isExcited) {
        // Vẫy hai tay lên cao vui mừng
        if (leftArm) leftArm.rotation.z = Math.sin(elapsed * 7.0) * 0.3 + 0.8;
        if (rightArm) rightArm.rotation.z = -Math.sin(elapsed * 7.0) * 0.3 - 0.8;
      } else {
        // Khua tay bơi nhẹ nhàng
        if (leftArm) leftArm.rotation.z = Math.sin(elapsed * 2.5) * 0.25 + 0.2;
        if (rightArm) rightArm.rotation.z = -Math.sin(elapsed * 2.5) * 0.25 - 0.2;
      }

      // Đạp chân bơi lội
      if (leftLeg) leftLeg.rotation.x = Math.sin(elapsed * 2.5) * 0.35;
      if (rightLeg) rightLeg.rotation.x = -Math.sin(elapsed * 2.5) * 0.35;
      if (leftFoot) leftFoot.rotation.x = Math.cos(elapsed * 2.5) * 0.25;
      if (rightFoot) rightFoot.rotation.x = -Math.cos(elapsed * 2.5) * 0.25;
    } else if (id === 'deerling') {
      const spine = bones['spine_01'] || bones['waist'];
      const neck = bones['neck'];
      const head = bones['head'];
      const leftEar = bones['left_ear'];
      const rightEar = bones['right_ear'];
      const tail = bones['tail'];
      const leftArm = bones['left_arm_01'];
      const rightArm = bones['right_arm_01'];
      const leftLeg = bones['left_leg_01'];
      const rightLeg = bones['right_leg_01'];

      if (spine) spine.rotation.x = Math.sin(elapsed * 2.4) * 0.06;
      if (neck) neck.rotation.y = Math.sin(elapsed * 2.4 + 0.3) * 0.06;
      if (head) head.rotation.x = Math.sin(elapsed * 2.4 + 0.6) * 0.08;

      // Vẫy tai
      const earWave = Math.sin(elapsed * (isExcited ? 8.0 : 3.2)) * 0.18;
      if (leftEar) leftEar.rotation.z = earWave;
      if (rightEar) rightEar.rotation.z = -earWave;

      // Vẫy đuôi
      if (tail) tail.rotation.y = Math.sin(elapsed * 4.5) * 0.28;

      // Bước 4 chân như đang bay lượn
      const legStep = Math.sin(elapsed * 2.6) * 0.28;
      if (leftArm) leftArm.rotation.x = legStep;
      if (rightArm) rightArm.rotation.x = -legStep;
      if (leftLeg) leftLeg.rotation.x = -legStep;
      if (rightLeg) rightLeg.rotation.x = legStep;
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
