import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { KeepsakeManifestItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';
import { prepareKeepsakeScene, animateSuppleBracelet, animateGlassBottleRope } from '../utils/prepareKeepsakeScene';

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
  const userRotRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (selectedKeepsakeOrigin) {
      currentWorldPosRef.current.set(...selectedKeepsakeOrigin);
    } else {
      currentWorldPosRef.current.set(...item.initialPosition);
    }
    userRotRef.current = { x: 0, y: 0 };
    setZoomScale(1.0);
  }, [item.id, item.initialPosition, selectedKeepsakeOrigin]);

  // Hỗ trợ chụm/tách 2 ngón tay (pinch-to-zoom) mượt mà trên điện thoại
  useEffect(() => {
    let initialDist = 0;
    let initialZoom = 1.0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        initialDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        initialZoom = zoomScale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDist > 0) {
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
  }, [zoomScale]);

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
    const minVisibleDim = Math.min(visibleWidth, visibleHeight);

    const baseTargetSize = (item.radius || 0.65) * (item.id === 'glass-bottle' ? 2.5 : 2.1);
    // Vật phẩm chỉ chiếm tối đa 56% chiều hẹp nhất của màn hình
    const fitScale = (minVisibleDim * 0.56) / baseTargetSize;
    const finalScale = fitScale * zoomScale;
    modelGroupRef.current.scale.setScalar(finalScale);

    // Đung đưa mềm mại sợi dây vòng tay và nơ cổ chai
    if (item.id === 'clover-bracelet') {
      animateSuppleBracelet(preparedScene, elapsed);
    }
    if (item.id === 'glass-bottle') {
      animateGlassBottleRope(preparedScene, elapsed);
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();

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
    }
  };

  const handleWheel = (e: ThreeEvent<WheelEvent>) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.min(1.65, Math.max(0.55, prev - e.deltaY * 0.0015)));
  };

  return (
    <>
      {/* Dimmed backdrop plane: tapping outside dismisses inspection */}
      <mesh
        ref={backdropRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          clearSelection();
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial
          transparent
          opacity={0.65}
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
      </group>
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
