import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface OrbitControlsLike {
  target: THREE.Vector3;
  update: () => void;
  enabled?: boolean;
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
  const prevPinchDistRef = useRef<number>(0);

  useEffect(() => {
    const dom = gl.domElement;
    if (!dom) return;

    // 1. TOUCHSCREEN: Thao tác 2 ngón tay chạm màn hình (Pha capture để chặn trước OrbitControls)
    const handleTouchStart = (e: TouchEvent) => {
      if (!enabled || e.touches.length < 2) {
        prevCenterRef.current = null;
        prevPinchDistRef.current = 0;
        return;
      }

      // Khóa tạm thời OrbitControls để không tranh chấp thao tác 2 ngón tay
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      prevCenterRef.current = {
        x: (t0.clientX + t1.clientX) * 0.5,
        y: (t0.clientY + t1.clientY) * 0.5,
      };
      prevPinchDistRef.current = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!enabled || e.touches.length < 2 || !prevCenterRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const curX = (t0.clientX + t1.clientX) * 0.5;
      const curY = (t0.clientY + t1.clientY) * 0.5;
      const curPinchDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

      const dx = curX - prevCenterRef.current.x;
      const dy = curY - prevCenterRef.current.y;
      const dPinch = curPinchDist - prevPinchDistRef.current;

      prevCenterRef.current = { x: curX, y: curY };
      prevPinchDistRef.current = curPinchDist;

      // Nếu kéo ngang 2 ngón (|dx| > |dy| * 1.15) HOẶC chụm/tách 2 ngón (|dPinch| > 2.5):
      if (Math.abs(dx) > Math.abs(dy) * 1.15 || Math.abs(dPinch) > 2.5) {
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          const zoomDelta = Math.abs(dx) > Math.abs(dPinch) ? dx : dPinch;
          persp.fov = THREE.MathUtils.clamp(persp.fov - zoomDelta * 0.08, 20, 78);
          persp.updateProjectionMatrix();
        }
      } else if (Math.abs(dy) >= Math.abs(dx)) {
        // Kéo lên trên (dy < 0) -> Tiến camera lên phía trước; Kéo xuống (dy > 0) -> Lùi camera ra sau
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const moveAmount = -dy * 0.022;

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
        prevPinchDistRef.current = 0;
        if (controlsRef.current && enabled) {
          controlsRef.current.enabled = true;
          controlsRef.current.update();
        }
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
          persp.fov = THREE.MathUtils.clamp(persp.fov + e.deltaY * 0.05, 20, 78);
          persp.updateProjectionMatrix();
        }
        return;
      }

      const dx = -e.deltaX;
      const dy = -e.deltaY;

      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        // Kéo ngang 2 ngón: Zoom
        const persp = camera as THREE.PerspectiveCamera;
        if (persp.isPerspectiveCamera) {
          persp.fov = THREE.MathUtils.clamp(persp.fov - dx * 0.06, 20, 78);
          persp.updateProjectionMatrix();
        }
      } else {
        // Kéo dọc 2 ngón: dy > 0 (kéo lên) -> Tiến camera; dy < 0 (kéo xuống) -> Lùi camera
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const moveAmount = dy * 0.012;

        camera.position.addScaledVector(forward, moveAmount);
        if (controlsRef.current) {
          controlsRef.current.target.addScaledVector(forward, moveAmount);
          controlsRef.current.update();
        }
      }
    };

    dom.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    dom.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    dom.addEventListener('touchend', handleTouchEnd, { capture: true });
    dom.addEventListener('touchcancel', handleTouchEnd, { capture: true });
    dom.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      dom.removeEventListener('touchstart', handleTouchStart, { capture: true });
      dom.removeEventListener('touchmove', handleTouchMove, { capture: true });
      dom.removeEventListener('touchend', handleTouchEnd, { capture: true });
      dom.removeEventListener('touchcancel', handleTouchEnd, { capture: true });
      dom.removeEventListener('wheel', handleWheel);
    };
  }, [camera, controlsRef, enabled, gl.domElement]);

  return null;
}
