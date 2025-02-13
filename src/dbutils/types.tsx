export interface EvidenceData {
  evidenceName: string;
  evidenceType: "Disk image" | "Memory Image" | "Procmon dump";
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
  imageFormat: string;
  isFormatCompatible: boolean;
  partitions: Partition[];
  compatibleModules: Module[];
  selectedModules: Module[];
  status: string;
  startDate: Date;
  endDate: Date;
}
