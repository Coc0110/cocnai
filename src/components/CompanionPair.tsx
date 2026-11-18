import { useRef, useEffect, useState, useMemo } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as THREE from 'three';
import { useUniverseStore } from '../store/useUniverseStore';
import { sharedEntityPositions } from '../utils/sharedEntityPositions';

// =============================================================================
// CẤU HÌNH VÀ BỘ BIẾN TẠM TOÀN CỤC (TRÁNH RÁC BỘ NHỚ TRÊN TỪNG FRAME)
// =============================================================================
const tempEuler = new THREE.Euler();
const tempQuat = new THREE.Quaternion();

// Các tầng độ cao không gian 3D của Vũ trụ Ký ức
const Y_TIERS = [-1.75, -0.65, 0.45, 1.45];

/**
 * Chọn điểm đến ngẫu nhiên nhưng ưu tiên giữ nguyên tầng hoặc cùng tầng với bạn đồng hành
 */
function getRandomWaypoint(
  currentTierY?: number,
  partnerTierY?: number,
  maxX: number = 3.7,
  floorY?: number,
): THREE.Vector3 {
  const tiers =
    floorY !== undefined
      ? [floorY, floorY + 1.25, floorY + 2.5, floorY + 3.75]
      : Y_TIERS;

  let y: number;
  if (partnerTierY !== undefined && Math.random() < 0.65) {
    y = partnerTierY;
  } else if (currentTierY !== undefined && Math.random() < 0.70) {
    y = currentTierY;
  } else {
    y = tiers[Math.floor(Math.random() * tiers.length)];
  }

  // Quãng đường di chuyển mỗi lần vừa phải (bán kính 1.6 đến 3.8)
  const angle = Math.random() * Math.PI * 2;
  const dist = 1.6 + Math.random() * 2.2;
  let x = Math.cos(angle) * dist;
  let z = Math.sin(angle) * dist;
  x = THREE.MathUtils.clamp(x, -maxX, maxX);
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

const tempBonePos = new THREE.Vector3();

function spawnRippleAtBones(
  group: THREE.Group | null,
  bones: Record<string, THREE.Bone>,
  boneNames: string[],
  groundY: number,
  color: string,
  startR: number,
  maxR: number,
  dur: number,
  opacity: number,
  elapsed: number,
  isDouble = false,
  rippleManager: RippleManager,
) {
  if (!group || boneNames.length === 0) return;
  group.updateMatrixWorld(true);

  let sumX = 0;
  let sumZ = 0;
  let validCount = 0;

  for (const name of boneNames) {
    const bone = bones[name];
    if (bone) {
      bone.getWorldPosition(tempBonePos);
      sumX += tempBonePos.x;
      sumZ += tempBonePos.z;
      validCount++;
    }
  }

  if (validCount > 0) {
    const avgX = sumX / validCount;
    const avgZ = sumZ / validCount;
    rippleManager.add(avgX, groundY, avgZ, color, startR, maxR, dur, opacity, isDouble, elapsed);
  } else {
    rippleManager.add(group.position.x, groundY, group.position.z, color, startR, maxR, dur, opacity, isDouble, elapsed);
  }
}

const RIPPLE_VERTEX_SHADER = /* glsl */ `
  uniform float uProgress;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float r = length(uv - 0.5) * 2.0;
    float wavePhase = (r - uProgress * 0.78) * 26.0;
    float diff = r - uProgress * 0.68;
    float envelope = exp(-16.0 * diff * diff) * smoothstep(1.0, 0.75, r) * smoothstep(0.0, 0.06, r);
    pos.z += sin(wavePhase) * envelope * 0.035 * (1.0 - uProgress);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const RIPPLE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uProgress;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r > 1.0) {
      discard;
    }

    float wavePhase = (r - uProgress * 0.78) * 26.0;
    float diff = r - uProgress * 0.68;
    float envelope = exp(-16.0 * diff * diff) * smoothstep(1.0, 0.75, r) * smoothstep(0.0, 0.06, r);
    float crests = pow(max(0.0, cos(wavePhase)), 2.2) * envelope;
    float centerDrop = exp(-28.0 * r * r) * pow(max(0.0, 1.0 - uProgress), 2.0) * 0.55;

    vec3 col = mix(uColor, vec3(1.0), crests * 0.55);
    float alpha = (crests + centerDrop) * uOpacity * (1.0 - pow(clamp(uProgress, 0.0, 1.0), 1.4));
    if (alpha <= 0.001) {
      discard;
    }
    gl_FragColor = vec4(col, alpha);
  }
`;

function createRippleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0 },
    },
    vertexShader: RIPPLE_VERTEX_SHADER,
    fragmentShader: RIPPLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function SpaceRippleMeshSystem({ manager }: { manager: RippleManager }) {
  const groupRef = useRef<THREE.Group>(null);
  const planeGeom = useMemo(() => new THREE.PlaneGeometry(2, 2, 48, 48), []);
  const materials = useMemo(
    () => Array.from({ length: MAX_RIPPLES }, () => createRippleMaterial()),
    [],
  );

  useEffect(() => {
    return () => {
      planeGeom.dispose();
      materials.forEach((m) => m.dispose());
    };
  }, [planeGeom, materials]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const elapsed = state.clock.getElapsedTime();
    const children = groupRef.current.children;
    const pool = manager.getPool();

    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = pool[i];
      const mesh = children[i] as THREE.Mesh | undefined;
      if (!mesh) continue;

      if (!r.active) {
        mesh.visible = false;
        continue;
      }

      const p = (elapsed - r.startTime) / r.duration;
      if (p >= 1.0 || p < 0) {
        r.active = false;
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      mesh.position.set(r.x, r.y + 0.012, r.z);
      mesh.scale.set(r.maxRadius, r.maxRadius, 1);

      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uProgress.value = p;
      mat.uniforms.uColor.value.copy(r.color);
      mat.uniforms.uOpacity.value = r.maxOpacity;
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: MAX_RIPPLES }).map((_, i) => (
        <mesh
          key={i}
          geometry={planeGeom}
          material={materials[i]}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
          raycast={() => null}
        />
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
  floorY?: number;
  maxX?: number;
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
  floorY,
  maxX: customMaxX,
}: CompanionEntityProps) {
  const { viewport } = useThree();
  const maxX = customMaxX ?? Math.max(1.3, viewport.width * 0.36);

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

  // Đặt góc quay ban đầu hướng chếch về phía người xem ở 2 góc dưới màn hình
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(...initialPos);
      groupRef.current.rotation.y = id === 'froakie' ? 0.45 : -0.45;
    }
  }, [id, initialPos]);

  // Trạng thái cho Deerling (Mặc định bắt đầu bằng đứng nghỉ ngơi yên bình)
  const deerlingStateRef = useRef<DeerlingState>('REST_STAND');
  const deerlingStateTimerRef = useRef<number>(0);
  const deerlingDurationRef = useRef<number>(5.5);
  const handRippleRef = useRef<boolean>(false);
  const footRippleRef = useRef<boolean>(false);

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

      targetPosRef.current = getRandomWaypoint(initialPos[1], undefined, maxX, floorY);
    });

    return () => {
      isCancelled = true;
    };
  }, [id, daeUrl, targetHeight, initialPos, floorY, maxX]);

  useFrame((threeState, delta) => {
    if (!groupRef.current || !modelInnerRef.current || !eyeTextures) return;

    const elapsed = threeState.clock.getElapsedTime();
    const bones = bonesMapRef.current;
    const curPos = currentPosRef.current;
    const targetPos = targetPosRef.current;
    const startPos = startPosRef.current;

    // Cập nhật tọa độ ra ref dùng chung
    myPosRef.current.copy(curPos);
    if (!sharedEntityPositions.companions[id]) {
      sharedEntityPositions.companions[id] = new THREE.Vector3();
    }
    sharedEntityPositions.companions[id].copy(curPos);

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

        // Căn khoảng cách chuẩn 1.15 đơn vị (cả khi dist2D < 1.15 lẫn dist2D > 1.15) để 2 model tuyệt đối không chồng lên nhau
        if (sameLayer && Math.abs(dist2D - 1.15) > 0.01) {
          const targetDist = 1.15;
          const diff = dist2D - targetDist; // Âm thì lùi ra xa nhau, dương thì tiến lại gần
          const moveStep = diff * 0.5 * Math.min(1, delta * 10.0);
          curPos.x += (lookDx / dist2D) * moveStep;
          curPos.z += (lookDz / dist2D) * moveStep;
          groupRef.current.position.copy(curPos);
        }
      }

      if (id === 'deerling') {
        modelInnerRef.current.position.y = 0;
        modelInnerRef.current.rotation.x = 0;
        resetAllBones(bones);

        // Khuỵu nhẹ 2 chân trước và cúi đầu vừa phải (không chúi quá xa vào mặt Froakie)
        if (bones['waist']) {
          bones['waist'].position.set(0, 0.225, -0.039);
        }
        rotateBoneLocal(bones['left_arm_01'], 0, 0.48, 0);
        rotateBoneLocal(bones['left_arm_02'], 0, -0.85, 0);
        rotateBoneLocal(bones['left_hand'], 0, 0.38, 0);
        rotateBoneLocal(bones['right_arm_01'], 0, 0.48, 0);
        rotateBoneLocal(bones['right_arm_02'], 0, -0.85, 0);
        rotateBoneLocal(bones['right_hand'], 0, 0.38, 0);

        const nod = Math.sin(elapsed * 4.5) * 0.04;
        rotateBoneLocal(bones['spine_02'], 0, -0.24, 0);
        rotateBoneLocal(bones['neck'], 0, -0.68 + nod, 0);
        rotateBoneLocal(bones['head'], 0, -0.28 - nod, Math.sin(elapsed * 3.2) * 0.05);

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

        // Reset riêng cánh tay phải rồi duỗi thẳng hơn về phía trước vươn qua khoảng cách 1.15 đặt đúng lên trán Deerling
        ['right_arm_01', 'right_arm_02', 'right_arm_03', 'right_hand'].forEach((n) => {
          if (bones[n]?.userData.restQuat) bones[n].quaternion.copy(bones[n].userData.restQuat);
        });

        const patStroke = Math.sin(elapsed * 6.5) * 0.12;
        const patUpDown = Math.cos(elapsed * 6.5) * 0.06;

        rotateBoneLocal(bones['right_arm_01'], -1.38, -0.95 + patStroke, -2.05 + patUpDown);
        rotateBoneLocal(bones['right_arm_02'], 0, 0, -0.06 + patStroke * 0.6);
        rotateBoneLocal(bones['right_arm_03'], 0, 0, 0);
        rotateBoneLocal(bones['right_hand'], 0, 0, 0.28 + patUpDown * 1.4);
      }
      return;
    }

    // =========================================================================
    // 2.5. PHẢN LỰC ĐẨY TÁCH TRÁNH ĐÈ LÊN NHAU VÀ TRÁNH VA CHẠM KỶ VẬT
    // =========================================================================
    // Tránh va chạm giữa 2 bạn đồng hành khi không trong trạng thái gặp gỡ (dist2D < 0.95)
    const other = otherPosRef.current;
    if (Math.abs(other.y - curPos.y) < 0.8) {
      const cdx = curPos.x - other.x;
      const cdz = curPos.z - other.z;
      const cdist2D = Math.hypot(cdx, cdz);
      if (cdist2D > 0.001 && cdist2D < 0.95) {
        const push = (0.95 - cdist2D) * Math.min(1, delta * 3.5);
        curPos.x += (cdx / cdist2D) * push;
        curPos.z += (cdz / cdist2D) * push;
      }
    }

    // Tránh va chạm với các kỷ vật trôi nổi trong không gian (dist < 1.35)
    Object.values(sharedEntityPositions.keepsakes).forEach((kPos) => {
      const kdx = curPos.x - kPos.x;
      const kdy = curPos.y - kPos.y;
      const kdz = curPos.z - kPos.z;
      const kdist = Math.hypot(kdx, kdy, kdz);
      if (kdist > 0.001 && kdist < 1.35) {
        const kpush = (1.35 - kdist) * Math.min(1, delta * 4.0);
        const distXZ = Math.hypot(kdx, kdz);
        if (distXZ > 0.01) {
          curPos.x += (kdx / distXZ) * kpush;
          curPos.z += (kdz / distXZ) * kpush;
        } else {
          curPos.x += (Math.random() - 0.5) * kpush;
          curPos.z += (Math.random() - 0.5) * kpush;
        }
      }
    });

    curPos.x = THREE.MathUtils.clamp(curPos.x, -3.8, 3.8);
    curPos.z = THREE.MathUtils.clamp(curPos.z, -3.0, 2.6);
    groupRef.current.position.copy(curPos);

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
          targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y, maxX, floorY);
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
          targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y, maxX, floorY);
          if (Math.abs(targetPosRef.current.y - curPos.y) > 0.45) {
            deerlingStateRef.current = 'LEAP_LAYER';
          } else {
            deerlingStateRef.current = 'WALKING';
          }
          deerlingStateTimerRef.current = 0;
        }
      } else if (state === 'WALKING') {
        // 1. Luôn reset toàn bộ xương về Bind/Rest Pose ở đầu frame để góc quay không bị cộng dồn
        resetAllBones(bones);

        const dx = targetPos.x - curPos.x;
        const dz = targetPos.z - curPos.z;
        const dist2D = Math.hypot(dx, dz);

        const cycleDuration = 1.72;
        const tCycle = (timer % cycleDuration) / cycleDuration;

        // 2. Chỉ chuyển trạng thái nghỉ ở cuối Pha 3 tiếp đất (tCycle >= 0.92 && dist2D < 0.22) hoặc trước Pha 1 (tCycle < 0.06 && dist2D < 0.18)
        const canArrive =
          (tCycle >= 0.92 && dist2D < 0.22) ||
          (tCycle < 0.06 && dist2D < 0.18);

        if (canArrive) {
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
          modelInnerRef.current.rotation.x = 0;
          if (bones['waist']) {
            bones['waist'].position.set(0, 0.257, -0.039);
          }
          resetAllBones(bones);
        } else {
          const targetYaw = Math.atan2(dx, dz);
          groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, targetYaw, delta * 5.0);
          groupRef.current.rotation.x = 0;
          groupRef.current.rotation.z = 0;

          curPos.y = THREE.MathUtils.lerp(curPos.y, targetPos.y, delta * 3.0);

          if (tCycle < 0.18) {
            // Pha 1: Nhún lấy đà tại chỗ (0.0 <= tCycle < 0.18) - Nhịp nhún duy nhất
            const dip = Math.sin((tCycle / 0.18) * Math.PI * 0.85);
            modelInnerRef.current.position.y = 0;
            modelInnerRef.current.rotation.x = 0;
            if (bones['waist']) {
              bones['waist'].position.set(0, 0.257 - 0.024 * dip, -0.039);
            }

            // Chân trước: bắp trên xoay ÂM bù trừ với khớp gối xoay DƯƠNG để móng chân bám cố định trên sàn
            rotateBoneLocal(bones['left_arm_01'], 0, -0.24 * dip, 0);
            rotateBoneLocal(bones['right_arm_01'], 0, -0.24 * dip, 0);
            rotateBoneLocal(bones['left_arm_02'], 0, 0.44 * dip, 0);
            rotateBoneLocal(bones['right_arm_02'], 0, 0.44 * dip, 0);
            rotateBoneLocal(bones['left_hand'], 0, -0.20 * dip, 0);
            rotateBoneLocal(bones['right_hand'], 0, -0.20 * dip, 0);

            // Chân sau
            rotateBoneLocal(bones['left_leg_01'], 0, -0.22 * dip, 0);
            rotateBoneLocal(bones['right_leg_01'], 0, -0.22 * dip, 0);
            rotateBoneLocal(bones['left_leg_02'], 0, 0.40 * dip, 0);
            rotateBoneLocal(bones['right_leg_02'], 0, 0.40 * dip, 0);
            rotateBoneLocal(bones['left_foot'], 0, -0.18 * dip, 0);
            rotateBoneLocal(bones['right_foot'], 0, -0.18 * dip, 0);

            rotateBoneLocal(bones['neck'], 0, -0.10 * dip, 0);
            rotateBoneLocal(bones['head'], 0, 0.05 * dip, 0);
            rotateBoneLocal(bones['tail'], 0, 0, Math.sin(elapsed * 4.0) * 0.15);

            handRippleRef.current = false;
            footRippleRef.current = false;
          } else if (tCycle < 0.84) {
            // Pha 2: Bật nhảy lơ lửng slow-motion (0.18 <= tCycle < 0.84)
            const pAir = (tCycle - 0.18) / 0.66;
            const uAir = pAir + 0.115 * Math.sin(pAir * Math.PI * 2.0);

            // Tăng vận tốc bay ngang cơ sở lên 1.18 đv/s để mỗi cú nhảy vươn xa thanh thoát
            if (dist2D >= 0.05) {
              const airSpeed = 1.18 * Math.sin(uAir * Math.PI * 0.85 + 0.15);
              const stepDist = Math.min(dist2D, delta * airSpeed);
              curPos.x += (dx / dist2D) * stepDist;
              curPos.z += (dz / dist2D) * stepDist;
            }

            const rawSin = Math.sin(uAir * Math.PI);
            const hopArc =
              rawSin * THREE.MathUtils.smoothstep(pAir, 1.0, 0.82) +
              Math.pow(rawSin, 1.6) * (1.0 - THREE.MathUtils.smoothstep(pAir, 1.0, 0.82));
            modelInnerRef.current.position.y = hopArc * 0.32;
            modelInnerRef.current.rotation.x = -Math.cos(uAir * Math.PI) * 0.12;

            if (bones['waist']) {
              bones['waist'].position.set(0, 0.257, -0.039);
            }

            // Lệch pha: chân trước duỗi thẳng sớm hơn đón đất, chân sau thu về muộn hơn
            const frontFold = 1.0 - THREE.MathUtils.smoothstep(uAir, 0.42, 0.88);
            const hindFold = 1.0 - THREE.MathUtils.smoothstep(uAir, 0.58, 0.98);

            rotateBoneLocal(bones['left_arm_01'], 0, -0.42 * hopArc * frontFold, 0);
            rotateBoneLocal(bones['right_arm_01'], 0, -0.42 * hopArc * frontFold, 0);
            rotateBoneLocal(bones['left_arm_02'], 0, 0.95 * hopArc * frontFold, 0);
            rotateBoneLocal(bones['right_arm_02'], 0, 0.95 * hopArc * frontFold, 0);

            rotateBoneLocal(bones['left_leg_01'], 0, 0.38 * hopArc * hindFold, 0);
            rotateBoneLocal(bones['right_leg_01'], 0, 0.38 * hopArc * hindFold, 0);
            rotateBoneLocal(bones['left_leg_02'], 0, 0.28 * hopArc * hindFold, 0);
            rotateBoneLocal(bones['right_leg_02'], 0, 0.28 * hopArc * hindFold, 0);

            rotateBoneLocal(bones['neck'], 0, 0.22 * hopArc, 0);
            rotateBoneLocal(bones['head'], 0, -0.10 * hopArc, 0);
            rotateBoneLocal(bones['left_ear'], 0, 0, 0.24 * hopArc);
            rotateBoneLocal(bones['right_ear'], 0, 0, -0.24 * hopArc);
            rotateBoneLocal(bones['tail'], 0, -0.35 * hopArc, Math.sin(elapsed * 8.0) * 0.20);

            // Cuối Pha 2 khi 2 chân trước vừa vươn chạm đất (pAir >= 0.90)
            if (pAir >= 0.90 && !handRippleRef.current) {
              handRippleRef.current = true;
              spawnRippleAtBones(
                groupRef.current,
                bones,
                ['left_hand', 'right_hand'],
                curPos.y,
                '#fbcfe8',
                0.05,
                0.38,
                0.95,
                0.50,
                elapsed,
                false,
                rippleManager,
              );
            }
          } else {
            // Pha 3: Tiếp đất êm ái với quán tính mềm (0.84 <= tCycle <= 1.0)
            const pLand = (tCycle - 0.84) / 0.16;
            const softWave = Math.sin(pLand * Math.PI);

            modelInnerRef.current.position.y = 0;
            modelInnerRef.current.rotation.x = THREE.MathUtils.lerp(
              modelInnerRef.current.rotation.x,
              0,
              delta * 14.0,
            );

            if (bones['waist']) {
              bones['waist'].position.set(0, 0.257, -0.039);
            }

            // Toàn bộ 4 chân đứng thẳng trên sàn, cổ/đầu/tai/đuôi chuyển động quán tính mềm
            rotateBoneLocal(bones['spine_02'], 0, -0.05 * softWave, 0);
            rotateBoneLocal(bones['neck'], 0, -0.11 * softWave, 0);
            rotateBoneLocal(bones['head'], 0, 0.07 * softWave, 0);
            rotateBoneLocal(bones['left_ear'], 0, 0, -0.16 * softWave);
            rotateBoneLocal(bones['right_ear'], 0, 0, 0.16 * softWave);
            rotateBoneLocal(bones['tail'], 0, -0.18 * softWave, 0);

            // Đầu Pha 3 khi 2 chân sau chạm đất
            if (tCycle >= 0.84 && !footRippleRef.current) {
              footRippleRef.current = true;
              spawnRippleAtBones(
                groupRef.current,
                bones,
                ['left_foot', 'right_foot'],
                curPos.y,
                '#fbcfe8',
                0.06,
                0.48,
                1.05,
                0.60,
                elapsed,
                false,
                rippleManager,
              );
            }
          }

          groupRef.current.position.copy(curPos);
        }
      } else if (state === 'LEAP_LAYER') {
        const prepTime = 0.3;
        const jumpTime = 1.1;

        if (timer < prepTime) {
          handRippleRef.current = false;
          footRippleRef.current = false;

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

          // Chân trước vươn chạm đất sớm khi p >= 0.90
          if (p >= 0.90 && !handRippleRef.current) {
            handRippleRef.current = true;
            spawnRippleAtBones(
              groupRef.current,
              bones,
              ['left_hand', 'right_hand'],
              targetPos.y,
              '#f9a8d4',
              0.06,
              0.52,
              1.15,
              0.65,
              elapsed,
              false,
              rippleManager,
            );
          }
        } else {
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          modelInnerRef.current.position.y = 0;
          resetAllBones(bones);

          if (!footRippleRef.current) {
            footRippleRef.current = true;
            spawnRippleAtBones(
              groupRef.current,
              bones,
              ['left_foot', 'right_foot'],
              targetPos.y,
              '#f9a8d4',
              0.08,
              0.72,
              1.35,
              0.75,
              elapsed,
              true,
              rippleManager,
            );
          }

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
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y, maxX, floorY);
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
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y, maxX, floorY);
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
            targetPosRef.current = getRandomWaypoint(curPos.y, otherPosRef.current.y, maxX, floorY);
            froakieStateRef.current = 'HOP_MOVE';
          }
          froakieStateTimerRef.current = 0;
        }
      } else if (state === 'HOP_MOVE') {
        const prepTime = 0.35;
        const jumpTime = 0.95;

        if (timer < prepTime) {
          handRippleRef.current = false;
          footRippleRef.current = false;

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

          // Khi đang đáp xuống ở cuối cú nhảy (p >= 0.88): 2 bàn tay trước chạm đất trước
          if (p >= 0.88 && !handRippleRef.current) {
            handRippleRef.current = true;
            spawnRippleAtBones(
              groupRef.current,
              bones,
              ['left_hand', 'right_hand'],
              curPos.y,
              '#7dd3fc',
              0.05,
              0.40,
              0.95,
              0.55,
              elapsed,
              false,
              rippleManager,
            );
          }
        } else {
          curPos.copy(targetPos);
          groupRef.current.position.copy(curPos);
          modelInnerRef.current.position.y = 0;
          modelInnerRef.current.rotation.x = 0;
          applyFrogSitPose(bones, 0);

          // Khi hoàn tất cú nhảy: 2 bàn chân sau chạm đất (tuyệt đối không phát ở curPos dưới mông)
          if (!footRippleRef.current) {
            footRippleRef.current = true;
            const isLayerHop = Math.abs(targetPos.y - startPos.y) > 0.45;
            spawnRippleAtBones(
              groupRef.current,
              bones,
              ['left_foot', 'right_foot'],
              curPos.y,
              '#7dd3fc',
              isLayerHop ? 0.08 : 0.06,
              isLayerHop ? 0.72 : 0.48,
              isLayerHop ? 1.35 : 1.05,
              isLayerHop ? 0.75 : 0.60,
              elapsed,
              isLayerHop,
              rippleManager,
            );
          }

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
      0.08,
      0.72,
      1.35,
      0.75,
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
  const { camera, size } = useThree();
  const perspCam = camera as THREE.PerspectiveCamera;
  const companionZ = 0.4;
  const fovDeg = perspCam.fov || 78;
  const dist = Math.abs(camera.position.z - companionZ);
  const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const visW = visH * (size.width / Math.max(1, size.height));
  const cornerX = visW * 0.36;
  const bottomY = -visH * 0.42;

  const froakieInitialPos = useMemo<[number, number, number]>(
    () => [-cornerX, bottomY, companionZ],
    [cornerX, bottomY, companionZ],
  );
  const deerlingInitialPos = useMemo<[number, number, number]>(
    () => [cornerX, bottomY, companionZ],
    [cornerX, bottomY, companionZ],
  );

  const froakiePosRef = useRef<THREE.Vector3>(new THREE.Vector3(...froakieInitialPos));
  const deerlingPosRef = useRef<THREE.Vector3>(new THREE.Vector3(...deerlingInitialPos));

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
          0.08,
          0.72,
          1.35,
          0.75,
          true,
          elapsed,
        );
        rippleManager.add(
          deerlingPosRef.current.x,
          deerlingPosRef.current.y,
          deerlingPosRef.current.z,
          '#f9a8d4',
          0.08,
          0.72,
          1.35,
          0.75,
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
        initialPos={froakieInitialPos}
        targetHeight={1.05}
        myPosRef={froakiePosRef}
        otherPosRef={deerlingPosRef}
        rippleManager={rippleManager}
        isMeeting={isMeeting}
        floorY={bottomY}
        maxX={visW * 0.42}
      />

      {/* Deerling (Nai) - Chống trượt chân (Moonwalk), nhảy chuyển tầng, ăn cỏ, ngửi mùi */}
      <CompanionEntity
        id="deerling"
        daeUrl="/models/companions/deerling/pm0585_11_00.dae"
        initialPos={deerlingInitialPos}
        targetHeight={1.2}
        myPosRef={deerlingPosRef}
        otherPosRef={froakiePosRef}
        rippleManager={rippleManager}
        isMeeting={isMeeting}
        floorY={bottomY}
        maxX={visW * 0.42}
      />
    </group>
  );
}
