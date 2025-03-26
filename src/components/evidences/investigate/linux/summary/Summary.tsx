import React, { useState, useEffect } from "react";
import { Card, Box, Typography, CardContent, Divider } from "@mui/material";
import { useSnackbar } from "../../../../SnackbarProvider";
import Grid from "@mui/material/Grid2";
import { getPartitionById } from "../../../../../dbutils/sqlite";
import { Evidence, MBRPartitionEntry } from "../../../../../dbutils/types";
import Partition from "../../../processing/Partition";
import FileSystem from "./FileSystem";
interface SummaryProps {
  evidence: Evidence;
  partition_id: number;
}

const Summary: React.FC<SummaryProps> = ({ evidence, partition_id }) => {
  const [partition, setPartition] = useState<MBRPartitionEntry | null>(null);
  const { display_message } = useSnackbar();

  useEffect(() => {
    if (!partition_id) return;

    const fetchPartition = async () => {
      try {
        const p = await getPartitionById(null, partition_id);
        setPartition(p);
      } catch (error: any) {
        display_message("error", error.message);
      }
    };

    fetchPartition();
  }, [partition_id, display_message]);

  return (
    partition &&
    evidence && (
      <Grid container spacing={2}>
        <Grid size={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h5" component="div" sx={{ mb: 1 }}>
                Partition
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <Partition partition={partition} index={partition_id - 1} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={6}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h5" component="div" sx={{ mb: 1 }}>
                FileSystem
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <FileSystem path={evidence.path} partition={partition} />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h5" component="div" sx={{ mb: 1 }}>
                Module(s) Metadata
              </Typography>
              <Divider sx={{ mb: 1 }} />
              blabla
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    )
  );
};

export default Summary;
