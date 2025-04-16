import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box } from "@mui/material";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  GridRowSelectionModel,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import {
  Partitions,
  MBRPartitionEntry,
  GPTPartitionEntry,
} from "../../../dbutils/types";

//
// We define local row interfaces for DataGrid.
//
interface MBRRow extends MBRPartitionEntry {
  // DataGrid requires an "id" property
  id: number;
  isExtended: boolean;
  isUnused: boolean;
}

interface EBRRow extends MBRPartitionEntry {
  // DataGrid requires an "id" property
  id: number;
}

interface GPTRow extends GPTPartitionEntry {
  // DataGrid requires an "id" property
  id: number;
}

interface PartitionsComponentProps {
  partitions: Partitions;
  locked: boolean;
  // Combined callback that returns all MBR + GPT selections
  onSelectPartitions: (
    mbr: MBRPartitionEntry[],
    gpt: GPTPartitionEntry[],
  ) => void;
}

const PartitionsComponent: React.FC<PartitionsComponentProps> = ({
  partitions,
  locked,
  onSelectPartitions,
}) => {
  const apiRef = useGridApiRef();

  // --------------------------------------------------
  // MBR + EBR Data & Column Definitions
  // --------------------------------------------------
  const mbrRows = useMemo<MBRRow[]>(() => {
    return partitions.mbr.partition_table.map((partition, index) => ({
      id: index, // needed by DataGridPro
      ...partition,
      isExtended:
        partition.partition_type === 0x05 || partition.partition_type === 0x0f,
      isUnused:
        partition.partition_type === 0 || partition.partition_type === 0xee,
    }));
  }, [partitions.mbr.partition_table]);

  const mbrColumns = useMemo<GridColDef[]>(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      { field: "boot_indicator", headerName: "Boot", width: 80 },
      {
        field: "partition_type",
        headerName: "Type",
        width: 100,
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      {
        field: "description",
        headerName: "Description",
        width: 180,
      },
      {
        field: "start_lba",
        headerName: "Start LBA",
        width: 110,
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      { field: "size_sectors", headerName: "Size (Sectors)", width: 130 },
      {
        field: "first_byte_addr",
        headerName: "First Byte Addr",
        width: 150,
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
    ],
    [],
  );

  const ebrColumns = useMemo<GridColDef[]>(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      { field: "boot_indicator", headerName: "Boot", width: 80 },
      {
        field: "partition_type",
        headerName: "Type",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      {
        field: "description",
        headerName: "Description",
      },
      {
        field: "start_lba",
        headerName: "Start LBA",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      { field: "size_sectors", headerName: "Size (Sectors)", width: 130 },
      {
        field: "first_byte_addr",
        headerName: "First Byte Addr",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
    ],
    [],
  );

  // --------------------------------------------------
  // GPT Data & Column Definitions
  // --------------------------------------------------
  const gptRows = useMemo<GPTRow[]>(() => {
    const arr = partitions.gpt?.partition_entries || [];
    return arr.map((entry, idx) => ({
      id: idx,
      ...entry,
    }));
  }, [partitions.gpt]);

  const gptColumns = useMemo<GridColDef[]>(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      {
        field: "starting_lba",
        headerName: "Start LBA",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      {
        field: "ending_lba",
        headerName: "End LBA",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      {
        field: "partition_guid_string",
        headerName: "Partition GUID",
      },
      {
        field: "partition_type_guid_string",
        headerName: "Type GUID",
      },
      {
        field: "description",
        headerName: "Description",
      },
      {
        field: "partition_name",
        headerName: "Name",
      },
      {
        field: "attributes",
        headerName: "Attributes",
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
    ],
    [],
  );

  // --------------------------------------------------
  // Selection States
  // --------------------------------------------------
  const [selectedMbrIds, setSelectedMbrIds] = useState<GridRowSelectionModel>(
    [],
  );
  const [selectedEbr, setSelectedEbr] = useState<EBRRow[]>([]);
  const [selectedGptIds, setSelectedGptIds] = useState<GridRowSelectionModel>(
    [],
  );

  // --------------------------------------------------
  // Combine MBR + EBR selections, plus GPT selections
  // --------------------------------------------------
  useEffect(() => {
    // MBR selected
    const chosenMbr = mbrRows.filter((r) => selectedMbrIds.includes(r.id));
    // EBR selected
    const combinedMbr = [...chosenMbr, ...selectedEbr];
    // GPT selected
    const chosenGpt = gptRows.filter((r) => selectedGptIds.includes(r.id));

    // Emit them all back to the parent
    onSelectPartitions(combinedMbr, chosenGpt);
  }, [
    selectedMbrIds,
    selectedEbr,
    selectedGptIds,
    mbrRows,
    gptRows,
    onSelectPartitions,
  ]);

  // --------------------------------------------------
  // Nested EBR DataGrid for extended partitions
  // --------------------------------------------------
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

  // --------------------------------------------------
  // Render: MBR/EBR + GPT
  // --------------------------------------------------
  return (
    <Box
      sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}
    >
      {/* MBR DataGrid */}
      <DataGridPro
        apiRef={apiRef}
        rows={mbrRows}
        columns={mbrColumns}
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
        // The primary grid uses selectedMbrIds
        //
        rowSelectionModel={selectedMbrIds}
        onRowSelectionModelChange={(newSelectionModel) => {
          if (!locked) {
            setSelectedMbrIds(newSelectionModel);
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
            expandedRowIds: mbrRows
              .filter((r) => r.isExtended)
              .map((r) => r.id),
          },
        }}
      />

      {/* GPT DataGrid */}
      {partitions.gpt?.partition_entries?.length > 0 && (
        <DataGridPro
          apiRef={apiRef}
          rows={gptRows}
          columns={gptColumns}
          checkboxSelection
          columnVisibilityModel={{ id: false }}
          disableRowSelectionOnClick
          autosizeOnMount
          rowHeight={30}
          //
          // If you need GPT "unused" logic, you could define it here
          //
          isRowSelectable={() => !locked}
          rowSelectionModel={selectedGptIds}
          onRowSelectionModelChange={(newSelectionModel) => {
            if (!locked) {
              setSelectedGptIds(newSelectionModel);
            }
          }}
          hideFooter
        />
      )}
    </Box>
  );
};

export default PartitionsComponent;
