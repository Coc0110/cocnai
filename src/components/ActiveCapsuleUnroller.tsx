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
  minVisibleDim: number;
  isClosing: boolean;
  onFinishClose: () => void;
  onReadingReady: () => void;
  onRequestClose: () => void;
}

export function ActiveCapsuleUnroller({
  letter,
  localStartPos,
  localStartQuat,
  localMouthPos,
  minVisibleDim,
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

  // Tạo viên nang chuẩn 3D giống hệt viên nang trong bình (đã scale 1.5x)
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

  // Kích thước chuẩn tỷ lệ aspectRatio (4:1) vừa vặn màn hình
  const targetW = useMemo(() => Math.min(2.85, minVisibleDim * 0.88), [minVisibleDim]);
  const targetH = useMemo(() => targetW / letter.aspectRatio, [targetW, letter.aspectRatio]);

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

  // Đích dừng chính giữa trước ống kính
  const localTargetPos = useMemo(() => new THREE.Vector3(0, 0, 0.45), []);

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
    // Giai đoạn 1 (0.0s -> 0.85s): Bay ra khỏi lọ / Bay về lại lọ
    // =========================================================================
    if (t < 0.85) {
      const p1 = Math.min(1, Math.max(0, t / 0.85));
      const ease1 = p1 * p1 * (3 - 2 * p1);

      // Đường cong Bézier bậc 2: start -> mouth -> target
      const pos = new THREE.Vector3()
        .copy(localStartPos)
        .multiplyScalar((1 - ease1) * (1 - ease1))
        .addScaledVector(localMouthPos, 2 * (1 - ease1) * ease1)
        .addScaledVector(localTargetPos, ease1 * ease1);

      if (capsuleHolderRef.current) {
        capsuleHolderRef.current.position.copy(pos);
        capsuleHolderRef.current.quaternion.slerpQuaternions(localStartQuat, targetQuat, ease1);
      }
    } else {
      if (capsuleHolderRef.current) {
        capsuleHolderRef.current.position.copy(localTargetPos);
        capsuleHolderRef.current.quaternion.copy(targetQuat);
      }
    }

    // =========================================================================
    // Giai đoạn 2 (0.85s -> 1.55s): Tách vỏ & Vỏ tiếp tục lơ lửng trong ống kính
    // =========================================================================
    const p2 = Math.min(1, Math.max(0, (t - 0.85) / 0.70));
    const ease2 = p2 * p2 * (3 - 2 * p2);

    if (topShell && bottomShell) {
      // Vỏ luôn luôn hiển thị (không ẩn, không mất độ đục)
      topShell.visible = true;
      bottomShell.visible = true;

      // Vị trí tách vỏ và trôi lơ lửng cạnh tờ thư
      const halfW = targetW / 2;
      const bobTop = Math.sin(elapsed * 1.5) * 0.04;
      const bobBot = Math.cos(elapsed * 1.3) * 0.04;

      if (!isMobile) {
        // MÁY TÍNH: Tách sang 2 bên Trái / Phải theo trục X
        // topShell trượt sang phải (+local Y trong hệ trục nằm ngang)
        const targetTopY = halfW + 0.55 + bobTop;
        const targetBotY = -halfW - 0.55 + bobBot;

        topShell.position.y = THREE.MathUtils.lerp(0, targetTopY, ease2);
        topShell.position.z = THREE.MathUtils.lerp(0, -0.22, ease2);
        topShell.rotation.z = ease2 * 0.25;

        bottomShell.position.y = THREE.MathUtils.lerp(0, targetBotY, ease2);
        bottomShell.position.z = THREE.MathUtils.lerp(0, -0.22, ease2);
        bottomShell.rotation.z = -ease2 * 0.25;
      } else {
        // ĐIỆN THOẠI: Tách lên trên (+Y) và xuống dưới (-Y)
        const targetTopY = targetH / 2 + 0.65 + bobTop;
        const targetBotY = -targetH / 2 - 0.65 + bobBot;

        topShell.position.y = THREE.MathUtils.lerp(0, targetTopY, ease2);
        topShell.position.z = THREE.MathUtils.lerp(0, -0.22, ease2);

        bottomShell.position.y = THREE.MathUtils.lerp(0, targetBotY, ease2);
        bottomShell.position.z = THREE.MathUtils.lerp(0, -0.22, ease2);
      }
    }

    // =========================================================================
    // Giai đoạn 3 (1.55s -> 2.15s): Vòng vàng tuột ra & Lơ lửng trong ống kính
    // =========================================================================
    const p3 = Math.min(1, Math.max(0, (t - 1.55) / 0.60));
    const ease3 = p3 * p3 * (3 - 2 * p3);

    if (goldRing) {
      goldRing.visible = true;
      const bobRing = Math.sin(elapsed * 1.8 + 1.0) * 0.035;

      if (!isMobile) {
        // Máy tính: Vòng vàng trôi phía trên mép thư (local -X là phía trên màn hình khi rot.z = PI/2)
        const targetRingX = -targetH / 2 - 0.45 + bobRing;
        goldRing.position.y = THREE.MathUtils.lerp(0, 0.95, ease3);
        goldRing.position.x = THREE.MathUtils.lerp(0, targetRingX, ease3);
        goldRing.position.z = THREE.MathUtils.lerp(0, -0.20, ease3);
        goldRing.rotation.y = THREE.MathUtils.lerp(0, elapsed * 0.6, ease3);
      } else {
        // Điện thoại: Vòng vàng trôi sang góc phải lá thư
        const targetRingX = targetW / 2 + 0.45 + bobRing;
        goldRing.position.y = THREE.MathUtils.lerp(0, 0.95, ease3);
        goldRing.position.x = THREE.MathUtils.lerp(0, targetRingX, ease3);
        goldRing.position.z = THREE.MathUtils.lerp(0, -0.20, ease3);
        goldRing.rotation.y = THREE.MathUtils.lerp(0, elapsed * 0.6, ease3);
      }
    }

    // =========================================================================
    // Giai đoạn 4 (2.15s -> 3.15s): Cuộn mở thư TỪ TRÁI QUA PHẢI
    // =========================================================================
    if (t < 2.15) {
      if (scrollRoll) scrollRoll.visible = true;
      if (paperGroupRef.current) paperGroupRef.current.visible = false;
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
        onReadingReady();
      }
    }

    // Khi đã mở hoàn tất (t >= 3.15), cho phép người dùng xoay và zoom ngắm thư
    if (paperGroupRef.current) {
      paperGroupRef.current.position.set(0, 0, 0.45);
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
