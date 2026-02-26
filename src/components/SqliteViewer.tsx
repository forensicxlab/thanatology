import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Divider,
  Alert,
} from "@mui/material";
import { DataGridPro, GridColDef } from "@mui/x-data-grid-pro";
import { invoke } from "@tauri-apps/api/core";
import initSqlJs, { Database } from "sql.js";

// Import sql-wasm.wasm - this might need careful handling in Vite/Tauri
// We'll use the CDN for the WASM file for simplicity or try to load it locally if possible
// For Tauri, we usually want it bundled.
// @ts-ignore
import sqlWasm from "sql.js/dist/sql-wasm.wasm?url";

interface SqliteViewerProps {
  fileId: number;
}

const SqliteViewer: React.FC<SqliteViewerProps> = ({ fileId }) => {
  const [db, setDb] = useState<Database | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<GridColDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDb = async () => {
      setLoading(true);
      setError(null);
      try {
        const SQL = await initSqlJs({
          locateFile: () => sqlWasm,
        });

        const fileBytes = await invoke<number[]>("read_file_bytes", { fileId });
        const uint8Array = new Uint8Array(fileBytes);
        const database = new SQL.Database(uint8Array);
        setDb(database);

        // Fetch tables
        const result = database.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
        if (result.length > 0) {
          const tableNames = result[0].values.map((v) => v[0] as string);
          setTables(tableNames);
          if (tableNames.length > 0) {
            setSelectedTable(tableNames[0]);
          }
        }
      } catch (err: any) {
        console.error("Failed to load SQLite DB:", err);
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    loadDb();

    return () => {
      if (db) {
        db.close();
      }
    };
  }, [fileId]);

  useEffect(() => {
    if (!db || !selectedTable) return;

    try {
      const result = db.exec(`SELECT * FROM "${selectedTable.replace(/"/g, '""')}" LIMIT 1000`);

      if (result && result.length > 0) {
        const firstResult = result[0];
        // Some builds of sql.js might use 'lc' instead of 'columns' or vice versa depending on minification/version
        const cols = firstResult.columns || (firstResult as any).lc;
        const vals = firstResult.values || [];

        if (cols && Array.isArray(cols)) {
          const tableColumns: GridColDef[] = cols.map((col) => ({
            field: col,
            headerName: col,
            width: 150,
            editable: false,
          }));

          const tableRows = vals.map((row, idx) => {
            const rowObj: any = { id: idx };
            cols.forEach((col, i) => {
              rowObj[col] = row[i];
            });
            return rowObj;
          });

          setColumns(tableColumns);
          setRows(tableRows);
        } else {
          console.warn(`Query for table ${selectedTable} has no detectable columns:`, firstResult);
          setColumns([]);
          setRows([]);
        }
      } else {
        console.warn(`Query for table ${selectedTable} returned empty result:`, result);
        setColumns([]);
        setRows([]);
      }
    } catch (err: any) {
      console.error("Failed to query table:", err);
      setError(`Failed to query table ${selectedTable}: ${err.message}`);
    }
  }, [db, selectedTable]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading Database...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={2}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <Box display="flex" height="100%" overflow="hidden">
      {/* Tables Sidebar */}
      <Paper
        elevation={0}
        sx={{
          width: 200,
          borderRight: 1,
          borderColor: "divider",
          overflowY: "auto",
          flexShrink: 0,
        }}
      >
        <Typography variant="overline" sx={{ px: 2, py: 1, display: "block" }}>
          Tables
        </Typography>
        <Divider />
        <List dense>
          {tables.map((table) => (
            <ListItem key={table} disablePadding>
              <ListItemButton
                selected={selectedTable === table}
                onClick={() => setSelectedTable(table)}
              >
                <ListItemText
                  primary={table}
                  primaryTypographyProps={{
                    variant: "body2",
                    noWrap: true,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>

      {/* Content Area */}
      <Box flex={1} minWidth={0} display="flex" flexDirection="column">
        {selectedTable ? (
          <Box flex={1} sx={{ height: "100%", width: "100%" }}>
            <DataGridPro
              rows={rows}
              columns={columns}
              density="compact"
              disableRowSelectionOnClick
              sx={{ border: "none" }}
            />
          </Box>
        ) : (
          <Box p={4} textAlign="center">
            <Typography color="text.secondary">No tables found in this database.</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default SqliteViewer;
