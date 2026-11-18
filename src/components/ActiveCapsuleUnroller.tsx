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
  minVisibleDim?: number;
  isClosing: boolean;
  onFinishClose: () => void;
  onReadingReady?: () => void;
  onRequestClose: () => void;
}

export function ActiveCapsuleUnroller({
  letter,
  localStartPos,
  localStartQuat,
  localMouthPos,
  startHolderScale,
  isClosing,
  onFinishClose,
  onReadingReady,
  onRequestClose,
}: ActiveCapsuleUnrollerProps): JSX.Element {
  const { size } = useThree();
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
  const { targetW, targetH, targetHolderScale } = useMemo(() => {
    // Mặt phẳng lá thư đặt tại localTargetPos (z = 0.35) -> distToPaper = 2.45 - 0.35 = 2.10
    const distToPaper = 2.10;
    const visH = 2 * distToPaper * Math.tan(THREE.MathUtils.degToRad(50) / 2);
    const visW = visH * (size.width / Math.max(1, size.height));
    const w = Math.min(2.1, visW * 0.80);
    const h = w / letter.aspectRatio;

    // Chiều dài cuộn giấy scrollRoll trong capsuleObj là 0.94 * scaleY
    const scrollMeshH = 0.94 * (capsuleObj.scale.y || 1.18);
    const holderScale = h / scrollMeshH;

    return {
      targetW: w,
      targetH: h,
      targetHolderScale: holderScale,
    };
  }, [size.width, size.height, letter.aspectRatio, capsuleObj.scale.y]);

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

  // Đích dừng chính giữa trước ống kính (ở hẳn phía trước z = 0.35)
  const localTargetPos = useMemo(() => new THREE.Vector3(0, 0, 0.35), []);

  // Điểm neo cao hơn miệng lọ để viên nang chui thẳng ra ngoài miệng lọ
  const aboveMouthPos = useMemo(() => {
    return localMouthPos.clone().add(new THREE.Vector3(0, 0.35, 0));
  }, [localMouthPos]);

  // Góc xoay khi đến trước camera: Máy tính nằm ngang (Z = PI/2), Điện thoại nằm dọc (Z = 0)
  const targetQuat = useMemo(() => {
    const euler = isMobile ? new THREE.Euler(0, 0, 0) : new THREE.Euler(0, 0, Math.PI / 2);
    return new THREE.Quaternion().setFromEuler(euler);
  }, [isMobile]);

  useFrame((state, delta) => {
    const elapsed = state.clock.getElapsedTime();

    // 1. Quản lý thời gian mở / đóng thư
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
        // Nửa đầu (0.0 -> 0.45): Bay thẳng từ vị trí trong bình chui qua miệng lọ
        const s1 = p1 / 0.45;
        const ease1 = s1 * s1 * (3 - 2 * s1);
        curPos = new THREE.Vector3().lerpVectors(localStartPos, aboveMouthPos, ease1);
        curScale = startHolderScale;
        curQuat = localStartQuat.clone();
      } else {
        // Nửa sau (0.45 -> 1.0): Lượn từ trên miệng lọ ra vị trí trước camera, scale to dần
        const s2 = (p1 - 0.45) / 0.55;
        const ease2 = s2 * s2 * (3 - 2 * s2);
        const ctrl = aboveMouthPos
          .clone()
          .add(localTargetPos)
          .multiplyScalar(0.5)
          .add(new THREE.Vector3(0, 0.12, 0.22));

        curPos = new THREE.Vector3()
          .copy(aboveMouthPos)
          .multiplyScalar((1 - ease2) * (1 - ease2))
          .addScaledVector(ctrl, 2 * (1 - ease2) * ease2)
          .addScaledVector(localTargetPos, ease2 * ease2);

        curScale = THREE.MathUtils.lerp(startHolderScale, targetHolderScale, ease2);
        curQuat = new THREE.Quaternion().slerpQuaternions(localStartQuat, targetQuat, ease2);
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

    // =========================================================================
    // Giai đoạn 2 (0.95s -> 1.55s): Tách vỏ & Vỏ luôn lơ lửng trong khung hình
    // =========================================================================
    const p2 = Math.min(1, Math.max(0, (t - 0.95) / 0.60));
    const ease2 = p2 * p2 * (3 - 2 * p2);

    if (topShell && bottomShell) {
      topShell.visible = true;
      bottomShell.visible = true;

      const bobTop = Math.sin(elapsed * 1.5) * 0.04;
      const bobBot = Math.cos(elapsed * 1.3) * 0.04;

      if (!isMobile) {
        // Máy tính: Tách sang 2 bên trái/phải theo trục Y cục bộ (viên nang nằm ngang rot.z = PI/2)
        const targetTopY = 1.15 + bobTop;
        const targetBotY = -1.15 + bobBot;

        topShell.position.x = 0;
        topShell.position.y = THREE.MathUtils.lerp(0, targetTopY, ease2);
        topShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);

        bottomShell.position.x = 0;
        bottomShell.position.y = THREE.MathUtils.lerp(0, targetBotY, ease2);
        bottomShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);
      } else {
        // Điện thoại: Tách lên trên (+Y) và xuống dưới (-Y)
        const targetTopY = 0.85 + bobTop;
        const targetBotY = -0.85 + bobBot;

        topShell.position.x = 0;
        topShell.position.y = THREE.MathUtils.lerp(0, targetTopY, ease2);
        topShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);

        bottomShell.position.x = 0;
        bottomShell.position.y = THREE.MathUtils.lerp(0, targetBotY, ease2);
        bottomShell.position.z = THREE.MathUtils.lerp(0, -0.15, ease2);
      }
    }

    // =========================================================================
    // Giai đoạn 3 (1.55s -> 2.15s): Vòng vàng tuột dọc thân & Cuộn giấy chuẩn bị mở
    // =========================================================================
    const p3 = Math.min(1, Math.max(0, (t - 1.55) / 0.60));

    if (goldRing) {
      goldRing.visible = true;
      if (p3 <= 0.65) {
        // Bước 3A (0.0 -> 0.65): Trượt thẳng dọc trục cuộn thư từ 0 đến +0.56 ra khỏi đầu cuộn
        const s3A = p3 / 0.65;
        const ease3A = s3A * s3A * (3 - 2 * s3A);
        goldRing.position.x = 0;
        goldRing.position.y = THREE.MathUtils.lerp(0, 0.56, ease3A);
        goldRing.position.z = 0;
        goldRing.rotation.set(Math.PI / 2, 0, 0);
      } else {
        // Bước 3B (0.65 -> 1.0): Trôi nhẹ sang góc bên cạnh và lơ lửng nhẹ
        const s3B = (p3 - 0.65) / 0.35;
        const ease3B = s3B * s3B * (3 - 2 * s3B);
        const bobRing = Math.sin(elapsed * 1.8 + 1.0) * 0.035;
        goldRing.position.x = THREE.MathUtils.lerp(0, 0.45, ease3B);
        goldRing.position.y = THREE.MathUtils.lerp(0.56, 0.68 + bobRing, ease3B);
        goldRing.position.z = THREE.MathUtils.lerp(0, -0.12, ease3B);
        goldRing.rotation.set(Math.PI / 2, 0, 0);
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
      paperGroupRef.current.position.set(0, 0, 0.35);
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
