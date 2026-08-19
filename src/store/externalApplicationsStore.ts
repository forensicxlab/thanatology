import { create } from "zustand";
import {
  createExternalApplication,
  deleteExternalApplication,
  listExternalApplications,
  updateExternalApplication,
} from "../externalApps/db";
import type {
  ExternalApplication,
  ExternalApplicationInput,
} from "../externalApps/types";

interface ExternalApplicationsState {
  applications: ExternalApplication[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  save: (id: number | null, input: ExternalApplicationInput) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useExternalApplicationsStore = create<ExternalApplicationsState>(
  (set, get) => ({
    applications: [],
    loaded: false,
    loading: false,
    error: null,
    load: async (force = false) => {
      if (get().loading || (get().loaded && !force)) return;
      set({ loading: true, error: null });
      try {
        const applications = await listExternalApplications();
        set({ applications, loaded: true, loading: false });
      } catch (error) {
        set({ error: errorMessage(error), loaded: true, loading: false });
        throw error;
      }
    },
    save: async (id, input) => {
      set({ error: null });
      try {
        if (id === null) await createExternalApplication(input);
        else await updateExternalApplication(id, input);
        const applications = await listExternalApplications();
        set({ applications, loaded: true });
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      }
    },
    remove: async (id) => {
      set({ error: null });
      try {
        await deleteExternalApplication(id);
        set((state) => ({
          applications: state.applications.filter(
            (application) => application.id !== id,
          ),
        }));
      } catch (error) {
        set({ error: errorMessage(error) });
        throw error;
      }
    },
  }),
);
