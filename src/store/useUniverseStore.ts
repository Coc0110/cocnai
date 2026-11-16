import { create } from 'zustand';
import { CompanionId } from '../types/universe';

export interface UniverseState {
  selectedKeepsakeId: string | null;
  selectedKeepsakeOrigin: [number, number, number] | null;
  excitedCompanion: CompanionId | null;
  selectKeepsake: (id: string | null, origin?: [number, number, number]) => void;
  clearSelection: () => void;
  triggerCompanion: (id: CompanionId) => void;
}

let excitementTimer: ReturnType<typeof setTimeout> | null = null;

export const useUniverseStore = create<UniverseState>((set) => ({
  selectedKeepsakeId: null,
  selectedKeepsakeOrigin: null,
  excitedCompanion: null,

  selectKeepsake: (id: string | null, origin?: [number, number, number]) => {
    set({
      selectedKeepsakeId: id,
      selectedKeepsakeOrigin: origin || null,
    });
  },

  clearSelection: () => {
    set({
      selectedKeepsakeId: null,
      selectedKeepsakeOrigin: null,
      excitedCompanion: null,
    });
  },

  triggerCompanion: (id: CompanionId) => {
    if (excitementTimer) {
      clearTimeout(excitementTimer);
    }
    set({ excitedCompanion: id });
    excitementTimer = setTimeout(() => {
      set((state) => (state.excitedCompanion === id ? { excitedCompanion: null } : {}));
      excitementTimer = null;
    }, 1800);
  },
}));
