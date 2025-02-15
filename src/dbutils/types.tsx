export interface EvidenceData {
  evidenceName: string;
  evidenceType: "Disk image" | "Memory Image" | "Procmon dump";
  evidenceLocation: string;
  evidenceDescription: string;
  sealNumber: string;
  sealingDateTime: string;
  sealingLocation: string;
  sealingPerson: string;
  sealReason: string;
  sealReferenceFile: File | null;
}

export interface Partition {
  //TODO Take the fields from the exhume module
}

export interface Module {
  name: String;
  //...TODO
}

export interface ProcessDiskImage {
  evidence: EvidenceData;
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
  evidenceData: EvidenceData;
  diskImageFormat: string;
  selectedPartition: MBRPartitionEntry;
  extractionModules: ExtractionModule[];
}

export interface MBRPartitionEntry {
  boot_indicator: number;
  start_chs: [number, number, number];
  partition_type: number;
  end_chs: [number, number, number];
  start_lba: number;
  size_sectors: number;
  sector_size: number;
  first_byte_addr: number;
}

export interface ExtractionModule {
  id: string;
  name: string;
  description: string;
}
