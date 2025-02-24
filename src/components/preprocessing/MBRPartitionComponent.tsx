// MBRPartitionComponent.tsx
import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  GridRowSelectionModel,
} from "@mui/x-data-grid-pro";
import { Partitions, MBRPartitionEntry } from "../../dbutils/types";

interface MBRPartitionComponentProps {
  partitions: Partitions;
  locked: boolean;
  onSelectPartitions: (selected: MBRPartitionEntry[]) => void;
}

const MBRPartitionComponent: React.FC<MBRPartitionComponentProps> = ({
  partitions,
  locked,
  onSelectPartitions,
}) => {
  // Helper functions to decide if a partition is extended or unused.
  const isExtended = (p: MBRPartitionEntry) =>
    p.partition_type === 0x05 || p.partition_type === 0x0f;
  const isUnused = (p: MBRPartitionEntry) => p.partition_type === 0;

  // Build DataGrid rows from the primary MBR partition table.
  const rows = partitions.mbr.partition_table.map((partition, index) => ({
    id: index,
    ...partition,
    isExtended: isExtended(partition),
    isUnused: isUnused(partition),
  }));

  // Local state for primary grid selection
  const [selectedPrimary, setSelectedPrimary] = useState<GridRowSelectionModel>(
    [],
  );
  // Local state for manual EBR grid selection (if any)
  const [selectedEbr, setSelectedEbr] = useState<MBRPartitionEntry[]>([]);

  // Whenever primary or nested EBR selections change, update the combined selection.
  useEffect(() => {
    const primarySelectedPartitions = rows.filter((row) =>
      selectedPrimary.includes(row.id),
    );
    // Combine primary selection and manual EBR selection.
    const combined = [...primarySelectedPartitions, ...selectedEbr];
    onSelectPartitions(combined);
  }, [selectedPrimary, selectedEbr, rows, onSelectPartitions]);

  // Define DataGrid columns for the primary grid.
  const columns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "boot_indicator", headerName: "Boot Indicator", width: 120 },
    {
      field: "start_chs",
      headerName: "Start CHS",
      width: 150,
      renderCell: (params) => `(${params.value.join(", ")})`,
    },
    {
      field: "partition_type",
      headerName: "Partition Type",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
    { field: "description", headerName: "Description", width: 150 },
    {
      field: "end_chs",
      headerName: "End CHS",
      width: 150,
      renderCell: (params) => `(${params.value.join(", ")})`,
    },
    {
      field: "start_lba",
      headerName: "Start LBA",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
    { field: "size_sectors", headerName: "Size (Sectors)", width: 150 },
    { field: "sector_size", headerName: "Sector Size", width: 150 },
    {
      field: "first_byte_addr",
      headerName: "First Byte Addr",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
  ];

  // Define DataGrid columns for the sub-datagrid (EBR partitions) matching the MBR columns.
  const ebrColumns: GridColDef[] = [
    { field: "id", headerName: "ID", width: 70 },
    { field: "boot_indicator", headerName: "Boot Indicator", width: 120 },
    {
      field: "start_chs",
      headerName: "Start CHS",
      width: 150,
      renderCell: (params) => `(${params.value.join(", ")})`,
    },
    {
      field: "partition_type",
      headerName: "Partition Type",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
    { field: "description", headerName: "Description", width: 150 },
    {
      field: "end_chs",
      headerName: "End CHS",
      width: 150,
      renderCell: (params) => `(${params.value.join(", ")})`,
    },
    {
      field: "start_lba",
      headerName: "Start LBA",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
    { field: "size_sectors", headerName: "Size (Sectors)", width: 150 },
    { field: "sector_size", headerName: "Sector Size", width: 150 },
    {
      field: "first_byte_addr",
      headerName: "First Byte Addr",
      width: 150,
      renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
    },
  ];

  // Detail panel: for extended partition rows, render nested EBR entries in a sub-datagrid.
  const getDetailPanelContent = useCallback(
    (params: GridRowParams) => {
      if (!params.row.isExtended) return null;

      // Build rows for the sub-datagrid from the EBR partitions.
      const ebrRows = partitions.ebr.map((ebr, idx) => ({
        id: idx,
        ...ebr,
      }));

      return (
        <Box sx={{ p: 2 }}>
          <DataGridPro
            rows={ebrRows}
            columns={ebrColumns}
            checkboxSelection
            columnVisibilityModel={{ id: false }}
            rowHeight={30}
            hideFooter
            disableRowSelectionOnClick
            isRowSelectable={(params) => !isUnused(params.row) && !locked}
            rowSelectionModel={selectedEbr.map((row) => row.id)}
            onRowSelectionModelChange={(newSelectionModel) => {
              if (!locked) {
                const selectedRows = ebrRows.filter((row) =>
                  newSelectionModel.includes(row.id),
                );
                setSelectedEbr(selectedRows);
              }
            }}
          />
        </Box>
      );
    },
    [partitions.ebr, ebrColumns, locked, selectedEbr],
  );

  // Fixed height for the detail panel.
  const getDetailPanelHeight = useCallback(() => 200, []);

  return (
    <Box>
      {/* Bootloader Section */}
      {/* DataGrid for MBR Partition Table */}
      <Box sx={{ height: "auto", width: "100%" }}>
        <DataGridPro
          rows={rows}
          columns={columns}
          checkboxSelection
          columnVisibilityModel={{ id: false }}
          disableRowSelectionOnClick
          isRowSelectable={(params) =>
            !params.row.isUnused && !params.row.isExtended && !locked
          }
          rowSelectionModel={selectedPrimary}
          onRowSelectionModelChange={(newSelectionModel) => {
            if (!locked) {
              setSelectedPrimary(newSelectionModel);
            }
          }}
          getDetailPanelContent={getDetailPanelContent}
          getDetailPanelHeight={getDetailPanelHeight}
          rowHeight={30}
          initialState={{
            detailPanel: {
              // Automatically expand detail panels for all extended partition rows.
              expandedRowIds: rows
                .filter((row) => row.isExtended)
                .map((row) => row.id),
            },
          }}
        />
      </Box>
    </Box>
  );
};

export default MBRPartitionComponent;
