import { create } from 'zustand';

interface EvidenceState {
    activeEvidenceDbPath: string | null;
    activeEvidenceId: number | null;
    setActiveEvidence: (dbPath: string | null, id: number | null) => void;
    clearActiveEvidence: () => void;
}

export const useEvidenceStore = create<EvidenceState>((set) => ({
    activeEvidenceDbPath: null,
    activeEvidenceId: null,
    setActiveEvidence: (dbPath, id) => set({ activeEvidenceDbPath: dbPath, activeEvidenceId: id }),
    clearActiveEvidence: () => set({ activeEvidenceDbPath: null, activeEvidenceId: null }),
}));
