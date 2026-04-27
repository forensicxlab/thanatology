import React, { useEffect, useState } from "react";
import Grid from "@mui/material/Grid";
import {
  Card,
  CardContent,
  CardMedia,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useSnackbar } from "../../../../SnackbarProvider";
import {
  Evidence,
  EvidenceImageRecord,
  MBRPartitionEntry,
  GPTPartitionEntry,
  PartitionEntry,
  LogicalPartitionEntry,
} from "../../../../../dbutils/types";
import {
  getEvidenceImages,
  getPartitions,
} from "../../../../../dbutils/sqlite";
import MBRPartition from "../../../common/MBRPartition";
import GPTPartition from "../../../common/GPTPartition";
import ProcessingTask from "../../../processing/ProcessingTask";
import FileSystem from "./FileSystem";
import LogicalPartition from "../../../common/LogicalPartition";
import FileStatistics from "./FileStatistics";

/* ------------------------------------------------------------------ */
interface SummaryProps {
  evidence: Evidence; // full evidence record
  partitionId: number | null;
}

/* ================================================================== */
const Summary: React.FC<SummaryProps> = ({ evidence, partitionId }) => {
  const [partition, setPartition] = useState<PartitionEntry | null>(null);
  const [images, setImages] = useState<EvidenceImageRecord[]>([]);
  const isFolderEvidence = evidence.type === "Folder";
  const [isMbr, setIsMbr] = useState<boolean>(false);
  const [isGPT, setIsGPT] = useState<boolean>(false);

  const [isLogical, setIsLogical] = useState<boolean>(false);

  const { display_message } = useSnackbar();

  /* --------------------------------------------------------------- */
  useEffect(() => {
    const fetchImages = async () => {
      try {
        const rows = await getEvidenceImages(evidence.id);
        setImages(rows);
      } catch (err: any) {
        console.error(err);
        display_message(
          "error",
          err.message ?? "Failed to load evidence images",
        );
      }
    };

    fetchImages();
  }, [evidence.id, display_message]);

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
          setIsGPT(false);
          setIsLogical(false);
        } else if (gptMatch) {
          setPartition(gptMatch);
          setIsMbr(false);
          setIsGPT(true);
          setIsLogical(false);
        } else if (logicalMatch) {
          setPartition(logicalMatch);
          setIsMbr(false);
          setIsGPT(false);
          setIsLogical(true);
        } else {
          setPartition(null);
          setIsMbr(false);
          setIsGPT(false);
          setIsLogical(false);
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
            evidence={evidence}
          />
          <Divider />
        </Grid>
      ) : (
        <></>
      )}
      {!isFolderEvidence && (
        <Grid size={12}>
          <FileSystem path={evidence.path} partition={partition} />
        </Grid>
      )}

      {/* File statistics — only once indexing has started */}
      {evidence.status > 1 && (
        <Grid size={12}>
          <FileStatistics
            evidenceId={evidence.id}
            partitionId={partition.id}
          />
        </Grid>
      )}

      {images.length > 0 && (
        <Grid size={12}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="h6" gutterBottom>
            Evidence Images
          </Typography>
          <Stack spacing={2}>
            {images.map((image) => (
              <Card key={image.id} variant="outlined">
                <Grid container spacing={0}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <CardMedia
                      component="img"
                      image={image.data_url}
                      alt={image.caption}
                      sx={{ height: "100%", minHeight: 240, objectFit: "cover" }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <CardContent>
                      <Typography variant="subtitle1">{image.caption}</Typography>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {image.source_kind === "camera"
                          ? "Captured with camera"
                          : "Imported from file"}
                      </Typography>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {image.file_name}
                      </Typography>
                    </CardContent>
                  </Grid>
                </Grid>
              </Card>
            ))}
          </Stack>
        </Grid>
      )}
    </Grid>
  );
};

export default Summary;
