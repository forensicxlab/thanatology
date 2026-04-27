import React from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import { LogicalPartitionEntry } from "../../../dbutils/types";

interface LogicalPartitionProps {
  logicalPartition: LogicalPartitionEntry;
  index: number | null;
}

const LogicalPartition: React.FC<LogicalPartitionProps> = ({
  logicalPartition,
  index,
}) => {
  return (
    <Paper
      elevation={3}
      sx={{
        p: 2,
        borderLeft: "4px solid transparent",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          mb: 1
        }}>
        <StorageIcon color="primary" sx={{ mr: 1 }} />
        {index ? (
          <Typography variant="subtitle1">Partition #{index + 1}</Typography>
        ) : (
          <Typography variant="subtitle1">Partition</Typography>
        )}
      </Box>
      <Typography variant="body2">
        <Typography variant="body2">
          <strong>Description:</strong> {`${logicalPartition.description}`}
        </Typography>
        <strong>Size:</strong>{" "}
        {`0x${logicalPartition.size.toString(16).toUpperCase()}`}
      </Typography>
    </Paper>
  );
};

export default LogicalPartition;
