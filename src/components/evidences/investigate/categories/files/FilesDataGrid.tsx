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
import { Chip, Tooltip } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { InfoOutlined } from "@mui/icons-material";
import { useNavigate } from "react-router";
import UnixToISO8601UTC from "../../../common/UnixToUTC";
import { getFiles } from "../../../../../dbutils/sqlite";
import { File } from "../../../../../dbutils/types";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface FileDataGridProps {
  partition_id: number;
  /** Called each time the grid fetches a new page of rows. */
  onRowsLoaded?: (rows: File[]) => void;
  /** Called when a user double-clicks a row or uses the "View file" action. */
  onRowActivate?: (row: File) => void;
}

const pageSizeDefault = 30;

const FileDataGrid: React.FC<FileDataGridProps> = ({
  partition_id,
  onRowsLoaded,
  onRowActivate,
}) => {
  const navigate = useNavigate();
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
        headerName: "",
        getActions: ({ row }) => [
          <GridActionsCellItem
            key="view"
            icon={<VisibilityIcon />}
            label="View file"
            onClick={() => {
              onRowActivate?.(row);
              // Keep your existing file-viewer nav too:
              navigate(`/viewer/${row.file_id}`);
            }}
            showInMenu={false}
          />,
          <Tooltip key="info" title={row.description} arrow>
            <InfoOutlined fontSize="small" sx={{ color: "text.secondary" }} />
          </Tooltip>,
        ],
      },
    ],
    [onRowActivate],
  );

  const [queryOptions, setQueryOptions] = React.useState({});

  const fetchData = React.useCallback(async () => {
    const { page, pageSize } = paginationModel;
    const offset = page * pageSize;

    setIsLoading(true);
    const { rows: newRows, rowCount: total } = await getFiles(
      partition_id,
      offset,
      pageSize,
      queryOptions.filterModel as any, // matches FilterModel shape used above
    );

    ReactDOM.flushSync(() => {
      setIsLoading(false);
      setRows(newRows);
      setRowCount(total);
    });

    onRowsLoaded?.(newRows);

    await sleep(0);
    apiRef.current?.autosizeColumns({
      includeHeaders: true,
      includeOutliers: true,
    });
  }, [paginationModel, partition_id, apiRef, onRowsLoaded, queryOptions]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRowDoubleClick = React.useCallback(
    (params: GridRowParams) => {
      onRowActivate?.(params.row as File);
    },
    [onRowActivate],
  );

  const onFilterChange = React.useCallback((filterModel: GridFilterModel) => {
    setQueryOptions({ filterModel: { ...filterModel } });
  }, []);

  return (
    <div style={{ width: "100%" }}>
      <DataGridPro
        apiRef={apiRef}
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowCount={rowCount}
        pagination
        paginationMode="server"
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 20, 50]}
        rowHeight={50}
        onFilterModelChange={onFilterChange}
        density="compact"
        showToolbar={true}
        onRowDoubleClick={handleRowDoubleClick}
      />
    </div>
  );
};

export default FileDataGrid;
