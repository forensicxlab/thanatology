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
//import FileSystem from "./FileSystem"; // keep commented for now

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
    /* no partition selected → clear state */
    if (partitionId === null) {
      setPartition(null);
      return;
    }

    const fetchPartition = async () => {
      try {
        /* 1️⃣  Fetch **all** selected partitions for THIS evidence     */
        const { mbrRows, gptRows } = await getSelectedPartitions(
          evidence.id, //  ⬅️  correct argument
          null,
        );

        /* 2️⃣  Find the specific row by ID                            */
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
    <Grid container spacing={2}>
      <Grid sx={{ xs: 12, md: 12, lg: 12 }}>
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

      <Grid sx={{ xs: 12, md: 12, lg: 12 }}>
        {/* <FileSystem path={evidence.path} partition={partition} /> */}
      </Grid>
    </Grid>
  );
};

export default Summary;
