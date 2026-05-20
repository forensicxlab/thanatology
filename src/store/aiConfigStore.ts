import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface AiConfig {
    provider: string;
    endpoint: string;
    api_key: string;
    model: string;
    enable_text_specialist: boolean;
    enable_image_specialist: boolean;
    enable_audio_specialist: boolean;
    batch_size: number;
}

const DEFAULT_CONFIG: AiConfig = {
    provider: "copilot",
    endpoint: "http://10.0.0.198",
    api_key: "",
    model: "forensic-qwen",
    enable_text_specialist: false,
    enable_image_specialist: false,
    enable_audio_specialist: false,
    batch_size: 10,
};

interface AiConfigState {
    config: AiConfig;
    loaded: boolean;
    setConfig: (partial: Partial<AiConfig>) => void;
    loadConfig: () => Promise<void>;
    saveConfig: () => Promise<void>;
}

export const useAiConfigStore = create<AiConfigState>((set, get) => ({
    config: DEFAULT_CONFIG,
    loaded: false,
    setConfig: (partial) => set((state) => ({ config: { ...state.config, ...partial } })),
    loadConfig: async () => {
        try {
            const config = await invoke<AiConfig>("load_ai_config");
            set({ config, loaded: true });
        } catch {
            set({ loaded: true });
        }
    },
    saveConfig: async () => {
        await invoke("save_ai_config", { config: get().config });
    },
}));
