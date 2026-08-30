import * as React from "react";
import TimelineWindowApp from "../components/evidences/investigate/categories/timeline/TimelineWindowApp";
import type { TimelineControlAdapter } from "../components/evidences/investigate/categories/timeline/timelineControl";
import LocationWindowApp from "../components/windows/location/LocationWindowApp";
import type { LocationControlAdapter } from "../components/evidences/investigate/categories/mobile/locationControl";
import type { TimelineEvent } from "../dbutils/types";
import type { SpatiotemporalIdentity, SpatiotemporalSnapshot } from "./types";
import type { SpatiotemporalSessionApi } from "./useSpatiotemporalSession";
import SpatiotemporalCorrelationPanel from "./SpatiotemporalCorrelationPanel";

type LocalWorkspaceState = {
  cursorMs: number | null;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  correlationWindowMs: number;
  playing: boolean;
  playbackRate: number;
  selectedTimelineEventId: number | null;
  selectedLocationObservationId: number | null;
};

type Props = {
  identity: SpatiotemporalIdentity;
  session: SpatiotemporalSessionApi;
};

function stateFromSnapshot(snapshot: SpatiotemporalSnapshot): LocalWorkspaceState {
  return {
    cursorMs: snapshot.cursorMs,
    rangeStartMs: snapshot.rangeStartMs,
    rangeEndMs: snapshot.rangeEndMs,
    correlationWindowMs: snapshot.correlationWindowMs,
    playing: snapshot.playing,
    playbackRate: snapshot.playbackRate,
    selectedTimelineEventId: snapshot.selectedTimelineEventId,
    selectedLocationObservationId: snapshot.selectedLocationObservationId,
  };
}

function normalizeRange(
  startMs: number | null,
  endMs: number | null,
): Pick<LocalWorkspaceState, "rangeStartMs" | "rangeEndMs"> {
  if (startMs != null && endMs != null && startMs > endMs) {
    return { rangeStartMs: endMs, rangeEndMs: startMs };
  }
  return { rangeStartMs: startMs, rangeEndMs: endMs };
}

/**
 * Owns the local evidence clock for one detached workspace. The Rust session
 * remains authoritative only while synchronization is enabled; while it is
 * disabled, each window can be explored without mutating its peer.
 */
export default function SynchronizedWorkspaceContent({ identity, session }: Props) {
  const snapshot = session.snapshot;
  const [local, setLocal] = React.useState<LocalWorkspaceState | null>(() =>
    snapshot ? stateFromSnapshot(snapshot) : null,
  );
  const [timelineEventTypes, setTimelineEventTypes] = React.useState<string[] | null>(
    null,
  );
  const previousSyncEnabled = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    if (!snapshot) return;
    const justDisconnected = previousSyncEnabled.current === true && !snapshot.syncEnabled;
    setLocal((current) =>
      current == null || snapshot.syncEnabled || justDisconnected
        ? stateFromSnapshot(snapshot)
        : current,
    );
    previousSyncEnabled.current = snapshot.syncEnabled;
  }, [snapshot]);

  const publish = React.useCallback(
    (patch: Parameters<SpatiotemporalSessionApi["publish"]>[0]) => {
      void session.publish(patch).catch(() => {
        // The session hook exposes the transport error. Re-align the local
        // controlled view if a concurrent peer controller rejected this edit.
        if (session.snapshot?.syncEnabled) {
          setLocal(stateFromSnapshot(session.snapshot));
        }
      });
    },
    [session],
  );

  const publishPlaybackCursor = React.useCallback(
    (cursorMs: number) => {
      void session.publishPlaybackCursor(cursorMs).catch(() => {
        if (session.snapshot?.syncEnabled) {
          setLocal(stateFromSnapshot(session.snapshot));
        }
      });
    },
    [session],
  );

  const setSyncEnabled = React.useCallback(
    (enabled: boolean) => {
      if (!local) return;
      // Timeline renders the shared playhead but does not own a clock loop. It
      // must never re-enable synchronization as a phantom playback controller.
      const seed =
        identity.role === "timeline" ? { ...local, playing: false } : local;
      void session
        .setSyncEnabled(enabled, seed)
        .then((next) => setLocal(stateFromSnapshot(next)))
        .catch(() => undefined);
    },
    [identity.role, local, session],
  );

  const timelineControl = React.useMemo<TimelineControlAdapter | null>(() => {
    if (!local) return null;
    return {
      range:
        local.rangeStartMs == null &&
        local.rangeEndMs == null &&
        timelineEventTypes == null
          ? null
          : {
              start: local.rangeStartMs,
              end: local.rangeEndMs,
              event_types: timelineEventTypes,
            },
      cursorMs: local.cursorMs,
      selectedEventId: local.selectedTimelineEventId,
      cursorWindow:
        local.cursorMs == null
          ? null
          : {
              beforeMs: local.correlationWindowMs,
              afterMs: local.correlationWindowMs,
              limit: 250,
              queryIntervalMs: 250,
            },
      onRangeChange: (range, reason) => {
        const normalized = normalizeRange(range?.start ?? null, range?.end ?? null);
        setTimelineEventTypes(range?.event_types ?? null);
        if (reason === "types") {
          // Event-type visibility is a Timeline-only filter. It must not stop
          // Location playback or clear/move the shared UTC playhead.
          setLocal((current) =>
            current
              ? { ...current, selectedTimelineEventId: null }
              : current,
          );
          publish({ selectedTimelineEventId: null });
          return;
        }
        setLocal((current) =>
          current
            ? {
                ...current,
                ...normalized,
                // A chart bucket or manually applied range is an interval, not
                // an exact instant. Leaving the previous Location cursor set
                // would make the events grid intersect that stale cursor
                // neighbourhood with the newly selected interval.
                cursorMs: null,
                playing: false,
                selectedTimelineEventId: null,
                selectedLocationObservationId: null,
              }
            : current,
        );
        publish({
          rangeStartMs: normalized.rangeStartMs,
          rangeEndMs: normalized.rangeEndMs,
          cursorMs: null,
          playing: false,
          controller: null,
          selectedTimelineEventId: null,
          selectedLocationObservationId: null,
        });
      },
      onEventSelect: (event: TimelineEvent | null) => {
        setLocal((current) => {
          if (!current) return current;
          return {
            ...current,
            cursorMs: event?.ts ?? current.cursorMs,
            playing: false,
            selectedTimelineEventId: event?.id ?? null,
            selectedLocationObservationId: null,
          };
        });
        publish({
          ...(event ? { cursorMs: event.ts } : null),
          selectedTimelineEventId: event?.id ?? null,
          selectedLocationObservationId: null,
          playing: false,
          controller: null,
        });
      },
    };
  }, [local, publish, timelineEventTypes]);

  const locationControl = React.useMemo<LocationControlAdapter | null>(() => {
    if (!local) return null;
    return {
      range: {
        startMs: local.rangeStartMs,
        endMs: local.rangeEndMs,
      },
      cursorMs: local.cursorMs,
      playing: local.playing,
      playbackRate: local.playbackRate,
      selectedObservationId: local.selectedLocationObservationId,
      onCursorChange: (cursorMs, reason) => {
        const stopsPlayback = reason !== "playback";
        const clearsLocationSelection = reason !== "observation";
        setLocal((current) =>
          current
            ? {
                ...current,
                cursorMs,
                playing: stopsPlayback ? false : current.playing,
                selectedTimelineEventId: null,
                selectedLocationObservationId: clearsLocationSelection
                  ? null
                  : current.selectedLocationObservationId,
              }
            : current,
        );
        if (reason === "playback") {
          publishPlaybackCursor(cursorMs);
        } else {
          publish({
            cursorMs,
            playing: false,
            controller: null,
            selectedTimelineEventId: null,
            ...(clearsLocationSelection
              ? { selectedLocationObservationId: null }
              : null),
          });
        }
      },
      onPlayingChange: (playing) => {
        setLocal((current) =>
          current
            ? {
                ...current,
                playing,
                ...(playing
                  ? {
                      selectedTimelineEventId: null,
                      selectedLocationObservationId: null,
                    }
                  : null),
              }
            : current,
        );
        publish({
          playing,
          controller: playing ? "location" : null,
          ...(playing
            ? {
                selectedTimelineEventId: null,
                selectedLocationObservationId: null,
              }
            : null),
        });
      },
      onPlaybackRateChange: (playbackRate) => {
        setLocal((current) =>
          current ? { ...current, playbackRate } : current,
        );
        publish({ playbackRate });
      },
      onObservationSelect: (selectedLocationObservationId) => {
        setLocal((current) =>
          current
            ? {
                ...current,
                selectedLocationObservationId,
                ...(selectedLocationObservationId != null
                  ? { selectedTimelineEventId: null }
                  : null),
              }
            : current,
        );
        publish({
          selectedLocationObservationId,
          ...(selectedLocationObservationId != null
            ? { selectedTimelineEventId: null }
            : null),
        });
      },
    };
  }, [local, publish, publishPlaybackCursor]);

  if (!snapshot || !local || !timelineControl || !locationControl) return null;

  const statusMessage = session.peerConnected
    ? snapshot.syncEnabled
      ? "Main investigation follows this UTC range; Timeline and Location also share cursor and playback."
      : "Main investigation, Timeline and Location currently use independent time ranges."
    : snapshot.syncEnabled
      ? "Main investigation follows this UTC range. Detached workspace synchronization will resume when its companion reconnects."
      : "Main investigation and this workspace use independent time ranges. Open the companion workspace for side-by-side correlation.";

  if (identity.role === "timeline") {
    return (
      <TimelineWindowApp
        evidenceId={identity.evidenceId}
        partitionId={identity.partitionId}
        session={{
          control: timelineControl,
          syncEnabled: snapshot.syncEnabled,
          peerConnected: session.peerConnected,
          onSyncEnabledChange: setSyncEnabled,
          statusMessage,
        }}
      />
    );
  }

  return (
    <LocationWindowApp
      evidenceId={identity.evidenceId}
      partitionId={identity.partitionId}
      control={locationControl}
      syncEnabled={snapshot.syncEnabled}
      peerConnected={session.peerConnected}
      onSyncEnabledChange={setSyncEnabled}
      correlationWindowMs={local.correlationWindowMs}
      onCorrelationWindowMsChange={(correlationWindowMs) => {
        setLocal((current) =>
          current ? { ...current, correlationWindowMs } : current,
        );
        publish({ correlationWindowMs });
      }}
      correlationPanel={
        <SpatiotemporalCorrelationPanel
          evidenceId={identity.evidenceId}
          partitionId={identity.partitionId}
          cursorMs={local.cursorMs}
          selectedTimelineEventId={local.selectedTimelineEventId}
          correlationWindowMs={local.correlationWindowMs}
        />
      }
    />
  );
}
