import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    DataGridPro,
    GridColDef,
    GridActionsCellItem,
    GridRowParams,
    GRID_DETAIL_PANEL_TOGGLE_FIELD,
    useGridApiContext,
    useGridSelector,
    gridDimensionsSelector,
    useGridApiRef,
    GridRenderCellParams,
} from "@mui/x-data-grid-pro";
import { Box, Typography, Paper, Stack, Chip } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router";
import { emitTo } from "@tauri-apps/api/event";
import { fetchAiArtifacts } from "../../../../../dbutils/sqlite";
import * as ReactDOM from "react-dom";
import { ArtifactWithFile } from "../../../../../dbutils/types";
import { invoke } from "@tauri-apps/api/core";

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */
function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface AiArtifactsProps {
    evidenceId: number;
    partitionId: number;
}

/* ------------------------------------------------------------------ */
/* Detail-panel component                                              */
/* ------------------------------------------------------------------ */
function ArtifactDetailPanel({ row }: { row: ArtifactWithFile }) {
    const apiRef = useGridApiContext();
    const width = useGridSelector(apiRef, gridDimensionsSelector)
        .viewportInnerSize.width;

    let pretty = row.metadata;
    try {
        pretty = JSON.stringify(JSON.parse(row.metadata), null, 2);
    } catch {
    }

    return (
        <Stack
            sx={{
                py: 2,
                height: "100%",
                boxSizing: "border-box",
                position: "sticky",
                left: 0,
                width,
            }}
            direction="column"
        >
            <Paper sx={{ flex: 1, mx: "auto", width: "90%", p: 2, overflow: "auto" }}>
                <Typography variant="h6" gutterBottom>
                    AI Analysis Source
                </Typography>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{pretty}</pre>
            </Paper>
        </Stack>
    );
}

/* ------------------------------------------------------------------ */
/* Main grid component                                                 */
/* ------------------------------------------------------------------ */
const AiArtifacts: React.FC<AiArtifactsProps> = ({
    evidenceId,
    partitionId,
}) => {
    const apiRef = useGridApiRef();
    const navigate = useNavigate();

    const [rows, setRows] = useState<any[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [paginationModel, setPaginationModel] = useState({
        page: 0,
        pageSize: 20,
    });

    const [filterModel, setFilterModel] = useState<any>({
        items: [],
    });

    const AUTOSIZE_COLS = [
        "score",
        "description",
        "artifact_name",
        "identifier",
        "absolute_path",
        "actions",
    ];

    const runAutosize = React.useCallback(() => {
        apiRef.current?.autosizeColumns({
            columns: AUTOSIZE_COLS,
            includeHeaders: true,
            includeOutliers: true,
            disableColumnVirtualization: true,
        });
    }, [apiRef]);

    useEffect(() => {
        if (loading) return;

        let raf1 = 0;
        let raf2 = 0;

        const schedule = () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => {
                    runAutosize();
                });
            });
        };

        const unsubscribe = apiRef.current?.subscribeEvent?.(
            "viewportInnerSizeChange",
            ({ width }: { width: number }) => {
                if (width > 0) schedule();
            },
        );

        schedule();

        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
            unsubscribe?.();
        };
    }, [apiRef, loading, runAutosize]);

    /* Data fetch */
    const loadArtifacts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { page, pageSize } = paginationModel;
            const offset = page * pageSize;

            const { rows: data, rowCount: total } = await fetchAiArtifacts(
                evidenceId,
                partitionId,
                offset,
                pageSize,
                filterModel
            );

            const dataWithId = data.map((r: any) => ({ ...r, id: r.artifact_id }));

            ReactDOM.flushSync(() => {
                setRowCount(total);
                setRows(dataWithId);
                setLoading(false);
            });

            await sleep(0);

            apiRef.current?.autosizeColumns({
                columns: AUTOSIZE_COLS,
                includeHeaders: true,
                includeOutliers: true,
                disableColumnVirtualization: true,
            });
        } catch (err) {
            setLoading(false);
            setError((err as Error).message || "Unknown error");
            console.log(error);
        }
    }, [apiRef, evidenceId, partitionId, paginationModel, filterModel]);

    useEffect(() => {
        loadArtifacts();
    }, [loadArtifacts]);

    useEffect(() => {
        setPaginationModel((prev) => ({ ...prev, page: 0 }));
    }, [filterModel]);

    /* Columns */
    const columns: GridColDef[] = useMemo(
        () => [
            {
                field: "score",
                headerName: "Score",
                width: 100,
                renderCell: (params: GridRenderCellParams) => {
                    let color: "default" | "error" | "warning" | "success" | "info" = "default";
                    if (params.value >= 80) color = "error";
                    else if (params.value >= 50) color = "warning";
                    else if (params.value !== null) color = "info";

                    return params.value !== null ? (
                        <Chip label={params.value} size="small" color={color} variant="filled" />
                    ) : <Typography variant="caption" color="textSecondary">Na</Typography>;
                }
            },
            { field: "description", headerName: "AI Summary", flex: 2, minWidth: 300 },
            { field: "artifact_name", headerName: "Specialization", width: 140 },
            { field: "absolute_path", headerName: "Source File", flex: 1, minWidth: 200 },
            { field: "identifier", headerName: "File ID", width: 100 },
            { field: "size", headerName: "Size (B)", type: "number", width: 100 },
            {
                field: "actions",
                type: "actions",
                headerName: "Tools",
                width: 100,
                getActions: ({ row }) => [
                    <GridActionsCellItem
                        key="view"
                        icon={<VisibilityIcon />}
                        label="View file"
                        onClick={async () => {
                            const payload = {
                                evidenceId: evidenceId,
                                partitionId: partitionId,
                                Identifier: row.identifier,
                                fileId: row.file_id,
                                fileSize: row.size,
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
                ],
            },
        ],
        [evidenceId, partitionId, navigate],
    );

    const getDetailPanelContent = useCallback(
        ({ row }: GridRowParams<any>) => (
            <ArtifactDetailPanel row={row} />
        ),
        [],
    );

    const getDetailPanelHeight = useCallback(() => 300, []);

    return (
        <Box sx={{ width: "100%" }}>
            <DataGridPro
                apiRef={apiRef}
                density="compact"
                columns={columns}
                rows={rows}
                getRowId={(r) => r.artifact_id}
                loading={loading}
                rowHeight={50}
                showToolbar
                disableRowSelectionOnClick
                pagination
                paginationMode="server"
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                filterMode="server"
                filterModel={filterModel}
                onFilterModelChange={setFilterModel}
                rowCount={rowCount}
                pageSizeOptions={[25, 50, 100]}
                getDetailPanelContent={getDetailPanelContent}
                getDetailPanelHeight={getDetailPanelHeight}
                initialState={{
                    pinnedColumns: { left: [GRID_DETAIL_PANEL_TOGGLE_FIELD] },
                    columns: {
                        columnVisibilityModel: {
                            permissions: false,
                            group: false,
                            modified: false,
                            accessed: false,
                        },
                    },
                }}
                sx={{
                    "& .MuiDataGrid-detailPanel": {
                        overflow: "visible",
                    },
                }}
            />
        </Box>
    );
};

export default AiArtifacts;
