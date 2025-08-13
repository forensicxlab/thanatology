import React, { useState, useEffect } from "react";

import { invoke } from "@tauri-apps/api/core";
import { PartitionEntry, FsInfo } from "../../../../../dbutils/types";
import { useSnackbar } from "../../../../SnackbarProvider";
import { Box, Paper, Typography } from "@mui/material";

import { GridView } from "@mui/icons-material";
import ExtfsLayout from "./ExtfsLayout";

interface FileSystemProps {
  path: String;
  partition: PartitionEntry;
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
          size: partition.size_sectors,
        });
        setFsInfo(info);
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
          borderLeft: "4px solid #ab47bc",
        }}
      >
        <Box display="flex" alignItems="center" mb={1}>
          <GridView color="secondary" sx={{ mr: 1 }} />
          <Typography variant="subtitle1">FileSystem</Typography>
        </Box>

        <ExtfsLayout superblock={fsInfo.metadata} />
      </Paper>
    )
  );
};

export default FileSystem;
