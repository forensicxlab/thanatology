import React from "react";
import { Paper, Typography, Box, Chip } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import { MBRPartitionEntry } from "../../../dbutils/types";

interface MBRPartitionProps {
  mbrPartition: MBRPartitionEntry;
  index: number | null;
}

const MBRPartition: React.FC<MBRPartitionProps> = ({ mbrPartition, index }) => {
  const isBootable =
    mbrPartition.boot_indicator === 128 || mbrPartition.boot_indicator === 80;
  return (
    <Paper
      elevation={3}
      sx={{
        p: 2,
        borderLeft: isBootable ? "4px solid #1976d2" : "4px solid transparent",
      }}
    >
      <Box display="flex" alignItems="center" mb={1}>
        <StorageIcon color="primary" sx={{ mr: 1 }} />
        {index ? (
          <Typography variant="subtitle1">Partition #{index + 1}</Typography>
        ) : (
          <Typography variant="subtitle1">Partition</Typography>
        )}
        {isBootable && (
          <Chip
            label="Bootable"
            color="secondary"
            size="small"
            sx={{ ml: 1 }}
          />
        )}
      </Box>
      <Typography variant="body2">
        <strong>Type:</strong>{" "}
        {`0x${mbrPartition.partition_type.toString(16).toUpperCase()}`}
      </Typography>
      <Typography variant="body2">
        <strong>Description:</strong> {mbrPartition.description}
      </Typography>
      <Typography variant="body2">
        <strong>Start LBA:</strong>{" "}
        {`0x${mbrPartition.start_lba.toString(16).toUpperCase()}`}
      </Typography>
      <Typography variant="body2">
        <strong>Size (sectors):</strong>{" "}
        {`0x${mbrPartition.size_sectors.toString(16).toUpperCase()}`}
      </Typography>
      <Typography variant="body2">
        <strong>Sector Size:</strong> {mbrPartition.sector_size} bytes
      </Typography>
    </Paper>
  );
};

export default MBRPartition;
