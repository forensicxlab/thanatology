import React, { useState, useEffect } from "react";

import { invoke } from "@tauri-apps/api/core";
import { MBRPartitionEntry, FsInfo } from "../../../../../dbutils/types";
import { useSnackbar } from "../../../../SnackbarProvider";
import { Box, Paper, Typography } from "@mui/material";
import { GridView, Info, TableBar } from "@mui/icons-material";
import RenderJson from "../../../common/RenderJson";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface FileSystemProps {
  path: String;
  partition: MBRPartitionEntry;
}

const FileSystem: React.FC<FileSystemProps> = ({ path, partition }) => {
  const { display_message } = useSnackbar();
  const [fsInfo, setFsInfo] = useState<FsInfo>();

  useEffect(() => {
    const get_info = async () => {
      console.log(partition);
      try {
        const info: FsInfo = await invoke("get_fs_info", {
          path: path,
          offset: partition.first_byte_address,
          size: partition.sector_size * partition.size_sectors,
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

        <Accordion defaultExpanded>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="panel1-content"
            id="panel1-header"
          >
            <Box display="flex" alignItems="center">
              <Info sx={{ mr: 1 }} />
              <Typography variant="body2">General</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2">
              <strong>Type:</strong> {fsInfo.filesystem_type}
            </Typography>
            <Typography variant="body2">
              <strong>Size of a block: </strong>
              {fsInfo.block_size} bytes
            </Typography>
          </AccordionDetails>
        </Accordion>
        <Accordion>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="panel2-content"
            id="panel2-header"
          >
            <Box display="flex" alignItems="center">
              <TableBar sx={{ mr: 1 }} />
              <Typography variant="body2">Extracted Metadata</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <RenderJson data={fsInfo.metadata} />
          </AccordionDetails>
        </Accordion>
      </Paper>
    )
  );
};

export default FileSystem;
