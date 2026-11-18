import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { RigidBody, RapierRigidBody, BallCollider } from '@react-three/rapier';
import * as THREE from 'three';
import { KeepsakeManifestItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';
import { computeGravityWellImpulse } from '../utils/physicsMath';
import {
  prepareKeepsakeScene,
  animateSuppleBracelet,
  animateGlassBottleRope,
  animateGlassBottleCapsules,
} from '../utils/prepareKeepsakeScene';
import { sharedEntityPositions } from '../utils/sharedEntityPositions';
import { requestDeviceMotionPermission } from '../utils/deviceMotionPermission';

interface KeepsakeItemProps {
  item: KeepsakeManifestItem;
}

export function KeepsakeItem({ item }: KeepsakeItemProps): JSX.Element {
  const { camera } = useThree();
  const gltf = useGLTF(item.url);
  const preparedScene = useMemo(
    () => prepareKeepsakeScene(gltf.scene, item),
    [gltf.scene, item],
  );
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const visualGroupRef = useRef<THREE.Group>(null);

  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);
  const selectKeepsake = useUniverseStore((s) => s.selectKeepsake);
  const draggingKeepsakeId = useUniverseStore((s) => s.draggingKeepsakeId);
  const setDraggingKeepsakeId = useUniverseStore((s) => s.setDraggingKeepsakeId);

  const isSelected = selectedKeepsakeId === item.id;
  const isDraggingThis = draggingKeepsakeId === item.id;

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
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane());
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const dragStartPosRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 });
  const lastPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lastTimeRef = useRef<number>(0);
  const smoothedVelRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const intersectPointRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useEffect(() => {
    return () => {
      delete sharedEntityPositions.keepsakes[item.id];
    };
  }, [item.id]);

  useFrame((state, delta) => {
    if (!rigidBodyRef.current || isSelected) {
      if (isSelected) {
        delete sharedEntityPositions.keepsakes[item.id];
      }
      return;
    }

    const elapsed = state.clock.getElapsedTime();
    const pos = rigidBodyRef.current.translation();

    // Đồng bộ tọa độ toàn cục để các thực thể khác (companions) né tránh
    if (!sharedEntityPositions.keepsakes[item.id]) {
      sharedEntityPositions.keepsakes[item.id] = new THREE.Vector3();
    }
    sharedEntityPositions.keepsakes[item.id].set(pos.x, pos.y, pos.z);

    // 1. Chuyển động trôi lơ lửng rõ rệt trong không gian (khi không bị kéo)
    if (!isDraggingThis) {
      const [ix, iy, iz] = computeGravityWellImpulse([pos.x, pos.y, pos.z], 4.2, 0.35);
      let fx =
        Math.sin(elapsed * 0.55 + seed) * 0.14 +
        Math.cos(elapsed * 0.27 + seed * 2.1) * 0.08;
      let fy =
        Math.cos(elapsed * 0.48 + seed * 1.7) * 0.12 +
        Math.sin(elapsed * 0.31 + seed) * 0.06;
      let fz = Math.sin(elapsed * 0.51 + seed * 2.3) * 0.12;

      // Đẩy nhẹ ra xa các companions nếu khoảng cách < 1.35
      Object.values(sharedEntityPositions.companions).forEach((cPos) => {
        const cdx = pos.x - cPos.x;
        const cdy = pos.y - cPos.y;
        const cdz = pos.z - cPos.z;
        const cdist = Math.hypot(cdx, cdy, cdz);
        if (cdist > 0.001 && cdist < 1.35) {
          const repelStrength = ((1.35 - cdist) / 1.35) * 1.8;
          fx += (cdx / cdist) * repelStrength;
          fy += (cdy / cdist) * repelStrength;
          fz += (cdz / cdist) * repelStrength;
        }
      });

      rigidBodyRef.current.applyImpulse(
        { x: (ix + fx) * delta, y: (iy + fy) * delta, z: (iz + fz) * delta },
        true,
      );

      if (visualGroupRef.current) {
        // Visual luôn gắn chặt tâm collider (0, 0, 0), chỉ xoay chuyển nhẹ nhàng
        visualGroupRef.current.position.set(0, 0, 0);
        visualGroupRef.current.rotation.y += delta * 0.18;
        visualGroupRef.current.rotation.x = Math.sin(elapsed * 0.65 + seed) * 0.14;
        visualGroupRef.current.rotation.z = Math.cos(elapsed * 0.52 + seed * 1.2) * 0.1;
      }
    }

    if (item.id === 'clover-bracelet') {
      animateSuppleBracelet(preparedScene, elapsed);
    }
    if (item.id === 'glass-bottle') {
      animateGlassBottleRope(preparedScene, elapsed);
      animateGlassBottleCapsules(preparedScene, elapsed, delta);
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Chặn ngay lập tức sự kiện để không xoay Camera
    e.stopPropagation();
    if (!rigidBodyRef.current) return;

    setIsPointerDown(true);
    setDraggingKeepsakeId(item.id);

    dragStartPosRef.current = { clientX: e.clientX, clientY: e.clientY };

    const trans = rigidBodyRef.current.translation();
    const currentPos = new THREE.Vector3(trans.x, trans.y, trans.z);
    lastPosRef.current.copy(currentPos);
    lastTimeRef.current = performance.now();
    smoothedVelRef.current.set(0, 0, 0);

    // Mặt phẳng kéo đi qua tâm vật phẩm và có pháp tuyến hướng về camera
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const planeNormal = camDir.clone().negate();
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(planeNormal, currentPos);

    // Tính độ lệch giữa vị trí chạm và tâm vật thể
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    raycasterRef.current.setFromCamera(ndc, camera);
    const hit = raycasterRef.current.ray.intersectPlane(
      dragPlaneRef.current,
      intersectPointRef.current,
    );
    if (hit) {
      dragOffsetRef.current.copy(currentPos).sub(hit);
    } else {
      dragOffsetRef.current.set(0, 0, 0);
    }
  };

  useEffect(() => {
    if (!isPointerDown) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      if (!rigidBodyRef.current) return;

      const distPx = Math.hypot(
        e.clientX - dragStartPosRef.current.clientX,
        e.clientY - dragStartPosRef.current.clientY,
      );

      // Kéo trực tiếp trong không gian nếu khoảng cách di chuyển >= 6px
      if (distPx >= 6) {
        const ndc = new THREE.Vector2(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1,
        );
        raycasterRef.current.setFromCamera(ndc, camera);
        const hit = raycasterRef.current.ray.intersectPlane(
          dragPlaneRef.current,
          intersectPointRef.current,
        );
        if (hit) {
          const newPos = hit.clone().add(dragOffsetRef.current);
          const now = performance.now();
          const dt = Math.max(0.005, (now - lastTimeRef.current) / 1000);

          const instVel = newPos.clone().sub(lastPosRef.current).divideScalar(dt);
          instVel.clampLength(0, 16);
          smoothedVelRef.current.lerp(instVel, 0.45);

          lastPosRef.current.copy(newPos);
          lastTimeRef.current = now;

          rigidBodyRef.current.setTranslation(
            { x: newPos.x, y: newPos.y, z: newPos.z },
            true,
          );
          rigidBodyRef.current.setLinvel(
            {
              x: smoothedVelRef.current.x,
              y: smoothedVelRef.current.y,
              z: smoothedVelRef.current.z,
            },
            true,
          );
        }
      }
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      setIsPointerDown(false);
      setDraggingKeepsakeId(null);

      const distPx = Math.hypot(
        e.clientX - dragStartPosRef.current.clientX,
        e.clientY - dragStartPosRef.current.clientY,
      );

      const pos = rigidBodyRef.current
        ? rigidBodyRef.current.translation()
        : { x: item.initialPosition[0], y: item.initialPosition[1], z: item.initialPosition[2] };

      if (distPx < 8) {
        // Chạm tĩnh (click) -> Chọn vật phẩm để bay về phía trước ống kính
        if (item.id === 'glass-bottle') {
          requestDeviceMotionPermission();
        }
        selectKeepsake(item.id, [pos.x, pos.y, pos.z]);
      } else if (rigidBodyRef.current) {
        // Nhả kéo -> Tiếp tục trôi theo đà vận tốc
        rigidBodyRef.current.setLinvel(
          {
            x: smoothedVelRef.current.x,
            y: smoothedVelRef.current.y,
            z: smoothedVelRef.current.z,
          },
          true,
        );
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [camera, isPointerDown, item.id, item.initialPosition, selectKeepsake, setDraggingKeepsakeId]);

  return (
    <RigidBody
      ref={rigidBodyRef}
      colliders={false}
      gravityScale={0}
      linearDamping={0.35}
      angularDamping={2.4}
      position={item.initialPosition}
    >
      <BallCollider args={[item.radius * 1.18]} restitution={0.6} />
      <group
        visible={!isSelected}
        onPointerDown={handlePointerDown}
      >
        <group ref={visualGroupRef}>
          <primitive object={preparedScene} />
        </group>
      </group>
    </RigidBody>
  );
}
