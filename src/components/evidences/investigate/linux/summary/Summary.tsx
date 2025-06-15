import React, { useEffect, useState } from "react";
import Grid from "@mui/material/Grid";
import { useSnackbar } from "../../../../SnackbarProvider";
import {
  Evidence,
  MBRPartitionEntry,
  GPTPartitionEntry,
} from "../../../../../dbutils/types";
import { getSelectedPartitions } from "../../../../../dbutils/sqlite";

import MBRPartition from "../../../processing/MBRPartition";
import GPTPartition from "../../../processing/GPTPartition";
import FileSystem from "./FileSystem";

interface SummaryProps {
  evidence: Evidence;
  partitionId: number | null;
}

type PartitionEntry = MBRPartitionEntry | GPTPartitionEntry;

const Summary: React.FC<SummaryProps> = ({ evidence, partitionId }) => {
  const [partition, setPartition] = useState<PartitionEntry | null>(null);
  const [isMbr, setIsMbr] = useState<boolean>(true);
  const { display_message } = useSnackbar();

  useEffect(() => {
    if (!partitionId) {
      setPartition(null);
      return;
    }

    const fetchPartition = async () => {
      try {
        /* The helper always returns both kinds in separate arrays      *
         * so we just pick the first match for the requested type.      */
        const { mbrRows, gptRows } = await getSelectedPartitions(
          partitionId,
          null,
        );

        if (mbrRows.length > 0) {
          setPartition(mbrRows?.[0] ?? null);
        } else {
          setPartition(gptRows?.[0] ?? null);
          setIsMbr(false);
        }
      } catch (err: any) {
        console.error(err);
        display_message("error", err.message ?? "Failed to load partition");
      }
    };

    fetchPartition();
  }, [partitionId, display_message]);

  if (!partition || !evidence) return null;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
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

      <Grid size={{ xs: 12, md: 6 }}>
        {/* <FileSystem path={evidence.path} partition={partition} /> */}
      </Grid>
    </Grid>
  );
};

export default Summary;
