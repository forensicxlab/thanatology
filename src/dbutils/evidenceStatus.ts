/**
 * Evidence processing lifecycle — the single source of truth.
 *
 * The pipeline previously spread these integers across the Rust backend and the
 * UI, which let two bugs hide: a failed artefact stage rendered as a green
 * "Ready", and the file-type stage was invisible because it was only ever
 * written to the per-evidence DB.
 *
 * Positive values are stages, ordered; negatives are failures whose magnitude
 * names the stage that failed (the backend resumes from `abs(status)`).
 */
export const EVIDENCE_STATUS = {
  NOT_PROCESSED: 0,
  PENDING: 1,
  PROCESSING: 2,
  INDEXED: 3,
  IDENTIFIED: 4,
  /** Artefacts parsed — reviewable. AI enrichment may still be running. */
  ARTEFACTS_PARSED: 5,
  /** Everything, including AI analysis, finished. */
  COMPLETE: 6,

  STOPPED: -1,
  STOPPING: -2,
  INDEXING_FAILED: -3,
  ARTEFACTS_FAILED: -4,
} as const;

/** Ordered stages shown in the card's progress display. */
export const PROCESSING_STAGES = [
  { key: "index", label: "Indexing files", reachedAt: EVIDENCE_STATUS.INDEXED },
  { key: "identify", label: "File types", reachedAt: EVIDENCE_STATUS.IDENTIFIED },
  { key: "artefact-discovery", label: "Artefact discovery", reachedAt: EVIDENCE_STATUS.ARTEFACTS_PARSED },
  { key: "artefact-parsing", label: "Artefact parsing", reachedAt: EVIDENCE_STATUS.ARTEFACTS_PARSED },
  { key: "ai", label: "AI analysis", reachedAt: EVIDENCE_STATUS.COMPLETE },
] as const;

export type EvidenceStatusInfo = {
  label: string;
  /** MUI theme colour token. */
  color: string;
  /** Severity for banners. */
  severity: "success" | "info" | "warning" | "error";
  /** Investigation may be opened. */
  isReviewable: boolean;
  /** Reviewable, but the data is knowingly incomplete. */
  isPartial: boolean;
  /** Work is in flight (or was, until interrupted). */
  isRunning: boolean;
  /** Nothing further will happen without user action. */
  isFailed: boolean;
  /** 0-5: how many stages are done, for the progress display. */
  stagesDone: number;
  /** Why review is unavailable, when it is. */
  blockedReason?: string;
};

const NOT_YET =
  "Review becomes available only after artefact parsing has completed.";

export function getEvidenceStatusInfo(status: number): EvidenceStatusInfo {
  switch (status) {
    case EVIDENCE_STATUS.NOT_PROCESSED:
      return {
        label: "Not processed",
        color: "text.disabled",
        severity: "info",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: false,
        stagesDone: 0,
        blockedReason: "This evidence has not been processed yet.",
      };

    case EVIDENCE_STATUS.PENDING:
      return {
        label: "Pending start",
        color: "warning.main",
        severity: "warning",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: false,
        stagesDone: 0,
        blockedReason: NOT_YET,
      };

    case EVIDENCE_STATUS.PROCESSING:
      return {
        label: "Indexing files",
        color: "info.main",
        severity: "info",
        isReviewable: false,
        isPartial: false,
        isRunning: true,
        isFailed: false,
        stagesDone: 0,
        blockedReason: NOT_YET,
      };

    case EVIDENCE_STATUS.INDEXED:
      return {
        label: "Identifying file types",
        color: "info.main",
        severity: "info",
        isReviewable: false,
        isPartial: false,
        isRunning: true,
        isFailed: false,
        stagesDone: 1,
        blockedReason: NOT_YET,
      };

    case EVIDENCE_STATUS.IDENTIFIED:
      return {
        label: "Processing artefacts",
        color: "info.main",
        severity: "info",
        isReviewable: false,
        isPartial: false,
        isRunning: true,
        isFailed: false,
        stagesDone: 2,
        blockedReason: NOT_YET,
      };

    case EVIDENCE_STATUS.ARTEFACTS_PARSED:
      // A resting, reviewable state. AI enrichment may or may not still be
      // running — that is liveness, not status, so it is detected from live
      // progress events rather than assumed here. (Evidence processed before
      // this stage existed also sits at 5 and is genuinely finished.)
      return {
        label: "Ready for review",
        color: "success.main",
        severity: "success",
        isReviewable: true,
        isPartial: false,
        isRunning: false,
        isFailed: false,
        stagesDone: 4,
      };

    case EVIDENCE_STATUS.COMPLETE:
      return {
        label: "Complete",
        color: "success.main",
        severity: "success",
        isReviewable: true,
        isPartial: false,
        isRunning: false,
        isFailed: false,
        stagesDone: 5,
      };

    case EVIDENCE_STATUS.STOPPING:
      return {
        label: "Stopping…",
        color: "warning.main",
        severity: "warning",
        isReviewable: false,
        isPartial: false,
        isRunning: true,
        isFailed: false,
        stagesDone: 0,
        blockedReason: "Processing is being stopped.",
      };

    case EVIDENCE_STATUS.STOPPED:
      return {
        label: "Stopped",
        color: "error.main",
        severity: "error",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: true,
        stagesDone: 0,
        blockedReason: "Processing was stopped before artefacts were parsed.",
      };

    case EVIDENCE_STATUS.INDEXING_FAILED:
      return {
        label: "Indexing failed",
        color: "error.main",
        severity: "error",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: true,
        stagesDone: 0,
        blockedReason: "File indexing failed, so there is nothing to review yet.",
      };

    case EVIDENCE_STATUS.ARTEFACTS_FAILED:
      return {
        label: "Artefact parsing failed",
        color: "error.main",
        severity: "error",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: true,
        stagesDone: 2,
        blockedReason:
          "Artefact parsing did not complete. Resume processing before reviewing this evidence.",
      };

    default:
      return {
        label: `Unknown state (${status})`,
        color: "text.disabled",
        severity: "warning",
        isReviewable: false,
        isPartial: false,
        isRunning: false,
        isFailed: false,
        stagesDone: 0,
        blockedReason: "This evidence is in an unrecognised state.",
      };
  }
}
