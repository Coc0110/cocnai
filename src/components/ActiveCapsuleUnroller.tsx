import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { LetterItem } from '../types/universe';
import { createSingleCapsule } from '../utils/prepareKeepsakeScene';

interface ActiveCapsuleUnrollerProps {
  letter: LetterItem;
  localStartPos: THREE.Vector3;
  localStartQuat: THREE.Quaternion;
  localMouthPos: THREE.Vector3;
  startHolderScale: number;
  targetCapsule?: THREE.Object3D;
  preparedScene?: THREE.Group;
  minVisibleDim?: number;
  isClosing: boolean;
  onFinishClose: () => void;
  onReadingReady?: () => void;
  onRequestClose: () => void;
}

// Scratch vectors cho tính toán động học live
const _dynStartPos = new THREE.Vector3();
const _dynStartQuat = new THREE.Quaternion();
const _dynMouthPos = new THREE.Vector3();
const _dynAboveMouthPos = new THREE.Vector3();
const _tempWorldPos = new THREE.Vector3();
const _tempWorldQuat = new THREE.Quaternion();
const _tempContainerQuat = new THREE.Quaternion();
const _tempClosedPos = new THREE.Vector3();
const _tempCtrl = new THREE.Vector3();

export function ActiveCapsuleUnroller({
  letter,
  localStartPos,
  localStartQuat,
  localMouthPos,
  startHolderScale,
  targetCapsule,
  preparedScene,
  isClosing,
  onFinishClose,
  onReadingReady,
  onRequestClose,
}: ActiveCapsuleUnrollerProps): JSX.Element {
  const { size, camera } = useThree();
  const isMobile = size.width < size.height;

  const containerRef = useRef<THREE.Group>(null);
  const capsuleHolderRef = useRef<THREE.Group>(null);
  const paperGroupRef = useRef<THREE.Group>(null);

  const openTimeRef = useRef<number>(0);
  const hasNotifiedReading = useRef<boolean>(false);

  // Người dùng xoay tự do để ngắm 2 mặt thư khi đọc xong (t >= 3.15)
  const userLetterRotRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoomScale, setZoomScale] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tạo viên nang 3D (kích thước chuẩn createSingleCapsule)
  const capsuleObj = useMemo(() => {
    return createSingleCapsule(letter);
  }, [letter]);

  // Texture mặt trước và mặt sau của lá thư
  const [frontTex, backTex] = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const f = loader.load(letter.front);
    f.colorSpace = THREE.SRGBColorSpace;
    const b = loader.load(letter.back);
    b.colorSpace = THREE.SRGBColorSpace;
    return [f, b];
  }, [letter.front, letter.back]);

  // 1. Tính kích thước lá thư targetW và targetH chuẩn tỷ lệ aspectRatio (4:1) KHÔNG BAO GIỜ tràn viền
  const { targetW, targetH, targetHolderScale, fovScale } = useMemo(() => {
    const fovDeg = (camera as THREE.PerspectiveCamera).fov || 50;
    const fovScale = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) / Math.tan(THREE.MathUtils.degToRad(50) / 2);
    const distToPaper = 2.10;
    const visH = 2 * distToPaper * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
    const visW = visH * (size.width / Math.max(1, size.height));
    const w = Math.min(2.1 * fovScale, visW * (isMobile ? 0.86 : 0.72));
    const h = w / letter.aspectRatio;

    // Chiều dài cuộn giấy scrollRoll trong capsuleObj là 0.94 * scaleY
    const scrollMeshH = 0.94 * (capsuleObj.scale.y || 1.18);
    const holderScale = h / scrollMeshH;

    return {
      targetW: w,
      targetH: h,
      targetHolderScale: holderScale,
      fovScale,
    };
  }, [camera, size.width, size.height, isMobile, letter.aspectRatio, capsuleObj.scale.y]);

  const segsX = 80;
  const planeGeo = useMemo(() => new THREE.PlaneGeometry(targetW, targetH, segsX, 1), [targetW, targetH]);
  const origPositions = useMemo(() => {
    return (planeGeo.attributes.position.array as Float32Array).slice();
  }, [planeGeo]);

  const frontMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: frontTex,
        roughness: 0.85,
        metalness: 0.02,
        side: THREE.FrontSide,
      }),
    [frontTex],
  );

  const backMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: backTex,
        roughness: 0.85,
        metalness: 0.02,
        side: THREE.BackSide,
      }),
    [backTex],
  );

  // Đích dừng chính giữa trước ống kính (ở hẳn phía trước z = 0.35 * fovScale)
  const localTargetPos = useMemo(() => new THREE.Vector3(0, 0, 0.35 * fovScale), [fovScale]);

  // Góc xoay khi đến trước camera: Máy tính nằm ngang (Z = PI/2), Điện thoại nằm dọc (Z = 0)
  const targetQuat = useMemo(() => {
    const euler = isMobile ? new THREE.Euler(0, 0, 0) : new THREE.Euler(0, 0, Math.PI / 2);
    return new THREE.Quaternion().setFromEuler(euler);
  }, [isMobile]);

  useFrame((state, delta) => {
    const elapsed = state.clock.getElapsedTime();

    // 1. Đọc vị trí và góc xoay thế giới thực tế của viên thuốc đích trong lọ (khi lọ đang ở z = -1.15)
    _dynStartPos.copy(localStartPos);
    _dynStartQuat.copy(localStartQuat);
    _dynMouthPos.copy(localMouthPos);

    if (containerRef.current && targetCapsule) {
      targetCapsule.getWorldPosition(_tempWorldPos);
      containerRef.current.worldToLocal(_tempWorldPos);
      _dynStartPos.copy(_tempWorldPos);

      targetCapsule.getWorldQuaternion(_tempWorldQuat);
      containerRef.current.getWorldQuaternion(_tempContainerQuat);
      _tempWorldQuat.premultiply(_tempContainerQuat.invert());
      _dynStartQuat.copy(_tempWorldQuat);
    }

    if (containerRef.current && preparedScene) {
      const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;
      if (corkNode && corkNode.userData.closedPos) {
        _tempClosedPos.copy(corkNode.userData.closedPos as THREE.Vector3);
        const mouthWorld = corkNode.parent ? corkNode.parent.localToWorld(_tempClosedPos) : _tempClosedPos;
        containerRef.current.worldToLocal(mouthWorld);
        _dynMouthPos.copy(mouthWorld);
      } else {
        _tempClosedPos.set(0, 6.8, 0);
        const mouthWorld = preparedScene.localToWorld(_tempClosedPos);
        containerRef.current.worldToLocal(mouthWorld);
        _dynMouthPos.copy(mouthWorld);
      }
    }

    _dynAboveMouthPos.copy(_dynMouthPos).add(new THREE.Vector3(0, 0.35, 0));

    // 2. Quản lý thời gian mở / đóng thư
    if (isClosing) {
      // Đóng ngược lại: lùi thời gian từ 3.15 về 0.0
      openTimeRef.current = Math.max(0, openTimeRef.current - delta * 1.35);

      // Trả góc xoay và zoom của người dùng về mặc định
      userLetterRotRef.current.x = THREE.MathUtils.lerp(userLetterRotRef.current.x, 0, delta * 8.0);
      userLetterRotRef.current.y = THREE.MathUtils.lerp(userLetterRotRef.current.y, 0, delta * 8.0);
      setZoomScale((prev) => THREE.MathUtils.lerp(prev, 1.0, delta * 8.0));

      if (openTimeRef.current <= 0.001) {
        onFinishClose();
        return;
      }
    } else {
      openTimeRef.current = Math.min(3.15, openTimeRef.current + delta);
    }

    const t = openTimeRef.current;

    const topShell = capsuleObj.getObjectByName('topShell') as THREE.Group | undefined;
    const bottomShell = capsuleObj.getObjectByName('bottomShell') as THREE.Group | undefined;
    const goldRing = capsuleObj.getObjectByName('goldRing') as THREE.Mesh | undefined;
    const scrollRoll = capsuleObj.getObjectByName('scrollRoll') as THREE.Group | undefined;

    // =========================================================================
    // Giai đoạn 1 (0.0s -> 0.95s): Quỹ đạo bay 2 chặng từ trong lọ qua miệng lọ
    // =========================================================================
    if (t < 0.95) {
      const p1 = Math.min(1, Math.max(0, t / 0.95));
      let curPos: THREE.Vector3;
      let curScale: number;
      let curQuat: THREE.Quaternion;

      if (p1 < 0.45) {
        // Nửa đầu (0.0 -> 0.45): Bay giữa vị trí trong bình và miệng lọ
        const s1 = p1 / 0.45;
        const ease1 = s1 * s1 * (3 - 2 * s1);
        curPos = new THREE.Vector3().lerpVectors(_dynStartPos, _dynAboveMouthPos, ease1);
        curScale = startHolderScale;
        curQuat = _dynStartQuat.clone();
      } else {
        // Nửa sau (0.45 -> 1.0): Lượn giữa trên miệng lọ và vị trí trước camera, scale to dần
        const s2 = (p1 - 0.45) / 0.55;
        const ease2 = s2 * s2 * (3 - 2 * s2);
        _tempCtrl
          .copy(_dynAboveMouthPos)
          .add(localTargetPos)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, 0.12, 0.22));

        curPos = new THREE.Vector3()
          .copy(_dynAboveMouthPos)
          .multiplyScalar((1 - ease2) * (1 - ease2))
          .addScaledVector(_tempCtrl, 2 * (1 - ease2) * ease2)
          .addScaledVector(localTargetPos, ease2 * ease2);

        curScale = THREE.MathUtils.lerp(startHolderScale, targetHolderScale, ease2);
        curQuat = new THREE.Quaternion().slerpQuaternions(_dynStartQuat, targetQuat, ease2);
      }

      if (capsuleHolderRef.current) {
        capsuleHolderRef.current.position.copy(curPos);
        capsuleHolderRef.current.quaternion.copy(curQuat);
        capsuleHolderRef.current.scale.setScalar(curScale);
      }
    } else {
      if (capsuleHolderRef.current) {
        capsuleHolderRef.current.position.copy(localTargetPos);
        capsuleHolderRef.current.quaternion.copy(targetQuat);
        capsuleHolderRef.current.scale.setScalar(targetHolderScale);
      }
    }

    // Hệ số quy đổi từ không gian hiển thị (containerRef) sang không gian cục bộ của capsuleObj
    const invScale = 1.0 / Math.max(0.05, targetHolderScale * (capsuleObj.scale.x || 1.06));

    // =========================================================================
    // Giai đoạn 2, 3, 4: Điều khiển 2 nửa vỏ nhựa (topShell & bottomShell)
    // =========================================================================
    if (topShell && bottomShell) {
      topShell.visible = true;
      bottomShell.visible = true;

      if (t < 0.95) {
        topShell.position.set(0, 0, 0);
        topShell.rotation.set(0, 0, 0);
        bottomShell.position.set(0, 0, 0);
        bottomShell.rotation.set(0, 0, 0);
      } else if (t < 1.55) {
        // Giai đoạn 2 (0.95s -> 1.55s): Tách 2 nửa vỏ dọc theo trục viên nang (±0.65)
        const p2 = (t - 0.95) / 0.60;
        const ease2 = p2 * p2 * (3 - 2 * p2);

        topShell.position.x = 0;
        topShell.position.y = THREE.MathUtils.lerp(0, 0.65, ease2);
        topShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);
        topShell.rotation.set(0, 0, 0);

        bottomShell.position.x = 0;
        bottomShell.position.y = THREE.MathUtils.lerp(0, -0.65, ease2);
        bottomShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);
        bottomShell.rotation.set(0, 0, 0);
      } else {
        // Giai đoạn 3 & 4 (t >= 1.55s): Dịch chuyển ra ngoài viền lá thư & lùi ra sau mặt phẳng thư
        const p34 = Math.min(1, (t - 1.55) / 0.60);
        const ease34 = p34 * p34 * (3 - 2 * p34);

        const bobTop = Math.sin(elapsed * 1.5) * (0.055 * invScale);
        const bobBot = Math.cos(elapsed * 1.35) * (0.055 * invScale);
        const swayTop = Math.cos(elapsed * 1.2) * 0.06;
        const swayBot = Math.sin(elapsed * 1.1) * 0.06;

        if (!isMobile) {
          // Trên Máy tính (rotation.z = Math.PI / 2, nơi localX là trục dọc màn hình +screenY):
          // Đưa 2 nửa vỏ ra khoảng trống phía dưới mép dưới lá thư (localX < 0)
          const targetShellX = -(targetH / 2 + 0.25 * fovScale) * invScale;
          const targetTopY = (targetW * 0.28) * invScale;
          const targetBotY = -(targetW * 0.28) * invScale;
          const targetZ = -0.26 * fovScale * invScale;

          topShell.position.x = THREE.MathUtils.lerp(0, targetShellX + bobTop, ease34);
          topShell.position.y = THREE.MathUtils.lerp(0.65, targetTopY + bobTop * 0.5, ease34);
          topShell.position.z = THREE.MathUtils.lerp(-0.15, targetZ, ease34);
          topShell.rotation.set(
            THREE.MathUtils.lerp(0, 0.16, ease34),
            0,
            THREE.MathUtils.lerp(0, 0.24 + swayTop, ease34),
          );

          bottomShell.position.x = THREE.MathUtils.lerp(0, targetShellX + bobBot, ease34);
          bottomShell.position.y = THREE.MathUtils.lerp(-0.65, targetBotY - bobBot * 0.5, ease34);
          bottomShell.position.z = THREE.MathUtils.lerp(-0.15, targetZ, ease34);
          bottomShell.rotation.set(
            THREE.MathUtils.lerp(0, -0.15, ease34),
            0,
            THREE.MathUtils.lerp(0, 0.22 + swayBot, ease34),
          );
        } else {
          // Trên Điện thoại (rotation.z = 0):
          // topShell: Dịch sang TRÁI để tránh nắp bần, đưa lên trên, lùi nhẹ
          const targetTopX = -0.28 * fovScale * invScale;
          const targetTopY = +(targetH / 2 + 0.25 * fovScale) * invScale;
          const targetZ = -0.26 * fovScale * invScale;

          topShell.position.x = THREE.MathUtils.lerp(0, targetTopX + bobTop * 0.5, ease34);
          topShell.position.y = THREE.MathUtils.lerp(0.65, targetTopY + bobTop, ease34);
          topShell.position.z = THREE.MathUtils.lerp(-0.15, targetZ, ease34);
          topShell.rotation.set(
            THREE.MathUtils.lerp(0, 0.16, ease34),
            0,
            THREE.MathUtils.lerp(0, 0.24 + swayTop, ease34),
          );

          // bottomShell: Dịch sang PHẢI, đưa xuống dưới
          const targetBotX = +0.28 * fovScale * invScale;
          const targetBotY = -(targetH / 2 + 0.25 * fovScale) * invScale;

          bottomShell.position.x = THREE.MathUtils.lerp(0, targetBotX - bobBot * 0.5, ease34);
          bottomShell.position.y = THREE.MathUtils.lerp(-0.65, targetBotY + bobBot, ease34);
          bottomShell.position.z = THREE.MathUtils.lerp(-0.15, targetZ, ease34);
          bottomShell.rotation.set(
            THREE.MathUtils.lerp(0, -0.15, ease34),
            0,
            THREE.MathUtils.lerp(0, 0.22 + swayBot, ease34),
          );
        }
      }
    }

    // =========================================================================
    // Giai đoạn 3 & 4: Vòng vàng tuột khỏi cuộn thư & lơ lửng phía trên mép thư
    // =========================================================================
    const p3 = Math.min(1, Math.max(0, (t - 1.55) / 0.60));

    if (goldRing) {
      goldRing.visible = true;

      if (t < 1.55) {
        goldRing.position.set(0, 0, 0);
        goldRing.rotation.set(Math.PI / 2, 0, 0);
      } else {
        if (p3 <= 0.65) {
          // Bước 3A (0.0 -> 0.65): Trượt thẳng dọc trục cuộn thư từ 0 đến +0.56 ra khỏi đầu cuộn
          const s3A = p3 / 0.65;
          const ease3A = s3A * s3A * (3 - 2 * s3A);
          goldRing.position.x = 0;
          goldRing.position.y = THREE.MathUtils.lerp(0, 0.56, ease3A);
          goldRing.position.z = 0;
          goldRing.rotation.set(Math.PI / 2, 0, 0);
        } else {
          // Bước 3B (0.65 -> 1.0) & Giai đoạn 4: Dịch chuyển mượt ra phía trên mép lá thư & lùi ra sau
          const s3B = t < 2.15 ? (p3 - 0.65) / 0.35 : 1.0;
          const ease3B = Math.min(1, Math.max(0, s3B * s3B * (3 - 2 * s3B)));

          const bobRingY = Math.sin(elapsed * 1.7 + 1.0) * (0.085 * fovScale * invScale);
          const bobRingX = Math.cos(elapsed * 1.3 + 0.5) * (0.055 * fovScale * invScale);

          if (!isMobile) {
            // Máy tính (rotation.z = Math.PI / 2, nơi +localX là hướng lên trên màn hình +screenY):
            const targetRingX = +(targetH / 2 + 0.22 * fovScale) * invScale + bobRingY;
            const targetRingY = (0.35 * fovScale) * invScale + bobRingX;
            const targetRingZ = -0.24 * fovScale * invScale;

            goldRing.position.x = THREE.MathUtils.lerp(0, targetRingX, ease3B);
            goldRing.position.y = THREE.MathUtils.lerp(0.56, targetRingY, ease3B);
            goldRing.position.z = THREE.MathUtils.lerp(0, targetRingZ, ease3B);
          } else {
            // Điện thoại (rotation.z = 0, nơi +localY là hướng lên trên màn hình +screenY):
            const targetRingX = (0.28 * fovScale) * invScale + bobRingX;
            const targetRingY = +(targetH / 2 + 0.22 * fovScale) * invScale + bobRingY;
            const targetRingZ = -0.24 * fovScale * invScale;

            goldRing.position.x = THREE.MathUtils.lerp(0, targetRingX, ease3B);
            goldRing.position.y = THREE.MathUtils.lerp(0.56, targetRingY, ease3B);
            goldRing.position.z = THREE.MathUtils.lerp(0, targetRingZ, ease3B);
          }

          goldRing.rotation.x = THREE.MathUtils.lerp(
            Math.PI / 2,
            Math.PI / 2 - 0.38 + Math.sin(elapsed * 1.6) * 0.12,
            ease3B,
          );
          goldRing.rotation.y = THREE.MathUtils.lerp(0, 0.32 + Math.cos(elapsed * 1.4) * 0.10, ease3B);
          goldRing.rotation.z = THREE.MathUtils.lerp(0, -0.25 + Math.sin(elapsed * 1.2) * 0.08, ease3B);
        }
      }
    }

    // Chuyển hướng cuộn giấy mượt sang mép trái (x = -targetW / 2) và tư thế thẳng đứng
    if (scrollRoll) {
      const sRoll = Math.max(0, (p3 - 0.5) / 0.5);
      const easeRoll = sRoll * sRoll * (3 - 2 * sRoll);

      if (!isMobile) {
        // Trên Máy tính: xoay mượt cuộn giấy về trục thẳng đứng và tịnh tiến sang mép trái
        const targetScrollY = -targetW / (2 * targetHolderScale);
        scrollRoll.rotation.set(0, 0, THREE.MathUtils.lerp(0, -Math.PI / 2, easeRoll));
        scrollRoll.position.set(0, THREE.MathUtils.lerp(0, targetScrollY, easeRoll), 0);
      } else {
        // Trên Điện thoại: cuộn giấy đã thẳng đứng, tịnh tiến sang mép trái
        const targetScrollX = -targetW / (2 * targetHolderScale);
        scrollRoll.rotation.set(0, 0, 0);
        scrollRoll.position.set(THREE.MathUtils.lerp(0, targetScrollX, easeRoll), 0, 0);
      }
    }

    // =========================================================================
    // Giai đoạn 4 (2.15s -> 3.15s): Cuộn mở thư TỪ TRÁI QUA PHẢI
    // =========================================================================
    if (t < 2.15) {
      if (scrollRoll) scrollRoll.visible = true;
      if (paperGroupRef.current) paperGroupRef.current.visible = false;
      hasNotifiedReading.current = false;
    } else {
      if (scrollRoll) scrollRoll.visible = false;
      if (paperGroupRef.current) paperGroupRef.current.visible = true;

      const p4 = Math.min(1, Math.max(0, (t - 2.15) / 1.0));
      const u = p4 * p4 * (3 - 2 * p4); // 0 -> 1

      const posAttr = planeGeo.attributes.position;
      const halfW = targetW / 2;
      const unrollX = -halfW + u * targetW; // Đường biên đang mở chạy từ -halfW đến +halfW

      for (let i = 0; i < posAttr.count; i++) {
        const ox = origPositions[i * 3];
        const oy = origPositions[i * 3 + 1];

        if (ox <= unrollX) {
          // Phần giấy đã được mở phẳng hoàn toàn
          posAttr.setXYZ(i, ox, oy, 0);
        } else {
          // Phần giấy vẫn đang cuộn tròn về phía mép phải
          const dist = ox - unrollX;
          const rollRadius = 0.08 * (1.0 - u * 0.35);
          const theta = dist / rollRadius;
          const cx = unrollX + rollRadius * Math.sin(theta);
          const cz = rollRadius * (1.0 - Math.cos(theta));
          posAttr.setXYZ(i, cx, oy, cz);
        }
      }
      posAttr.needsUpdate = true;
      planeGeo.computeVertexNormals();

      if (u >= 0.999 && !hasNotifiedReading.current) {
        hasNotifiedReading.current = true;
        onReadingReady?.();
      }
    }

    // Khi đã mở hoàn tất (t >= 3.15), cho phép người dùng xoay và zoom ngắm thư
    if (paperGroupRef.current) {
      paperGroupRef.current.position.set(0, 0, 0.35 * fovScale);
      if (t >= 3.15) {
        paperGroupRef.current.rotation.y = userLetterRotRef.current.y;
        paperGroupRef.current.rotation.x = userLetterRotRef.current.x;
        paperGroupRef.current.scale.setScalar(zoomScale);
      } else {
        paperGroupRef.current.rotation.set(0, 0, 0);
        paperGroupRef.current.scale.setScalar(1.0);
      }
    }
  });

  // Hỗ trợ bấm phím Escape để thu thư lại
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onRequestClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRequestClose]);

  // Hỗ trợ chụm 2 ngón tay zoom lá thư khi đọc
  useEffect(() => {
    let initialDist = 0;
    let initialZoom = 1.0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && openTimeRef.current >= 3.15) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        initialDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        initialZoom = zoomScale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist > 0 && openTimeRef.current >= 3.15) {
        e.preventDefault();
        e.stopPropagation();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        setZoomScale(Math.min(2.2, Math.max(0.65, initialZoom * (dist / initialDist))));
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [zoomScale]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (openTimeRef.current < 3.15 || isClosing) return;
    e.stopPropagation();
    setIsDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || openTimeRef.current < 3.15 || isClosing) return;
    e.stopPropagation();
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    userLetterRotRef.current.y += dx * 0.012;
    userLetterRotRef.current.x += dy * 0.012;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging) {
      e.stopPropagation();
      setIsDragging(false);
      try {
        (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Safe
      }
    }
  };

  const handleWheel = (e: ThreeEvent<WheelEvent>) => {
    if (openTimeRef.current < 3.15 || isClosing) return;
    e.stopPropagation();
    setZoomScale((prev) => Math.min(2.2, Math.max(0.65, prev - e.deltaY * 0.0015)));
  };

  return (
    <group ref={containerRef}>
      {/* 1. Nhóm chứa viên nang 3D (vỏ và vòng vàng tiếp tục lơ lửng) */}
      <group ref={capsuleHolderRef}>
        <primitive object={capsuleObj} />
      </group>

      {/* 2. Nhóm chứa bức thư cuộn mở phẳng (mặt trước & mặt sau) */}
      <group
        ref={paperGroupRef}
        visible={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <mesh geometry={planeGeo} material={frontMat} />
        <mesh geometry={planeGeo} material={backMat} />
      </group>
    </group>
  );
}
