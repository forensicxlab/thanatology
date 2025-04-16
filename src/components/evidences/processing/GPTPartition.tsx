import React from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import { GPTPartitionEntry } from "../../../dbutils/types";

interface GPTPartitionProps {
  gptPartition: GPTPartitionEntry;
  index: number | null;
}

const GPTPartition: React.FC<GPTPartitionProps> = ({ gptPartition, index }) => {
  return (
    <Paper
      elevation={3}
      sx={{
        p: 2,
        borderLeft: "4px solid transparent",
      }}
    >
      <Box display="flex" alignItems="center" mb={1}>
        <StorageIcon color="primary" sx={{ mr: 1 }} />
        {index ? (
          <Typography variant="subtitle1">Partition #{index + 1}</Typography>
        ) : (
          <Typography variant="subtitle1">Partition</Typography>
        )}
      </Box>
      <Typography variant="body2">
        <strong>GUID:</strong> {`${gptPartition.partition_guid_string}`}
      </Typography>
      <Typography variant="body2">
        <strong>Type GUID:</strong>{" "}
        {`${gptPartition.partition_type_guid_string}`}
      </Typography>
      <Typography variant="body2">
        <strong>Description:</strong> {gptPartition.description}
      </Typography>
      <Typography variant="body2">
        <strong>Start LBA:</strong>{" "}
        {`0x${gptPartition.starting_lba.toString(16).toUpperCase()}`}
      </Typography>
      <Typography variant="body2">
        <strong>End LBA:</strong>{" "}
        {`0x${gptPartition.ending_lba.toString(16).toUpperCase()}`}
      </Typography>
    </Paper>
  );
};

export default GPTPartition;
