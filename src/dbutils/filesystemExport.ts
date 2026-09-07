import { invoke } from "@tauri-apps/api/core";

export const DIRECTORY_EXPORT_EVENT = "filesystem-directory-export";

export type DirectoryExportJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type DirectoryExportJobStage =
  | "queued"
  | "preparing"
  | "traversing"
  | "copying"
  | "finalizing"
  | "complete"
  | "cancelled"
  | "failed";

export interface DirectoryExportRequest {
  operationId: string;
  evidenceId: number;
  partitionId: number;
  directorySystemFileId: number;
  destinationParent: string;
}

export interface DirectoryExportFailure {
  path: string;
  error: string;
}

/**
 * Backend-owned app-session state for one recursive directory export. The
 * same shape is returned by commands and emitted as progress so a remounted
 * Files view can recover a job without relying on renderer-local state.
 */
export interface DirectoryExportJobSnapshot {
  jobId: string;
  evidenceId: number;
  partitionId: number;
  directorySystemFileId: number;
  sourcePath: string;
  destinationParent: string;
  outputPath: string | null;
  status: DirectoryExportJobStatus;
  stage: DirectoryExportJobStage;
  currentPath: string | null;
  entriesProcessed: number;
  totalEntries: number | null;
  filesExported: number;
  directoriesCreated: number;
  bytesWritten: number;
  totalBytes: number | null;
  skippedEntries: number;
  failedEntries: number;
  failures: DirectoryExportFailure[];
  manifestPath: string | null;
  error: string | null;
  startedAtUnixMs: number | null;
  finishedAtUnixMs: number | null;
}

export interface CancelDirectoryExportResult {
  accepted: boolean;
}

export function startDirectoryExport(
  request: DirectoryExportRequest,
): Promise<DirectoryExportJobSnapshot> {
  return invoke<DirectoryExportJobSnapshot>("start_directory_export", {
    request,
  });
}

export function getDirectoryExportJobs(
  evidenceId?: number,
): Promise<DirectoryExportJobSnapshot[]> {
  return invoke<DirectoryExportJobSnapshot[]>("get_directory_export_jobs", {
    evidenceId,
  });
}

export function cancelDirectoryExport(
  jobId: string,
): Promise<CancelDirectoryExportResult> {
  return invoke<CancelDirectoryExportResult>("cancel_directory_export", {
    jobId,
  });
}
