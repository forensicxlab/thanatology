import React, { useState, useEffect } from "react";

import { invoke } from "@tauri-apps/api/core";
import type {
  PartitionEntry,
  FsInfo,
  LogicalPartitionEntry,
} from "../../../../../dbutils/types";
import { useSnackbar } from "../../../../SnackbarProvider";
import { Box, Paper, Typography } from "@mui/material";

import { GridView } from "@mui/icons-material";
import ExtfsLayout from "./ExtfsLayout";
import NtfsLayout from "./NtfsLayout";
import ExfatLayout from "./ExfatLayout";

interface FileSystemProps {
  path: string;
  partition: PartitionEntry;
}

function asciiFromBytes(arr?: number[]) {
  if (!Array.isArray(arr)) return "";
  return String.fromCharCode(...arr)
    .replace(/\0/g, "")
    .trim()
    .toUpperCase();
}

function oemString(meta: any) {
  const bytes =
    meta?.oem_id ?? meta?.oem_name ?? meta?.bpb?.oem_id ?? meta?.bpb?.oem_name;

  return asciiFromBytes(bytes);
}

function isLogicalPartitionEntry(
  p: PartitionEntry,
): p is LogicalPartitionEntry {
  return "size" in (p as any) && !("size_sectors" in (p as any));
}

const FileSystem: React.FC<FileSystemProps> = ({ path, partition }) => {
  const { display_message } = useSnackbar();
  const [fsInfo, setFsInfo] = useState<FsInfo>();

  useEffect(() => {
    const get_info = async () => {
      try {
        const logical = isLogicalPartitionEntry(partition);

        const info: FsInfo = await invoke("get_fs_info", {
          path,
          offset: logical ? 0 : (partition as any).first_byte_addr,
          size: logical ? partition.size : (partition as any).size_sectors,
        });

        setFsInfo(info);
        console.log(info.metadata);
      } catch (error) {
        console.error("Error when getting the filesystem layout:", error);
      }
    };

    get_info();
  }, [partition, path, display_message]);
  const oem = fsInfo ? oemString(fsInfo.metadata) : "";

  return (
    fsInfo && (
      <Paper elevation={3} sx={{ p: 2, borderLeft: "4px solid #ab47bc" }}>
        <Box display="flex" alignItems="center" mb={1}>
          <GridView color="secondary" sx={{ mr: 1 }} />
          <Typography variant="subtitle1">FileSystem</Typography>
        </Box>

        {oem.startsWith("NTFS") ? (
          <NtfsLayout metadata={fsInfo.metadata} />
        ) : oem.startsWith("EXFAT") ? (
          <ExfatLayout metadata={fsInfo.metadata} />
        ) : (
          <ExtfsLayout superblock={fsInfo.metadata} />
        )}
      </Paper>
    )
  );
};

export default FileSystem;
