import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { CosmicEnvironment } from './components/CosmicEnvironment';
import { KeepsakeItem } from './components/KeepsakeItem';
import { KeepsakeInspector } from './components/KeepsakeInspector';
import { CompanionPair } from './components/CompanionPair';
import { useUniverseStore } from './store/useUniverseStore';
import { KeepsakeManifestItem } from './types/universe';
import rawKeepsakes from './data/keepsakes.json';

const keepsakes = rawKeepsakes as KeepsakeManifestItem[];

export default function App(): JSX.Element {
  const selectedKeepsakeId = useUniverseStore((s) => s.selectedKeepsakeId);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        backgroundColor: '#02040a',
      }}
    >
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 9], fov: 50, near: 0.1, far: 500 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => useUniverseStore.getState().clearSelection()}
      >
        <Suspense fallback={null}>
          <CosmicEnvironment />

          <Physics gravity={[0, 0, 0]}>
            {keepsakes.map((item) => (
              <KeepsakeItem key={item.id} item={item} />
            ))}
          </Physics>

          <CompanionPair />

          <KeepsakeInspector items={keepsakes} />

          <OrbitControls
            makeDefault
            enabled={selectedKeepsakeId === null}
            enablePan={false}
            enableDamping
            dampingFactor={0.07}
            minDistance={4}
            maxDistance={16}
            rotateSpeed={0.85}
            zoomSpeed={0.8}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
