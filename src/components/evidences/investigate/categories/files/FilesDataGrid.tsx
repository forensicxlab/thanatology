// FilesDataGrid.tsx (only the relevant edits shown)
import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  DataGridPro,
  GridColDef,
  GridActionsCellItem,
  GridRenderCellParams,
  useGridApiRef,
  GridFilterModel,
  GridRowParams,
} from "@mui/x-data-grid-pro";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { InfoOutlined } from "@mui/icons-material";
import UnixToISO8601UTC from "../../../common/UnixToUTC";
import { getFiles } from "../../../../../dbutils/sqlite";
import { File } from "../../../../../dbutils/types";
import { emitTo } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { TimelineFileFilter } from "../../../../../dbutils/sqlite";
import { Chip, Tooltip, Stack, Typography } from "@mui/material";

interface FileDataGridProps {
  evidence_id: number;
  partition_id: number;
  onRowsLoaded?: (rows: File[]) => void;
  onRowActivate?: (row: File) => void;
  filterModel?: GridFilterModel;
  onFilterModelChange?: (m: GridFilterModel) => void;
  timelineFilter?: TimelineFileFilter | null;
  onClearTimelineFilter?: () => void;
}

const pageSizeDefault = 30;

const FileDataGrid: React.FC<FileDataGridProps> = ({
  evidence_id,
  partition_id,
  onRowsLoaded,
  onRowActivate,
  filterModel,
  onFilterModelChange,
  timelineFilter,
  onClearTimelineFilter,
}) => {
  const apiRef = useGridApiRef();

  const [rows, setRows] = React.useState<File[]>([]);
  const [rowCount, setRowCount] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const [paginationModel, setPaginationModel] = React.useState({
    page: 0,
    pageSize: pageSizeDefault,
  });

  const columns = React.useMemo<GridColDef[]>(
    () => [
      {
        field: "identifier",
        headerName: "File Identifier",
        flex: 1,
        minWidth: 150,
      },
      {
        field: "sig_mime",
        headerName: "MIME",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams) => (
          <Chip
            label={params.value ?? "unknown"}
            size="small"
            color="primary"
            variant="outlined"
          />
        ),
      },
      { field: "permissions", headerName: "Permissions", minWidth: 120 },
      { field: "group", headerName: "Group", minWidth: 100 },
      { field: "owner", headerName: "Owner", minWidth: 100 },
      {
        field: "created",
        headerName: "Created",
        minWidth: 170,
        renderCell: (p: GridRenderCellParams) =>
          p.value ? (
            <UnixToISO8601UTC timestamp={p.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },
      {
        field: "modified",
        headerName: "Modified",
        minWidth: 170,
        renderCell: (p: GridRenderCellParams) =>
          p.value ? (
            <UnixToISO8601UTC timestamp={p.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },
      {
        field: "accessed",
        headerName: "Accessed",
        minWidth: 170,
        renderCell: (p: GridRenderCellParams) =>
          p.value ? (
            <UnixToISO8601UTC timestamp={p.value} />
          ) : (
            <div style={{ color: "orange" }}>None</div>
          ),
      },
      {
        field: "absolute_path",
        headerName: "File",
        flex: 1.5,
        minWidth: 200,
        renderCell: (p: GridRenderCellParams) => (
          <div style={{ color: "orange" }}>{p.value}</div>
        ),
      },
      { field: "size", headerName: "Size (B)", type: "number", minWidth: 110 },
      {
        field: "actions",
        type: "actions",
        headerName: "Action",
        getActions: ({ row }) => [
          <GridActionsCellItem
            key="view"
            icon={<VisibilityIcon />}
            label="View file"
            onClick={async () => {
              const payload = {
                evidenceId: evidence_id,
                Identifier: row.identifier,
                fileId: row.id,
                fileSize: row.size,
                partitionId: partition_id,
                path: row.absolute_path,
              };

              localStorage.setItem("pending_fileviewer_payload", JSON.stringify(payload));

              try {
                await invoke("new_fileviewer");
              } catch (error) {
                console.error("Error opening the file viewer:", error);
              } finally {
                await emitTo("fileviewer", "message", payload);
              }
            }}
            showInMenu={false}
          />,
          <Tooltip key="info" title={row.description} arrow>
            <InfoOutlined fontSize="small" sx={{ color: "text.secondary" }} />
          </Tooltip>,
        ],
      },
    ],
    [evidence_id],
  );

  const fetchData = React.useCallback(async () => {
    const { page, pageSize } = paginationModel;
    const offset = page * pageSize;

    setIsLoading(true);
    const { rows: newRows, rowCount: total } = await getFiles(
      evidence_id,
      partition_id,
      offset,
      pageSize,
      filterModel as any, // your sqlite builder already tolerates the GridFilterModel shape
      timelineFilter ?? undefined,
    );

    ReactDOM.flushSync(() => {
      setIsLoading(false);
      setRows(newRows);
      setRowCount(total);
    });

    onRowsLoaded?.(newRows);

    apiRef.current?.autosizeColumns({
      columns: [
        "sig_mime",
        "permissions",
        "group",
        "owner",
        "created",
        "modified",
        "accessed",
        "size",
        "actions",
      ],
      includeHeaders: true,
      includeOutliers: true,
      disableColumnVirtualization: true,
    });
  }, [
    paginationModel,
    evidence_id,
    partition_id,
    apiRef,
    onRowsLoaded,
    filterModel,
    timelineFilter,
  ]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  React.useEffect(() => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, [timelineFilter]);

  const handleRowDoubleClick = React.useCallback(
    (params: GridRowParams) => onRowActivate?.(params.row as File),
    [onRowActivate],
  );

  return (
    <div style={{ width: "100%" }}>
      {timelineFilter?.start != null && timelineFilter?.end != null && (
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{ mb: 1, flexWrap: "wrap" }}
        >
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Timeline filter:
          </Typography>

          <Chip
            size="small"
            variant="outlined"
            label={
              <>
                <UnixToISO8601UTC timestamp={timelineFilter.start} /> →{" "}
                <UnixToISO8601UTC timestamp={timelineFilter.end} /> (
                {timelineFilter.types.join(", ")})
              </>
            }
            onDelete={onClearTimelineFilter}
          />
        </Stack>
      )}

      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowCount={rowCount}
        initialState={{
          columns: {
            columnVisibilityModel: {
              permissions: false,
              group: false,
              owner: false,
            },
          },
        }}
        pagination
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 20, 50]}
        rowHeight={50}
        density="compact"
        showToolbar
        onRowDoubleClick={handleRowDoubleClick}
        autosizeOnMount={false}
        filterModel={filterModel}
        onFilterModelChange={(m) => onFilterModelChange?.(m)}
      />
    </div>
  );
};

export default FileDataGrid;
