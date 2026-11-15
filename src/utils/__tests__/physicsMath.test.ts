import { describe, expect, it } from 'vitest';
import {
  classifyPointerGesture,
  computeFlickImpulse,
  computeGravityWellImpulse,
  computeProceduralCompanionPose,
  stepCompanionPair,
} from '../physicsMath';

describe('physicsMath', () => {
  it('classifies short low-jitter touches (<200ms, <=10px) as tap and larger/longer moves as drag', () => {
    expect(classifyPointerGesture(120, 6)).toBe('tap');
    expect(classifyPointerGesture(199, 10)).toBe('tap');
    expect(classifyPointerGesture(250, 4)).toBe('drag');
    expect(classifyPointerGesture(90, 14)).toBe('drag');
  });

  it('returns zero impulse inside safeRadius and inward centripetal impulse outside safeRadius', () => {
    expect(computeGravityWellImpulse([3, 0, 4], 6, 0.5)).toEqual([0, 0, 0]);
    const [ix, iy, iz] = computeGravityWellImpulse([10, 0, 0], 6, 0.5);
    expect(ix).toBeCloseTo(-2);
    expect(iy).toBeCloseTo(0);
    expect(iz).toBeCloseTo(0);
  });

  it('clamps dt=0 and caps maximum flick impulse without producing NaN', () => {
    const [ix, iy, iz] = computeFlickImpulse([100, -50, 25], 0, 8);
    const mag = Math.hypot(ix, iy, iz);
    expect(Number.isFinite(mag)).toBe(true);
    expect(mag).toBeLessThanOrEqual(8.0001);
  });

  it('keeps Froakie and Deerling targets bounded and close together over time', () => {
    const step = stepCompanionPair([-8, 2, 0], [8, -2, 0], 12.5);
    const dist = Math.hypot(
      step.froakieTarget[0] - step.deerlingTarget[0],
      step.froakieTarget[1] - step.deerlingTarget[1],
      step.froakieTarget[2] - step.deerlingTarget[2],
    );
    expect(dist).toBeLessThan(4.5);
  });

  it('produces higher jump offset and squash/stretch when companion is excited', () => {
    const calm = computeProceduralCompanionPose(0.25, false);
    const excited = computeProceduralCompanionPose(0.25, true);
    expect(Math.abs(excited.offsetY)).toBeGreaterThan(Math.abs(calm.offsetY));
    expect(excited.spinY).toBeGreaterThan(0);
  });
});
