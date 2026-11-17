import { useMemo, useRef, useState, useEffect } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { LetterItem } from '../types/universe';
import { createSingleCapsule } from '../utils/prepareKeepsakeScene';

interface ActiveCapsuleUnrollerProps {
  letter: LetterItem;
  localStartPos: THREE.Vector3;
  localStartQuat: THREE.Quaternion;
  localMouthPos: THREE.Vector3;
  minVisibleDim: number;
  onClose: () => void;
  onReadingReady: () => void;
}

export function ActiveCapsuleUnroller({
  letter,
  localStartPos,
  localStartQuat,
  localMouthPos,
  minVisibleDim,
  onClose,
  onReadingReady,
}: ActiveCapsuleUnrollerProps): JSX.Element {
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

  // Tạo viên nang chuẩn 3D giống hệt viên nang trong bình
  const capsuleObj = useMemo(() => {
    const cap = createSingleCapsule(letter);
    // Xoay ngang trục viên nang theo phương X
    cap.rotation.z = Math.PI / 2;
    return cap;
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

  // Hình học bức thư cuộn mở phẳng: width / height chuẩn theo aspectRatio
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
  const targetQuat = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0)), []);

  useFrame((_, delta) => {
    openTimeRef.current += delta;
    const t = openTimeRef.current;

    const topShell = capsuleObj.getObjectByName('topShell') as THREE.Group | undefined;
    const bottomShell = capsuleObj.getObjectByName('bottomShell') as THREE.Group | undefined;
    const goldRing = capsuleObj.getObjectByName('goldRing') as THREE.Mesh | undefined;
    const scrollRoll = capsuleObj.getObjectByName('scrollRoll') as THREE.Group | undefined;

    // Giai đoạn 1 (0.0s -> 0.85s): Bay từ lòng bình chui qua miệng lọ, dừng ở trước camera
    if (t < 0.85) {
      const p1 = Math.min(1, t / 0.85);
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

    // Giai đoạn 2 (0.85s -> 1.55s): Hai nửa vỏ nhựa trượt tách ra 2 phía ngược chiều nhau
    if (t >= 0.85 && t < 1.55) {
      const p2 = Math.min(1, (t - 0.85) / 0.70);
      const ease2 = p2 * p2 * (3 - 2 * p2);

      const splitDist = ease2 * 0.65;
      if (topShell) {
        topShell.position.y = splitDist;
        topShell.rotation.z = ease2 * 0.18;
      }
      if (bottomShell) {
        bottomShell.position.y = -splitDist;
        bottomShell.rotation.z = -ease2 * 0.18;
      }

      const shellOpacity = Math.max(0, 0.24 * (1 - ease2));
      topShell?.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = (c as THREE.Mesh).material as THREE.Material;
          if (m) m.opacity = shellOpacity;
        }
      });
      bottomShell?.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = (c as THREE.Mesh).material as THREE.Material;
          if (m) m.opacity = shellOpacity;
        }
      });
    } else if (t >= 1.55) {
      if (topShell) topShell.visible = false;
      if (bottomShell) bottomShell.visible = false;
    }

    // Giai đoạn 3 (1.55s -> 2.15s): Vòng vàng tuột hẳn ra một đầu cuộn thư rồi mờ dần
    if (t >= 1.55 && t < 2.15) {
      const p3 = Math.min(1, (t - 1.55) / 0.60);
      const ease3 = p3 * p3 * (3 - 2 * p3);

      if (goldRing) {
        goldRing.position.y = ease3 * 0.78;
        const ringMat = goldRing.material as THREE.MeshStandardMaterial;
        if (ringMat) ringMat.opacity = Math.max(0, 1.0 - ease3);
      }
    } else if (t >= 2.15) {
      if (goldRing) goldRing.visible = false;
    }

    // Giai đoạn 4 (2.15s -> 3.15s): Bức thư cuộn mở rộng từ tâm ra 2 mép
    if (t >= 2.15 && t < 3.15) {
      if (scrollRoll) scrollRoll.visible = false;
      if (paperGroupRef.current) paperGroupRef.current.visible = true;

      const p4 = Math.min(1, (t - 2.15) / 1.0);
      const u = p4 * p4 * (3 - 2 * p4); // 0 -> 1

      const posAttr = planeGeo.attributes.position;
      const halfW = targetW / 2;
      const flatBound = Math.max(0.001, u * halfW);
      const rollRadius = 0.075 * (1 - u * 0.35);

      for (let i = 0; i < posAttr.count; i++) {
        const ox = origPositions[i * 3];
        const oy = origPositions[i * 3 + 1];

        if (Math.abs(ox) <= flatBound) {
          posAttr.setXYZ(i, ox, oy, 0);
        } else if (ox > flatBound) {
          const dist = ox - flatBound;
          const theta = dist / rollRadius;
          const cx = flatBound + rollRadius * Math.sin(theta);
          const cz = -rollRadius * (1 - Math.cos(theta));
          posAttr.setXYZ(i, cx, oy, cz);
        } else {
          const dist = -flatBound - ox;
          const theta = dist / rollRadius;
          const cx = -flatBound - rollRadius * Math.sin(theta);
          const cz = -rollRadius * (1 - Math.cos(theta));
          posAttr.setXYZ(i, cx, oy, cz);
        }
      }
      posAttr.needsUpdate = true;
      planeGeo.computeVertexNormals();
    } else if (t >= 3.15) {
      if (scrollRoll) scrollRoll.visible = false;
      if (paperGroupRef.current) paperGroupRef.current.visible = true;

      // Đã mở phẳng hoàn toàn 100%
      const posAttr = planeGeo.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(i, origPositions[i * 3], origPositions[i * 3 + 1], 0);
      }
      posAttr.needsUpdate = true;
      planeGeo.computeVertexNormals();

      if (!hasNotifiedReading.current) {
        hasNotifiedReading.current = true;
        onReadingReady();
      }
    }

    // Khi đang đọc thư (t >= 3.15), áp dụng xoay tự do và tỉ lệ zoom
    if (paperGroupRef.current) {
      if (t >= 3.15) {
        paperGroupRef.current.position.set(0, 0, 0.45);
        paperGroupRef.current.rotation.y = userLetterRotRef.current.y;
        paperGroupRef.current.rotation.x = userLetterRotRef.current.x;
        paperGroupRef.current.scale.setScalar(zoomScale);
      } else {
        paperGroupRef.current.position.set(0, 0, 0.45);
        paperGroupRef.current.rotation.set(0, 0, 0);
        paperGroupRef.current.scale.setScalar(1.0);
      }
    }
  });

  // Hỗ trợ bấm phím Escape để thu thư lại
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
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
    if (openTimeRef.current < 3.15) return;
    e.stopPropagation();
    setIsDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || openTimeRef.current < 3.15) return;
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
    if (openTimeRef.current < 3.15) return;
    e.stopPropagation();
    setZoomScale((prev) => Math.min(2.2, Math.max(0.65, prev - e.deltaY * 0.0015)));
  };

  return (
    <group ref={containerRef}>
      {/* 1. Nhóm chứa viên nang 3D trong 3 giai đoạn đầu */}
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
