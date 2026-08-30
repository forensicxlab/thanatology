import { create } from "zustand";

/**
 * Global investigation time filter.
 *
 * The selected window constrains every time-bearing view (timeline, mobile
 * record grids, location, file-backed grids). It is scoped per evidence and
 * partition and mirrored to localStorage so it survives tab switches, route
 * changes and application restarts without bleeding into another partition.
 *
 * Bounds are epoch milliseconds, UTC. `null` on either side means "unbounded"
 * on that side; both null means the filter is inactive.
 */

const STORAGE_PREFIX = "thanatology:timefilter:v2:";

function storageKey(evidenceId: number, partitionId: number): string {
  return `${STORAGE_PREFIX}${evidenceId}:${partitionId}`;
}

/**
 * Which filesystem timestamp decides whether a file-backed row is in range.
 * "any" matches if created, modified OR accessed falls in the window.
 */
export type FileTimeField = "any" | "created" | "modified" | "accessed";

export const FILE_TIME_FIELDS: { value: FileTimeField; label: string }[] = [
  { value: "any", label: "Any timestamp" },
  { value: "created", label: "Created" },
  { value: "modified", label: "Modified" },
  { value: "accessed", label: "Accessed" },
];

type PersistedRange = {
  start: number | null;
  end: number | null;
  fileTimeField?: FileTimeField;
};

function loadPersisted(
  evidenceId: number,
  partitionId: number,
): Required<PersistedRange> {
  try {
    const raw = localStorage.getItem(storageKey(evidenceId, partitionId));
    if (!raw) return { start: null, end: null, fileTimeField: "any" };
    const parsed = JSON.parse(raw) as PersistedRange;
    const start = typeof parsed.start === "number" ? parsed.start : null;
    const end = typeof parsed.end === "number" ? parsed.end : null;
    const field = parsed.fileTimeField;
    const fileTimeField: FileTimeField =
      field === "created" || field === "modified" || field === "accessed"
        ? field
        : "any";
    return { start, end, fileTimeField };
  } catch {
    return { start: null, end: null, fileTimeField: "any" };
  }
}

function persist(
  evidenceId: number,
  partitionId: number,
  range: Required<PersistedRange>,
) {
  try {
    if (range.start == null && range.end == null && range.fileTimeField === "any") {
      localStorage.removeItem(storageKey(evidenceId, partitionId));
    } else {
      localStorage.setItem(storageKey(evidenceId, partitionId), JSON.stringify(range));
    }
  } catch {
    /* storage unavailable — filter still works for this session */
  }
}

interface TimeFilterState {
  /** Scope the current range belongs to; guards against cross-partition bleed. */
  evidenceId: number | null;
  partitionId: number | null;
  start: number | null;
  end: number | null;
  fileTimeField: FileTimeField;

  /** Point the store at an immutable forensic scope, restoring its range. */
  initForScope: (evidenceId: number, partitionId: number | null) => void;
  setRange: (start: number | null, end: number | null) => void;
  setFileTimeField: (field: FileTimeField) => void;
  clear: () => void;
}

export const useTimeFilterStore = create<TimeFilterState>((set, get) => ({
  evidenceId: null,
  partitionId: null,
  start: null,
  end: null,
  fileTimeField: "any",

  initForScope: (evidenceId, partitionId) => {
    if (
      get().evidenceId === evidenceId &&
      get().partitionId === partitionId
    ) {
      return;
    }
    const restored =
      partitionId == null
        ? { start: null, end: null, fileTimeField: "any" as FileTimeField }
        : loadPersisted(evidenceId, partitionId);
    set({
      evidenceId,
      partitionId,
      start: restored.start,
      end: restored.end,
      fileTimeField: restored.fileTimeField,
    });
  },

  setRange: (start, end) => {
    // Tolerate inverted input from a drag that crossed over.
    const [lo, hi] =
      start != null && end != null && start > end ? [end, start] : [start, end];
    set({ start: lo, end: hi });
    const { evidenceId, partitionId, fileTimeField } = get();
    if (evidenceId != null && partitionId != null) {
      persist(evidenceId, partitionId, { start: lo, end: hi, fileTimeField });
    }
  },

  setFileTimeField: (fileTimeField) => {
    set({ fileTimeField });
    const { evidenceId, partitionId, start, end } = get();
    if (evidenceId != null && partitionId != null) {
      persist(evidenceId, partitionId, { start, end, fileTimeField });
    }
  },

  clear: () => {
    set({ start: null, end: null });
    const { evidenceId, partitionId, fileTimeField } = get();
    if (evidenceId != null && partitionId != null) {
      persist(evidenceId, partitionId, {
        start: null,
        end: null,
        fileTimeField,
      });
    }
  },
}));

/**
 * Convenience read hook for views: the active window plus a flag so a view can
 * cheaply skip filtering (and skip advertising itself as filtered) when off.
 */
export function useTimeFilter(): {
  start: number | null;
  end: number | null;
  fileTimeField: FileTimeField;
  isActive: boolean;
} {
  const start = useTimeFilterStore((s) => s.start);
  const end = useTimeFilterStore((s) => s.end);
  const fileTimeField = useTimeFilterStore((s) => s.fileTimeField);
  return { start, end, fileTimeField, isActive: start != null || end != null };
}
