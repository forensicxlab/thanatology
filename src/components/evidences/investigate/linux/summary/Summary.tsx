import React, { useEffect, useState } from "react";
import Grid from "@mui/material/Grid";
import { Box, Divider } from "@mui/material";
import { useSnackbar } from "../../../../SnackbarProvider";
import {
  Evidence,
  MBRPartitionEntry,
  GPTPartitionEntry,
} from "../../../../../dbutils/types";
import { getSelectedPartitions } from "../../../../../dbutils/sqlite";

import MBRPartition from "../../../common/MBRPartition";
import GPTPartition from "../../../common/GPTPartition";
import ProcessingTask from "../../../processing/ProcessingTask";
import FileSystem from "./FileSystem";

/* ------------------------------------------------------------------ */
interface SummaryProps {
  evidence: Evidence; // full evidence record
  partitionId: number | null; // DB id of the partition to show
}

type PartitionEntry = MBRPartitionEntry | GPTPartitionEntry;

/* ================================================================== */
const Summary: React.FC<SummaryProps> = ({ evidence, partitionId }) => {
  const [partition, setPartition] = useState<PartitionEntry | null>(null);
  const [isMbr, setIsMbr] = useState<boolean>(true);
  const { display_message } = useSnackbar();

  /* --------------------------------------------------------------- */
  useEffect(() => {
    if (partitionId === null) {
      setPartition(null);
      return;
    }

    const fetchPartition = async () => {
      try {
        const { mbrRows, gptRows } = await getSelectedPartitions(
          evidence.id,
          null,
        );

        const mbrMatch = mbrRows.find((p) => p.id === partitionId);
        const gptMatch = gptRows.find((p) => p.id === partitionId);

        if (mbrMatch) {
          setPartition(mbrMatch);
          setIsMbr(true);
        } else if (gptMatch) {
          setPartition(gptMatch);
          setIsMbr(false);
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
      <Grid size={{ lg: 6, md: 12, sm: 12, xs: 12 }}>
        <Grid container spacing={2}>
          <Grid size={12}>
            {isMbr ? (
              <MBRPartition
                mbrPartition={partition as MBRPartitionEntry}
                index={0}
              />
            ) : (
              <GPTPartition
                gptPartition={partition as GPTPartitionEntry}
                index={0}
              />
            )}
          </Grid>
          <Grid size={12}>
            <FileSystem
              path={evidence.path}
              partition={partition as MBRPartitionEntry}
            />
          </Grid>
        </Grid>
      </Grid>

      {evidence.status > 1 ? (
        <Grid size={{ lg: 6, md: 12, sm: 12, xs: 12 }}>
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
    </Grid>
  );
};

export default Summary;
