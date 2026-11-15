import { GestureKind } from '../types/universe';

/**
 * Classifies a pointer interaction as a 'tap' or a 'drag'.
 * Short low-jitter touches (<200ms, <=10px) are taps; larger or longer moves are drags.
 */
export function classifyPointerGesture(durationMs: number, distancePx: number): GestureKind {
  if (durationMs < 200 && distancePx <= 10) {
    return 'tap';
  }
  return 'drag';
}

/**
 * Computes a centripetal restoring impulse when a body drifts beyond safeRadius in zero-g.
 */
export function computeGravityWellImpulse(
  position: [number, number, number],
  safeRadius: number,
  pullStrength: number,
): [number, number, number] {
  const [x, y, z] = position;
  const dist = Math.hypot(x, y, z);
  if (dist <= safeRadius || dist === 0) {
    return [0, 0, 0];
  }

  const excess = dist - safeRadius;
  const impulseMag = excess * pullStrength;
  const factor = impulseMag / dist;

  return [-x * factor, -y * factor, -z * factor];
}

/**
 * Computes physical impulse from pointer drag delta and elapsed duration,
 * clamping dt >= 16ms and capping maximum impulse to prevent infinite velocity / NaN.
 */
export function computeFlickImpulse(
  deltaWorld: [number, number, number],
  durationMs: number,
  maxImpulse = 8,
): [number, number, number] {
  const dt = Math.max(durationMs, 16) / 1000;
  let vx = deltaWorld[0] / dt;
  let vy = deltaWorld[1] / dt;
  let vz = deltaWorld[2] / dt;

  if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
    return [0, 0, 0];
  }

  const mag = Math.hypot(vx, vy, vz);
  if (mag > maxImpulse && mag > 0) {
    const scale = maxImpulse / mag;
    vx *= scale;
    vy *= scale;
    vz *= scale;
  }

  return [vx, vy, vz];
}

/**
 * Computes paired orbital targets for Froakie & Deerling so they swim together
 * near keepsakes in zero-g while staying close to each other (< 4.5 units distance).
 */
export function stepCompanionPair(
  _froakiePos: [number, number, number],
  _deerlingPos: [number, number, number],
  elapsedSec: number,
): {
  froakieTarget: [number, number, number];
  deerlingTarget: [number, number, number];
} {
  const t = elapsedSec * 0.35;
  const cx = Math.sin(t) * 3.8;
  const cy = Math.sin(t * 0.7) * 1.4;
  const cz = Math.cos(t) * 3.8;

  const froakieTarget: [number, number, number] = [
    cx + Math.sin(t * 1.5) * 0.8 - 0.7,
    cy + Math.cos(t * 1.2) * 0.35,
    cz + Math.cos(t * 1.5) * 0.8,
  ];

  const deerlingTarget: [number, number, number] = [
    cx + Math.cos(t * 1.5) * 0.8 + 0.7,
    cy - Math.cos(t * 1.2) * 0.35,
    cz + Math.sin(t * 1.5) * 0.8,
  ];

  return { froakieTarget, deerlingTarget };
}

/**
 * Computes procedural squash/stretch and elastic jump offsets for companions,
 * serving as a fallback and enhancement layer over skeletal animations.
 */
export function computeProceduralCompanionPose(
  elapsedSec: number,
  isExcited: boolean,
): {
  offsetY: number;
  scaleY: number;
  scaleXZ: number;
  spinY: number;
} {
  if (!isExcited) {
    const breath = Math.sin(elapsedSec * 3);
    const offsetY = breath * 0.08;
    const scaleY = 1 + breath * 0.04;
    const scaleXZ = 1 / Math.sqrt(scaleY);
    return {
      offsetY,
      scaleY,
      scaleXZ,
      spinY: 0,
    };
  }

  const hop = Math.abs(Math.sin(elapsedSec * 8));
  const offsetY = hop * 0.6;
  const scaleY = 1 + Math.sin(elapsedSec * 8) * 0.25;
  const scaleXZ = 1 / Math.sqrt(Math.max(0.1, scaleY));
  const spinY = elapsedSec * 6;

  return {
    offsetY,
    scaleY,
    scaleXZ,
    spinY,
  };
}
