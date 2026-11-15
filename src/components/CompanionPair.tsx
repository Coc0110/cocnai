import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as THREE from 'three';
import { useUniverseStore } from '../store/useUniverseStore';

// =============================================================================
// CẤU HÌNH VÀ BỘ BIẾN TẠM TOÀN CỤC (TRÁNH RÁC BỘ NHỚ TRÊN TỪNG FRAME)
// =============================================================================
const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();

// Các tầng độ cao không gian 3D của Vũ trụ Ký ức
const Y_TIERS = [-2.0, -1.0, 0.0, 1.0, 2.0];

function getRandomWaypoint(currentTierY?: number): THREE.Vector3 {
  // 55% giữ nguyên tầng độ cao để đi bộ/ngồi, 45% đổi sang tầng khác để kích hoạt nhảy chuyển tầng
  const y =
    currentTierY !== undefined && Math.random() < 0.55
      ? currentTierY
      : Y_TIERS[Math.floor(Math.random() * Y_TIERS.length)];
  const x = (Math.random() - 0.5) * 7.4; // -3.7 .. +3.7
  const z = (Math.random() - 0.5) * 5.4 - 0.2; // -2.9 .. +2.5
  return new THREE.Vector3(x, y, z);
}

/**
 * Xoay xương an toàn trong không gian cục bộ (Local Space) trên Quaternion gốc của file .dae.
 * Tuyệt đối không bị Gimbal Lock hay sai lệch Bind-Pose.
 */
function rotateBoneLocal(bone: THREE.Bone | undefined, rx: number, ry: number, rz: number) {
  if (!bone || !bone.userData.restQuat) return;
  tempEuler.set(rx, ry, rz, 'XYZ');
  tempQuat.setFromEuler(tempEuler);
  bone.quaternion.copy(bone.userData.restQuat).multiply(tempQuat);
}

// =============================================================================
// HỆ THỐNG GỢN SÓNG KHÔNG GIAN (SPACE RIPPLE SYSTEM)
// =============================================================================
interface ActiveRipple {
  active: boolean;
  x: number;
  y: number;
  z: number;
  startTime: number;
  duration: number;
  startRadius: number;
  maxRadius: number;
  color: THREE.Color;
  maxOpacity: number;
  isDouble: boolean;
}

const MAX_RIPPLES = 24;

class RippleManager {
  private pool: ActiveRipple[] = [];
  private nextIdx = 0;

  constructor() {
    for (let i = 0; i < MAX_RIPPLES; i++) {
      this.pool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        startTime: 0,
        duration: 1.0,
        startRadius: 0.1,
        maxRadius: 1.0,
        color: new THREE.Color(),
        maxOpacity: 0.7,
        isDouble: false,
      });
    }
  }

  add(
    x: number,
    y: number,
    z: number,
    colorHex: string,
    startRadius: number,
    maxRadius: number,
    duration: number,
    maxOpacity: number,
    isDouble = false,
    startTime = 0,
  ) {
    const r = this.pool[this.nextIdx];
    this.nextIdx = (this.nextIdx + 1) % MAX_RIPPLES;
    r.active = true;
    r.x = x;
    r.y = y;
    r.z = z;
    r.color.set(colorHex);
    r.startRadius = startRadius;
    r.maxRadius = maxRadius;
    r.duration = duration;
    r.maxOpacity = maxOpacity;
    r.isDouble = isDouble;
    r.startTime = startTime;
  }

  getPool() {
    return this.pool;
  }
}

function SpaceRippleMeshSystem({ manager }: { manager: RippleManager }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringGeom = useMemo(() => new THREE.RingGeometry(0.85, 1.0, 32), []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const elapsed = state.clock.getElapsedTime();
    const children = groupRef.current.children;
    const pool = manager.getPool();

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = pool[i];
      const rGroup = children[i] as THREE.Group | undefined;
      if (!rGroup) continue;

      if (!r.active) {
        rGroup.visible = false;
        continue;
      }

      const p = (elapsed - r.startTime) / r.duration;
      if (p >= 1.0 || p < 0) {
        r.active = false;
        rGroup.visible = false;
        continue;
      }

      rGroup.visible = true;
      rGroup.position.set(r.x, r.y + 0.015, r.z);

      const radius = THREE.MathUtils.lerp(r.startRadius, r.maxRadius, Math.sqrt(p));
      const opacity = r.maxOpacity * (1 - p);

      // Vòng sóng chính
      const mesh1 = rGroup.children[0] as THREE.Mesh;
      if (mesh1) {
        mesh1.scale.set(radius, radius, 1);
        const mat = mesh1.material as THREE.MeshBasicMaterial;
        mat.color.copy(r.color);
        mat.opacity = opacity;
      }

      // Vòng sóng phụ (gợn sóng kép khi chuyển tầng / gặp nhau)
      const mesh2 = rGroup.children[1] as THREE.Mesh;
      if (mesh2) {
        if (r.isDouble) {
          mesh2.visible = true;
          const r2 = radius * 0.65;
          mesh2.scale.set(r2, r2, 1);
          const mat2 = mesh2.material as THREE.MeshBasicMaterial;
          mat2.color.copy(r.color);
          mat2.opacity = opacity * 0.75;
        } else {
          mesh2.visible = false;
        }
      }
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: MAX_RIPPLES }).map((_, i) => (
        <group key={i} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <mesh geometry={ringGeom} raycast={() => null}>
            <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={ringGeom} raycast={() => null} visible={false}>
            <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// =============================================================================
// HỆ THỐNG MẮT ĐA TRẠNG THÁI (OPEN, BLINK, HAPPY)
// =============================================================================
interface EyeTextureSet {
  openTex: THREE.CanvasTexture;
  blinkTex: THREE.CanvasTexture;
  happyTex: THREE.CanvasTexture;
}

interface EyeLayerConfig {
  url: string;
  rgb: [number, number, number];
}

async function createEyeTextureSet(
  id: 'froakie' | 'deerling',
  baseRgb: [number, number, number],
  layers: EyeLayerConfig[],
): Promise<EyeTextureSet> {
  // 1. MẮT MỞ LONG LANH (Pha 4 lớp mask qua kênh Đỏ)
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

  const openCanvas = document.createElement('canvas');
  openCanvas.width = 256;
  openCanvas.height = 256;
  const ctx = openCanvas.getContext('2d');

  if (ctx) {
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

        for (let i = 0; i < out.data.length; i += 4) {
          const mask = maskData[i] / 255.0;
          out.data[i] = out.data[i] * (1 - mask) + layer.rgb[0] * mask;
          out.data[i + 1] = out.data[i + 1] * (1 - mask) + layer.rgb[1] * mask;
          out.data[i + 2] = out.data[i + 2] * (1 - mask) + layer.rgb[2] * mask;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  const openTex = new THREE.CanvasTexture(openCanvas);
  openTex.colorSpace = THREE.SRGBColorSpace;
  openTex.wrapS = THREE.RepeatWrapping;
  openTex.wrapT = THREE.RepeatWrapping;
  openTex.needsUpdate = true;

  // 2. MẮT NHẮM KHI CHỚP (Màu da mí mắt + viền cong mí mắt nhắm đậm)
  const blinkCanvas = document.createElement('canvas');
  blinkCanvas.width = 256;
  blinkCanvas.height = 256;
  const bCtx = blinkCanvas.getContext('2d');
  if (bCtx) {
    bCtx.fillStyle = id === 'froakie' ? 'rgb(78, 175, 226)' : 'rgb(232, 148, 174)';
    bCtx.fillRect(0, 0, 256, 256);

    bCtx.lineWidth = 11;
    bCtx.lineCap = 'round';
    bCtx.strokeStyle = id === 'froakie' ? '#142838' : '#3c1822';
    bCtx.beginPath();
    bCtx.moveTo(35, 128);
    bCtx.quadraticCurveTo(128, 155, 221, 128);
    bCtx.stroke();
  }
  const blinkTex = new THREE.CanvasTexture(blinkCanvas);
  blinkTex.colorSpace = THREE.SRGBColorSpace;
  blinkTex.needsUpdate = true;

  // 3. MẮT CƯỜI TÍT HẠNH PHÚC (Vòm cong ^ hình mắt híp hoan hỉ)
  const happyCanvas = document.createElement('canvas');
  happyCanvas.width = 256;
  happyCanvas.height = 256;
  const hCtx = happyCanvas.getContext('2d');
  if (hCtx) {
    hCtx.fillStyle = id === 'froakie' ? 'rgb(181, 144, 32)' : 'rgb(232, 148, 174)';
    hCtx.fillRect(0, 0, 256, 256);

    hCtx.lineWidth = 14;
    hCtx.lineCap = 'round';
    hCtx.strokeStyle = id === 'froakie' ? '#190e0b' : '#30141e';
    hCtx.beginPath();
    hCtx.moveTo(35, 148);
    hCtx.quadraticCurveTo(128, 68, 221, 148);
    hCtx.stroke();
  }
  const happyTex = new THREE.CanvasTexture(happyCanvas);
  happyTex.colorSpace = THREE.SRGBColorSpace;
  happyTex.needsUpdate = true;

  return { openTex, blinkTex, happyTex };
}

// =============================================================================
// HÀM TƯ THẾ NGỒI ẾCH CHUẨN CHO FROAKIE
// =============================================================================
function applyFrogSitPose(
  bones: Record<string, THREE.Bone>,
  modelInner: THREE.Group,
  crouchAmount = 1.0,
) {
  // Hạ thấp trọng tâm thân và rướn lưng về phía trước
  modelInner.position.y = -0.14 * crouchAmount;
  rotateBoneLocal(bones['spine'], 0, 0.38 * crouchAmount, 0);
  rotateBoneLocal(bones['head'], 0, -0.32 * crouchAmount, 0);

  // Hai chân sau co gập sâu đúng dáng ngồi ếch
  rotateBoneLocal(bones['left_leg_01'], 0, 0.95 * crouchAmount, 0.22 * crouchAmount);
  rotateBoneLocal(bones['right_leg_01'], 0, 0.95 * crouchAmount, -0.22 * crouchAmount);
  rotateBoneLocal(bones['left_leg_02'], 0, -1.42 * crouchAmount, 0);
  rotateBoneLocal(bones['right_leg_02'], 0, -1.42 * crouchAmount, 0);
  rotateBoneLocal(bones['left_foot'], 0, 0.52 * crouchAmount, 0);
  rotateBoneLocal(bones['right_foot'], 0, 0.52 * crouchAmount, 0);

  // Hai tay chống xuống đất giữa hai đầu gối
  rotateBoneLocal(bones['left_arm_01'], 0, 0.52 * crouchAmount, -0.52 * crouchAmount);
  rotateBoneLocal(bones['right_arm_01'], 0, 0.52 * crouchAmount, 0.52 * crouchAmount);
  rotateBoneLocal(bones['left_arm_02'], 0, 0.25 * crouchAmount, 0);
  rotateBoneLocal(bones['right_arm_02'], 0, 0.25 * crouchAmount, 0);
  rotateBoneLocal(bones['left_hand'], 0, -0.2 * crouchAmount, 0);
  rotateBoneLocal(bones['right_hand'], 0, -0.2 * crouchAmount, 0);
}

// =============================================================================
// COMPONENT ĐIỀU KHIỂN RIÊNG TỪNG LINH VẬT
// =============================================================================
interface CompanionEntityProps {
  id: 'froakie' | 'deerling';
  daeUrl: string;
  initialPos: [number, number, number];
  targetHeight: number;
  myPosRef: React.MutableRefObject<THREE.Vector3>;
  otherPosRef: React.MutableRefObject<THREE.Vector3>;
  rippleManager: RippleManager;
  isMeeting: boolean;
}

function CompanionEntity({
  id,
  daeUrl,
  initialPos,
  targetHeight,
  myPosRef,
  otherPosRef,
  rippleManager,
  isMeeting,
}: CompanionEntityProps) {
  const [modelScene, setModelScene] = useState<THREE.Object3D | null>(null);
  const [eyeTextures, setEyeTextures] = useState<EyeTextureSet | null>(null);

  const groupRef = useRef<THREE.Group>(null);
  const modelInnerRef = useRef<THREE.Group>(null);
  const bonesMapRef = useRef<Record<string, THREE.Bone>>({});
  const eyeMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);

  const excitedCompanion = useUniverseStore((s) => s.excitedCompanion);
  const triggerCompanion = useUniverseStore((s) => s.triggerCompanion);
  const isExcited = excitedCompanion !== null;

  // Quản lý chớp mắt
  const nextBlinkTimeRef = useRef<number>(3.5 + Math.random() * 2);
  const blinkEndTimeRef = useRef<number>(0);

  // Vị trí và điều hướng
  const currentPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...initialPos));
  const startPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...initialPos));
  const targetPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...initialPos));

  // Trạng thái cho Deerling
  const deerlingStateRef = useRef<'WALKING' | 'LEAP_LAYER' | 'GRAZING' | 'LOOKING'>('WALKING');
  const deerlingStateTimerRef = useRef<number>(0);
  const walkPhaseRef = useRef<number>(0);
  const prevWalkSinRef = useRef<number>(0);

  // Trạng thái cho Froakie
  const froakieStateRef = useRef<'HOP_MOVE' | 'SCRATCH_HEAD' | 'WAVE_CAMERA'>('HOP_MOVE');
  const froakieStateTimerRef = useRef<number>(0);

  // Tải model và khởi tạo 3 texture mắt
  useEffect(() => {
    let isCancelled = false;
    const loader = new ColladaLoader();
    const texLoader = new THREE.TextureLoader();

    const eyePromise =
      id === 'froakie'
        ? createEyeTextureSet('froakie', [19, 14, 11], [
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer1.png', rgb: [181, 144, 32] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer2.png', rgb: [19, 14, 11] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer3.png', rgb: [3, 3, 3] },
            { url: '/models/companions/froakie/pm0723_00_00_eye_a_lym_layer4.png', rgb: [255, 255, 255] },
          ])
        : createEyeTextureSet('deerling', [65, 58, 53], [
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
    ]).then(([scene, eyeTexSet]) => {
      if (isCancelled) return;

      scene.rotation.set(0, 0, 0);

      const bones: Record<string, THREE.Bone> = {};
      const eyeMats: THREE.MeshStandardMaterial[] = [];

      scene.traverse((child) => {
        const name = child.name.toLowerCase();

        if ((child as THREE.Bone).isBone || child.type === 'Bone') {
          child.userData.restQuat = child.quaternion.clone();
          bones[name] = child as THREE.Bone;
        }

        // Lọc lưới LOD
        if (id === 'froakie') {
          if (/lod1|lod2|eye_b|body_c/i.test(child.name)) child.visible = false;
        } else if (id === 'deerling') {
          if (/lod1|lod2/i.test(child.name)) child.visible = false;
        }

        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material;

          const applyMat = (m: THREE.Material) => {
            const std = m as THREE.MeshStandardMaterial;
            const matName = m.name.toLowerCase();

            if (/eye/i.test(matName) || /eye/i.test(mesh.name)) {
              std.map = eyeTexSet.openTex;
              if (std.color) std.color.setHex(0xffffff);
              std.roughness = 0.15;
              std.metalness = 0.05;
              std.needsUpdate = true;
              eyeMats.push(std);
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

          if (Array.isArray(mat)) mat.forEach(applyMat);
          else if (mat) applyMat(mat);
        }
      });

      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const scale = targetHeight / (size.y || 1);
      scene.scale.setScalar(scale);
      scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

      bonesMapRef.current = bones;
      eyeMaterialsRef.current = eyeMats;
      setEyeTextures(eyeTexSet);
      setModelScene(scene);

      // Khởi tạo điểm đến ban đầu
      targetPosRef.current = getRandomWaypoint(initialPos[1]);
    });

    return () => {
      isCancelled = true;
    };
  }, [id, daeUrl, targetHeight, initialPos]);

  useFrame((threeState, delta) => {
    if (!groupRef.current || !modelInnerRef.current || !eyeTextures) return;

    const elapsed = threeState.clock.getElapsedTime();
    const bones = bonesMapRef.current;
    const curPos = currentPosRef.current;
    const targetPos = targetPosRef.current;
    const startPos = startPosRef.current;

    // Cập nhật tọa độ ra ref dùng chung
    myPosRef.current.copy(curPos);

    // =========================================================================
    // 1. HỆ THỐNG MẮT: LIẾC NHẸ, CHỚP MẮT & CƯỜI TÍT MẮT
    // =========================================================================
    // Liếc nhẹ ánh mắt có hồn
    eyeTextures.openTex.offset.set(Math.sin(elapsed * 0.9) * 0.015, Math.cos(elapsed * 0.7) * 0.01);

    // Quản lý chớp mắt tự nhiên
    if (elapsed >= nextBlinkTimeRef.current) {
      blinkEndTimeRef.current = elapsed + 0.14;
      const isDouble = Math.random() < 0.28;
      nextBlinkTimeRef.current = elapsed + (isDouble ? 0.35 : 3.5 + Math.random() * 2.2);
    }
    const isBlinking = elapsed < blinkEndTimeRef.current;

    const shouldSmile =
      isMeeting ||
      isExcited ||
      (id === 'froakie' && froakieStateRef.current === 'WAVE_CAMERA');

    const activeEyeTex = shouldSmile
      ? eyeTextures.happyTex
      : isBlinking
        ? eyeTextures.blinkTex
        : eyeTextures.openTex;

    for (const m of eyeMaterialsRef.current) {
      if (m.map !== activeEyeTex) {
        m.map = activeEyeTex;
        m.needsUpdate = true;
      }
    }

    // =========================================================================
    // 2. TƯƠNG TÁC GẶP GỠ (CHANCE ENCOUNTER: MEET_SPECIAL) & CHẠM VÀO (EXCITED)
    // =========================================================================
    if (isMeeting || isExcited) {
      // Hướng mặt nhìn nhau
      const other = otherPosRef.current;
      const lookDx = other.x - curPos.x;
      const lookDz = other.z - curPos.z;
      if (Math.hypot(lookDx, lookDz) > 0.05) {
        const meetYaw = Math.atan2(lookDx, lookDz);
        let diffYaw = (meetYaw - groupRef.current.rotation.y) % (Math.PI * 2);
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 6.0);
      }

      if (id === 'froakie') {
        applyFrogSitPose(bones, modelInnerRef.current, 1.0);
        // Tay trái chống sàn, tay phải giơ vẫy chào Nai
        rotateBoneLocal(bones['right_arm_01'], 0, -1.15, -0.75);
        rotateBoneLocal(bones['right_arm_02'], 0, 0.65 + Math.sin(elapsed * 10.0) * 0.35, 0);
        modelInnerRef.current.position.y = -0.14 + Math.abs(Math.sin(elapsed * 8.0)) * 0.12;
      } else if (id === 'deerling') {
        // Deerling gật đầu chào trìu mến, vẫy tai và ngoắc đuôi
        rotateBoneLocal(bones['left_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, 0, 0);

        rotateBoneLocal(bones['neck'], 0, -0.32 + Math.sin(elapsed * 5.0) * 0.08, 0);
        rotateBoneLocal(bones['head'], 0, 0.15, 0);
        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 10.0) * 0.28);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 10.0) * 0.28);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 12.0) * 0.38);
      }
      return;
    }

    // =========================================================================
    // 3. MÁY TRẠNG THÁI DEERLING (CHỐNG TRƯỢT CHÂN, NHẢY CHUYỂN TẦNG, ĂN CỎ)
    // =========================================================================
    if (id === 'deerling') {
      const state = deerlingStateRef.current;
      deerlingStateTimerRef.current += delta;
      const timer = deerlingStateTimerRef.current;

      if (state === 'WALKING') {
        const dx = targetPos.x - curPos.x;
        const dz = targetPos.z - curPos.z;
        const dist2D = Math.hypot(dx, dz);

        if (dist2D < 0.12) {
          // Đến nơi: chuyển sang ăn cỏ hoặc ngẩng đầu nhìn quanh
          deerlingStateRef.current = Math.random() < 0.5 ? 'GRAZING' : 'LOOKING';
          deerlingStateTimerRef.current = 0;
        } else {
          // Xoay mặt về hướng đi
          const targetYaw = Math.atan2(dx, dz);
          let diffYaw = (targetYaw - groupRef.current.rotation.y) % (Math.PI * 2);
          if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
          if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
          groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 4.5);
          groupRef.current.rotation.x = 0;
          groupRef.current.rotation.z = 0;

          // Di chuyển thong thả 0.55 đv/s
          const walkSpeed = 0.55;
          const stepDist = Math.min(dist2D, delta * walkSpeed);
          curPos.x += (dx / dist2D) * stepDist;
          curPos.z += (dz / dist2D) * stepDist;
          curPos.y = THREE.MathUtils.lerp(curPos.y, targetPos.y, delta * 3.0);
          groupRef.current.position.copy(curPos);

          // Pha bước chân tỉ lệ trực tiếp với quãng đường (chống trượt chân hoàn toàn)
          walkPhaseRef.current += stepDist * 4.2;
          const phase = walkPhaseRef.current;

          // Nhấp nhô thân người tự nhiên
          modelInnerRef.current.position.y = Math.abs(Math.sin(phase)) * 0.025;

          // 4 chân bước chéo nhịp nhàng
          const swing = Math.sin(phase) * 0.32;
          const kneeA = Math.max(0, Math.cos(phase)) * 0.35;
          const kneeB = Math.max(0, -Math.cos(phase)) * 0.35;

          rotateBoneLocal(bones['left_arm_01'], 0, swing, 0);
          rotateBoneLocal(bones['left_arm_02'], 0, -kneeA, 0);
          rotateBoneLocal(bones['right_arm_01'], 0, -swing, 0);
          rotateBoneLocal(bones['right_arm_02'], 0, -kneeB, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, -swing * 0.9, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, kneeB * 0.8, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, swing * 0.9, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, kneeA * 0.8, 0);

          rotateBoneLocal(bones['spine_02'], 0, 0, 0);
          rotateBoneLocal(bones['neck'], 0, Math.sin(phase * 2) * 0.05, 0);
          rotateBoneLocal(bones['head'], 0, Math.sin(phase * 2 + 0.4) * 0.05, 0);
          rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 4.5) * 0.22);
          rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 3.0) * 0.12);
          rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 3.0) * 0.12);

          // Gợn sóng bước chân khi chân dẫm xuống đất
          const currentSin = Math.sin(phase);
          if (prevWalkSinRef.current * currentSin <= 0) {
            rippleManager.add(
              curPos.x,
              curPos.y,
              curPos.z,
              '#fbcfe8',
              0.05,
              0.45,
              0.75,
              0.55,
              false,
              elapsed,
            );
          }
          prevWalkSinRef.current = currentSin;
        }
      } else if (state === 'LEAP_LAYER') {
        // Nhảy phóng vọt chuyển tầng không gian
        const prepTime = 0.3;
        const jumpTime = 1.1;

        if (timer < prepTime) {
          // Nhún chân lấy đà
          const crouchP = timer / prepTime;
          modelInnerRef.current.position.y = -0.06 * crouchP;
          rotateBoneLocal(bones['left_arm_01'], 0, 0.2 * crouchP, 0);
          rotateBoneLocal(bones['right_arm_01'], 0, 0.2 * crouchP, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, 0.25 * crouchP, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, 0.25 * crouchP, 0);

          const targetYaw = Math.atan2(targetPos.x - curPos.x, targetPos.z - curPos.z);
          groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetYaw, delta * 6.0);
        } else if (timer < prepTime + jumpTime) {
          const p = (timer - prepTime) / jumpTime;
          curPos.x = THREE.MathUtils.lerp(startPos.x, targetPos.x, p);
          curPos.y = THREE.MathUtils.lerp(startPos.y, targetPos.y, p);
          curPos.z = THREE.MathUtils.lerp(startPos.z, targetPos.z, p);
          groupRef.current.position.copy(curPos);

          const leapArc = Math.sin(p * Math.PI);
          modelInnerRef.current.position.y = leapArc * 0.85;

          // Chân trước gập ngực, chân sau duỗi đạp ra sau, cổ vươn cao
          rotateBoneLocal(bones['left_arm_01'], 0, -0.65 * leapArc, 0);
          rotateBoneLocal(bones['left_arm_02'], 0, 0.95 * leapArc, 0);
          rotateBoneLocal(bones['right_arm_01'], 0, -0.65 * leapArc, 0);
          rotateBoneLocal(bones['right_arm_02'], 0, 0.95 * leapArc, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, -0.75 * leapArc, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, 0.35 * leapArc, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, -0.75 * leapArc, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, 0.35 * leapArc, 0);
          rotateBoneLocal(bones['neck'], 0, 0.28 * leapArc, 0);
          rotateBoneLocal(bones['head'], 0, -0.15 * leapArc, 0);
        } else {
          // Tiếp đất an toàn trên tầng mới
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          modelInnerRef.current.position.y = 0;

          // Gợn sóng lớn kép khi tiếp đất
          rippleManager.add(
            curPos.x,
            curPos.y,
            curPos.z,
            '#f9a8d4',
            0.15,
            1.35,
            1.2,
            0.75,
            true,
            elapsed,
          );

          deerlingStateRef.current = 'GRAZING';
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'GRAZING') {
        // Dừng lại cúi xuống ăn cỏ & ngửi mùi hương
        rotateBoneLocal(bones['left_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['left_leg_02'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_01'], 0, 0, 0);
        rotateBoneLocal(bones['right_leg_02'], 0, 0, 0);

        const duration = 3.6;
        const bend =
          THREE.MathUtils.smoothstep(timer, 0.0, 0.8) *
          (1.0 - THREE.MathUtils.smoothstep(timer, duration - 0.8, duration));

        rotateBoneLocal(bones['spine_02'], 0, -bend * 0.16, 0);
        rotateBoneLocal(bones['neck'], 0, -bend * 0.48, 0);
        const chew = Math.sin(elapsed * 7.5) * 0.11 * bend;
        const sniffYaw = Math.sin(elapsed * 2.8) * 0.14 * bend;
        rotateBoneLocal(bones['head'], 0, bend * 0.22 + chew, sniffYaw);

        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 3.5) * 0.15);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 3.5) * 0.15);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 3.0) * 0.18);

        if (timer >= duration) {
          // Chọn điểm đến mới
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y);

          if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
            deerlingStateRef.current = 'LEAP_LAYER';
          } else {
            deerlingStateRef.current = 'WALKING';
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'LOOKING') {
        // Đứng ngẩng cao đầu nhìn quanh
        rotateBoneLocal(bones['spine_02'], 0, 0, 0);
        rotateBoneLocal(bones['neck'], 0, 0.08, 0);
        rotateBoneLocal(bones['head'], 0, 0.08, Math.sin(elapsed * 2.4) * 0.28);

        const earFlick = Math.sin(elapsed * 10.0) * 0.26;
        rotateBoneLocal(bones['left_ear'], 0, 0, earFlick);
        rotateBoneLocal(bones['right_ear'], 0, 0, -earFlick);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 6.0) * 0.35);

        if (timer >= 2.8) {
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y);

          if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
            deerlingStateRef.current = 'LEAP_LAYER';
          } else {
            deerlingStateRef.current = 'WALKING';
          }
          deerlingStateTimerRef.current = 0;
        }
      }
    }

    // =========================================================================
    // 4. MÁY TRẠNG THÁI FROAKIE (TƯ THẾ NGỒI ẾCH, BẬT NHẢY, GÃI ĐẦU, VẪY TAY)
    // =========================================================================
    if (id === 'froakie') {
      const state = froakieStateRef.current;
      froakieStateTimerRef.current += delta;
      const timer = froakieStateTimerRef.current;

      if (state === 'HOP_MOVE') {
        const prepTime = 0.35;
        const jumpTime = 0.95;

        if (timer < prepTime) {
          // Giai đoạn 1: Nhún lấy đà từ tư thế ngồi ếch
          const crouch = 1.0 + (timer / prepTime) * 0.35;
          applyFrogSitPose(bones, modelInnerRef.current, crouch);

          const dx = targetPos.x - startPos.x;
          const dz = targetPos.z - startPos.z;
          if (Math.hypot(dx, dz) > 0.05) {
            const hopYaw = Math.atan2(dx, dz);
            let diffYaw = (hopYaw - groupRef.current.rotation.y) % (Math.PI * 2);
            if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
            if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
            groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 6.0);
          }
        } else if (timer < prepTime + jumpTime) {
          // Giai đoạn 2: Bật nhảy bay trên không theo Parabol
          const p = (timer - prepTime) / jumpTime;
          curPos.x = THREE.MathUtils.lerp(startPos.x, targetPos.x, p);
          curPos.y = THREE.MathUtils.lerp(startPos.y, targetPos.y, p);
          curPos.z = THREE.MathUtils.lerp(startPos.z, targetPos.z, p);
          groupRef.current.position.copy(curPos);

          const jumpArc = Math.sin(p * Math.PI);
          modelInnerRef.current.position.y = -0.14 * (1 - jumpArc) + jumpArc * 0.75;

          // Hai tay giơ cao về phía trước, hai chân đạp mạnh ra sau
          rotateBoneLocal(bones['spine'], 0, -0.15 * jumpArc, 0);
          rotateBoneLocal(bones['head'], 0, 0.1 * jumpArc, 0);

          rotateBoneLocal(bones['left_arm_01'], 0, -0.75 * jumpArc, 0.35 * jumpArc);
          rotateBoneLocal(bones['right_arm_01'], 0, -0.75 * jumpArc, -0.35 * jumpArc);
          rotateBoneLocal(bones['left_arm_02'], 0, 0, 0);
          rotateBoneLocal(bones['right_arm_02'], 0, 0, 0);

          rotateBoneLocal(bones['left_leg_01'], 0, -0.55 * jumpArc, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, -0.55 * jumpArc, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, 0.15 * jumpArc, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, 0.15 * jumpArc, 0);
          rotateBoneLocal(bones['left_foot'], 0, -0.35 * jumpArc, 0);
          rotateBoneLocal(bones['right_foot'], 0, -0.35 * jumpArc, 0);
        } else {
          // Tiếp đất an toàn và phát gợn sóng không gian
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          applyFrogSitPose(bones, modelInnerRef.current, 1.0);

          rippleManager.add(
            curPos.x,
            curPos.y,
            curPos.z,
            '#7dd3fc',
            0.15,
            1.35,
            1.2,
            0.75,
            true,
            elapsed,
          );

          // Chọn ngẫu nhiên hành động tiếp theo
          const rand = Math.random();
          if (rand < 0.38) {
            froakieStateRef.current = 'SCRATCH_HEAD';
          } else if (rand < 0.72) {
            froakieStateRef.current = 'WAVE_CAMERA';
          } else {
            // Nhảy tiếp sau 0.8s ngồi nghỉ
            startPosRef.current.copy(curPos);
            targetPosRef.current = getRandomWaypoint(curPos.y);
            froakieStateRef.current = 'HOP_MOVE';
          }
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'SCRATCH_HEAD') {
        // Giữ nguyên tư thế ngồi ếch, tay trái chống đất, tay phải gãi đầu
        applyFrogSitPose(bones, modelInnerRef.current, 1.0);

        rotateBoneLocal(bones['right_arm_01'], 0, -1.25, -0.65);
        rotateBoneLocal(bones['right_arm_02'], 0, 1.65 + Math.sin(elapsed * 15.0) * 0.22, 0);
        rotateBoneLocal(bones['head'], 0, -0.22, 0.18 + Math.sin(elapsed * 15.0) * 0.05);

        if (timer >= 2.8) {
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y);
          froakieStateRef.current = 'HOP_MOVE';
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'WAVE_CAMERA') {
        // Quay mặt về Camera, tay trái chống đất, tay phải vẫy chào & cười tít mắt
        applyFrogSitPose(bones, modelInnerRef.current, 1.0);

        const camPos = threeState.camera.position;
        const camDx = camPos.x - curPos.x;
        const camDz = camPos.z - curPos.z;
        const camYaw = Math.atan2(camDx, camDz);
        let diffYaw = (camYaw - groupRef.current.rotation.y) % (Math.PI * 2);
        if (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
        if (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        groupRef.current.rotation.y += diffYaw * Math.min(1, delta * 5.0);

        rotateBoneLocal(bones['right_arm_01'], 0, -1.15, -0.85);
        rotateBoneLocal(bones['right_arm_02'], 0, 0.65 + Math.sin(elapsed * 10.0) * 0.35, 0);
        rotateBoneLocal(bones['head'], 0, -0.15, Math.sin(elapsed * 5.0) * 0.12);

        if (timer >= 3.2) {
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y);
          froakieStateRef.current = 'HOP_MOVE';
          froakieStateTimerRef.current = 0;
        }
      }
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    triggerCompanion(id);
    // Phát gợn sóng khi chạm
    rippleManager.add(
      currentPosRef.current.x,
      currentPosRef.current.y,
      currentPosRef.current.z,
      id === 'froakie' ? '#7dd3fc' : '#f9a8d4',
      0.15,
      1.35,
      1.2,
      0.8,
      true,
    );
  };

  return (
    <group ref={groupRef} onClick={handleClick}>
      <group ref={modelInnerRef}>
        {modelScene ? <primitive object={modelScene} /> : null}
      </group>
    </group>
  );
}

// =============================================================================
// COMPONENT ĐIỀU PHỐI CHÍNH (COMPANION PAIR)
// =============================================================================
export function CompanionPair(): JSX.Element {
  const froakiePosRef = useRef<THREE.Vector3>(new THREE.Vector3(-2.2, 0.0, 1.2));
  const deerlingPosRef = useRef<THREE.Vector3>(new THREE.Vector3(2.2, 0.0, -1.0));

  const rippleManager = useMemo(() => new RippleManager(), []);
  const [isMeeting, setIsMeeting] = useState(false);

  const lastMeetingTimeRef = useRef<number>(-999);
  const meetingEndTimeRef = useRef<number>(0);

  // Kiểm tra gặp gỡ tình cờ giữa Froakie & Deerling
  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    if (isMeeting) {
      if (elapsed >= meetingEndTimeRef.current) {
        setIsMeeting(false);
      }
    } else {
      const dist = froakiePosRef.current.distanceTo(deerlingPosRef.current);
      // Gặp nhau khi khoảng cách < 1.8 và đã qua thời gian hồi 14 giây
      if (dist < 1.8 && elapsed - lastMeetingTimeRef.current > 14.0) {
        lastMeetingTimeRef.current = elapsed;
        meetingEndTimeRef.current = elapsed + 3.8;
        setIsMeeting(true);

        // Phát gợn sóng giao thoa đôi dưới chân cả 2 bé
        rippleManager.add(
          froakiePosRef.current.x,
          froakiePosRef.current.y,
          froakiePosRef.current.z,
          '#7dd3fc',
          0.15,
          1.5,
          1.8,
          0.8,
          true,
          elapsed,
        );
        rippleManager.add(
          deerlingPosRef.current.x,
          deerlingPosRef.current.y,
          deerlingPosRef.current.z,
          '#f9a8d4',
          0.15,
          1.5,
          1.8,
          0.8,
          true,
          elapsed,
        );
      }
    }
  });

  return (
    <group>
      {/* Hệ thống sóng không gian phẳng */}
      <SpaceRippleMeshSystem manager={rippleManager} />

      {/* Froakie (Cóc) - Tư thế ngồi ếch, bật nhảy vươn tay, gãi đầu, vẫy chào camera */}
      <CompanionEntity
        id="froakie"
        daeUrl="/models/companions/froakie/pm0723_00_00.dae"
        initialPos={[-2.2, 0.0, 1.2]}
        targetHeight={1.05}
        myPosRef={froakiePosRef}
        otherPosRef={deerlingPosRef}
        rippleManager={rippleManager}
        isMeeting={isMeeting}
      />

      {/* Deerling (Nai) - Chống trượt chân, nhảy chuyển tầng, ăn cỏ, ngửi mùi */}
      <CompanionEntity
        id="deerling"
        daeUrl="/models/companions/deerling/pm0585_11_00.dae"
        initialPos={[2.2, 0.0, -1.0]}
        targetHeight={1.2}
        myPosRef={deerlingPosRef}
        otherPosRef={froakiePosRef}
        rippleManager={rippleManager}
        isMeeting={isMeeting}
      />
    </group>
  );
}
