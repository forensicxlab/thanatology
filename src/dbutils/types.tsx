/* =========================================================================
 *  Global shared types – updated to match new Rust structs
 * ========================================================================= */

export interface Evidence {
  id: number;
  case_id: number;
  name: string;
  type:
  | "Physical Disk image"
  | "Logical Disk image"
  | "Memory Image"
  | "Procmon dump"
  | "Folder";
  path: string;
  description: string;
  status: number;
  db_path: string;
  images?: EvidenceImageDraft[];
}

export type EvidenceImageSourceKind = "camera" | "file";

export interface EvidenceImageDraft {
  id: string;
  caption: string;
  file_name: string;
  mime_type: string;
  source_kind: EvidenceImageSourceKind;
  bytes: number[];
  preview_url: string;
}

export interface EvidenceImageInput {
  caption: string;
  file_name: string;
  mime_type: string;
  source_kind: EvidenceImageSourceKind;
  bytes: number[];
}

export interface EvidenceImageRecord {
  id: number;
  evidence_id: number;
  caption: string;
  file_name: string;
  mime_type: string;
  source_kind: EvidenceImageSourceKind;
  created_at: string;
  data_url: string;
}

/* -------------------------------------------------------------------------
 *  Partition-related structures
 * --------------------------------------------------------------------- */

/** One entry in an MBR (primary or logical / EBR) */
export interface MBRPartitionEntry {
  id: number;
  boot_indicator: number;
  start_chs: [number, number, number];
  partition_type: number;
  end_chs: [number, number, number];
  start_lba: number;
  size_sectors: number;
  sector_size: number;
  first_byte_addr: number;
  description: string;
  fvek?: string;
}

/** Master Boot Record sector */
export interface MBR {
  bootloader: number[];
  partition_table: MBRPartitionEntry[];
  boot_signature: number;
  bootloader_disam: string;
}

/* ---------------------------  GPT  ------------------------------------ */

export type PartitionEntry =
  | MBRPartitionEntry
  | GPTPartitionEntry
  | LogicalPartitionEntry;

export interface GPTPartitionEntry {
  id: number;
  partition_guid: number[];
  partition_guid_string: string;
  partition_type_guid: number[];
  partition_type_guid_string: string;
  starting_lba: number;
  ending_lba: number;
  first_byte_addr: number;
  size_sectors: number;
  attributes: number;
  description: string;
  partition_name: string;
  fvek?: string;
}

export interface GPTHeader {
  signature: number[];
  revision: number;
  header_size: number;
  crc32: number;
  reserved: number;
  current_lba: number;
  backup_lba: number;
  first_usable_lba: number;
  last_usable_lba: number;
  disk_guid: number[];
  partition_entry_lba: number;
  num_partition_entries: number;
  partition_entry_size: number;
  partition_array_crc32: number;
}

export interface GPT {
  header: GPTHeader;
  partition_entries: GPTPartitionEntry[];
}

// dbutils/types.ts
export interface LogicalPartitionEntry {
  id: number;
  evidence_id: number;
  /** total size in bytes of the logical snapshot */
  size: number;
  /** optional short text for UI; add this column if you like */
  description?: string | null;
  fvek?: string;
}

/* -------------------------  Combined view  --------------------------- */

export interface Partitions {
  /** Primary MBR (null when not present) */
  mbr?: MBR | null;

  /**
   * Every discovered EBR sector, each parsed exactly like an MBR.
   * Empty or null when no extended chain exists.
   */
  ebr?: MBR[] | null;

  /** GPT layout (null when absent) */
  gpt?: GPT | null;
  logical?: LogicalPartition | null;
}

/* --------------------------------------------------------------------- */

export interface Module {
  id: string;
  name: string;
  category: string;
  version: string;
  mandatory: boolean;
  description: string;
  os: string;
  parent_id: number;
}

export interface LogicalPartition {
  id: number;
  size: number;
  fvek?: string;
}

/* --------------------------------  Workflows  ------------------------ */

export interface ProcessedEvidenceMetadata {
  evidenceData: Evidence;
  diskImageFormat: string;
  selectedMbrPartitions?: MBRPartitionEntry[];
  selectedGptPartitions?: GPTPartitionEntry[];
  selectedLogicalPartition?: LogicalPartition;
  logicalFilesystem?: string;
}

/* Other helper types (unchanged) … */

export interface Case {
  id: number;
  name: string;
  description: string;
  collaborators: number[];
}
export interface FsInfo {
  block_size: number;
  filesystem_type: string;
  metadata: Record<string, unknown>;
  image_size?: number;
}
export interface File {
  id: number;
  evidence_id: number;
  partition_id: number;
  identifier: number; // INTEGER in DB; if this can be a string, switch to string
  absolute_path: string;
  name: string;
  ftype: string;
  size: number;
  created: number | null; // UNIX timestamp, can be null
  modified: number | null;
  accessed: number | null;
  permissions: string | null;
  owner: string | null;
  group: string | null; // quoted in DB, must be renamed in TS
  display?: string | null;
  path_key: string;
  parent_path_key: string | null;
  depth: number;
  is_dir: number;
  sig_name: string | null;
  sig_mime: string | null;
  sig_exts: string | null;
  host_path?: string | null;
  metadata: string; // JSON as string from DB
}

export type FileQueryScope =
  | { kind: "root" }
  | { kind: "directory"; pathKey: string }
  | { kind: "file"; pathKey: string };

export type FilesystemTreeItemKind = "root" | "directory" | "file";

export interface FilesystemTreeItem {
  id: string;
  label: string;
  pathKey: string;
  parentPathKey: string | null;
  absolutePath: string;
  name: string;
  ftype: string;
  isDir: boolean;
  childrenCount: number;
  itemKind: FilesystemTreeItemKind;
}

export interface ArtifactWithFile {
  artifact_id: number;
  artifact_name: string;
  description: string;
  parser: string | null;
  tag: string;
  category: string;
  file_id: number;
  identifer: number;
  absolute_path: string;
  file_name: string;
  ftype: string;
  size: number;
  created: number;
  modified: number;
  accessed: number;
  permissions: string;
  owner: string;
  group: string;
  metadata: string;
  sig_name: string;
  sig_mime: string;
  sig_exts: string;
}

export type TimestampType = "created" | "accessed" | "modified";

export interface TimestampCount {
  type: TimestampType; // 'created' | 'accessed' | 'modified'
  ts: number; // epoch ms (what the chart expects)
  count: number; // number of files with this (bucketed) timestamp
}

export type ArtifactObjectRow = {
  id: number;
  evidence_id: number;
  partition_id: number;
  artifact_id: number;
  file_id: number | null;
  parser: string | null;
  kind: string | null;
  text: string | null;
  json: string | null;
};

export type WindowsEventRow = {
  id: number; // artifact_objects.id

  evidence_id: number;
  partition_id: number;
  file_id: number;

  event_record_id: number | null;
  ts: number | null; // epoch ms (derived from JSON timestamp)
  timestamp_iso: string | null;

  event_id: number | null;
  provider_name: string | null;
  provider_guid: string | null;

  channel: string | null;
  computer: string | null;

  level: number | null;
  task: number | null;
  opcode: number | null;
  keywords: string | null;

  user_sid: string | null;
  process_id: number | null;
  thread_id: number | null;

  json_raw: string | null;
};

export type WindowsEventCount = {
  ts: number; // epoch ms (bucket start)
  count: number;
};

/* -------------------------  Summary statistics  ---------------------- */

export interface FileStats {
  total_files: number;
  total_dirs: number;
  total_size: number;
  earliest_ts: number | null;
  latest_ts: number | null;
}

export interface MimeTypeCount {
  mime_category: string;
  count: number;
}

export interface ArtifactCategoryCount {
  category: string;
  count: number;
}

export interface TopSignature {
  sig_name: string;
  count: number;
}
