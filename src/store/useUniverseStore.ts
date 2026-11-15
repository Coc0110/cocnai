import { create } from 'zustand';
import { CompanionId } from '../types/universe';

export interface UniverseState {
  selectedKeepsakeId: string | null;
  excitedCompanion: CompanionId | null;
  selectKeepsake: (id: string) => void;
  clearSelection: () => void;
  triggerCompanion: (id: CompanionId) => void;
}

let excitementTimer: ReturnType<typeof setTimeout> | null = null;

export const useUniverseStore = create<UniverseState>((set) => ({
  selectedKeepsakeId: null,
  excitedCompanion: null,

  selectKeepsake: (id: string) => {
    set({ selectedKeepsakeId: id });
  },

  clearSelection: () => {
    set({ selectedKeepsakeId: null, excitedCompanion: null });
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
