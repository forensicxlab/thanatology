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

export interface Partition {
  //TODO Take the fields from the exhume module
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
  partitions: Partition[];
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

export interface Partitions {
  mbr: MBR;
  ebr: MBRPartitionEntry[];
  //Todo: Add GPT
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
