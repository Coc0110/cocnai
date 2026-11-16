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

/**
 * Chọn điểm đến ngẫu nhiên nhưng ưu tiên giữ nguyên tầng hoặc cùng tầng với bạn đồng hành
 */
function getRandomWaypoint(currentTierY?: number, partnerTierY?: number): THREE.Vector3 {
  let y: number;
  if (partnerTierY !== undefined && Math.random() < 0.65) {
    y = partnerTierY;
  } else if (currentTierY !== undefined && Math.random() < 0.70) {
    y = currentTierY;
  } else {
    y = Y_TIERS[Math.floor(Math.random() * Y_TIERS.length)];
  }

  // Quãng đường di chuyển mỗi lần vừa phải (bán kính 1.6 đến 3.8)
  const angle = Math.random() * Math.PI * 2;
  const dist = 1.6 + Math.random() * 2.2;
  let x = Math.cos(angle) * dist;
  let z = Math.sin(angle) * dist;
  x = THREE.MathUtils.clamp(x, -3.7, 3.7);
  z = THREE.MathUtils.clamp(z, -2.9, 2.5);
  return new THREE.Vector3(x, y, z);
}

function lerpAngle(current: number, target: number, step: number) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, step);
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

/**
 * Khôi phục cả Quaternion và Position gốc cho toàn bộ xương
 */
function resetAllBones(bones: Record<string, THREE.Bone>) {
  Object.values(bones).forEach((b) => {
    if (b.userData.restQuat) b.quaternion.copy(b.userData.restQuat);
    if (b.userData.restPos) b.position.copy(b.userData.restPos);
  });
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
      rGroup.position.set(r.x, r.y + 0.012, r.z);

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
  const isFroakie = id === 'froakie';
  const bgColor = isFroakie ? 'rgb(235, 212, 92)' : 'rgb(227, 218, 198)';
  const strokeColor = isFroakie ? '#1d2b3a' : '#3a261e';

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

  // 2. MẮT NHẮM KHI CHỚP (Màu mí mắt chuẩn: trắng kem #e3dac6 cho Deerling, vàng cho Froakie)
  const blinkCanvas = document.createElement('canvas');
  blinkCanvas.width = 256;
  blinkCanvas.height = 256;
  const bCtx = blinkCanvas.getContext('2d');
  if (bCtx) {
    bCtx.fillStyle = bgColor;
    bCtx.fillRect(0, 0, 256, 256);

    bCtx.lineWidth = 11;
    bCtx.lineCap = 'round';
    bCtx.strokeStyle = strokeColor;
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
    hCtx.fillStyle = bgColor;
    hCtx.fillRect(0, 0, 256, 256);

    hCtx.lineWidth = 14;
    hCtx.lineCap = 'round';
    hCtx.strokeStyle = strokeColor;
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
// HÀM TƯ THẾ NGỒI ẾCH CHUẨN ĐỘNG HỌC CHO FROAKIE (4 CHI CHẠM ĐẤT, ÚP PHẲNG CỔ TAY)
// =============================================================================
function applyFrogSitPose(bones: Record<string, THREE.Bone>, breath = 0) {
  // 1. Hạ thấp xương chậu xuống sát mặt đất (0.078) để ngồi xổm như ếch
  if (bones['waist']) {
    bones['waist'].position.set(0, 0.078, -0.035);
  }

  // 2. Đổ thân người về phía trước và ngẩng đầu nhìn thẳng
  rotateBoneLocal(bones['spine'], 0, -0.68 + breath * 0.04, 0);
  rotateBoneLocal(bones['neck'], 0, 0.32, 0);
  rotateBoneLocal(bones['head'], 0, 0.42 - breath * 0.03, 0);

  // 3. Gập sâu 2 đùi lên sát bụng và gập cẳng chân, mở rộng đầu gối sang 2 bên
  rotateBoneLocal(bones['left_leg_01'], 0, -1.25, 0.30);
  rotateBoneLocal(bones['right_leg_01'], 0, -1.25, -0.30);
  rotateBoneLocal(bones['left_leg_02'], 0, 1.45, 0);
  rotateBoneLocal(bones['right_leg_02'], 0, 1.45, 0);
  rotateBoneLocal(bones['left_foot'], 0, -0.25, 0);
  rotateBoneLocal(bones['right_foot'], 0, -0.25, 0);

  // 4. Hai chi trước chống thẳng xuống đất, xoay úp cổ tay (rx) + gập bản lề cổ tay (rz)
  // giúp cả cổ tay lẫn đầu ngón tay đều nằm phẳng tại Y = 0.001 trên mặt sàn
  rotateBoneLocal(bones['left_arm_01'], -0.20, -0.35, -0.85);
  rotateBoneLocal(bones['left_arm_02'], 0, -0.35, 0);
  rotateBoneLocal(bones['left_arm_03'], 0.45, 0, 0);
  rotateBoneLocal(bones['left_hand'], 0.54, 0.04, 1.05);

  rotateBoneLocal(bones['right_arm_01'], 0.20, -0.35, 0.85);
  rotateBoneLocal(bones['right_arm_02'], 0, -0.35, 0);
  rotateBoneLocal(bones['right_arm_03'], -0.45, 0, 0);
  rotateBoneLocal(bones['right_hand'], -0.54, 0.04, -1.05);
}

// =============================================================================
// COMPONENT ĐIỀU KHIỂN RIÊNG TỪNG LINH VẬT
// =============================================================================
type FroakieState = 'REST_SIT' | 'HOP_MOVE' | 'SCRATCH_HEAD' | 'WAVE_CAMERA';
type DeerlingState = 'REST_STAND' | 'SLEEP_CURL' | 'WALKING' | 'LEAP_LAYER' | 'GRAZING' | 'LOOKING';

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

  // Trạng thái cho Deerling (Mặc định bắt đầu bằng đứng nghỉ ngơi yên bình)
  const deerlingStateRef = useRef<DeerlingState>('REST_STAND');
  const deerlingStateTimerRef = useRef<number>(0);
  const deerlingDurationRef = useRef<number>(5.5);
  const walkPhaseRef = useRef<number>(0);
  const prevWalkSinRef = useRef<number>(0);

  // Trạng thái cho Froakie (Mặc định bắt đầu bằng ngồi nghỉ ngơi thư giãn)
  const froakieStateRef = useRef<FroakieState>('REST_SIT');
  const froakieStateTimerRef = useRef<number>(0);
  const froakieDurationRef = useRef<number>(5.5);

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

        // 1. Lưu cả restQuat lẫn restPos ban đầu
        if ((child as THREE.Bone).isBone || child.type === 'Bone') {
          bones[name] = child as THREE.Bone;
          child.userData.restQuat = child.quaternion.clone();
          child.userData.restPos = child.position.clone();
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

      // 2. Căn đáy bounding box (box.min.y) nằm đúng tại y = 0 để bàn chân luôn tiếp xúc mặt phẳng
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const scale = targetHeight / (size.y || 1);
      scene.scale.setScalar(scale);
      scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

      bonesMapRef.current = bones;
      eyeMaterialsRef.current = eyeMats;
      setEyeTextures(eyeTexSet);
      setModelScene(scene);

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
    // 1. HỆ THỐNG MẮT: LIẾC NHẸ, CHỚP MẮT, NGỦ NHẮM MẮT & CƯỜI TÍT MẮT
    // =========================================================================
    eyeTextures.openTex.offset.set(Math.sin(elapsed * 0.9) * 0.015, Math.cos(elapsed * 0.7) * 0.01);

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

    // Khi Deerling đang cuộn tròn ngủ: hiển thị mắt nhắm ngủ
    const isDeerlingSleeping =
      id === 'deerling' &&
      deerlingStateRef.current === 'SLEEP_CURL' &&
      deerlingStateTimerRef.current > 0.6 &&
      deerlingStateTimerRef.current < deerlingDurationRef.current - 0.6;

    const activeEyeTex = shouldSmile
      ? eyeTextures.happyTex
      : isDeerlingSleeping || isBlinking
        ? eyeTextures.blinkTex
        : eyeTextures.openTex;

    for (const m of eyeMaterialsRef.current) {
      if (m.map !== activeEyeTex) {
        m.map = activeEyeTex;
        m.needsUpdate = true;
      }
    }

    // =========================================================================
    // 2. TƯƠNG TÁC GẶP NHAU TRÊN CÙNG TẦNG (FROAKIE XOA ĐẦU DEERLING)
    // =========================================================================
    if (isMeeting || isExcited) {
      const other = otherPosRef.current;
      const sameLayer = Math.abs(other.y - curPos.y) < 0.12;
      const lookDx = other.x - curPos.x;
      const lookDz = other.z - curPos.z;
      const dist2D = Math.hypot(lookDx, lookDz);

      if (dist2D > 0.01) {
        const meetYaw = Math.atan2(lookDx, lookDz);
        groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, meetYaw, delta * 8.0);

        // Căn khoảng cách chuẩn 0.88 đơn vị (cả khi dist2D < 0.88 lẫn dist2D > 0.88) để 2 model tuyệt đối không chồng lên nhau
        if (sameLayer && Math.abs(dist2D - 0.88) > 0.01) {
          const targetDist = 0.88;
          const diff = dist2D - targetDist; // Âm thì lùi ra xa nhau, dương thì tiến lại gần
          const moveStep = diff * 0.5 * Math.min(1, delta * 8.0);
          curPos.x += (lookDx / dist2D) * moveStep;
          curPos.z += (lookDz / dist2D) * moveStep;
          groupRef.current.position.copy(curPos);
        }
      }

      if (id === 'deerling') {
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        resetAllBones(bones);

        // Khuỵu nhẹ 2 chân trước và cúi thấp đầu về phía trước (đỉnh đầu ở Y ~ 0.43, Z ~ +0.35)
        if (bones['waist']) {
          bones['waist'].position.set(0, 0.215, -0.039);
        }
        rotateBoneLocal(bones['left_arm_01'], 0, 0.48, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, -0.85, 0);
        rotateBoneLocal(bones['left_hand'], 0, 0.38, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0.48, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, -0.85, 0);
        rotateBoneLocal(bones['right_hand'], 0, 0.38, 0);

        const nod = Math.sin(elapsed * 4.5) * 0.04;
        rotateBoneLocal(bones['spine_02'], 0, -0.38, 0);
        rotateBoneLocal(bones['neck'], 0, -0.88 + nod, 0);
        rotateBoneLocal(bones['head'], 0, -0.25 - nod, Math.sin(elapsed * 3.2) * 0.05);

        // Khẽ rung đôi tai và vẫy đuôi
        const earTwitch = Math.sin(elapsed * 11.0) * 0.22;
        rotateBoneLocal(bones['left_ear'], 0, 0, earTwitch);
        rotateBoneLocal(bones['right_ear'], 0, 0, -earTwitch);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 9.0) * 0.30);
      } else if (id === 'froakie') {
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;

        // Ngồi vững tư thế ếch (tay trái chống phẳng dưới đất)
        applyFrogSitPose(bones, Math.sin(elapsed * 3.5));

        // Hơi rướn ngực lên để vươn tay cao hơn
        if (bones['spine']?.userData.restQuat) {
          bones['spine'].quaternion.copy(bones['spine'].userData.restQuat);
        }
        rotateBoneLocal(bones['spine'], 0, -0.42, 0);

        // Reset riêng cánh tay phải rồi vươn CAO lên phía trước (Y ~ 0.52, Z ~ +0.47) đặt đúng lên đỉnh đầu Deerling
        ['right_arm_01', 'right_arm_02', 'right_arm_03', 'right_hand'].forEach((n) => {
          if (bones[n]?.userData.restQuat) bones[n].quaternion.copy(bones[n].userData.restQuat);
        });

        const patStroke = Math.sin(elapsed * 6.5) * 0.12;
        const patUpDown = Math.cos(elapsed * 6.5) * 0.06;

        rotateBoneLocal(bones['right_arm_01'], -1.44, -1.02 + patStroke, -2.13 + patUpDown);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, -0.25 + patStroke * 0.8);
        rotateBoneLocal(bones['right_arm_03'], 0, 0, 0);
        rotateBoneLocal(bones['right_hand'], 0, 0, 0.35 + patUpDown * 1.5);
      }
      return;
    }

    // =========================================================================
    // 3. MÁY TRẠNG THÁI DEERLING (ĐỨNG NGHỈ, CUỘN MÌNH NGỦ, ĐI BỘ, NHẢY TẦNG, ĂN CỎ)
    // =========================================================================
    if (id === 'deerling') {
      const state = deerlingStateRef.current;
      deerlingStateTimerRef.current += delta;
      const timer = deerlingStateTimerRef.current;

      if (state === 'REST_STAND') {
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        resetAllBones(bones);

        // Nhịp thở chậm rãi ở ngực, cổ, tai và đuôi khẽ đung đưa
        const slowBreath = Math.sin(elapsed * 2.2);
        rotateBoneLocal(bones['spine_02'], 0, slowBreath * 0.02, 0);
        rotateBoneLocal(bones['neck'], 0, 0.05 + slowBreath * 0.03, 0);
        rotateBoneLocal(bones['head'], 0, 0.06, Math.sin(elapsed * 1.2) * 0.12);
        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 2.5) * 0.08);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 2.5) * 0.08);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 2.0) * 0.12);

        if (timer >= deerlingDurationRef.current) {
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y);
          if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
            deerlingStateRef.current = 'LEAP_LAYER';
          } else {
            deerlingStateRef.current = 'WALKING';
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'SLEEP_CURL') {
        // Dáng hươu/nai nằm nghỉ thanh thoát: 2 chân trước gập gọn về sau dưới ngực, 2 chân sau xếp bên sườn, cổ và đầu ngẩng tự nhiên
        const sleepDuration = deerlingDurationRef.current;
        const curlBlend =
          THREE.MathUtils.smoothstep(timer, 0.0, 0.9) *
          (1.0 - THREE.MathUtils.smoothstep(timer, sleepDuration - 0.9, sleepDuration));
        const sleepBreath = Math.sin(elapsed * 2.0) * 0.025 * curlBlend;

        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        resetAllBones(bones);

        // 1. Hạ thấp xương chậu từ 0.257 xuống 0.115 để ngực và bụng tựa êm trên mặt đất
        if (bones['waist']) {
          bones['waist'].position.set(
            0,
            THREE.MathUtils.lerp(0.257, 0.115, curlBlend),
            -0.039,
          );
        }

        // 2. Giữ sống lưng, cổ và đầu thẳng tự nhiên, hơi ngoảnh nhẹ thanh thoát nhìn về phía trước
        rotateBoneLocal(bones['waist'], 0, 0.04 * curlBlend, 0);
        rotateBoneLocal(bones['spine_01'], 0, (0.04 + sleepBreath) * curlBlend, 0);
        rotateBoneLocal(bones['spine_02'], 0, (0.08 + sleepBreath) * curlBlend, 0);
        rotateBoneLocal(bones['neck'], 0.18 * curlBlend, (0.06 + sleepBreath) * curlBlend, 0);
        rotateBoneLocal(bones['head'], 0.15 * curlBlend, 0.05 * curlBlend, 0);

        // 3. Hai chân trước: bắp tay đưa nhẹ về trước (-0.65), khớp gối trước (arm_02) GẬP VỀ PHÍA SAU (+2.10) thu gọn dưới ngực
        rotateBoneLocal(bones['left_arm_01'], 0, -0.65 * curlBlend, 0.08 * curlBlend);
        rotateBoneLocal(bones['left_arm_02'], 0, 2.10 * curlBlend, 0);
        rotateBoneLocal(bones['left_hand'], 0, 0.35 * curlBlend, 0);

        rotateBoneLocal(bones['right_arm_01'], 0, -0.65 * curlBlend, -0.08 * curlBlend);
        rotateBoneLocal(bones['right_arm_02'], 0, 2.10 * curlBlend, 0);
        rotateBoneLocal(bones['right_hand'], 0, 0.35 * curlBlend, 0);

        // 4. Hai chân sau: đùi thu về trước (-1.05), khớp cổ chân gập lại (+1.35), bàn chân hướng mũi về phía trước (-1.20) nằm dọc bên sườn
        rotateBoneLocal(bones['left_leg_01'], 0, -1.05 * curlBlend, 0.18 * curlBlend);
        rotateBoneLocal(bones['left_leg_02'], 0, 1.35 * curlBlend, 0);
        rotateBoneLocal(bones['left_foot'], 0, -1.20 * curlBlend, 0);

        rotateBoneLocal(bones['right_leg_01'], 0, -1.05 * curlBlend, -0.18 * curlBlend);
        rotateBoneLocal(bones['right_leg_02'], 0, 1.35 * curlBlend, 0);
        rotateBoneLocal(bones['right_foot'], 0, -1.20 * curlBlend, 0);

        // Tai và đuôi thư giãn nhẹ nhàng
        rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 1.8) * 0.06 * curlBlend);
        rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 1.8) * 0.06 * curlBlend);
        rotateBoneLocal(bones['tail'], 0, -0.25 * curlBlend, 0.15 * curlBlend);

        if (timer >= sleepDuration) {
          startPosRef.current.copy(curPos);
          targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y);
          if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
            deerlingStateRef.current = 'LEAP_LAYER';
          } else {
            deerlingStateRef.current = 'WALKING';
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'WALKING') {
        const dx = targetPos.x - curPos.x;
        const dz = targetPos.z - curPos.z;
        const dist2D = Math.hypot(dx, dz);

        if (dist2D < 0.12) {
          // Đến nơi: chuyển sang một trong các trạng thái nghỉ/tĩnh
          const rand = Math.random();
          if (rand < 0.35) {
            deerlingStateRef.current = 'REST_STAND';
            deerlingDurationRef.current = 4.5 + Math.random() * 2.0;
          } else if (rand < 0.65) {
            deerlingStateRef.current = 'SLEEP_CURL';
            deerlingDurationRef.current = 7.0 + Math.random() * 2.5;
          } else if (rand < 0.85) {
            deerlingStateRef.current = 'GRAZING';
          } else {
            deerlingStateRef.current = 'LOOKING';
          }
          deerlingStateTimerRef.current = 0;
          modelInnerRef.current.position.y = 0;
          resetAllBones(bones);
        } else {
          const targetYaw = Math.atan2(dx, dz);
          groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, targetYaw, delta * 4.5);
          groupRef.current.rotation.x = 0;
          groupRef.current.rotation.z = 0;

          // Tốc độ đi bộ thong thả chuẩn 0.42 đv/s
          const walkSpeed = 0.42;
          const stepDist = Math.min(dist2D, delta * walkSpeed);
          curPos.x += (dx / dist2D) * stepDist;
          curPos.z += (dz / dist2D) * stepDist;
          curPos.y = THREE.MathUtils.lerp(curPos.y, targetPos.y, delta * 3.0);
          groupRef.current.position.copy(curPos);

          // Đồng bộ pha bước chân theo đúng sải chân: stepDist * 5.7
          walkPhaseRef.current += stepDist * 5.7;
          const phase = walkPhaseRef.current;

          // Nhấp nhô thân nhẹ theo từng nhịp chân chạm đất
          modelInnerRef.current.position.y = Math.abs(Math.cos(phase)) * 0.025;

          // Công thức chuẩn pha chống/vung 4 chi (khóa gối khi chống, gập khi vung)
          const strideA = 0.35;
          const swingFL = Math.sin(phase) * strideA;
          const swingFR = Math.sin(phase + Math.PI) * strideA;
          const swingBL = Math.sin(phase + Math.PI) * strideA;
          const swingBR = Math.sin(phase) * strideA;

          const liftFL = Math.max(0, -Math.cos(phase)) * 0.55;
          const liftFR = Math.max(0, -Math.cos(phase + Math.PI)) * 0.55;
          const liftBL = Math.max(0, -Math.cos(phase + Math.PI)) * 0.55;
          const liftBR = Math.max(0, -Math.cos(phase)) * 0.55;

          rotateBoneLocal(bones['left_arm_01'], 0, swingFL, 0);
          rotateBoneLocal(bones['left_arm_02'], 0, -liftFL, 0);
          rotateBoneLocal(bones['left_hand'], 0, liftFL * 0.4, 0);

          rotateBoneLocal(bones['right_arm_01'], 0, swingFR, 0);
          rotateBoneLocal(bones['right_arm_02'], 0, -liftFR, 0);
          rotateBoneLocal(bones['right_hand'], 0, liftFR * 0.4, 0);

          rotateBoneLocal(bones['left_leg_01'], 0, swingBL, 0);
          rotateBoneLocal(bones['left_leg_02'], 0, liftBL, 0);
          rotateBoneLocal(bones['left_foot'], 0, -liftBL * 0.5, 0);

          rotateBoneLocal(bones['right_leg_01'], 0, swingBR, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, liftBR, 0);
          rotateBoneLocal(bones['right_foot'], 0, -liftBR * 0.5, 0);

          rotateBoneLocal(bones['spine_02'], 0, 0, 0);
          rotateBoneLocal(bones['neck'], 0, Math.sin(phase * 2) * 0.05, 0);
          rotateBoneLocal(bones['head'], 0, Math.sin(phase * 2 + 0.4) * 0.05, 0);
          rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 4.5) * 0.22);
          rotateBoneLocal(bones['left_ear'], 0, 0, Math.sin(elapsed * 3.0) * 0.12);
          rotateBoneLocal(bones['right_ear'], 0, 0, -Math.sin(elapsed * 3.0) * 0.12);

          // Kích hoạt gợn sóng bước chân ngay khoảnh khắc chân chạm đất (cực trị sin)
          const currentSin = Math.sin(phase);
          if (
            (prevWalkSinRef.current < 0.92 && currentSin >= 0.92) ||
            (prevWalkSinRef.current > -0.92 && currentSin <= -0.92)
          ) {
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
        const prepTime = 0.3;
        const jumpTime = 1.1;

        if (timer < prepTime) {
          const crouchP = timer / prepTime;
          modelInnerRef.current.position.y = -0.05 * crouchP;
          rotateBoneLocal(bones['left_arm_01'], 0, 0.2 * crouchP, 0);
          rotateBoneLocal(bones['right_arm_01'], 0, 0.2 * crouchP, 0);
          rotateBoneLocal(bones['left_leg_01'], 0, 0.25 * crouchP, 0);
          rotateBoneLocal(bones['right_leg_01'], 0, 0.25 * crouchP, 0);

          const targetYaw = Math.atan2(targetPos.x - curPos.x, targetPos.z - curPos.z);
          groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, targetYaw, delta * 6.0);
        } else if (timer < prepTime + jumpTime) {
          const p = (timer - prepTime) / jumpTime;
          curPos.x = THREE.MathUtils.lerp(startPos.x, targetPos.x, p);
          curPos.y = THREE.MathUtils.lerp(startPos.y, targetPos.y, p);
          curPos.z = THREE.MathUtils.lerp(startPos.z, targetPos.z, p);
          groupRef.current.position.copy(curPos);

          const leapArc = Math.sin(p * Math.PI);
          modelInnerRef.current.position.y = leapArc * 0.85;

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
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          modelInnerRef.current.position.y = 0;
          resetAllBones(bones);

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

          // Nhảy sang tầng mới xong: nghỉ ngơi hoặc cuộn mình nằm ngủ
          const rand = Math.random();
          if (rand < 0.4) {
            deerlingStateRef.current = 'REST_STAND';
            deerlingDurationRef.current = 4.5 + Math.random() * 2.0;
          } else if (rand < 0.75) {
            deerlingStateRef.current = 'SLEEP_CURL';
            deerlingDurationRef.current = 7.0 + Math.random() * 2.5;
          } else {
            deerlingStateRef.current = 'GRAZING';
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'GRAZING') {
        modelInnerRef.current.position.y = 0;
        resetAllBones(bones);

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
          if (Math.random() < 0.55) {
            deerlingStateRef.current = Math.random() < 0.5 ? 'REST_STAND' : 'SLEEP_CURL';
            deerlingDurationRef.current = 5.0 + Math.random() * 2.5;
          } else {
            startPosRef.current.copy(curPos);
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y);
            if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
              deerlingStateRef.current = 'LEAP_LAYER';
            } else {
              deerlingStateRef.current = 'WALKING';
            }
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'LOOKING') {
        modelInnerRef.current.position.y = 0;
        resetAllBones(bones);

        rotateBoneLocal(bones['spine_02'], 0, 0, 0);
        rotateBoneLocal(bones['neck'], 0, 0.08, 0);
        rotateBoneLocal(bones['head'], 0, 0.08, Math.sin(elapsed * 2.4) * 0.28);

        const earFlick = Math.sin(elapsed * 10.0) * 0.26;
        rotateBoneLocal(bones['left_ear'], 0, 0, earFlick);
        rotateBoneLocal(bones['right_ear'], 0, 0, -earFlick);
        rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 6.0) * 0.35);

        if (timer >= 2.8) {
          if (Math.random() < 0.55) {
            deerlingStateRef.current = Math.random() < 0.5 ? 'REST_STAND' : 'SLEEP_CURL';
            deerlingDurationRef.current = 5.0 + Math.random() * 2.5;
          } else {
            startPosRef.current.copy(curPos);
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y);
            if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
              deerlingStateRef.current = 'LEAP_LAYER';
            } else {
              deerlingStateRef.current = 'WALKING';
            }
          }
          deerlingStateTimerRef.current = 0;
        }
      }
    }

    // =========================================================================
    // 4. MÁY TRẠNG THÁI FROAKIE (NGỒI NGHỈ, BẬT NHẢY, GÃI ĐẦU, VẪY TAY)
    // =========================================================================
    if (id === 'froakie') {
      const state = froakieStateRef.current;
      froakieStateTimerRef.current += delta;
      const timer = froakieStateTimerRef.current;

      const breath = Math.sin(elapsed * 3.5);

      if (state === 'REST_SIT') {
        // Ngồi nghỉ ngơi thư giãn tại chỗ
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        applyFrogSitPose(bones, breath);

        // Khẽ nghiêng/ngoảnh đầu nhẹ nhàng nhìn ngắm vũ trụ
        rotateBoneLocal(
          bones['head'],
          Math.sin(elapsed * 1.1) * 0.08,
          0.42 - breath * 0.03,
          Math.sin(elapsed * 0.7) * 0.06,
        );

        if (timer >= froakieDurationRef.current) {
          const rand = Math.random();
          if (rand < 0.35) {
            froakieStateRef.current = 'SCRATCH_HEAD';
          } else if (rand < 0.65) {
            froakieStateRef.current = 'WAVE_CAMERA';
          } else {
            startPosRef.current.copy(curPos);
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y);
            froakieStateRef.current = 'HOP_MOVE';
          }
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'HOP_MOVE') {
        const prepTime = 0.35;
        const jumpTime = 0.95;

        if (timer < prepTime) {
          // Nhún lấy đà từ tư thế ngồi ếch
          modelInnerRef.current.position.y = 0;
          modelInnerRef.current.rotation.x = 0;
          applyFrogSitPose(bones, breath);

          const dx = targetPos.x - startPos.x;
          const dz = targetPos.z - startPos.z;
          if (Math.hypot(dx, dz) > 0.05) {
            const hopYaw = Math.atan2(dx, dz);
            groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, hopYaw, delta * 6.0);
          }
        } else if (timer < prepTime + jumpTime) {
          const p = (timer - prepTime) / jumpTime;
          curPos.x = THREE.MathUtils.lerp(startPos.x, targetPos.x, p);
          curPos.y = THREE.MathUtils.lerp(startPos.y, targetPos.y, p);
          curPos.z = THREE.MathUtils.lerp(startPos.z, targetPos.z, p);
          groupRef.current.position.copy(curPos);

          const jumpArc = Math.sin(p * Math.PI);
          modelInnerRef.current.position.y = jumpArc * 0.75;

          const stretch = Math.sin(p * Math.PI); // 0 -> 1 -> 0
          const landingReach = p > 0.45 ? Math.sin(((p - 0.45) / 0.55) * Math.PI) : 0;

          // Chúi mũi về phía trước khi nhảy, nghiêng chúi xuống khi chuẩn bị tiếp đất bằng 2 tay trước
          modelInnerRef.current.rotation.x = stretch * 0.25 + landingReach * 0.22;

          if (bones['waist']) {
            bones['waist'].position.set(0, 0.088 + stretch * 0.05, -0.035);
          }

          [
            'spine',
            'neck',
            'head',
            'left_arm_01',
            'left_arm_02',
            'left_arm_03',
            'left_hand',
            'right_arm_01',
            'right_arm_02',
            'right_arm_03',
            'right_hand',
            'left_leg_01',
            'right_leg_01',
            'left_leg_02',
            'right_leg_02',
            'left_foot',
            'right_foot',
          ].forEach((n) => {
            if (bones[n]?.userData.restQuat) bones[n].quaternion.copy(bones[n].userData.restQuat);
          });

          // Lưng luôn đổ về phía trước, đầu ngẩng nhìn điểm đáp
          rotateBoneLocal(bones['spine'], 0, -0.72 - landingReach * 0.15, 0);
          rotateBoneLocal(bones['neck'], 0, 0.35, 0);
          rotateBoneLocal(bones['head'], 0, 0.48 + landingReach * 0.12, 0);

          // Hai tay trước vươn về phía trước và hướng xuống mặt đất để chạm đất trước tiên
          const armForward = -0.35 - stretch * 0.45;
          const armDown = -0.85 + stretch * 0.25 - landingReach * 0.20;
          rotateBoneLocal(bones['left_arm_01'], -0.20, armForward, armDown);
          rotateBoneLocal(bones['left_arm_02'], 0, -0.25 * (1 - stretch), 0);
          rotateBoneLocal(bones['left_arm_03'], 0.45, 0, 0);
          rotateBoneLocal(bones['left_hand'], 0.54, 0.04, 0.85);

          rotateBoneLocal(bones['right_arm_01'], 0.20, armForward, -armDown);
          rotateBoneLocal(bones['right_arm_02'], 0, -0.25 * (1 - stretch), 0);
          rotateBoneLocal(bones['right_arm_03'], -0.45, 0, 0);
          rotateBoneLocal(bones['right_hand'], -0.54, 0.04, -0.85);

          // Hai chân sau đạp duỗi ra sau ở giữa cú nhảy và thu về tư thế ngồi xổm khi tiếp đất
          const hipRy = THREE.MathUtils.lerp(-1.25, 0.25, stretch);
          const kneeRy = THREE.MathUtils.lerp(1.45, 0.20, stretch);
          const footRy = THREE.MathUtils.lerp(-0.25, 0.45, stretch);
          const splay = THREE.MathUtils.lerp(0.30, 0.12, stretch);

          rotateBoneLocal(bones['left_leg_01'], 0, hipRy, splay);
          rotateBoneLocal(bones['right_leg_01'], 0, hipRy, -splay);
          rotateBoneLocal(bones['left_leg_02'], 0, kneeRy, 0);
          rotateBoneLocal(bones['right_leg_02'], 0, kneeRy, 0);
          rotateBoneLocal(bones['left_foot'], 0, footRy, 0);
          rotateBoneLocal(bones['right_foot'], 0, footRy, 0);
        } else {
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          modelInnerRef.current.position.y = 0;
          modelInnerRef.current.rotation.x = 0;
          applyFrogSitPose(bones, 0);

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

          // Sau cú nhảy: quay về nghỉ ngơi thay vì nhảy tiếp
          froakieStateRef.current = 'REST_SIT';
          froakieDurationRef.current = 4.5 + Math.random() * 2.5;
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'SCRATCH_HEAD') {
        // Giữ nguyên tư thế ngồi ếch, tay trái chống đất, tay phải gãi phía ngoài thái dương
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        applyFrogSitPose(bones, breath);

        ['right_arm_01', 'right_arm_02', 'right_arm_03', 'right_hand'].forEach((n) => {
          if (bones[n]?.userData.restQuat) bones[n].quaternion.copy(bones[n].userData.restQuat);
        });
        const scratch = Math.sin(elapsed * 14.0) * 0.15;
        rotateBoneLocal(bones['right_arm_01'], -0.45, 0.50, -0.35);
        rotateBoneLocal(bones['right_arm_02'], 0, -0.55, -0.65 + scratch);
        rotateBoneLocal(bones['head'], -0.10, 0, 0);

        if (timer >= 2.8) {
          froakieStateRef.current = 'REST_SIT';
          froakieDurationRef.current = 4.5 + Math.random() * 2.5;
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'WAVE_CAMERA') {
        // Quay mặt về Camera, tay trái chống đất, tay phải vẫy chào & cười tít mắt
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        applyFrogSitPose(bones, breath);

        const camPos = threeState.camera.position;
        const camDx = camPos.x - curPos.x;
        const camDz = camPos.z - curPos.z;
        const camYaw = Math.atan2(camDx, camDz);
        groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, camYaw, delta * 5.0);

        ['right_arm_01', 'right_arm_02', 'right_arm_03', 'right_hand'].forEach((n) => {
          if (bones[n]?.userData.restQuat) bones[n].quaternion.copy(bones[n].userData.restQuat);
        });
        const wave = Math.sin(elapsed * 10.0) * 0.22;
        rotateBoneLocal(bones['right_arm_01'], -0.40, 0.35, -0.25 + wave);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, -0.55 + wave);
        rotateBoneLocal(bones['head'], 0.12, 0, 0);

        if (timer >= 3.2) {
          froakieStateRef.current = 'REST_SIT';
          froakieDurationRef.current = 4.5 + Math.random() * 2.5;
          froakieStateTimerRef.current = 0;
        }
      }
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    triggerCompanion(id);
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

  // Kiểm tra gặp gỡ tình cờ giữa Froakie & Deerling: BẮT BUỘC Ở CÙNG MỘT TẦNG ĐỘ CAO
  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    if (isMeeting) {
      if (elapsed >= meetingEndTimeRef.current) {
        setIsMeeting(false);
      }
    } else {
      const dy = Math.abs(froakiePosRef.current.y - deerlingPosRef.current.y);
      const dx = froakiePosRef.current.x - deerlingPosRef.current.x;
      const dz = froakiePosRef.current.z - deerlingPosRef.current.z;
      const dist2D = Math.hypot(dx, dz);

      // BẮT BUỘC cùng một tầng (dy < 0.08) và khoảng cách ngang < 1.35
      if (dy < 0.08 && dist2D < 1.35 && elapsed - lastMeetingTimeRef.current > 16.0) {
        lastMeetingTimeRef.current = elapsed;
        meetingEndTimeRef.current = elapsed + 4.2;
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
      {/* Hệ thống sóng không gian phẳng ngay dưới lòng bàn chân */}
      <SpaceRippleMeshSystem manager={rippleManager} />

      {/* Froakie (Cóc) - Tư thế ngồi ếch 4 chi chạm đất, nhảy lao chúi đầu, gãi đầu, vẫy chào camera */}
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

      {/* Deerling (Nai) - Chống trượt chân (Moonwalk), nhảy chuyển tầng, ăn cỏ, ngửi mùi */}
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
