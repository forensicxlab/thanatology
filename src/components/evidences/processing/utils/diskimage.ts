import { ProcessedEvidenceMetadata } from "../../../../dbutils/types";
import { invoke } from "@tauri-apps/api/core";

// Called when user clicks "Launch Processing Action"
export async function start_processing(metadata: ProcessedEvidenceMetadata) {
  try {
    console.log(metadata);
    const resp: string = await invoke("default_processing_action", {
      evidenceId: metadata.evidenceData.id,
    });
  } catch (err) {
    console.error("Error launching disk image processing:", err);
  }
}

export async function start_processing_from_id(evidence_id: number) {
  try {
    // const resp: string = await invoke("default_processing_action", {
    //   evidenceId: metadata.evidenceData.id,
    // });
    console.log("TODO for evidence: ", evidence_id);
  } catch (err) {
    console.error("Error launching disk image processing:", err);
  }
}
