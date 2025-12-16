import React, { useEffect, useState } from "react";
import Grid from "@mui/material/Grid";
import { Divider } from "@mui/material";
import { useSnackbar } from "../../../../SnackbarProvider";
import {
  Evidence,
  MBRPartitionEntry,
  GPTPartitionEntry,
  PartitionEntry,
  LogicalPartitionEntry,
} from "../../../../../dbutils/types";
import {
  getPartitions,
  getSelectedPartitions,
} from "../../../../../dbutils/sqlite";
import MBRPartition from "../../../common/MBRPartition";
import GPTPartition from "../../../common/GPTPartition";
import ProcessingTask from "../../../processing/ProcessingTask";
import FileSystem from "./FileSystem";
import LogicalPartition from "../../../common/LogicalPartition";

/* ------------------------------------------------------------------ */
interface SummaryProps {
  evidence: Evidence; // full evidence record
  partitionId: number | null;
}

/* ================================================================== */
const Summary: React.FC<SummaryProps> = ({ evidence, partitionId }) => {
  const [partition, setPartition] = useState<PartitionEntry | null>(null);
  const [isMbr, setIsMbr] = useState<boolean>(false);
  const [isGPT, setIsGPT] = useState<boolean>(false);

  const [isLogical, setIsLogical] = useState<boolean>(false);

  const { display_message } = useSnackbar();

  /* --------------------------------------------------------------- */
  useEffect(() => {
    if (partitionId === null) {
      setPartition(null);
      return;
    }

    const fetchPartition = async () => {
      try {
        const { mbrRows, gptRows, logicalRows } = await getPartitions(
          evidence.id,
        );

        console.log(logicalRows);

        const mbrMatch = mbrRows.find((p) => p.id === partitionId);
        const gptMatch = gptRows.find((p) => p.id === partitionId);
        const logicalMatch = logicalRows.find((p) => p.id === partitionId);

        if (mbrMatch) {
          setPartition(mbrMatch);
          setIsMbr(true);
        } else if (gptMatch) {
          setPartition(gptMatch);
          setIsGPT(false);
        } else if (logicalMatch) {
          setPartition(logicalMatch);
          setIsLogical(true);
        } else {
          setPartition(null);
          display_message("warning", "Partition not found for this evidence");
        }
      } catch (err: any) {
        console.error(err);
        display_message("error", err.message ?? "Failed to load partition");
      }
    };

    fetchPartition();
  }, [partitionId, evidence.id, display_message]);

  /* --------------------------------------------------------------- */
  if (!partition) return null;

  return (
    <Grid container spacing={1}>
      <Grid size={6}>
        {isMbr && (
          <MBRPartition
            mbrPartition={partition as MBRPartitionEntry}
            index={0}
          />
        )}

        {isGPT && (
          <GPTPartition
            gptPartition={partition as GPTPartitionEntry}
            index={0}
          />
        )}
        {isLogical && (
          <LogicalPartition
            logicalPartition={partition as LogicalPartitionEntry}
            index={0}
          />
        )}
      </Grid>
      {evidence.status > 1 ? (
        <Grid size={6}>
          <ProcessingTask
            status={evidence.status}
            evidenceName={evidence.name}
            evidenceId={evidence.id}
          />
          <Divider />
        </Grid>
      ) : (
        <></>
      )}

      <Grid size={12}>
        <FileSystem path={evidence.path} partition={partition} />
      </Grid>
    </Grid>
  );
};

export default Summary;
