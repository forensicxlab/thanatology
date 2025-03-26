import React, { useState, useEffect } from "react";

import { invoke } from "@tauri-apps/api/core";
import { MBRPartitionEntry, FsInfo } from "../../../../../dbutils/types";
import { useSnackbar } from "../../../../SnackbarProvider";
import { Box, Paper, Typography } from "@mui/material";

interface FileSystemProps {
  path: String;
  partition: MBRPartitionEntry;
}

const FileSystem: React.FC<FileSystemProps> = ({ path, partition }) => {
  const { display_message } = useSnackbar();
  const [fsInfo, setFsInfo] = useState<FsInfo>();

  useEffect(() => {
    const get_info = async () => {
      try {
        const info: FsInfo = await invoke("get_fs_info", {
          path: path,
          offset: partition.first_byte_addr,
          size: partition.sector_size * partition.size_sectors,
        });
        setFsInfo(info);
        console.log(info);
      } catch (error) {
        console.error("Error checking evidence existence:", error);
      }
    };
    get_info();
  }, [partition, path, display_message]);

  return (
    fsInfo && (
      <Paper
        elevation={3}
        sx={{
          p: 2,
          borderRight: "4px solid #1976d2",
        }}
      >
        <Typography variant="body2">
          <strong>Type:</strong> {fsInfo.filesystem_type}
        </Typography>
        <Typography variant="body2">
          <strong>Size of a block/cluster: </strong>
          {fsInfo.block_size} bytes
        </Typography>
      </Paper>
    )
  );
};

export default FileSystem;
