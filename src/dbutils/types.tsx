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
    | "Procmon dump";
  path: string;
  description: string;
  status: number;
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
}

/** Master Boot Record sector */
export interface MBR {
  bootloader: number[];
  partition_table: MBRPartitionEntry[];
  boot_signature: number;
  bootloader_disam: string;
}

/* ---------------------------  GPT  ------------------------------------ */

export type PartitionEntry = MBRPartitionEntry | GPTPartitionEntry;

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
}

/* --------------------------------  Workflows  ------------------------ */

export interface ProcessedEvidenceMetadata {
  evidenceData: Evidence;
  diskImageFormat: string;
  selectedMbrPartitions?: MBRPartitionEntry[];
  selectedGptPartitions?: GPTPartitionEntry[];
  selectedLogicalPartition?: LogicalPartition;
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
}
export interface File {
  id: number;
  identifier: number;
  absolute_path: string;
  name: string;
  ftype: string;
  size: number;
  sig_mime: string;
  sig_name: string;
  metadata: string;
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
