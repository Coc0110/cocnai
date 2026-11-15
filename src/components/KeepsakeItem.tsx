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
  const visualGroupRef = useRef<THREE.Group>(null);

  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);
  const selectKeepsake = useUniverseStore((s) => s.selectKeepsake);

  const isSelected = selectedKeepsakeId === item.id;

  // Hạt giống pha riêng cho từng kỷ vật để dao động bập bềnh khác nhau
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

    // 2. Dòng chảy không trọng lực rất nhẹ nhàng (0.006) để kỷ vật bập bềnh êm ái tại chỗ
    const fx = Math.sin(elapsed * 0.45 + seed) * 0.006;
    const fy = Math.cos(elapsed * 0.38 + seed * 1.7) * 0.006;
    const fz = Math.sin(elapsed * 0.41 + seed * 2.3) * 0.006;

    rigidBodyRef.current.applyImpulse(
      {
        x: (ix + fx) * delta,
        y: (iy + fy) * delta,
        z: (iz + fz) * delta,
      },
      true,
    );

    // 3. Nghiêng và xoay bập bềnh cực nhẹ trên visual group (KHÔNG gọi applyTorqueImpulse để tránh cộng dồn vận tốc quay)
    if (visualGroupRef.current) {
      visualGroupRef.current.rotation.y += delta * 0.06;
      visualGroupRef.current.rotation.x = Math.sin(elapsed * 0.35 + seed) * 0.05;
      visualGroupRef.current.rotation.z = Math.cos(elapsed * 0.28 + seed * 1.2) * 0.03;
    }
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

    // Người dùng vuốt/gạt trực tiếp lên kỷ vật (khoảng cách >= 8px)
    if (distancePx >= 8 && rigidBodyRef.current) {
      const deltaWorld: [number, number, number] = [
        lastWorldPointRef.current.x - pointerStartRef.current.worldPoint.x,
        lastWorldPointRef.current.y - pointerStartRef.current.worldPoint.y,
        lastWorldPointRef.current.z - pointerStartRef.current.worldPoint.z,
      ];

      const [fx, fy, fz] = computeFlickImpulse(deltaWorld, duration, 6);
      rigidBodyRef.current.applyImpulse({ x: fx, y: fy, z: fz }, true);
      rigidBodyRef.current.applyTorqueImpulse(
        {
          x: fy * 0.12,
          y: -fx * 0.12,
          z: (Math.random() - 0.5) * 0.08,
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
      linearDamping={0.9}
      angularDamping={2.4}
      position={item.initialPosition}
    >
      <group
        visible={!isSelected}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
      >
        <group ref={visualGroupRef}>
          <primitive object={clonedScene} />
        </group>
      </group>
    </RigidBody>
  );
}
