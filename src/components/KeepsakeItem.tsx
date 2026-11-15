import { useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { RigidBody, RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { KeepsakeManifestItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';
import {
  classifyPointerGesture,
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

  // Pointer drag & flick tracking
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

    // Apply soft spherical gravity well toward center
    const pos = rigidBodyRef.current.translation();
    const [ix, iy, iz] = computeGravityWellImpulse([pos.x, pos.y, pos.z], 5.2, 0.45);
    if (ix !== 0 || iy !== 0 || iz !== 0) {
      rigidBodyRef.current.applyImpulse({ x: ix * delta, y: iy * delta, z: iz * delta }, true);
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
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
    e.stopPropagation();
    setIsPointerDown(false);

    const duration = Date.now() - pointerStartRef.current.time;
    const distancePx = Math.hypot(
      e.clientX - pointerStartRef.current.clientX,
      e.clientY - pointerStartRef.current.clientY,
    );

    const gesture = classifyPointerGesture(duration, distancePx);

    if (gesture === 'tap') {
      selectKeepsake(item.id);
    } else if (rigidBodyRef.current) {
      // Calculate flick impulse from world movement
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
      >
        <primitive object={clonedScene} />
      </group>
    </RigidBody>
  );
}
