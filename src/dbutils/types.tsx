export interface Evidence {
  id: number;
  case_id: number;
  name: string;
  type: "Disk image" | "Memory Image" | "Procmon dump";
  path: string;
  description: string;
  status: number;
}

export interface Case {
  id: number;
  name: string;
  description: string;
  collaborators: number[]; // Array of user IDs for collaborators
}

export interface FsInfo {
  block_size: number;
  filesystem_type: string;
  metadata: Object;
}

export interface Partitions {
  mbr: MBR;
  ebr: MBRPartitionEntry[];
  gpt: GPT;
}

export interface GPT {
  header: GPTHeader;
  partition_entries: GPTPartitionEntry[];
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

export interface GPTPartitionEntry {
  partition_guid: number[];
  partition_guid_string: string;
  partition_type_guid: number[];
  partition_type_guid_string: string;
  starting_lba: number;
  ending_lba: number;
  attributes: number;
  description: string;
  partition_name: string;
}

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

export interface ProcessDiskImage {
  evidence: Evidence;
  imageFormat: string; // RAW, EWF, ...
  isFormatCompatible: boolean;
  partitions: Partitions;
  compatibleModules: Module[]; // Fetch this from our database
  selectedModules: Module[];
  status: string;
  startDate: Date;
  endDate: Date;
}

export interface ProcessedEvidenceMetadata {
  evidenceData: Evidence;
  diskImageFormat: string;
  selectedMbrPartitions: MBRPartitionEntry[];
  selectedGptPartitions: GPTPartitionEntry[];
  extractionModules: Module[];
}

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

export interface MBR {
  bootloader: number[];
  partition_table: [
    MBRPartitionEntry,
    MBRPartitionEntry,
    MBRPartitionEntry,
    MBRPartitionEntry,
  ]; // Partition table (max 4 entries)
  boot_signature: number;
  bootloader_disam: String;
}

// Define the LinuxFile interface
export interface LinuxFile {
  id: number;
  evidence_id: number;
  absolute_path: string;
  filename: string;
  parent_directory: string;
  inode_number: number;
  file_type: string;
  size_bytes: number;
  owner_uid: number;
  group_gid: number;
  permissions_mode: number;
  hard_link_count: number;
  access_time: string;
  modification_time: string;
  change_time: string;
  creation_time: string;
  extended_attributes: string;
  symlink_target: string;
  mount_point: string;
  filesystem_type: string;
}
