import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box } from "@mui/material";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  GridRowSelectionModel,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import { Partitions, MBRPartitionEntry } from "../../../dbutils/types";

//
// We define local interfaces that extend the original `MBRPartitionEntry`
// so we can safely add the `id` field required by the DataGrid.
//
interface MBRRow extends MBRPartitionEntry {
  id: number;
  isExtended: boolean;
  isUnused: boolean;
}

interface EBRRow extends MBRPartitionEntry {
  id: number;
}

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
  const apiRef = useGridApiRef();

  //
  // 1. Build the MBR "rows" array by merging the partition data with an `id`.
  //    Each row is now typed as `MBRRow`.
  //
  const rows = useMemo<MBRRow[]>(() => {
    return partitions.mbr.partition_table.map((partition, index) => ({
      id: index, // needed by DataGridPro
      ...partition,
      isExtended:
        partition.partition_type === 0x05 || partition.partition_type === 0x0f,
      isUnused: partition.partition_type === 0,
    }));
  }, [partitions.mbr.partition_table]);

  //
  // 2. Build column definitions for the main MBR table.
  //
  const columns = useMemo<GridColDef[]>(
    () => [
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
    ],
    [],
  );

  //
  // 3. Columns for EBR rows
  //
  const ebrColumns = useMemo<GridColDef[]>(
    () => [
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
    ],
    [],
  );

  //
  // 4. For selection, we store:
  //    - Which "ids" are selected in the primary DataGrid.
  //    - For EBR, we keep an array of EBRRow. That way each row has an `id`.
  //
  const [selectedPrimary, setSelectedPrimary] = useState<GridRowSelectionModel>(
    [],
  );
  const [selectedEbr, setSelectedEbr] = useState<EBRRow[]>([]);

  //
  // 5. Each time the user selects rows in either the primary or the EBR grid,
  //    we combine them and pass them up (minus the extra local fields).
  //
  useEffect(() => {
    const primarySelectedRows = rows.filter((row) =>
      selectedPrimary.includes(row.id),
    ); // MBRRow[]

    // Combined EBR & MBR. Both are typed, but each object is still a valid MBRPartitionEntry plus local fields
    const combined = [...primarySelectedRows, ...selectedEbr];

    // onSelectPartitions expects MBRPartitionEntry[]. Our row types have extra fields (id, isExtended, etc.),
    // but that's okay because it's structurally compatible. If strictness is an issue, you can map out the extra fields.
    onSelectPartitions(combined);
  }, [selectedPrimary, selectedEbr, rows, onSelectPartitions]);

  //
  // 6. Build the nested DataGrid in the detail panel for any "extended" partition.
  //
  const getDetailPanelContent = useCallback(
    (params: GridRowParams) => {
      // If not extended, no detail panel
      if (!params.row.isExtended) return null;

      // Build an array of EBRRow with unique IDs
      const ebrRows: EBRRow[] = partitions.ebr.map((entry, idx) => ({
        id: idx,
        ...entry,
      }));

      return (
        <Box sx={{ p: 2 }}>
          <DataGridPro
            apiRef={apiRef}
            autosizeOnMount
            rows={ebrRows}
            columns={ebrColumns}
            checkboxSelection
            columnVisibilityModel={{ id: false }}
            rowHeight={30}
            hideFooter
            disableRowSelectionOnClick
            //
            // Only allow selection if partition_type != 0 and not locked
            //
            isRowSelectable={(rowParams) =>
              rowParams.row.partition_type !== 0 && !locked
            }
            //
            // Show which EBR rows are selected
            //
            rowSelectionModel={selectedEbr.map((row) => row.id)}
            //
            // Update local state with newly selected EBR rows
            //
            onRowSelectionModelChange={(newSelectionModel) => {
              if (!locked) {
                const newlySelected = ebrRows.filter((row) =>
                  newSelectionModel.includes(row.id),
                );
                setSelectedEbr(newlySelected);
              }
            }}
          />
        </Box>
      );
    },
    [partitions.ebr, ebrColumns, locked, selectedEbr],
  );

  const getDetailPanelHeight = useCallback(() => 200, []);

  return (
    <Box sx={{ width: "100%" }}>
      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        checkboxSelection
        columnVisibilityModel={{ id: false }}
        disableRowSelectionOnClick
        autosizeOnMount
        rowHeight={30}
        //
        // Only allow selection if partition is not unused, not extended, and not locked
        //
        isRowSelectable={(params) =>
          !params.row.isUnused && !params.row.isExtended && !locked
        }
        //
        // The primary grid uses `selectedPrimary` (an array of row IDs)
        //
        rowSelectionModel={selectedPrimary}
        onRowSelectionModelChange={(newSelectionModel) => {
          if (!locked) {
            setSelectedPrimary(newSelectionModel);
          }
        }}
        //
        // Show a nested DataGrid for extended partitions
        //
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        //
        // Expand extended partitions by default
        //
        initialState={{
          detailPanel: {
            expandedRowIds: rows.filter((r) => r.isExtended).map((r) => r.id),
          },
        }}
      />
    </Box>
  );
};

export default MBRPartitionComponent;
