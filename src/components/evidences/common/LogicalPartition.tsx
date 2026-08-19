import React from "react";
import { Paper, Typography, Box } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import { LogicalPartitionEntry } from "../../../dbutils/types";

interface LogicalPartitionProps {
  logicalPartition: LogicalPartitionEntry;
  index: number | null;
  realImageSize?: number;
}

const LogicalPartition: React.FC<LogicalPartitionProps> = ({
  logicalPartition,
  index,
  realImageSize,
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
        <strong>Description:</strong> {`${logicalPartition.description}`}
      </Typography>
      <Typography variant="body2">
        <strong>Size:</strong>{" "}
        {realImageSize != null && realImageSize > 0
          ? `0x${realImageSize.toString(16).toUpperCase()}`
          : `0x${logicalPartition.size.toString(16).toUpperCase()}`}
      </Typography>
    </Paper>
  );
};

export default LogicalPartition;
