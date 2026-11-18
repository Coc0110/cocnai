import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import { KeepsakeManifestItem, LetterItem } from '../types/universe';
import { useUniverseStore, liveKeepsakePoses } from '../store/useUniverseStore';
import {
  prepareKeepsakeScene,
  animateSuppleBracelet,
  animateGlassBottleRope,
  animateGlassBottleCapsules,
  animateHangingCharmString,
} from '../utils/prepareKeepsakeScene';
import { ActiveCapsuleUnroller } from './ActiveCapsuleUnroller';
import { requestDeviceMotionPermission } from '../utils/deviceMotionPermission';
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

  const openTRef = useRef<number>(0);
  const closeTRef = useRef<number>(0);
  const hasCapturedOpenStart = useRef<boolean>(false);
  const hasCapturedCloseStart = useRef<boolean>(false);
  const openStartPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const openStartQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const openStartScale = useRef<number>(1.0);
  const closeStartPos = useRef<THREE.Vector3>(new THREE.Vector3());
  const closeStartQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const closeStartScale = useRef<number>(1.0);
  const currentBottleZRef = useRef<number>(0);

  const _tempCamDir = useMemo(() => new THREE.Vector3(), []);
  const _tempRootQuat = useMemo(() => new THREE.Quaternion(), []);
  const _tempEuler = useMemo(() => new THREE.Euler(), []);
  const _tempTargetQuat = useMemo(() => new THREE.Quaternion(), []);

  const [isDragging, setIsDragging] = useState(false);
  const [zoomScale, setZoomScale] = useState(1.0);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const userRotRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Trạng thái mở nắp lọ và viên nang đang đọc
  const [isCorkOpen, setIsCorkOpen] = useState(false);
  const [activeLetterId, setActiveLetterId] = useState<number | null>(null);
  const [isClosingLetter, setIsClosingLetter] = useState(false);
  const [isReturningToSpace, setIsReturningToSpace] = useState(false);

  // Cảm biến chuyển động và vuốt nút bần
  const shakeImpulseRef = useRef(0);
  const lastAccRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastActionTimeRef = useRef<number>(0);
  const upsideDownStartRef = useRef<number | null>(null);
  const pointerDownOnCorkRef = useRef(false);

  // Đồng bộ ref để tránh stale closure trong devicemotion & setTimeout
  const isCorkOpenRef = useRef(isCorkOpen);
  isCorkOpenRef.current = isCorkOpen;
  const activeLetterIdRef = useRef(activeLetterId);
  activeLetterIdRef.current = activeLetterId;
  const isClosingLetterRef = useRef(isClosingLetter);
  isClosingLetterRef.current = isClosingLetter;

  const selectedCapsuleRef = useRef<THREE.Group | null>(null);
  const [unrollerData, setUnrollerData] = useState<{
    letter: LetterItem;
    localStartPos: THREE.Vector3;
    localStartQuat: THREE.Quaternion;
    localMouthPos: THREE.Vector3;
    startHolderScale: number;
    targetCapsule?: THREE.Object3D;
    preparedScene?: THREE.Group;
  } | null>(null);

  const [minVisibleDim, setMinVisibleDim] = useState(3.0);

  const triggerCloseLetter = () => {
    if (activeLetterId !== null && !isClosingLetter) {
      setIsClosingLetter(true);
    }
  };

  const handleFinishCloseLetter = () => {
    if (selectedCapsuleRef.current) {
      selectedCapsuleRef.current.visible = true;
      selectedCapsuleRef.current = null;
    }
    setActiveLetterId(null);
    setUnrollerData(null);
    setIsClosingLetter(false);
  };

  useEffect(() => {
    openTRef.current = 0;
    closeTRef.current = 0;
    hasCapturedOpenStart.current = false;
    hasCapturedCloseStart.current = false;
    currentBottleZRef.current = 0;
    userRotRef.current = { x: 0, y: 0 };
    setZoomScale(1.0);
    setIsCorkOpen(false);
    setIsReturningToSpace(false);
    handleFinishCloseLetter();
  }, [item.id, selectedKeepsakeOrigin]);

  // Hỗ trợ chụm/tách 2 ngón tay (pinch-to-zoom) mượt mà trên điện thoại
  useEffect(() => {
    let initialDist = 0;
    let initialZoom = 1.0;

    const handleTouchStart = (e: TouchEvent) => {
      if (isReturningToSpace) return;
      if (e.touches.length === 2 && activeLetterId === null) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        initialDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        initialZoom = zoomScale;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isReturningToSpace) return;
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
  }, [activeLetterId, isReturningToSpace, zoomScale]);

  useFrame((state, delta) => {
    if (!rootGroupRef.current || !modelGroupRef.current) return;

    const elapsed = state.clock.getElapsedTime();
    const inspectDist = item.id === 'glass-bottle' ? 2.45 : 2.65;

    // 1. Root group HUD cố định vững vàng ở khoảng cách inspectDist phía trước camera
    state.camera.getWorldDirection(_tempCamDir);
    rootGroupRef.current.position.copy(state.camera.position).addScaledVector(_tempCamDir, inspectDist);
    rootGroupRef.current.quaternion.copy(state.camera.quaternion);
    rootGroupRef.current.updateMatrixWorld(true);

    // Đặt tấm nền mờ luôn nằm phía sau vật phẩm (inspectDist + 1.2) và hướng thẳng camera
    if (backdropRef.current) {
      backdropRef.current.position.copy(state.camera.position).addScaledVector(_tempCamDir, inspectDist + 1.2);
      backdropRef.current.quaternion.copy(state.camera.quaternion);
    }

    // 2. Chuyển đổi tọa độ thế giới của Keepsake ngoài vũ trụ sang không gian local của rootGroupRef
    const livePose = liveKeepsakePoses[item.id];
    let localOriginPos: THREE.Vector3;
    let localOriginQuat: THREE.Quaternion;
    let originScale: number;

    if (livePose) {
      localOriginPos = rootGroupRef.current.worldToLocal(livePose.pos.clone());
      const rootWorldQuat = rootGroupRef.current.getWorldQuaternion(_tempRootQuat);
      localOriginQuat = rootWorldQuat.clone().invert().multiply(livePose.quat);
      originScale = livePose.scale;
    } else {
      const originPos = selectedKeepsakeOrigin
        ? new THREE.Vector3(...selectedKeepsakeOrigin)
        : new THREE.Vector3(...item.initialPosition);
      localOriginPos = rootGroupRef.current.worldToLocal(originPos.clone());
      localOriginQuat = new THREE.Quaternion();
      originScale = 1.0;
    }

    // 3. Hoạt ảnh quay trở lại không gian ngoài vũ trụ (khi người dùng bấm đóng hoặc chạm backdrop)
    if (isReturningToSpace) {
      if (!hasCapturedCloseStart.current) {
        closeStartPos.current.copy(modelGroupRef.current.position);
        closeStartQuat.current.copy(modelGroupRef.current.quaternion);
        closeStartScale.current = modelGroupRef.current.scale.x;
        hasCapturedCloseStart.current = true;
      }

      closeTRef.current += delta / 0.68;
      const t = Math.min(1.0, closeTRef.current);
      const easeClose = t * t * (3 - 2 * t); // smoothstep ease

      // Nội suy mượt mà tới tọa độ thực tế đang trôi dạt của Keepsake
      modelGroupRef.current.position.lerpVectors(closeStartPos.current, localOriginPos, easeClose);
      modelGroupRef.current.quaternion.slerpQuaternions(closeStartQuat.current, localOriginQuat, easeClose);
      modelGroupRef.current.scale.setScalar(THREE.MathUtils.lerp(closeStartScale.current, originScale, easeClose));

      if (backdropRef.current) {
        const mat = backdropRef.current.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.opacity = (1 - easeClose) * 0.68;
        }
      }

      // Vẫn duy trì chuyển động mềm mại của vật phẩm
      if (item.id === 'clover-bracelet') {
        animateSuppleBracelet(preparedScene, elapsed);
      }
      if (item.id === 'glass-bottle') {
        animateGlassBottleRope(preparedScene, elapsed);
        animateGlassBottleCapsules(preparedScene, elapsed, delta);
      }
      if (item.id === 'hanging-charm') {
        animateHangingCharmString(preparedScene, elapsed, delta);
      }

      if (t >= 1.0) {
        clearSelection();
        setIsReturningToSpace(false);
        hasCapturedCloseStart.current = false;
      }
      return;
    }

    // 4. Tính toán tư thế hiển thị khi Inspect (trước ống kính camera)
    const persp = state.camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(persp.fov || 50);
    const visibleHeight = 2 * inspectDist * Math.tan(fovRad / 2);
    const aspect = state.size.width / Math.max(1, state.size.height);
    const visibleWidth = visibleHeight * aspect;
    const currentMinDim = Math.min(visibleWidth, visibleHeight);
    setMinVisibleDim(currentMinDim);

    const baseTargetSize = (item.radius || 0.65) * (item.id === 'glass-bottle' ? 2.5 : 2.1);
    const fitScaleFactor = item.id === 'glass-bottle' ? 0.76 : 0.56;
    const fitScale = (currentMinDim * fitScaleFactor) / baseTargetSize;
    const effectiveZoom = activeLetterId !== null ? 1.0 : zoomScale;
    const finalScale = fitScale * effectiveZoom;

    const floatY = Math.sin(elapsed * 1.7) * 0.045;
    const floatX = Math.cos(elapsed * 1.15) * 0.028;

    let inspectTargetX = floatX;
    let inspectTargetY = floatY;
    let inspectTargetZ = 0;

    if (item.id === 'glass-bottle') {
      inspectTargetZ = activeLetterId !== null
        ? -1.15 * (Math.tan(fovRad / 2) / Math.tan(THREE.MathUtils.degToRad(25)))
        : 0;
    }

    // Rung lắc thân bình khi người dùng lắc thiết bị di động
    if (shakeImpulseRef.current > 0.001) {
      inspectTargetX += Math.sin(elapsed * 42) * shakeImpulseRef.current * 0.08;
      shakeImpulseRef.current = THREE.MathUtils.damp(shakeImpulseRef.current, 0, 5, delta);
    }

    const targetInspectPos = new THREE.Vector3(inspectTargetX, inspectTargetY, inspectTargetZ);

    let rotX = userRotRef.current.x + Math.sin(elapsed * 1.35) * 0.055;
    let rotY = userRotRef.current.y + Math.cos(elapsed * 1.05) * 0.065;
    let rotZ = Math.sin(elapsed * 1.5 + 0.8) * 0.038;

    if (shakeImpulseRef.current > 0.001) {
      rotZ += Math.cos(elapsed * 38) * shakeImpulseRef.current * 0.06;
    }

    _tempEuler.set(rotX, rotY, rotZ, 'XYZ');
    _tempTargetQuat.setFromEuler(_tempEuler);

    // 5. Hoạt ảnh bay vào (Open transition: 0.65s, easeOutCubic)
    if (openTRef.current < 1.0) {
      if (!hasCapturedOpenStart.current) {
        openStartPos.current.copy(localOriginPos);
        openStartQuat.current.copy(localOriginQuat);
        openStartScale.current = originScale;
        hasCapturedOpenStart.current = true;
      }

      openTRef.current = Math.min(1.0, openTRef.current + delta / 0.65);
      const easeOpen = 1 - Math.pow(1 - openTRef.current, 3); // easeOutCubic

      modelGroupRef.current.position.lerpVectors(openStartPos.current, targetInspectPos, easeOpen);
      modelGroupRef.current.quaternion.slerpQuaternions(openStartQuat.current, _tempTargetQuat, easeOpen);
      modelGroupRef.current.scale.setScalar(THREE.MathUtils.lerp(openStartScale.current, finalScale, easeOpen));

      if (backdropRef.current) {
        const mat = backdropRef.current.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.opacity = easeOpen * 0.68;
        }
      }
    } else {
      // Đã mở xong hoàn toàn: tương tác bình thường
      if (item.id === 'glass-bottle') {
        currentBottleZRef.current = THREE.MathUtils.lerp(
          currentBottleZRef.current,
          inspectTargetZ,
          delta * 5.5,
        );
        targetInspectPos.z = currentBottleZRef.current;
      }

      modelGroupRef.current.position.copy(targetInspectPos);
      modelGroupRef.current.quaternion.copy(_tempTargetQuat);
      modelGroupRef.current.scale.setScalar(finalScale);

      if (backdropRef.current) {
        const mat = backdropRef.current.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.opacity = 0.68;
        }
      }
    }

    // 6. Đung đưa mềm mại sợi dây vòng tay, nơ cổ chai và các viên nang trong bình
    if (item.id === 'clover-bracelet') {
      animateSuppleBracelet(preparedScene, elapsed);
    }
    if (item.id === 'glass-bottle') {
      animateGlassBottleRope(preparedScene, elapsed);
      animateGlassBottleCapsules(preparedScene, elapsed, delta);

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
    if (item.id === 'hanging-charm') {
      animateHangingCharmString(preparedScene, elapsed, delta);
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

    // Tỷ lệ scale thực tế của viên nang trong bình so với rootGroupRef
    const capWorldScale = targetCapsule.getWorldScale(new THREE.Vector3());
    const rootWorldScale = rootGroupRef.current.getWorldScale(new THREE.Vector3());
    const startHolderScale = capWorldScale.x / (rootWorldScale.x || 1);

    targetCapsule.visible = false;
    selectedCapsuleRef.current = targetCapsule;

    const letterObj = (lettersData as LetterItem[]).find((l) => l.id === capId);
    if (!letterObj) return;

    setUnrollerData({
      letter: letterObj,
      localStartPos,
      localStartQuat,
      localMouthPos,
      startHolderScale,
      targetCapsule,
      preparedScene,
    });
    setActiveLetterId(capId);
    setIsClosingLetter(false);
  };

  // Lắng nghe sự kiện cảm biến chuyển động devicemotion trên thiết bị di động
  useEffect(() => {
    if (item.id !== 'glass-bottle' || isReturningToSpace) return;

    const handleDeviceMotion = (e: DeviceMotionEvent) => {
      if (!e.accelerationIncludingGravity) return;
      const ax = e.accelerationIncludingGravity.x ?? 0;
      const ay = e.accelerationIncludingGravity.y ?? 0;
      const az = e.accelerationIncludingGravity.z ?? 0;

      const now = performance.now();
      if (!lastAccRef.current) {
        lastAccRef.current = { x: ax, y: ay, z: az };
        return;
      }

      const deltaAcc = Math.hypot(
        ax - lastAccRef.current.x,
        ay - lastAccRef.current.y,
        az - lastAccRef.current.z,
      );
      lastAccRef.current = { x: ax, y: ay, z: az };

      // Trường hợp A — Lắc điện thoại (deltaAcc > 16 và đã qua cooldown 950ms)
      if (deltaAcc > 16 && now - lastActionTimeRef.current > 950) {
        shakeImpulseRef.current = 1.0;
        lastActionTimeRef.current = now;

        if (!isCorkOpenRef.current) {
          setIsCorkOpen(true);
        } else if (activeLetterIdRef.current === null && !isClosingLetterRef.current) {
          setTimeout(() => {
            if (
              activeLetterIdRef.current === null &&
              !isClosingLetterRef.current &&
              isCorkOpenRef.current
            ) {
              const randomId = Math.floor(Math.random() * 31) + 1;
              selectCapsuleToOpen(randomId);
            }
          }, 320);
        }
      }

      // Trường hợp B — Dốc ngược điện thoại (acc.y > 5.8, tức đầu điện thoại chúc xuống đất)
      if (ay > 5.8) {
        if (upsideDownStartRef.current === null) {
          upsideDownStartRef.current = now;
        } else if (now - upsideDownStartRef.current >= 250) {
          if (
            isCorkOpenRef.current &&
            activeLetterIdRef.current === null &&
            !isClosingLetterRef.current &&
            now - lastActionTimeRef.current > 1200
          ) {
            shakeImpulseRef.current = 0.6;
            lastActionTimeRef.current = now;
            upsideDownStartRef.current = null;
            const randomId = Math.floor(Math.random() * 31) + 1;
            selectCapsuleToOpen(randomId);
          }
        }
      } else {
        upsideDownStartRef.current = null;
      }
    };

    window.addEventListener('devicemotion', handleDeviceMotion);
    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
    };
  }, [item.id, isReturningToSpace]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (isReturningToSpace || openTRef.current < 1.0) return;
    e.stopPropagation();
    setIsDragging(true);
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);

    // Kiểm tra nếu chạm vào nút bần
    if (item.id === 'glass-bottle') {
      const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;
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
      pointerDownOnCorkRef.current = hitCork;
    } else {
      pointerDownOnCorkRef.current = false;
    }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || isReturningToSpace || openTRef.current < 1.0) return;
    e.stopPropagation();

    if (activeLetterId !== null) return;

    // Nếu đang bắt đầu thao tác trên nút bần và vuốt lên trên, không xoay thân bình
    if (pointerDownOnCorkRef.current) {
      const dy = e.clientY - pointerDownPosRef.current.y;
      if (dy < -6) {
        return;
      }
    }

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

      const deltaY = e.clientY - pointerDownPosRef.current.y;
      const dragDist = Math.hypot(
        e.clientX - pointerDownPosRef.current.x,
        deltaY,
      );

      // Nhận diện cú click hoặc vuốt trên nút bần / chọn viên nang
      if (item.id === 'glass-bottle' && activeLetterId === null) {
        const corkNode = preparedScene.userData.corkNode as THREE.Object3D | undefined;

        // 1. Kiểm tra thao tác trên nút bần: nhấn thả tại chỗ (< 8px) HOẶC vuốt lên trên (deltaY < -12px)
        let hitCork = pointerDownOnCorkRef.current;
        if (!hitCork && corkNode && dragDist < 8) {
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
          if (dragDist < 8) {
            requestDeviceMotionPermission();
            setIsCorkOpen((prev) => !prev);
            pointerDownOnCorkRef.current = false;
            return;
          } else if (deltaY < -12) {
            requestDeviceMotionPermission();
            setIsCorkOpen(true);
            pointerDownOnCorkRef.current = false;
            return;
          }
        }
        pointerDownOnCorkRef.current = false;

        // 2. Khi nắp đã mở, kiểm tra bấm trúng 1 trong 31 viên nang
        if (isCorkOpen && dragDist < 8) {
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
    if (activeLetterId !== null || isReturningToSpace) return;
    e.stopPropagation();
    setZoomScale((prev) => Math.min(1.65, Math.max(0.55, prev - e.deltaY * 0.0015)));
  };

  return (
    <>
      {/* Dimmed backdrop plane: tapping outside dismisses letter reading or returns keepsake to space */}
      <mesh
        ref={backdropRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (activeLetterId !== null) {
            triggerCloseLetter();
          } else if (!isReturningToSpace) {
            if (item.id === 'glass-bottle' && isCorkOpen) {
              setIsCorkOpen(false);
            }
            setIsReturningToSpace(true);
          }
        }}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial
          transparent
          opacity={0}
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
          {item.id === 'clover-bracelet' && (
            <mesh visible={true}>
              <sphereGeometry args={[0.85, 16, 16]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
            </mesh>
          )}
          <primitive object={preparedScene} />
        </group>

        {/* Hoạt ảnh mở cuộn thư khi chọn viên nang */}
        {unrollerData && (
          <ActiveCapsuleUnroller
            key={unrollerData.letter.id}
            letter={unrollerData.letter}
            localStartPos={unrollerData.localStartPos}
            localStartQuat={unrollerData.localStartQuat}
            localMouthPos={unrollerData.localMouthPos}
            startHolderScale={unrollerData.startHolderScale}
            targetCapsule={unrollerData.targetCapsule}
            preparedScene={unrollerData.preparedScene}
            minVisibleDim={minVisibleDim}
            isClosing={isClosingLetter}
            onFinishClose={handleFinishCloseLetter}
            onRequestClose={triggerCloseLetter}
          />
        )}
      </group>

      {/* HTML UI Overlay: Hướng dẫn mở nắp / chọn thư */}
      <Html fullscreen style={{ pointerEvents: 'none' }}>
        {item.id === 'glass-bottle' && !isCorkOpen && activeLetterId === null && !isReturningToSpace && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full bg-slate-900/80 text-amber-200 border border-amber-400/30 shadow-lg text-xs md:text-sm font-medium backdrop-blur-md flex items-center gap-2 pointer-events-none select-none animate-pulse">
            <span>💡</span> Chạm / Vuốt lên nút bần hoặc Lắc để mở nắp lọ
          </div>
        )}

        {item.id === 'glass-bottle' && isCorkOpen && activeLetterId === null && !isReturningToSpace && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 rounded-full bg-slate-900/80 text-amber-300 border border-amber-400/40 shadow-lg text-xs md:text-sm font-medium backdrop-blur-md flex items-center gap-2 pointer-events-none select-none">
            <span>✨</span> Chạm viên thuốc hoặc Lắc / Dốc ngược lọ để mở thư
          </div>
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
