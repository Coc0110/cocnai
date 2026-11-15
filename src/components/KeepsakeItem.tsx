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

  useFrame((_, delta) => {
    if (!rigidBodyRef.current || isSelected) return;

    // Soft gravity well kéo nhẹ về trung tâm nếu trôi quá xa
    const pos = rigidBodyRef.current.translation();
    const [ix, iy, iz] = computeGravityWellImpulse([pos.x, pos.y, pos.z], 5.5, 0.45);
    if (ix !== 0 || iy !== 0 || iz !== 0) {
      rigidBodyRef.current.applyImpulse({ x: ix * delta, y: iy * delta, z: iz * delta }, true);
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Không dùng stopPropagation ở đây để OrbitControls vẫn nhận sự kiện kéo xoay camera
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

    // Nếu người dùng vuốt kéo vật thể (khoảng cách >= 8px)
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
    // Chỉ kích hoạt chọn xem 360 độ khi người dùng chạm click tĩnh (khoảng cách < 8px)
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
      linearDamping={0.5}
      angularDamping={0.5}
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
