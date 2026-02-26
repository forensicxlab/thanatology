import React, { useState, useEffect, useCallback } from "react";
import {
    Box,
} from "@mui/material";
import { DataGrid, GridColDef, GridToolbar, GridFilterModel } from "@mui/x-data-grid";
import { getPmlEvents } from "../dbutils/sqlite";

interface PmlViewerProps {
    evidenceId: number;
    partitionId: number;
    fileId: number;
}

export const PmlViewer: React.FC<PmlViewerProps> = ({ evidenceId, partitionId, fileId }) => {
    const [rows, setRows] = useState<any[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [filterModel, setFilterModel] = useState<GridFilterModel>({
        items: [],
    });
    const [paginationModel, setPaginationModel] = useState({
        page: 0,
        pageSize: 50,
    });

    const columns: GridColDef[] = [
        { field: "time", headerName: "Time", width: 120 },
        { field: "process", headerName: "Process Name", width: 150 },
        { field: "pid", headerName: "PID", width: 80 },
        { field: "operation", headerName: "Operation", width: 180 },
        { field: "path", headerName: "Path", width: 300, flex: 1 },
        { field: "result", headerName: "Result", width: 150 },
    ];

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const { page, pageSize } = paginationModel;
            const offset = page * pageSize;

            const { rows: events, rowCount: total } = await getPmlEvents(
                evidenceId,
                partitionId,
                fileId,
                offset,
                pageSize,
                filterModel as any
            );

            const formattedRows = events.map((event, index) => ({
                id: offset + index, // Give a unique id based on offset
                time: event.timestamp_unix_ms
                    ? new Date(event.timestamp_unix_ms).toLocaleTimeString()
                    : "N/A",
                process: event.details?.process_name || "Unknown",
                pid: event.details?.pid || "",
                operation: event.operation,
                path: event.details?.path || event.details?.raw || "",
                result: event.result_text || event.result,
                detail: JSON.stringify(event.details),
            }));

            setRowCount(total);
            setRows(formattedRows);
        } catch (error) {
            console.error("Failed to fetch PML events:", error);
        } finally {
            setIsLoading(false);
        }
    }, [evidenceId, partitionId, fileId, paginationModel, filterModel]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        setPaginationModel((prev) => ({ ...prev, page: 0 }));
    }, [filterModel]);

    return (
        <Box sx={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <DataGrid
                rows={rows}
                columns={columns}
                rowCount={rowCount}
                loading={isLoading}
                paginationMode="server"
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                filterMode="server"
                filterModel={filterModel}
                onFilterModelChange={setFilterModel}
                slots={{ toolbar: GridToolbar }}
                initialState={{
                    density: "compact"
                }}
                showToolbar
                pageSizeOptions={[25, 50, 100]}
                sx={{ border: 0 }}
            />
        </Box>
    );
};
