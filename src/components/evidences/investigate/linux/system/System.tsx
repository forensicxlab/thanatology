// thanatology/src/components/evidences/investigate/linux/system/System.tsx
import React, { useEffect, useState } from "react";
import { DataGridPro, GridColDef, GridToolbar } from "@mui/x-data-grid-pro";
import {
  Info,
  Timeline,
  Hub,
  Translate,
  Settings,
  Memory,
  Storage,
  Code,
} from "@mui/icons-material";
import {
  getOsReleaseFiles,
  getBootConfiguration,
  getContainerVirtualizationConfig,
  getSystemLogs,
  getTimezoneAndLocaltime,
  getLocalizationSettings,
  getSystemServicesAndDaemons,
  getKernelModules,
  getSystemArchitectureHardware,
  getKernelVersionAndBootloader,
} from "../../../../../dbutils/artefacts/system";
import { LinuxFile } from "../../../../../dbutils/types";
import { Box, Backdrop, CircularProgress } from "@mui/material";
interface SystemArtefactRow {
  id: number;
  category: string;
  absolute_path: string;
  file_name?: string;
}

interface SystemProps {
  evidenceId: number;
  partitionId: number;
}

const System: React.FC<SystemProps> = ({ evidenceId, partitionId }) => {
  const [rows, setRows] = useState<SystemArtefactRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Returns a colorful icon based on the artefact category.
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Operating System Information":
        return <Info style={{ marginRight: 4 }} color="primary" />;
      case "Boot Configuration":
        return <Timeline style={{ marginRight: 4 }} color="secondary" />;
      case "Container/Virtualization":
        return <Hub style={{ marginRight: 4 }} color="action" />;
      case "System Logging":
        return <Timeline style={{ marginRight: 4 }} color="error" />;
      case "Timezone/Localtime":
        return <Timeline style={{ marginRight: 4 }} color="warning" />;
      case "Localization Settings":
        return <Translate style={{ marginRight: 4 }} color="primary" />;
      case "System Services And Daemons":
        return <Settings style={{ marginRight: 4 }} color="info" />;
      case "Kernel Modules":
        return <Memory style={{ marginRight: 4 }} color="secondary" />;
      case "System Architecture Hardware":
        return <Storage style={{ marginRight: 4 }} color="action" />;
      case "Kernel Version Bootloader":
        return <Code style={{ marginRight: 4 }} color="error" />;
      default:
        return <Info style={{ marginRight: 4 }} />;
    }
  };

  useEffect(() => {
    const fetchArtefacts = async () => {
      try {
        const db = null;
        const [
          osRelease,
          bootConfig,
          containerConfig,
          systemLogs,
          timezone,
          localization,
          services,
          kernelModules,
          architecture,
          kernelVersion,
        ] = await Promise.all([
          getOsReleaseFiles(db, evidenceId, partitionId),
          getBootConfiguration(db, evidenceId, partitionId),
          getContainerVirtualizationConfig(db, evidenceId, partitionId),
          getSystemLogs(db, evidenceId, partitionId),
          getTimezoneAndLocaltime(db, evidenceId, partitionId),
          getLocalizationSettings(db, evidenceId, partitionId),
          getSystemServicesAndDaemons(db, evidenceId, partitionId),
          getKernelModules(db, evidenceId, partitionId),
          getSystemArchitectureHardware(db, evidenceId, partitionId),
          getKernelVersionAndBootloader(db, evidenceId, partitionId),
        ]);

        // Combine each artefact group into one single list.
        const allArtefacts: SystemArtefactRow[] = [];
        const addFiles = (artefact: {
          category: string;
          files: LinuxFile[];
        }) => {
          console.log(artefact);
          artefact.files.forEach((file) => {
            allArtefacts.push({
              id: file.id, // assuming each LinuxFile has a unique id
              category: artefact.category,
              absolute_path: file.absolute_path,
              file_name: file.filename, // if available – otherwise we'll derive from path
            });
          });
        };

        [
          osRelease,
          bootConfig,
          containerConfig,
          systemLogs,
          timezone,
          localization,
          services,
          kernelModules,
          architecture,
          kernelVersion,
        ].forEach(addFiles);

        setRows(allArtefacts);
      } catch (err) {
        console.error(err);
        setError("Failed to load system artefacts.");
      } finally {
        setLoading(false);
      }
    };

    fetchArtefacts();
  }, [evidenceId, partitionId]);

  // Define the DataGrid columns.
  const columns: GridColDef[] = [
    {
      field: "id",
      headerName: "ID",
      flex: 0.5,
    },
    {
      field: "category",
      headerName: "Category",
      flex: 1,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {getCategoryIcon(params.value)}
          <span>{params.value}</span>
        </div>
      ),
    },
    {
      field: "absolute_path",
      headerName: "Source",
      flex: 2,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value}
        </div>
      ),
    },
    {
      field: "file_name",
      headerName: "File Name",
      flex: 1,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value || params.row.absolute_path.split("/").pop()}
        </div>
      ),
    },
  ];

  return (
    <Box sx={{ height: "80vh", width: "100%" }}>
      {loading ? (
        <Backdrop
          sx={(theme) => ({ color: "#fff", zIndex: theme.zIndex.drawer + 1 })}
          open={loading}
        >
          <CircularProgress color="inherit" />
        </Backdrop>
      ) : error ? (
        <div style={{ color: "red" }}>{error}</div>
      ) : (
        <DataGridPro
          rows={rows}
          columns={columns}
          checkboxSelection
          pagination
          rowHeight={30}
          autoPageSize
          slots={{ toolbar: GridToolbar }}
          disableRowSelectionOnClick
          sx={{
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: "#1976d2",
              color: "#fff",
            },
            "& .MuiDataGrid-row:hover": {
              backgroundColor: "rgba(25, 118, 210, 0.1)",
            },
          }}
        />
      )}
    </Box>
  );
};

export default System;
