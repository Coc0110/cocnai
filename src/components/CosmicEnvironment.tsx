import { Stars, Sparkles } from '@react-three/drei';

export function CosmicEnvironment(): JSX.Element {
  return (
    <>
      <color attach="background" args={['#03050e']} />
      <fog attach="fog" args={['#03050e', 14, 38]} />

      {/* Multi-angle cinematic illumination */}
      <ambientLight intensity={0.65} color="#dbe5ff" />
      <directionalLight position={[5, 8, 6]} intensity={1.6} color="#fff6eb" />
      <directionalLight position={[-6, -4, -4]} intensity={0.9} color="#8ec5fc" />
      <directionalLight position={[0, 6, -8]} intensity={1.2} color="#e0b8fe" />
      <pointLight position={[0, 0, 0]} intensity={0.8} color="#fce7f3" distance={10} />

      {/* Cosmic background stars and floating stardust */}
      <Stars radius={45} depth={45} count={3500} factor={4} saturation={0.6} fade speed={0.8} />
      <Sparkles count={120} scale={14} size={3} speed={0.3} color="#ffe4f2" opacity={0.65} />
      <Sparkles count={60} scale={10} size={4.5} speed={0.5} color="#bae6fd" opacity={0.7} />
    </>
  );
}
