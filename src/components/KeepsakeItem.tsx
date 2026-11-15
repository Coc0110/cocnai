import { useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { KeepsakeManifestItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';
import {
  computeFlickImpulse,
  computeGravityWellImpulse,
} from '../utils/physicsMath';

interface KeepsakeItemProps {
  item: KeepsakeManifestItem;
}

export function KeepsakeItem({ item }: KeepsakeItemProps): JSX.Element {
  const gltf = useGLTF(item.url);
  const clonedScene = useMemo(() => gltf.scene.clone(), [gltf.scene]);
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);
  const selectKeepsake = useUniverseStore((s) => s.selectKeepsake);

  const isSelected = selectedKeepsakeId === item.id;

  // Hạt giống pha riêng cho từng kỷ vật để dao động trôi nổi và xoay khác nhau
  const seed = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < item.id.length; i++) {
      hash = (hash << 5) - hash + item.id.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash % 1000) / 100) + 1.0;
  }, [item.id]);

  const [isPointerDown, setIsPointerDown] = useState(false);
  const pointerStartRef = useRef<{
    time: number;
    clientX: number;
    clientY: number;
    worldPoint: THREE.Vector3;
  }>({
    time: 0,
    clientX: 0,
    clientY: 0,
    worldPoint: new THREE.Vector3(),
  });

  const lastWorldPointRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useFrame((state, delta) => {
    if (!rigidBodyRef.current || isSelected) return;

    const elapsed = state.clock.getElapsedTime();

    // 1. Lực hút mềm vô hình giữ kỷ vật không trôi mất khỏi trung tâm
    const pos = rigidBodyRef.current.translation();
    const [ix, iy, iz] = computeGravityWellImpulse([pos.x, pos.y, pos.z], 5.5, 0.45);

    // 2. Dòng chảy không trọng lực êm dịu (Zero-G Ambient Drift Force)
    const fx = Math.sin(elapsed * 0.45 + seed) * 0.04;
    const fy = Math.cos(elapsed * 0.38 + seed * 1.7) * 0.04;
    const fz = Math.sin(elapsed * 0.41 + seed * 2.3) * 0.04;

    rigidBodyRef.current.applyImpulse(
      {
        x: (ix + fx) * delta,
        y: (iy + fy) * delta,
        z: (iz + fz) * delta,
      },
      true,
    );

    // 3. Vận tốc góc bập bềnh, xoay chầm chậm tự nhiên trong không gian 3D
    const tx = Math.sin(elapsed * 0.22 + seed) * 0.008 * delta;
    const ty = Math.cos(elapsed * 0.26 + seed * 1.5) * 0.01 * delta;
    const tz = Math.sin(elapsed * 0.19 + seed * 2.0) * 0.006 * delta;
    rigidBodyRef.current.applyTorqueImpulse({ x: tx, y: ty, z: tz }, true);
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Không gọi stopPropagation để OrbitControls nhận sự kiện kéo xoay camera bình thường
    setIsPointerDown(true);
    pointerStartRef.current = {
      time: Date.now(),
      clientX: e.clientX,
      clientY: e.clientY,
      worldPoint: e.point.clone(),
    };
    lastWorldPointRef.current.copy(e.point);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isPointerDown) return;
    lastWorldPointRef.current.copy(e.point);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isPointerDown) return;
    setIsPointerDown(false);

    const duration = Date.now() - pointerStartRef.current.time;
    const distancePx = Math.hypot(
      e.clientX - pointerStartRef.current.clientX,
      e.clientY - pointerStartRef.current.clientY,
    );

    // Người dùng vuốt kéo trực tiếp lên kỷ vật (khoảng cách >= 8px)
    if (distancePx >= 8 && rigidBodyRef.current) {
      const deltaWorld: [number, number, number] = [
        lastWorldPointRef.current.x - pointerStartRef.current.worldPoint.x,
        lastWorldPointRef.current.y - pointerStartRef.current.worldPoint.y,
        lastWorldPointRef.current.z - pointerStartRef.current.worldPoint.z,
      ];

      const [fx, fy, fz] = computeFlickImpulse(deltaWorld, duration, 7);
      rigidBodyRef.current.applyImpulse({ x: fx, y: fy, z: fz }, true);
      rigidBodyRef.current.applyTorqueImpulse(
        {
          x: fy * 0.15,
          y: -fx * 0.15,
          z: (Math.random() - 0.5) * 0.1,
        },
        true,
      );
    }
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // Chỉ kích hoạt chọn ngắm 360 độ khi người dùng chạm tĩnh (khoảng cách < 8px)
    const distancePx = Math.hypot(
      e.clientX - pointerStartRef.current.clientX,
      e.clientY - pointerStartRef.current.clientY,
    );

    if (distancePx < 8) {
      e.stopPropagation();
      selectKeepsake(item.id);
    }
  };

  return (
    <RigidBody
      ref={rigidBodyRef}
      colliders="hull"
      gravityScale={0}
      linearDamping={0.18}
      angularDamping={0.18}
      position={item.initialPosition}
    >
      <group
        visible={!isSelected}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
      >
        <primitive object={clonedScene} />
      </group>
    </RigidBody>
  );
}
