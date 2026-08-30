import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getSpatiotemporalSnapshot,
  registerSpatiotemporalWindow,
  setSpatiotemporalSync,
  SPATIOTEMPORAL_EVENT_NAME,
  updateSpatiotemporalState,
  updateSpatiotemporalPlaybackCursor,
} from "./ipc";
import type {
  SpatiotemporalIdentity,
  SpatiotemporalSnapshot,
  SpatiotemporalStatePatch,
  SpatiotemporalSyncSeed,
} from "./types";

export interface SpatiotemporalSessionApi {
  snapshot: SpatiotemporalSnapshot | null;
  loading: boolean;
  error: string | null;
  peerConnected: boolean;
  publish: (patch: SpatiotemporalStatePatch) => Promise<SpatiotemporalSnapshot | null>;
  publishPlaybackCursor: (
    cursorMs: number,
  ) => Promise<SpatiotemporalSnapshot | null>;
  setSyncEnabled: (
    enabled: boolean,
    localState?: Partial<SpatiotemporalSyncSeed>,
  ) => Promise<SpatiotemporalSnapshot>;
}

const DEFAULT_SEED: SpatiotemporalSyncSeed = {
  cursorMs: null,
  rangeStartMs: null,
  rangeEndMs: null,
  correlationWindowMs: 5 * 60 * 1_000,
  playing: false,
  playbackRate: 1,
  selectedTimelineEventId: null,
  selectedLocationObservationId: null,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSpatiotemporalSession(
  identity: SpatiotemporalIdentity,
): SpatiotemporalSessionApi {
  const [snapshot, setSnapshot] = React.useState<SpatiotemporalSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const latestRevision = React.useRef(-1);
  const latestSessionId = React.useRef<string | null>(null);
  const snapshotRef = React.useRef<SpatiotemporalSnapshot | null>(null);
  const outgoingQueue = React.useRef<Promise<void>>(Promise.resolve());

  const enqueue = React.useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = outgoingQueue.current.then(operation);
    outgoingQueue.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const accept = React.useCallback(
    (next: SpatiotemporalSnapshot) => {
      if (
        next.schemaVersion !== 2 ||
        next.evidenceId !== identity.evidenceId ||
        next.partitionId !== identity.partitionId
      ) {
        return;
      }
      if (next.sessionId !== latestSessionId.current) {
        latestSessionId.current = next.sessionId;
        latestRevision.current = -1;
      }
      if (next.revision < latestRevision.current) return;
      latestRevision.current = next.revision;
      snapshotRef.current = next;
      setSnapshot(next);
    },
    [identity.evidenceId, identity.partitionId],
  );

  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    latestRevision.current = -1;
    latestSessionId.current = null;
    snapshotRef.current = null;
    outgoingQueue.current = Promise.resolve();
    setSnapshot(null);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        // Listener first, snapshot second: revisions make either arrival order safe.
        unlisten = await listen<SpatiotemporalSnapshot>(
          SPATIOTEMPORAL_EVENT_NAME,
          ({ payload }) => accept(payload),
        );
        if (disposed) {
          unlisten();
          return;
        }
        const registered = await registerSpatiotemporalWindow(identity);
        if (!disposed) accept(registered);
      } catch (caught) {
        if (!disposed) setError(message(caught));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [accept, identity]);

  const publish = React.useCallback(
    (patch: SpatiotemporalStatePatch) =>
      enqueue(async () => {
        if (!snapshotRef.current?.syncEnabled) return snapshotRef.current;
        try {
          const next = await updateSpatiotemporalState(identity, patch);
          accept(next);
          setError(null);
          return next;
        } catch (caught) {
          setError(message(caught));
          throw caught;
        }
      }),
    [accept, enqueue, identity],
  );

  const publishPlaybackCursor = React.useCallback(
    (cursorMs: number) =>
      enqueue(async () => {
        const current = snapshotRef.current;
        if (!current?.syncEnabled) return current;
        if (!current.playing || current.controller !== "location") return current;
        try {
          // Generation and sequence are intentionally derived only when this
          // queued operation begins. Earlier start/rate/control commands from
          // this window have therefore already updated the authoritative token.
          const next = await updateSpatiotemporalPlaybackCursor(
            identity,
            cursorMs,
            current.playbackGeneration,
            current.playbackTickSequence + 1,
          );
          accept(next);
          setError(null);
          return next;
        } catch (caught) {
          const detail = message(caught);
          const expectedClockRace =
            detail.includes("Stale playback generation") ||
            detail.includes("Out-of-order playback tick") ||
            detail.includes("Location playback is no longer active");
          if (!expectedClockRace) {
            setError(detail);
            throw caught;
          }

          // A peer seek/pause legitimately invalidates an in-flight tick. Pull
          // the winning state back without surfacing that normal race as a
          // persistent investigator-facing transport error.
          try {
            const authoritative = await getSpatiotemporalSnapshot(
              identity.evidenceId,
              identity.partitionId,
            );
            if (authoritative) accept(authoritative);
            setError(null);
            return authoritative;
          } catch (refreshError) {
            setError(message(refreshError));
            throw refreshError;
          }
        }
      }),
    [accept, enqueue, identity],
  );

  const setSyncEnabled = React.useCallback(
    (enabled: boolean, localState: Partial<SpatiotemporalSyncSeed> = {}) =>
      enqueue(async () => {
        const current = snapshotRef.current;
        const seed: SpatiotemporalSyncSeed = {
          ...DEFAULT_SEED,
          ...(current
            ? {
                cursorMs: current.cursorMs,
                rangeStartMs: current.rangeStartMs,
                rangeEndMs: current.rangeEndMs,
                correlationWindowMs: current.correlationWindowMs,
                playing: current.playing,
                playbackRate: current.playbackRate,
                selectedTimelineEventId: current.selectedTimelineEventId,
                selectedLocationObservationId:
                  current.selectedLocationObservationId,
              }
            : null),
          ...localState,
        };
        try {
          const next = await setSpatiotemporalSync(identity, enabled, seed);
          accept(next);
          setError(null);
          return next;
        } catch (caught) {
          setError(message(caught));
          throw caught;
        }
      }),
    [accept, enqueue, identity],
  );

  const peerConnected =
    identity.role === "timeline"
      ? Boolean(snapshot?.locationConnected)
      : Boolean(snapshot?.timelineConnected);

  return {
    snapshot,
    loading,
    error,
    peerConnected,
    publish,
    publishPlaybackCursor,
    setSyncEnabled,
  };
}
