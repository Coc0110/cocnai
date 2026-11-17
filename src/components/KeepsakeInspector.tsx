import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { KeepsakeManifestItem, LetterItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';
import { prepareKeepsakeScene, animateSuppleBracelet, animateGlassBottleRope } from '../utils/prepareKeepsakeScene';
import { ActiveCapsuleUnroller } from './ActiveCapsuleUnroller';
import lettersData from '../data/letters.json';

interface KeepsakeInspectorProps {
  items: KeepsakeManifestItem[];
}

function InspectedModel({ item }: { item: KeepsakeManifestItem }) {
  const gltf = useGLTF(item.url);
  const preparedScene = useMemo(
    () => prepareKeepsakeScene(gltf.scene, item),
    [gltf.scene, item],
  );

  const selectedKeepsakeOrigin = useUniverseStore((s) => s.selectedKeepsakeOrigin);
  const clearSelection = useUniverseStore((s) => s.clearSelection);

  const rootGroupRef = useRef<THREE.Group>(null);
  const modelGroupRef = useRef<THREE.Group>(null);
  const backdropRef = useRef<THREE.Mesh>(null);

  const currentWorldPosRef = useRef<THREE.Vector3>(
    selectedKeepsakeOrigin
      ? new THREE.Vector3(...selectedKeepsakeOrigin)
      : new THREE.Vector3(...item.initialPosition),
  );

  const [isDragging, setIsDragging] = useState(false);
  const [zoomScale, setZoomScale] = useState(1.0);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const userRotRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Trạng thái mở nắp lọ và viên nang đang đọc
  const [isCorkOpen, setIsCorkOpen] = useState(false);
  const [activeLetterId, setActiveLetterId] = useState<number | null>(null);
  const [isReadingLetter, setIsReadingLetter] = useState(false);
  const selectedCapsuleRef = useRef<THREE.Group | null>(null);
  const [unrollerData, setUnrollerData] = useState<{
    letter: LetterItem;
    localStartPos: THREE.Vector3;
    localStartQuat: THREE.Quaternion;
    localMouthPos: THREE.Vector3;
  } | null>(null);

  const [minVisibleDim, setMinVisibleDim] = useState(3.0);

  const handleCloseLetter = () => {
    if (selectedCapsuleRef.current) {
      selectedCapsuleRef.current.visible = true;
      selectedCapsuleRef.current = null;
    }
    setActiveLetterId(null);
    setUnrollerData(null);
    setIsReadingLetter(false);
  };

  useEffect(() => {
    if (selectedKeepsakeOrigin) {
      currentWorldPosRef.current.set(...selectedKeepsakeOrigin);
    } else {
      currentWorldPosRef.current.set(...item.initialPosition);
    }
    userRotRef.current = { x: 0, y: 0 };
    setZoomScale(1.0);
    setIsCorkOpen(false);
    handleCloseLetter();
  }, [item.id, item.initialPosition, selectedKeepsakeOrigin]);

  // Hỗ trợ chụm/tách 2 ngón tay (pinch-to-zoom) mượt mà trên điện thoại
  useEffect(() => {
    let initialDist = 0;
    let initialZoom = 1.0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && activeLetterId === null) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        initialDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        initialZoom = zoomScale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist > 0 && activeLetterId === null) {
        e.preventDefault();
        e.stopPropagation();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const factor = dist / initialDist;
        setZoomScale(Math.min(1.65, Math.max(0.55, initialZoom * factor)));
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [activeLetterId, zoomScale]);

  useFrame((state, delta) => {
    if (!rootGroupRef.current || !modelGroupRef.current) return;

    const inspectDist = 2.65;

    // 1. Bay mượt về ngay phía trước Camera
    const camDir = new THREE.Vector3();
    state.camera.getWorldDirection(camDir);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(state.camera.quaternion);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(state.camera.quaternion);

    // Điểm đích cách mặt camera 2.65 đơn vị
    const targetCenter = state.camera.position.clone().addScaledVector(camDir, inspectDist);
    currentWorldPosRef.current.lerp(targetCenter, Math.min(1, delta * 6.5));

    // Đặt tấm nền mờ luôn nằm phía sau vật phẩm (3.85 đơn vị) và hướng thẳng camera
    if (backdropRef.current) {
      backdropRef.current.position.copy(state.camera.position).addScaledVector(camDir, inspectDist + 1.2);
      backdropRef.current.quaternion.copy(state.camera.quaternion);
    }

    // 2. Dao động lơ lửng không trọng lực và người dùng tự xoay
    const elapsed = state.clock.getElapsedTime();
    const floatY = Math.sin(elapsed * 1.7) * 0.045;
    const floatX = Math.cos(elapsed * 1.15) * 0.028;

    rootGroupRef.current.position
      .copy(currentWorldPosRef.current)
      .addScaledVector(camUp, floatY)
      .addScaledVector(camRight, floatX);

    rootGroupRef.current.quaternion.copy(state.camera.quaternion);

    // Nghiêng bập bềnh nhẹ quanh góc mà người dùng đã xoay
    modelGroupRef.current.rotation.x = userRotRef.current.x + Math.sin(elapsed * 1.35) * 0.055;
    modelGroupRef.current.rotation.y = userRotRef.current.y + Math.cos(elapsed * 1.05) * 0.065;
    modelGroupRef.current.rotation.z = Math.sin(elapsed * 1.5 + 0.8) * 0.038;

    // 3. Tự động co giãn theo khung hình thực tế để KHÔNG BAO GIỜ tràn màn hình
    const persp = state.camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(persp.fov || 50);
    const visibleHeight = 2 * inspectDist * Math.tan(fovRad / 2);
    const aspect = state.size.width / Math.max(1, state.size.height);
    const visibleWidth = visibleHeight * aspect;
    const currentMinDim = Math.min(visibleWidth, visibleHeight);
    setMinVisibleDim(currentMinDim);

    const baseTargetSize = (item.radius || 0.65) * (item.id === 'glass-bottle' ? 2.5 : 2.1);
    const fitScale = (currentMinDim * 0.56) / baseTargetSize;
    const finalScale = fitScale * zoomScale;
    modelGroupRef.current.scale.setScalar(finalScale);

    // Đung đưa mềm mại sợi dây vòng tay và nơ cổ chai
    if (item.id === 'clover-bracelet') {
      animateSuppleBracelet(preparedScene, elapsed);
    }
    if (item.id === 'glass-bottle') {
      animateGlassBottleRope(preparedScene, elapsed);

      // Điều khiển nắp nút bần mở / đóng
      const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;
      if (corkNode && corkNode.userData.closedPos) {
        const closedPos = corkNode.userData.closedPos as THREE.Vector3;
        const closedRot = (corkNode.userData.closedRot as THREE.Euler) || new THREE.Euler();

        const targetPos = isCorkOpen
          ? new THREE.Vector3(closedPos.x + 1.7, closedPos.y + 2.2, closedPos.z)
          : closedPos;
        const targetRotZ = isCorkOpen ? -0.5 : closedRot.z;

        corkNode.position.lerp(targetPos, Math.min(1, delta * 5.0));
        corkNode.rotation.z = THREE.MathUtils.lerp(corkNode.rotation.z, targetRotZ, Math.min(1, delta * 5.0));
      }
    }
  });

  const selectCapsuleToOpen = (capId: number) => {
    const capsules = preparedScene.userData.capsules as THREE.Group[] | undefined;
    const targetCapsule = capsules?.find((c) => c.userData.capsuleId === capId);
    if (!targetCapsule || !rootGroupRef.current) return;

    // Tọa độ xuất phát của viên nang trong hệ quy chiếu local của rootGroupRef
    const capWorldPos = targetCapsule.getWorldPosition(new THREE.Vector3());
    const capWorldQuat = targetCapsule.getWorldQuaternion(new THREE.Quaternion());
    const localStartPos = rootGroupRef.current.worldToLocal(capWorldPos.clone());
    const rootWorldQuat = rootGroupRef.current.getWorldQuaternion(new THREE.Quaternion());
    const localStartQuat = capWorldQuat.clone().premultiply(rootWorldQuat.clone().invert());

    // Tọa độ miệng lọ
    const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;
    let mouthWorldPos = new THREE.Vector3();
    if (corkNode && corkNode.userData.closedPos) {
      const closedPos = corkNode.userData.closedPos as THREE.Vector3;
      mouthWorldPos = corkNode.parent ? corkNode.parent.localToWorld(closedPos.clone()) : closedPos.clone();
    } else {
      mouthWorldPos = preparedScene.localToWorld(new THREE.Vector3(0, 6.8, 0));
    }
    const localMouthPos = rootGroupRef.current.worldToLocal(mouthWorldPos);

    targetCapsule.visible = false;
    selectedCapsuleRef.current = targetCapsule;

    const letterObj = (lettersData as LetterItem[]).find((l) => l.id === capId);
    if (!letterObj) return;

    setUnrollerData({
      letter: letterObj,
      localStartPos,
      localStartQuat,
      localMouthPos,
    });
    setActiveLetterId(capId);
    setIsReadingLetter(false);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsDragging(true);
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();

    if (activeLetterId !== null) return;

    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;

    userRotRef.current.y += dx * 0.012;
    userRotRef.current.x += dy * 0.012;

    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging) {
      e.stopPropagation();
      setIsDragging(false);
      try {
        (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      } catch {
        // Safe fallback
      }

      const dragDist = Math.hypot(
        e.clientX - pointerDownPosRef.current.x,
        e.clientY - pointerDownPosRef.current.y,
      );

      // Nhận diện cú click/chạm tĩnh (< 8px)
      if (dragDist < 8 && item.id === 'glass-bottle' && activeLetterId === null) {
        const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;

        // 1. Kiểm tra bấm trúng nút bần
        let hitCork = false;
        if (corkNode) {
          hitCork = (e.intersections || []).some((hit) => {
            let cur: THREE.Object3D | null = hit.object;
            while (cur && cur !== preparedScene) {
              if (cur === corkNode) return true;
              cur = cur.parent;
            }
            return false;
          });
        }

        if (hitCork) {
          setIsCorkOpen((prev) => !prev);
          return;
        }

        // 2. Khi nắp đã mở, kiểm tra bấm trúng 1 trong 31 viên nang
        if (isCorkOpen) {
          for (const hit of e.intersections || []) {
            let cur: THREE.Object3D | null = hit.object;
            while (cur && cur !== preparedScene) {
              if (typeof cur.userData.capsuleId === 'number') {
                const capId = cur.userData.capsuleId;
                selectCapsuleToOpen(capId);
                return;
              }
              cur = cur.parent;
            }
          }
        }
      }
    }
  };

  const handleWheel = (e: ThreeEvent<WheelEvent>) => {
    if (activeLetterId !== null) return;
    e.stopPropagation();
    setZoomScale((prev) => Math.min(1.65, Math.max(0.55, prev - e.deltaY * 0.0015)));
  };

  return (
    <>
      {/* Dimmed backdrop plane: tapping outside dismisses letter reading or inspection */}
      <mesh
        ref={backdropRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (activeLetterId !== null) {
            handleCloseLetter();
          } else {
            clearSelection();
          }
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial
          transparent
          opacity={0.68}
          color="#03040b"
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <group ref={rootGroupRef}>
        {/* Focused illumination for 360 inspection */}
        <pointLight position={[0, 1.8, 2.2]} intensity={2.5} color="#ffffff" distance={10} />
        <pointLight position={[0, -1.8, -1.5]} intensity={1.2} color="#f0abfc" distance={10} />

        <group
          ref={modelGroupRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <primitive object={preparedScene} />
        </group>

        {/* Hoạt ảnh mở cuộn thư khi chọn viên nang */}
        {unrollerData && (
          <ActiveCapsuleUnroller
            letter={unrollerData.letter}
            localStartPos={unrollerData.localStartPos}
            localStartQuat={unrollerData.localStartQuat}
            localMouthPos={unrollerData.localMouthPos}
            minVisibleDim={minVisibleDim}
            onClose={handleCloseLetter}
            onReadingReady={() => setIsReadingLetter(true)}
          />
        )}
      </group>

      {/* HTML UI Overlay: Hướng dẫn mở nắp / chọn thư và nút đóng */}
      <Html fullscreen style={{ pointerEvents: 'none' }}>
        {item.id === 'glass-bottle' && !isCorkOpen && activeLetterId === null && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full bg-slate-900/80 text-amber-200 border border-amber-400/30 shadow-lg text-xs md:text-sm font-medium backdrop-blur-md flex items-center gap-2 pointer-events-none select-none animate-pulse">
            <span>💡</span> Chạm vào nút bần để mở nắp lọ
          </div>
        )}

        {item.id === 'glass-bottle' && isCorkOpen && activeLetterId === null && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full bg-slate-900/80 text-amber-300 border border-amber-400/40 shadow-lg text-xs md:text-sm font-medium backdrop-blur-md flex items-center gap-2 pointer-events-none select-none">
            <span>✨</span> Chọn 1 viên nang trong lọ để mở thư
          </div>
        )}

        {activeLetterId !== null && isReadingLetter && (
          <button
            onClick={handleCloseLetter}
            style={{ pointerEvents: 'auto' }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-6 py-2.5 rounded-full bg-slate-950/90 text-amber-200 border border-amber-400/50 shadow-2xl text-sm font-medium backdrop-blur-md flex items-center gap-2 hover:bg-slate-900 hover:text-amber-100 transition-all cursor-pointer active:scale-95"
          >
            <span>✕</span> Thu thư lại vào lọ
          </button>
        )}
      </Html>
    </>
  );
}

export function KeepsakeInspector({ items }: KeepsakeInspectorProps): JSX.Element | null {
  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);

  if (!selectedKeepsakeId) {
    return null;
  }

  const selectedItem = items.find((it) => it.id === selectedKeepsakeId);
  if (!selectedItem) {
    return null;
  }

  return (
    <group>
      <InspectedModel item={selectedItem} />
    </group>
  );
}
