import { describe, expect, it, beforeEach } from 'vitest';
import { useUniverseStore } from '../useUniverseStore';

describe('useUniverseStore', () => {
  beforeEach(() => {
    useUniverseStore.getState().clearSelection();
  });

  it('transitions cleanly between overview, single keepsake selection, and switching keepsakes', () => {
    expect(useUniverseStore.getState().selectedKeepsakeId).toBeNull();
    useUniverseStore.getState().selectKeepsake('keepsake-1');
    expect(useUniverseStore.getState().selectedKeepsakeId).toBe('keepsake-1');
    useUniverseStore.getState().selectKeepsake('keepsake-2');
    expect(useUniverseStore.getState().selectedKeepsakeId).toBe('keepsake-2');
    useUniverseStore.getState().clearSelection();
    expect(useUniverseStore.getState().selectedKeepsakeId).toBeNull();
  });

  it('sets excitedCompanion when triggered', () => {
    useUniverseStore.getState().triggerCompanion('froakie');
    expect(useUniverseStore.getState().excitedCompanion).toBe('froakie');
  });
});
