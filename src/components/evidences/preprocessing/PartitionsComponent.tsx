import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box } from "@mui/material";
import {
  DataGridPro,
  GridColDef,
  GridRowParams,
  GridRowSelectionModel,
  GridRowId,
  useGridApiRef,
} from "@mui/x-data-grid-pro";
import {
  Partitions,
  MBRPartitionEntry,
  GPTPartitionEntry,
} from "../../../dbutils/types";

interface MBRRow extends MBRPartitionEntry {
  id: number;
  isExtended: boolean;
  isUnused: boolean;
}
interface EBRRow extends MBRPartitionEntry {
  id: number;
}
interface GPTRow extends GPTPartitionEntry {
  id: number;
}

interface PartitionsComponentProps {
  partitions: Partitions;
  locked: boolean;
  onSelectPartitions: (
    mbr: MBRPartitionEntry[],
    gpt: GPTPartitionEntry[],
  ) => void;
}

/* Helpers */
const emptySelection = (): GridRowSelectionModel => ({
  type: "include",
  ids: new Set<GridRowId>(),
});

const PartitionsComponent: React.FC<PartitionsComponentProps> = ({
  partitions,
  locked,
  onSelectPartitions,
}) => {
  const apiRef = useGridApiRef();

  const mbrRows = useMemo<MBRRow[]>(
    () =>
      partitions.mbr.partition_table.map((p) => ({
        ...p,
        isExtended: p.partition_type === 0x05 || p.partition_type === 0x0f,
        isUnused: p.partition_type === 0 || p.partition_type === 0xee,
      })),
    [partitions.mbr.partition_table],
  );

  const mbrColumns: GridColDef[] = useMemo(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      { field: "boot_indicator", headerName: "Boot", width: 80 },
      {
        field: "partition_type",
        headerName: "Type",
        width: 100,
        renderCell: (params) => `0x${params.value.toString(16).toUpperCase()}`,
      },
      { field: "description", headerName: "Description", width: 180 },
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

  const ebrRowsAll = useMemo<EBRRow[]>(
    () =>
      partitions.ebr.map((entry) => ({
        ...entry,
      })),
    [partitions.ebr],
  );

  const ebrColumns: GridColDef[] = useMemo(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      { field: "boot_indicator", headerName: "Boot", width: 80 },
      {
        field: "partition_type",
        headerName: "Type",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
      { field: "description", headerName: "Description" },
      {
        field: "start_lba",
        headerName: "Start LBA",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
      { field: "size_sectors", headerName: "Size (Sectors)", width: 130 },
      {
        field: "first_byte_addr",
        headerName: "First Byte Addr",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
    ],
    [],
  );

  const gptRows = useMemo<GPTRow[]>(
    () =>
      (partitions.gpt?.partition_entries ?? []).map((e) => ({
        ...e,
      })),
    [partitions.gpt],
  );

  const gptColumns: GridColDef[] = useMemo(
    () => [
      { field: "id", headerName: "ID", width: 70 },
      {
        field: "starting_lba",
        headerName: "Start LBA",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
      {
        field: "ending_lba",
        headerName: "End LBA",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
      { field: "partition_guid_string", headerName: "Partition GUID" },
      { field: "partition_type_guid_string", headerName: "Type GUID" },
      { field: "description", headerName: "Description" },
      { field: "partition_name", headerName: "Name" },
      {
        field: "attributes",
        headerName: "Attributes",
        renderCell: (p) => `0x${p.value.toString(16).toUpperCase()}`,
      },
    ],
    [],
  );

  const [mbrSel, setMbrSel] = useState<GridRowSelectionModel>(emptySelection);
  const [ebrSel, setEbrSel] = useState<GridRowSelectionModel>(emptySelection);
  const [gptSel, setGptSel] = useState<GridRowSelectionModel>(emptySelection);

  useEffect(() => {
    const mbrArr = mbrRows.filter((r) => mbrSel.ids.has(r.id));
    const ebrArr = ebrRowsAll.filter((r) => ebrSel.ids.has(r.id));
    const gptArr = gptRows.filter((r) => gptSel.ids.has(r.id));
    onSelectPartitions([...mbrArr, ...ebrArr], gptArr);
  }, [
    mbrSel,
    ebrSel,
    gptSel,
    mbrRows,
    ebrRowsAll,
    gptRows,
    onSelectPartitions,
  ]);

  /* ————————————————— Detail-panel (EBR) ————————————————— */
  const getDetailPanelContent = useCallback(
    (params: GridRowParams) =>
      !params.row.isExtended ? null : (
        <Box sx={{ p: 2 }}>
          <DataGridPro
            apiRef={apiRef}
            rows={ebrRowsAll}
            columns={ebrColumns}
            checkboxSelection
            columnVisibilityModel={{ id: false }}
            rowHeight={30}
            hideFooter
            disableRowSelectionOnClick
            isRowSelectable={(p) => p.row.partition_type !== 0 && !locked}
            rowSelectionModel={ebrSel}
            onRowSelectionModelChange={(m) => !locked && setEbrSel(m)}
          />
        </Box>
      ),
    [ebrRowsAll, ebrColumns, ebrSel, locked],
  );

  const getDetailPanelHeight = useCallback(() => 200, []);

  /* ————————————————— Render ————————————————— */
  return (
    <Box
      sx={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}
    >
      {/* ---------- MBR + EBR ---------- */}
      <DataGridPro
        apiRef={apiRef}
        rows={mbrRows}
        columns={mbrColumns}
        checkboxSelection
        columnVisibilityModel={{ id: false }}
        disableRowSelectionOnClick
        autosizeOnMount
        rowHeight={30}
        isGroupExpandedByDefault={() => true}
        isRowSelectable={(p) => !p.row.isUnused && !p.row.isExtended && !locked}
        rowSelectionModel={mbrSel}
        onRowSelectionModelChange={(m) => !locked && setMbrSel(m)}
        getDetailPanelContent={getDetailPanelContent}
        getDetailPanelHeight={getDetailPanelHeight}
        initialState={{
          detailPanel: {
            expandedRowIds: new Set<GridRowId>(
              mbrRows.filter((r) => r.isExtended).map((r) => r.id),
            ),
          },
        }}
      />

      {/* ---------- GPT ---------- */}
      {gptRows.length > 0 && (
        <DataGridPro
          apiRef={apiRef}
          rows={gptRows}
          columns={gptColumns}
          checkboxSelection
          columnVisibilityModel={{ id: false }}
          disableRowSelectionOnClick
          autosizeOnMount
          rowHeight={30}
          isRowSelectable={() => !locked}
          rowSelectionModel={gptSel}
          onRowSelectionModelChange={(m) => !locked && setGptSel(m)}
          hideFooter
        />
      )}
    </Box>
  );
};

export default PartitionsComponent;
