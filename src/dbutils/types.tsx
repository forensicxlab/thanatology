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
