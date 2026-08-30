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

export interface TimelineEventCount {
  event_type: string;
  ts: number;    // epoch ms
  count: number;
}

export interface TimelineEvent {
  id: number;
  ts: number;
  source: string;
  event_type: string;
  description: string | null;
  actor: string | null;
  file_id: number | null;
  artifact_object_id: number | null;
  file_name: string | null;
  file_path: string | null;
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

/** Fixed, index-friendly fields exposed by the file-scoped parsed-object grid. */
export type ParsedArtefactObjectRow = ArtifactObjectRow & {
  created_at: number | null;
  source_path: string | null;
  source_table: string | null;
  source_record: string | null;
  source_role: string | null;
  source_rowid: string | number | null;
  source_schema: string | null;
};

export type ParsedArtefactObjectSortField =
  | "id"
  | "parser"
  | "kind"
  | "artifact_id"
  | "text"
  | "source_path"
  | "created_at";

export type ParsedArtefactObjectsPageQuery = {
  evidenceId: number;
  partitionId: number;
  /** `system_files.id`, as stored in `artifact_objects.file_id`. */
  fileId: number;
  offset: number;
  limit: number;
  search?: string;
  sortField?: ParsedArtefactObjectSortField;
  sortDirection?: "asc" | "desc";
  /** Reuse a count already obtained for the same file/search scope. */
  knownRowCount?: number;
};

export type ParsedArtefactObjectsPage = {
  rows: ParsedArtefactObjectRow[];
  rowCount: number;
};

// ---- iOS mobile artefact rows (parsed from artifact_objects.json) ----

export type IosCallRow = {
  id: number;
  ts: number | null; // unix ms
  direction: string | null; // incoming | outgoing | unknown
  answered: number | null; // 0/1
  missed: number | null; // 0/1
  party_name: string | null;
  party_address: string | null;
  duration_seconds: number | null;
  call_type: string | null; // type_family
  service_provider: string | null;
  json: string | null;
};

export type IosContactRow = {
  id: number;
  display_name: string | null;
  organization: string | null;
  job_title: string | null;
  phones: string | null; // JSON array string: [{value,label}]
  emails: string | null; // JSON array string: [{value,label}]
  note: string | null;
  created_ms: number | null;
  modified_ms: number | null;
  json: string | null;
};

export type IosBrowserVisitRow = {
  id: number;
  ts: number | null; // unix ms
  url: string | null;
  host: string | null;
  title: string | null;
  is_redirect: number | null; // 0/1
  load_successful: number | null; // 0/1
  json: string | null;
};

// ---- Cross-platform browser activity (artifact-tag scoped) ----

export type BrowserActivitySortDirection = "asc" | "desc";

export type BrowserActivityQuery = {
  evidenceId: number;
  partitionId: number;
  /** Exact artifacts.tag value (Safari, Chrome, Edge, Brave, Firefox, ...). */
  tag: string;
  offset: number;
  limit: number;
  search?: string;
  sortField?: string;
  sortDirection?: BrowserActivitySortDirection;
};

export type BrowserVisitRow = {
  id: number;
  tag: string;
  parser: string;
  platform: string | null;
  ts: number | null;
  title: string | null;
  url: string | null;
  host: string | null;
  transition: string | null;
  is_redirect: number | null;
  load_successful: number | null;
  source_path: string | null;
  json: string | null;
};

export type BrowserSiteRow = {
  id: number;
  tag: string;
  parser: string;
  title: string | null;
  url: string | null;
  host: string | null;
  visit_count: number;
  first_visit_ms: number | null;
  last_visit_ms: number | null;
  source_path: string | null;
  /** Representative parser record retained for provenance inspection. */
  json: string | null;
};

export type BrowserDownloadRow = {
  id: number;
  tag: string;
  parser: string;
  start_ms: number | null;
  end_ms: number | null;
  target_path: string | null;
  url: string | null;
  host: string | null;
  received_bytes: number | null;
  total_bytes: number | null;
  source_path: string | null;
  json: string | null;
};

// ---- Focused macOS artifact panels --------------------------------------

export type MacosArtifactPanel =
  | "recent_items"
  | "keychain"
  | "quarantine"
  | "persistence"
  | "login_configuration"
  | "network_configuration";

export type MacosArtifactQuery = {
  evidenceId: number;
  partitionId: number;
  panel: MacosArtifactPanel;
  /** Exact catalog tag selected by CategoryTagWorkspace. */
  tag: string;
  /** Exact catalog category, preserving user/system keychain separation. */
  category: "Users" | "System" | "Network";
  offset: number;
  limit: number;
  search?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
};

/**
 * One bounded, parser-neutral page row. The six V4 panels give the generic
 * value slots stable forensic labels while retaining the complete JSON record.
 */
export type MacosArtifactRow = {
  id: number;
  artifact_id: number;
  file_id: number | null;
  fs_identifier: number | null;
  file_size: number | null;
  file_path: string | null;
  source_path: string | null;
  tag: string;
  category: string;
  parser: string;
  kind: string;
  record_type: string | null;
  text: string | null;
  timestamp_ms: number | null;
  secondary_timestamp_ms: number | null;
  primary_value: string | null;
  secondary_value: string | null;
  tertiary_value: string | null;
  detail_value: string | null;
  state_value: string | null;
  numeric_value: number | null;
  json: string | null;
};

export type MacosArtifactPage = {
  rows: MacosArtifactRow[];
  rowCount: number;
};

// ---- Spotlight Explore --------------------------------------------------

export type SpotlightSortField =
  | "updated_ms"
  | "name"
  | "path"
  | "content_type"
  | "item_kind"
  | "source_store";

export type SpotlightResolutionStatus = "resolved" | "not_indexed" | "no_path";

export type SpotlightExploreQuery = {
  evidenceId: number;
  partitionId: number;
  offset: number;
  limit: number;
  /** Trigram search over the normalized item name and reconstructed path. */
  search?: string;
  contentType?: string;
  itemKind?: string;
  sourceStore?: string;
  pathRoot?: string;
  startMs?: number | null;
  endMs?: number | null;
  sortField?: SpotlightSortField;
  sortDirection?: "asc" | "desc";
  /** Reuse the current filtered count while only page or sort changes. */
  knownRowCount?: number;
};

export type SpotlightExploreRow = {
  id: number;
  parser: string;
  kind: string;
  spotlight_id: number | null;
  parent_id: number | null;
  item_id: number | null;
  flags: number | null;
  name: string | null;
  path: string | null;
  content_type: string | null;
  item_kind: string | null;
  updated_ms: number | null;
  source_store: string | null;
  resolution_status: SpotlightResolutionStatus;
  resolved_file_id: number | null;
  resolved_identifier: number | null;
  resolved_size: number | null;
  resolved_absolute_path: string | null;
  json: string;
};

export type SpotlightExplorePage = {
  rows: SpotlightExploreRow[];
  rowCount: number;
};

export type SpotlightFacet = {
  value: string;
  count: number;
};

export type SpotlightExploreFacets = {
  contentTypes: SpotlightFacet[];
  itemKinds: SpotlightFacet[];
  sourceStores: SpotlightFacet[];
  pathRoots: SpotlightFacet[];
};

export type IosLocationFixRow = {
  id: number;
  ts: number | null; // unix ms
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  speed: number | null; // m/s, null when unavailable
  course: number | null; // degrees, null when unavailable
  horizontal_accuracy: number | null; // meters
  json: string | null;
};

export type IosCalendarEventRow = {
  id: number;
  start_ms: number | null;
  end_ms: number | null;
  summary: string | null;
  all_day: number | null; // 0/1
  status: string | null;
  availability: string | null;
  location_title: string | null;
  location_address: string | null;
  url: string | null;
  has_attendees: number | null; // 0/1
  json: string | null;
};

export type IosMailMessageRow = {
  id: number;
  date_received_ms: number | null;
  date_sent_ms: number | null;
  subject: string | null;
  from_address: string | null;
  to_addresses: string | null; // comma-joined
  mailbox: string | null;
  read: number | null; // 0/1
  flagged: number | null; // 0/1
  deleted: number | null; // 0/1
  size: number | null;
  json: string | null;
};

export type IosNoteRow = {
  id: number;
  title: string | null;
  snippet: string | null;
  folder: string | null;
  created_ms: number | null;
  modified_ms: number | null;
  json: string | null;
};

export type IosTccGrantRow = {
  id: number;
  client: string | null;
  client_type: string | null;
  service: string | null;
  service_name: string | null;
  decision: string | null;
  auth_reason_code: number | null;
  indirect_object: string | null;
  last_modified_ms: number | null;
  json: string | null;
};

export type IosInteractionRow = {
  id: number;
  start_ms: number | null;
  end_ms: number | null;
  bundle_id: string | null;
  target_bundle_id: string | null;
  direction: string | null;
  counterpart_name: string | null;
  counterpart_id: string | null;
  recipient_count: number | null;
  json: string | null;
};

export type IosDataUsageRow = {
  id: number;
  ts: number | null;
  process_name: string | null;
  bundle_name: string | null;
  wifi_in: number | null;
  wifi_out: number | null;
  wwan_in: number | null;
  wwan_out: number | null;
  json: string | null;
};

export type IosPhotoAssetRow = {
  id: number;
  filename: string | null;
  relative_path: string | null;
  kind: string | null; // image | video | unknown
  created_ms: number | null; // capture date
  added_ms: number | null; // added to library
  trashed_ms: number | null;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  favorite: number | null; // 0/1
  hidden: number | null; // 0/1
  trashed: number | null; // 0/1
  json: string | null;
  /** Resolved system_files row for the asset's bytes; null when not on disk. */
  file_id: number | null;
  host_path: string | null;
  /**
   * The device's own pre-rendered JPEG thumbnail for this asset, when present.
   * Serving it instead of the original avoids decoding a multi-megabyte HEIC
   * just to paint a tile.
   */
  thumb_file_id: number | null;
  thumb_host_path: string | null;
};

export type IosActivityEventRow = {
  id: number;
  start_ms: number | null;
  end_ms: number | null;
  stream: string | null;
  family: string | null;
  bundle_id: string | null;
  summary: string | null;
  value_int: number | null;
  duration_seconds: number | null;
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

export type DiscussionConversationRow = {
  id: string;
  title: string | null;
  subtitle: string | null;
  chat_jid: string | null;
  source_path: string | null;
  message_count: number;
  /** Messages inside the active global time window. */
  in_window_count: number;
  incoming_count: number;
  outgoing_count: number;
  media_count: number;
  first_timestamp_ms: number | null;
  last_timestamp_ms: number | null;
};

export type DiscussionAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "location"
  | "contact"
  | "sticker"
  | "unknown";

export type DiscussionAttachmentRow = {
  id: string;
  kind: DiscussionAttachmentKind;
  mime: string | null;
  file_name: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  local_path: string | null;
  remote_url: string | null;
  thumbnail_path: string | null;
  file_id: number | null;
  fs_identifier: number | null;
  absolute_path: string | null;
  host_path: string | null;
  sig_mime: string | null;
  preview_mime: string | null;
  preview_base64: string | null;
};

export type DiscussionMessageRow = {
  id: number;
  /** Parser is part of message identity because source rowids are per database. */
  parser: string;
  message_rowid: number | null;
  conversation_id: string;
  timestamp_ms: number | null;
  direction: string | null;
  sender: string | null;
  sender_jid: string | null;
  recipient_jid: string | null;
  text: string | null;
  type_family: string | null;
  type_code: number | null;
  status_code: number | null;
  media_path: string | null;
  media_file_size: number | null;
  media_mime: string | null;
  media_url: string | null;
  source_path: string | null;
  attachments: DiscussionAttachmentRow[];
  json_raw: string | null;
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
