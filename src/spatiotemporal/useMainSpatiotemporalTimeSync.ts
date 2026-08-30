import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { useTimeFilterStore } from "../store/timeFilterStore";
import {
  getSpatiotemporalSnapshot,
  setSpatiotemporalSyncFromMain,
  SPATIOTEMPORAL_EVENT_NAME,
  updateSpatiotemporalRangeFromMain,
} from "./ipc";
import type { SpatiotemporalSnapshot } from "./types";

export interface MainSpatiotemporalTimeSyncApi {
  snapshot: SpatiotemporalSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Re-read the optional session, for example after opening a detached window. */
  refresh: () => Promise<SpatiotemporalSnapshot | null>;
  /** Main's range is the seed when synchronization is enabled from Main. */
  setSyncEnabled: (
    enabled: boolean,
  ) => Promise<SpatiotemporalSnapshot | null>;
}

type SnapshotSource = "event" | "response";

type PendingRange = {
  scopeKey: string;
  scopeGeneration: object;
  start: number | null;
  end: number | null;
};

type PendingSyncToggle = {
  scopeKey: string;
  sessionId: string;
  localRangeSequence: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameRange(
  startA: number | null,
  endA: number | null,
  startB: number | null,
  endB: number | null,
): boolean {
  return startA === startB && endA === endB;
}

/**
 * Connects the main investigation's global time filter to the optional
 * revisioned Timeline/Location session.
 *
 * Main deliberately synchronizes only range bounds. Cursor, playback,
 * selections, event-type filters and the filesystem timestamp field remain in
 * their owning workspace. The hook never creates a session: detached window
 * launch remains the only session-creation path.
 */
export function useMainSpatiotemporalTimeSync(
  evidenceId: number,
  partitionId: number | null,
): MainSpatiotemporalTimeSyncApi {
  const [snapshot, setSnapshot] =
    React.useState<SpatiotemporalSnapshot | null>(null);
  const [loading, setLoading] = React.useState(partitionId != null);
  const [error, setError] = React.useState<string | null>(null);

  const scopeKey = `${evidenceId}:${partitionId ?? "none"}`;
  const scopeGeneration = React.useMemo(() => ({ scopeKey }), [scopeKey]);
  const scopeKeyRef = React.useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const scopeGenerationRef = React.useRef(scopeGeneration);
  scopeGenerationRef.current = scopeGeneration;

  const mountedRef = React.useRef(false);
  const snapshotRef = React.useRef<SpatiotemporalSnapshot | null>(null);
  const latestRevisionRef = React.useRef(-1);
  const retiredSessionIdsRef = React.useRef(new Set<string>());
  const applyingInboundRangeRef = React.useRef(false);
  const localRangeSequenceRef = React.useRef(0);
  const pendingSyncToggleRef = React.useRef<PendingSyncToggle | null>(null);
  const pendingRangeRef = React.useRef<PendingRange | null>(null);
  const scheduledRangeDrainGenerationsRef = React.useRef(new Set<object>());
  const outgoingQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const enqueue = React.useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = outgoingQueueRef.current.then(operation);
    outgoingQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const clearAcceptedSession = React.useCallback(
    (expectedSessionId?: string | null) => {
      const current = snapshotRef.current;
      if (
        expectedSessionId !== undefined &&
        (current?.sessionId ?? null) !== expectedSessionId
      ) {
        return;
      }
      if (current) retiredSessionIdsRef.current.add(current.sessionId);
      snapshotRef.current = null;
      latestRevisionRef.current = -1;
      pendingRangeRef.current = null;
      if (mountedRef.current) setSnapshot(null);
    },
    [],
  );

  const applySnapshotRange = React.useCallback(
    (next: SpatiotemporalSnapshot) => {
      if (!next.syncEnabled) return;
      const pendingToggle = pendingSyncToggleRef.current;
      if (
        next.origin === "investigation" &&
        pendingToggle?.scopeKey === scopeKeyRef.current &&
        pendingToggle.sessionId === next.sessionId &&
        localRangeSequenceRef.current > pendingToggle.localRangeSequence
      ) {
        // The investigator changed Main's range while an enable command was in
        // flight. Preserve that newer local intent; once enable commits it is
        // queued as the next authoritative range update.
        return;
      }
      const store = useTimeFilterStore.getState();
      if (
        store.evidenceId !== evidenceId ||
        store.partitionId !== partitionId ||
        sameRange(store.start, store.end, next.rangeStartMs, next.rangeEndMs)
      ) {
        return;
      }

      // Zustand subscriptions run synchronously. The guard therefore prevents
      // this remote application from being queued back to Rust as a main edit.
      applyingInboundRangeRef.current = true;
      try {
        store.setRange(next.rangeStartMs, next.rangeEndMs);
      } finally {
        applyingInboundRangeRef.current = false;
      }
    },
    [evidenceId, partitionId],
  );

  const acceptSnapshot = React.useCallback(
    (
      next: SpatiotemporalSnapshot,
      source: SnapshotSource,
      requestSessionId?: string | null,
    ): boolean => {
      if (
        !mountedRef.current ||
        scopeGenerationRef.current !== scopeGeneration ||
        scopeKeyRef.current !== scopeKey ||
        next.schemaVersion !== 2 ||
        !next.sessionId ||
        next.evidenceId !== evidenceId ||
        next.partitionId !== partitionId ||
        retiredSessionIdsRef.current.has(next.sessionId)
      ) {
        return false;
      }

      const current = snapshotRef.current;
      if (current?.sessionId === next.sessionId) {
        if (next.revision < latestRevisionRef.current) return false;
      } else {
        // A listener is installed before each read. If the session changed
        // while that read/command was in flight, its older response must not
        // replace the newer event already accepted by Main.
        if (
          source === "response" &&
          current &&
          requestSessionId !== current.sessionId
        ) {
          return false;
        }
        if (current) retiredSessionIdsRef.current.add(current.sessionId);
        latestRevisionRef.current = -1;
      }

      latestRevisionRef.current = next.revision;
      snapshotRef.current = next;
      setSnapshot(next);
      applySnapshotRange(next);
      return true;
    },
    [
      applySnapshotRange,
      evidenceId,
      partitionId,
      scopeGeneration,
      scopeKey,
    ],
  );

  const acceptResponse = React.useCallback(
    (
      next: SpatiotemporalSnapshot | null,
      requestSessionId: string | null,
    ) => {
      if (scopeGenerationRef.current !== scopeGeneration) return;
      if (next) {
        acceptSnapshot(next, "response", requestSessionId);
      } else {
        clearAcceptedSession(requestSessionId);
      }
    },
    [acceptSnapshot, clearAcceptedSession, scopeGeneration],
  );

  const scheduleRangeUpdate = React.useCallback(
    (start: number | null, end: number | null) => {
      if (partitionId == null) return;
      pendingRangeRef.current = {
        scopeKey,
        scopeGeneration,
        start,
        end,
      };
      if (
        scheduledRangeDrainGenerationsRef.current.has(scopeGeneration)
      ) {
        return;
      }
      scheduledRangeDrainGenerationsRef.current.add(scopeGeneration);

      void enqueue(async () => {
        try {
          // One queued drain absorbs all picker/slider changes which arrive
          // while an IPC call is in flight, sending only the newest bounds. A
          // drain may consume work only from the scope generation which
          // created it; a previous partition's in-flight command therefore
          // cannot steal or discard a newly selected partition's edit.
          while (scopeGenerationRef.current === scopeGeneration) {
            const desired = pendingRangeRef.current;
            if (!desired || desired.scopeGeneration !== scopeGeneration) {
              break;
            }
            pendingRangeRef.current = null;
            const current = snapshotRef.current;
            if (
              desired.scopeKey !== scopeKeyRef.current ||
              !current?.syncEnabled ||
              sameRange(
                desired.start,
                desired.end,
                current.rangeStartMs,
                current.rangeEndMs,
              )
            ) {
              continue;
            }

            const requestSessionId = current.sessionId;
            try {
              const next = await updateSpatiotemporalRangeFromMain({
                evidenceId,
                partitionId,
                expectedSessionId: requestSessionId,
                // Playback ticks legitimately revise the session frequently;
                // session identity, the serialized queue, and commit ordering
                // protect this edit without starving it on a strict revision.
                expectedRevision: null,
                rangeStartMs: desired.start,
                rangeEndMs: desired.end,
              });
              if (
                desired.scopeGeneration !== scopeGenerationRef.current ||
                desired.scopeKey !== scopeKeyRef.current
              ) {
                continue;
              }
              acceptResponse(next, requestSessionId);
              if (mountedRef.current) setError(null);
            } catch (caught) {
              if (
                mountedRef.current &&
                desired.scopeGeneration === scopeGenerationRef.current &&
                desired.scopeKey === scopeKeyRef.current
              ) {
                setError(errorMessage(caught));
              }
            }
          }
        } finally {
          scheduledRangeDrainGenerationsRef.current.delete(scopeGeneration);
        }
      });
    },
    [
      acceptResponse,
      enqueue,
      evidenceId,
      partitionId,
      scopeGeneration,
      scopeKey,
    ],
  );

  React.useEffect(() => {
    if (partitionId == null) return;
    return useTimeFilterStore.subscribe((state, previous) => {
      const stateMatchesScope =
        state.evidenceId === evidenceId && state.partitionId === partitionId;
      const previousMatchedScope =
        previous.evidenceId === evidenceId &&
        previous.partitionId === partitionId;

      // Scope initialization restores a persisted main range. When a linked
      // session already exists, its revisioned range is authoritative; do not
      // mistake restoration for an investigator edit and publish it outward.
      if (stateMatchesScope && !previousMatchedScope) {
        const current = snapshotRef.current;
        if (current) applySnapshotRange(current);
        return;
      }
      if (
        state.start === previous.start &&
        state.end === previous.end
      ) {
        return;
      }
      if (
        applyingInboundRangeRef.current ||
        !stateMatchesScope
      ) {
        return;
      }
      localRangeSequenceRef.current += 1;
      if (!snapshotRef.current?.syncEnabled) return;
      scheduleRangeUpdate(state.start, state.end);
    });
  }, [applySnapshotRange, evidenceId, partitionId, scheduleRangeUpdate]);

  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    snapshotRef.current = null;
    latestRevisionRef.current = -1;
    retiredSessionIdsRef.current = new Set<string>();
    localRangeSequenceRef.current = 0;
    pendingSyncToggleRef.current = null;
    if (
      pendingRangeRef.current?.scopeGeneration !== scopeGeneration
    ) {
      pendingRangeRef.current = null;
    }
    setSnapshot(null);
    setError(null);

    if (partitionId == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        // Listener first, snapshot second: session identity plus revisions make
        // either arrival order safe, including close/reopen lifecycle races.
        unlisten = await listen<SpatiotemporalSnapshot>(
          SPATIOTEMPORAL_EVENT_NAME,
          ({ payload }) => {
            if (acceptSnapshot(payload, "event")) setError(null);
          },
        );
        if (disposed) {
          unlisten();
          return;
        }

        const requestSessionId = snapshotRef.current?.sessionId ?? null;
        const initial = await getSpatiotemporalSnapshot(evidenceId, partitionId);
        if (!disposed) acceptResponse(initial, requestSessionId);
      } catch (caught) {
        if (!disposed) setError(errorMessage(caught));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    acceptResponse,
    acceptSnapshot,
    evidenceId,
    partitionId,
    scopeGeneration,
  ]);

  const refresh = React.useCallback(async () => {
    if (partitionId == null) {
      clearAcceptedSession();
      setLoading(false);
      return null;
    }
    const requestedScope = scopeKey;
    const requestedGeneration = scopeGeneration;
    const requestSessionId = snapshotRef.current?.sessionId ?? null;
    setLoading(true);
    try {
      const next = await getSpatiotemporalSnapshot(evidenceId, partitionId);
      if (
        scopeGenerationRef.current === requestedGeneration &&
        scopeKeyRef.current === requestedScope
      ) {
        acceptResponse(next, requestSessionId);
        setError(null);
      }
      return next;
    } catch (caught) {
      if (
        scopeGenerationRef.current === requestedGeneration &&
        scopeKeyRef.current === requestedScope
      ) {
        setError(errorMessage(caught));
      }
      throw caught;
    } finally {
      if (
        mountedRef.current &&
        scopeGenerationRef.current === requestedGeneration &&
        scopeKeyRef.current === requestedScope
      ) {
        setLoading(false);
      }
    }
  }, [
    acceptResponse,
    clearAcceptedSession,
    evidenceId,
    partitionId,
    scopeGeneration,
    scopeKey,
  ]);

  const setSyncEnabled = React.useCallback(
    (enabled: boolean) =>
      enqueue(async () => {
        const current = snapshotRef.current;
        if (partitionId == null || !current) return null;
        const requestedScope = scopeKey;
        const requestedGeneration = scopeGeneration;
        const requestSessionId = current.sessionId;
        const store = useTimeFilterStore.getState();
        const storeMatchesScope =
          store.evidenceId === evidenceId && store.partitionId === partitionId;
        const pendingToggle: PendingSyncToggle = {
          scopeKey: requestedScope,
          sessionId: requestSessionId,
          localRangeSequence: localRangeSequenceRef.current,
        };
        pendingSyncToggleRef.current = pendingToggle;
        try {
          const next = await setSpatiotemporalSyncFromMain({
            evidenceId,
            partitionId,
            expectedSessionId: requestSessionId,
            expectedRevision: null,
            syncEnabled: enabled,
            rangeStartMs: storeMatchesScope ? store.start : current.rangeStartMs,
            rangeEndMs: storeMatchesScope ? store.end : current.rangeEndMs,
          });
          if (
            scopeGenerationRef.current === requestedGeneration &&
            scopeKeyRef.current === requestedScope
          ) {
            acceptResponse(next, requestSessionId);
            setError(null);
            if (
              enabled &&
              next?.syncEnabled &&
              localRangeSequenceRef.current >
                pendingToggle.localRangeSequence
            ) {
              const latestStore = useTimeFilterStore.getState();
              if (
                latestStore.evidenceId === evidenceId &&
                latestStore.partitionId === partitionId
              ) {
                scheduleRangeUpdate(latestStore.start, latestStore.end);
              }
            }
          }
          return next;
        } catch (caught) {
          if (
            scopeGenerationRef.current === requestedGeneration &&
            scopeKeyRef.current === requestedScope
          ) {
            setError(errorMessage(caught));
          }
          throw caught;
        } finally {
          if (pendingSyncToggleRef.current === pendingToggle) {
            pendingSyncToggleRef.current = null;
          }
        }
      }),
    [
      acceptResponse,
      enqueue,
      evidenceId,
      partitionId,
      scheduleRangeUpdate,
      scopeGeneration,
      scopeKey,
    ],
  );

  return { snapshot, loading, error, refresh, setSyncEnabled };
}
