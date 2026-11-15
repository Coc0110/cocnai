import { useMemo, useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { KeepsakeManifestItem } from '../types/universe';
import { useUniverseStore } from '../store/useUniverseStore';

interface KeepsakeInspectorProps {
  items: KeepsakeManifestItem[];
}

function InspectedModel({ item }: { item: KeepsakeManifestItem }) {
  const gltf = useGLTF(item.url);
  const clonedScene = useMemo(() => gltf.scene.clone(), [gltf.scene]);
  const groupRef = useRef<THREE.Group>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [zoomScale, setZoomScale] = useState(1.4);
  const lastPointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Smooth idle spin when not being actively dragged
    if (!isDragging) {
      groupRef.current.rotation.y += delta * 0.35;
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setIsDragging(true);
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !groupRef.current) return;
    e.stopPropagation();

    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;

    groupRef.current.rotation.y += dx * 0.012;
    groupRef.current.rotation.x += dy * 0.012;

    lastPointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (isDragging) {
      e.stopPropagation();
      setIsDragging(false);
    }
  };

  const handleWheel = (e: ThreeEvent<WheelEvent>) => {
    e.stopPropagation();
    setZoomScale((prev) => Math.min(2.4, Math.max(0.6, prev - e.deltaY * 0.0015)));
  };

  return (
    <group position={[0, 0, 3.2]}>
      {/* Focused illumination for 360 inspection */}
      <pointLight position={[0, 2, 3]} intensity={2.2} color="#ffffff" distance={8} />
      <pointLight position={[0, -2, -2]} intensity={1.2} color="#f0abfc" distance={8} />

      <group
        ref={groupRef}
        scale={[zoomScale, zoomScale, zoomScale]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <primitive object={clonedScene} />
      </group>
    </group>
  );
}

export function KeepsakeInspector({ items }: KeepsakeInspectorProps): JSX.Element | null {
  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);
  const clearSelection = useUniverseStore((s) => s.clearSelection);

  if (!selectedKeepsakeId) {
    return null;
  }

  const selectedItem = items.find((it) => it.id === selectedKeepsakeId);
  if (!selectedItem) {
    return null;
  }

  return (
    <group>
      {/* Dimmed backdrop plane: tapping outside dismisses inspection */}
      <mesh
        position={[0, 0, 0.5]}
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

      <InspectedModel item={selectedItem} />
    </group>
  );
}
