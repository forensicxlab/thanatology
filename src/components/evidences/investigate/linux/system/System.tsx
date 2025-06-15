import React, { useCallback, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid-pro";
import ArtefactsGrid from "../../../../common/ArtefactsGrid";
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
import { File } from "../../../../../dbutils/types";

interface SystemArtefactRow {
  id: number;
  identifier: number;
  category: string;
  absolute_path: string;
  name: string;
  ftype: string;
  size: number;
  metadata: Record<string, any>;
}

interface SystemProps {
  evidenceId: number;
  partitionId: number;
}

const System: React.FC<SystemProps> = ({ evidenceId, partitionId }) => {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Operating System Information":
        return <Info sx={{ mr: 0.5 }} color="primary" />;
      case "Boot Configuration":
        return <Timeline sx={{ mr: 0.5 }} color="secondary" />;
      case "Container/Virtualization":
        return <Hub sx={{ mr: 0.5 }} color="action" />;
      case "System Logging":
        return <Timeline sx={{ mr: 0.5 }} color="error" />;
      case "Timezone/Localtime":
        return <Timeline sx={{ mr: 0.5 }} color="warning" />;
      case "Localization Settings":
        return <Translate sx={{ mr: 0.5 }} color="primary" />;
      case "System Services And Daemons":
        return <Settings sx={{ mr: 0.5 }} color="info" />;
      case "Kernel Modules":
        return <Memory sx={{ mr: 0.5 }} color="secondary" />;
      case "System Architecture Hardware":
        return <Storage sx={{ mr: 0.5 }} color="action" />;
      case "Kernel Version Bootloader":
        return <Code sx={{ mr: 0.5 }} color="error" />;
      default:
        return <Info sx={{ mr: 0.5 }} />;
    }
  };

  const fetchRows = useCallback(async (): Promise<SystemArtefactRow[]> => {
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

    const rows: SystemArtefactRow[] = [];
    const add = (a: { category: string; files: File[] }) =>
      a.files.forEach((f) =>
        rows.push({
          id: f.id,
          identifier: f.identifier,
          size: f.size,
          ftype: f.ftype,
          category: a.category,
          metadata: JSON.parse(f.metadata),
          absolute_path: f.absolute_path,
          name: f.name,
        }),
      );

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
    ].forEach(add);
    return rows;
  }, [evidenceId, partitionId]);

  const columns: GridColDef<SystemArtefactRow>[] = useMemo(
    () => [
      { field: "id", headerName: "ID", flex: 0.5 },
      { field: "identifier", headerName: "File Identifier", flex: 0.8 },
      {
        field: "size",
        headerName: "File Size",
        flex: 0.6,
        valueFormatter: (p) =>
          p.value ? `${(p.value / 1024).toFixed(1)} KB` : p.value,
      },
      { field: "ftype", headerName: "File Type", flex: 0.5 },
      {
        field: "category",
        headerName: "Category",
        flex: 1,
        renderCell: ({ value }) => (
          <span style={{ display: "flex", alignItems: "center" }}>
            {getCategoryIcon(value)} {value}
          </span>
        ),
      },
      { field: "absolute_path", headerName: "Source", flex: 2 },
    ],
    [],
  );

  return <ArtefactsGrid fetchRows={fetchRows} columns={columns} />;
};

export default System;
