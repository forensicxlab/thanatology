import { create } from 'zustand';

interface EvidenceState {
    activeEvidenceDbPath: string | null;
    activeEvidenceId: number | null;
    processingStatus: number | null;
    setActiveEvidence: (dbPath: string | null, id: number | null) => void;
    setProcessingStatus: (status: number | null) => void;
    clearActiveEvidence: () => void;
}

export const useEvidenceStore = create<EvidenceState>((set) => ({
    activeEvidenceDbPath: null,
    activeEvidenceId: null,
    processingStatus: null,
    setActiveEvidence: (dbPath, id) => set({ activeEvidenceDbPath: dbPath, activeEvidenceId: id }),
    setProcessingStatus: (status) => set({ processingStatus: status }),
    clearActiveEvidence: () => set({ activeEvidenceDbPath: null, activeEvidenceId: null, processingStatus: null }),
}));
