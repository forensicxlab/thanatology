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
import ApfsLayout from "./ApfsLayout";

interface FileSystemProps {
  path: string;
  partition: PartitionEntry;
  onImageSizeResolved?: (size: number) => void;
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = (bytes / Math.pow(1024, i)).toFixed(2);
  return `${val} ${units[i]} (0x${bytes.toString(16).toUpperCase()})`;
}

function isLogicalPartitionEntry(
  p: PartitionEntry,
): p is LogicalPartitionEntry {
  return "size" in (p as any) && !("size_sectors" in (p as any));
}

const FileSystem: React.FC<FileSystemProps> = ({ path, partition, onImageSizeResolved }) => {
  const { display_message } = useSnackbar();
  const [fsInfo, setFsInfo] = useState<FsInfo>();

  useEffect(() => {
    const get_info = async () => {
      try {
        const logical = isLogicalPartitionEntry(partition);

        const info: FsInfo = await invoke("get_fs_info", {
          path,
          offset: logical ? 0 : (partition as any).first_byte_addr,
          size: logical
            ? Math.ceil(partition.size / 512)
            : (partition as any).size_sectors,
          fvek: (partition as any).fvek || null,
        });

        setFsInfo(info);
        if (info.image_size && info.image_size > 0) {
          onImageSizeResolved?.(info.image_size);
        }
        console.log(info.metadata);
      } catch (error) {
        console.error("Error when getting the filesystem layout:", error);
      }
    };

    get_info();
  }, [partition, path, display_message]);
  const oem = fsInfo ? oemString(fsInfo.metadata) : "";
  const fsType = fsInfo?.filesystem_type?.toLowerCase() ?? "";

  function renderLayout() {
    if (fsType.includes("apple") || fsType === "apfs") {
      return <ApfsLayout metadata={fsInfo!.metadata} />;
    }
    if (oem.startsWith("NTFS") || fsType.includes("ntfs")) {
      return <NtfsLayout metadata={fsInfo!.metadata} />;
    }
    if (oem.startsWith("EXFAT") || fsType.includes("exfat")) {
      return <ExfatLayout metadata={fsInfo!.metadata} />;
    }
    return <ExtfsLayout superblock={fsInfo!.metadata} />;
  }

  return (fsInfo && (<Paper elevation={3} sx={{ p: 2, borderLeft: "4px solid #ab47bc" }}>
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        mb: 1
      }}>
      <GridView color="secondary" sx={{ mr: 1 }} />
      <Typography variant="subtitle1">FileSystem</Typography>
    </Box>
    {fsInfo.image_size != null && fsInfo.image_size > 0 && (
      <Typography variant="body2" sx={{ mb: 1 }}>
        <strong>Image Size:</strong> {formatBytes(fsInfo.image_size)}
      </Typography>
    )}
    {renderLayout()}
  </Paper>));
};

export default FileSystem;
