import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface OrbitControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

interface TwoFingerCameraControllerProps {
  controlsRef: React.RefObject<OrbitControlsLike>;
  enabled: boolean;
}

export function TwoFingerCameraController({
  controlsRef,
  enabled,
}: TwoFingerCameraControllerProps): null {
  const { camera, gl } = useThree();
  const prevCenterRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;

    // 1. TOUCHSCREEN: Thao tác 2 ngón tay chạm màn hình
    const handleTouchStart = (e: TouchEvent) => {
      if (!enabled || e.touches.length !== 2) {
        prevCenterRef.current = null;
        return;
      }
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      prevCenterRef.current = {
        x: (t0.clientX + t1.clientX) * 0.5,
        y: (t0.clientY + t1.clientY) * 0.5,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!enabled || e.touches.length !== 2 || !prevCenterRef.current) return;
      e.preventDefault();

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const curX = (t0.clientX + t1.clientX) * 0.5;
      const curY = (t0.clientY + t1.clientY) * 0.5;

      const dx = curX - prevCenterRef.current.x;
      const dy = curY - prevCenterRef.current.y;
      prevCenterRef.current = { x: curX, y: curY };

      if (Math.abs(dx) > Math.abs(dy)) {
        // Kéo ngang: Phóng to / Thu nhỏ (Zoom) qua fov [22, 75]
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          persp.fov = THREE.MathUtils.clamp(persp.fov - dx * 0.06, 22, 75);
          persp.updateProjectionMatrix();
        }
      } else {
        // Kéo dọc: Kéo lên (dy < 0) -> Tiến camera lên phía trước; Kéo xuống (dy > 0) -> Lùi camera ra sau
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const moveAmount = -dy * 0.012;

        camera.position.addScaledVector(forward, moveAmount);
        if (controlsRef.current) {
          controlsRef.current.target.addScaledVector(forward, moveAmount);
          controlsRef.current.update();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        prevCenterRef.current = null;
      }
    };

    // 2. TOUCHPAD: Thao tác 2 ngón tay trên bàn rê (sự kiện wheel)
    const handleWheel = (e: WheelEvent) => {
      if (!enabled) return;
      e.preventDefault();

      if (e.ctrlKey) {
        // Pinch-to-zoom trên touchpad
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          persp.fov = THREE.MathUtils.clamp(persp.fov + e.deltaY * 0.05, 22, 75);
          persp.updateProjectionMatrix();
        }
        return;
      }

      const dx = -e.deltaX;
      const dy = -e.deltaY;

      if (Math.abs(dx) > Math.abs(dy)) {
        // Kéo ngang 2 ngón: Zoom
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          persp.fov = THREE.MathUtils.clamp(persp.fov - dx * 0.05, 22, 75);
          persp.updateProjectionMatrix();
        }
      } else {
        // Kéo dọc 2 ngón: dy > 0 (kéo lên) -> Tiến camera; dy < 0 (kéo xuống) -> Lùi camera
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const moveAmount = dy * 0.008;

        camera.position.addScaledVector(forward, moveAmount);
        if (controlsRef.current) {
          controlsRef.current.target.addScaledVector(forward, moveAmount);
          controlsRef.current.update();
        }
      }
    };

    dom.addEventListener('touchstart', handleTouchStart, { passive: false });
    dom.addEventListener('touchmove', handleTouchMove, { passive: false });
    dom.addEventListener('touchend', handleTouchEnd);
    dom.addEventListener('touchcancel', handleTouchEnd);
    dom.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      dom.removeEventListener('touchstart', handleTouchStart);
      dom.removeEventListener('touchmove', handleTouchMove);
      dom.removeEventListener('touchend', handleTouchEnd);
      dom.removeEventListener('touchcancel', handleTouchEnd);
      dom.removeEventListener('wheel', handleWheel);
    };
  }, [camera, controlsRef, enabled, gl.domElement]);

  return null;
}
