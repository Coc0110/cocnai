import { useRef, useMemo, useEffect } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF, useAnimations, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { useUniverseStore } from '../store/useUniverseStore';
import {
  computeProceduralCompanionPose,
  stepCompanionPair,
} from '../utils/physicsMath';

interface CompanionEntityProps {
  id: 'froakie' | 'deerling';
  modelUrl: string;
  sparkleColor: string;
  initialPos: [number, number, number];
}

function CompanionEntity({ id, modelUrl, sparkleColor, initialPos }: CompanionEntityProps) {
  const gltf = useGLTF(modelUrl);
  const clonedScene = useMemo(() => gltf.scene.clone(), [gltf.scene]);
  const groupRef = useRef<THREE.Group>(null);
  const modelInnerRef = useRef<THREE.Group>(null);
  const { actions, names } = useAnimations(gltf.animations, clonedScene);

  const excitedCompanion = useUniverseStore((s) => s.excitedCompanion);
  const triggerCompanion = useUniverseStore((s) => s.triggerCompanion);

  const isExcited = excitedCompanion !== null;
  const currentPosRef = useRef<[number, number, number]>([...initialPos]);
  const currentVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3());

  // Play skeletal animation clips when present
  useEffect(() => {
    if (names.length === 0) return;
    const clipName = isExcited
      ? names.find((n) => /jump|happy|celebrate/i.test(n)) || names[0]
      : names.find((n) => /idle|swim|walk|move/i.test(n)) || names[0];

    const action = actions[clipName];
    if (action) {
      action.reset().fadeIn(0.25).play();
      return () => {
        action.fadeOut(0.25);
      };
    }
  }, [actions, names, isExcited]);

  useFrame((state, delta) => {
    if (!groupRef.current || !modelInnerRef.current) return;

    const elapsed = state.clock.getElapsedTime();
    const { froakieTarget, deerlingTarget } = stepCompanionPair(
      currentPosRef.current,
      currentPosRef.current,
      elapsed,
    );

    const target = id === 'froakie' ? froakieTarget : deerlingTarget;

    // Smooth movement interpolation
    const lerpFactor = Math.min(1, delta * 2.2);
    const prevPos = new THREE.Vector3(...currentPosRef.current);
    const nextX = THREE.MathUtils.lerp(currentPosRef.current[0], target[0], lerpFactor);
    const nextY = THREE.MathUtils.lerp(currentPosRef.current[1], target[1], lerpFactor);
    const nextZ = THREE.MathUtils.lerp(currentPosRef.current[2], target[2], lerpFactor);

    currentPosRef.current = [nextX, nextY, nextZ];
    groupRef.current.position.set(nextX, nextY, nextZ);

    // Compute velocity for heading / banking
    const nextPos = new THREE.Vector3(nextX, nextY, nextZ);
    const velocity = nextPos.clone().sub(prevPos);
    if (velocity.lengthSq() > 0.00001) {
      currentVelocityRef.current.lerp(velocity.normalize(), 0.1);
      const lookTarget = nextPos.clone().add(currentVelocityRef.current);
      groupRef.current.lookAt(lookTarget);
    }

    // Procedural squash, stretch, and celebration spin
    const pose = computeProceduralCompanionPose(elapsed, isExcited);
    modelInnerRef.current.position.y = pose.offsetY;
    modelInnerRef.current.scale.set(pose.scaleXZ, pose.scaleY, pose.scaleXZ);
    if (pose.spinY > 0) {
      modelInnerRef.current.rotation.y = pose.spinY;
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    triggerCompanion(id);
  };

  return (
    <group ref={groupRef} onPointerDown={handlePointerDown}>
      <group ref={modelInnerRef}>
        <primitive object={clonedScene} />

        {/* Trail / aura sparkles */}
        <Sparkles
          count={isExcited ? 36 : 14}
          scale={isExcited ? 2.5 : 1.2}
          size={isExcited ? 4.5 : 2.5}
          speed={isExcited ? 1.8 : 0.6}
          color={sparkleColor}
          opacity={0.85}
        />
      </group>
    </group>
  );
}

export function CompanionPair(): JSX.Element {
  return (
    <group>
      {/* Froakie (Cóc) - Cyan water sparkles */}
      <CompanionEntity
        id="froakie"
        modelUrl="/models/companions/froakie.glb"
        sparkleColor="#38bdf8"
        initialPos={[-2.2, 0.8, 1.2]}
      />

      {/* Deerling (Nai) - Rose/golden starlight sparkles */}
      <CompanionEntity
        id="deerling"
        modelUrl="/models/companions/deerling.glb"
        sparkleColor="#f472b6"
        initialPos={[2.2, -0.6, -1.0]}
      />
    </group>
  );
}
