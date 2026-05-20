import * as React from "react";
import type { GridFilterModel } from "@mui/x-data-grid-pro";
import { SimpleTreeView, TreeItem } from "@mui/x-tree-view";
import {
  Alert,
  Box,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import {
  getFilesystemTreeChildren,
  ROOT_PATH_KEY,
} from "../../../../../dbutils/sqlite";
import type {
  File,
  FileQueryScope,
  FilesystemTreeItem,
} from "../../../../../dbutils/types";
import FileDataGrid from "./FilesDataGrid";

interface FilesExplorerProps {
  evidenceId: number;
  partitionId: number;
}

const ROOT_ITEM_ID = "__filesystem_root__";
const EMPTY_FILTER_MODEL: GridFilterModel = { items: [] };
const ROOT_TREE_ITEM: FilesystemTreeItem = {
  id: ROOT_ITEM_ID,
  label: "Filesystem",
  pathKey: ROOT_PATH_KEY,
  parentPathKey: null,
  absolutePath: ROOT_PATH_KEY,
  name: "Filesystem",
  ftype: "root",
  isDir: true,
  childrenCount: 1,
  itemKind: "root",
};

const FilesExplorer: React.FC<FilesExplorerProps> = ({
  evidenceId,
  partitionId,
}) => {
  const [selectedItemId, setSelectedItemId] = React.useState(ROOT_ITEM_ID);
  const [expandedItems, setExpandedItems] = React.useState<string[]>([ROOT_ITEM_ID]);
  const [filterModel, setFilterModel] = React.useState<GridFilterModel>(EMPTY_FILTER_MODEL);
  const [treeError, setTreeError] = React.useState<string | null>(null);
  const [treeItems, setTreeItems] = React.useState<Record<string, FilesystemTreeItem>>({
    [ROOT_ITEM_ID]: ROOT_TREE_ITEM,
  });
  const [childrenByParent, setChildrenByParent] = React.useState<Record<string, string[]>>({});
  const [loadedParents, setLoadedParents] = React.useState<Record<string, boolean>>({});
  const [loadingParents, setLoadingParents] = React.useState<Record<string, boolean>>({});

  // Refs mirror state for synchronous guard checks so loadChildren stays stable.
  const loadedParentsRef = React.useRef<Record<string, boolean>>({});
  const loadingParentsRef = React.useRef<Record<string, boolean>>({});

  const loadChildren = React.useCallback(
    async (parentId: string) => {
      if (loadedParentsRef.current[parentId] || loadingParentsRef.current[parentId]) return;

      const parentPathKey = parentId === ROOT_ITEM_ID ? ROOT_PATH_KEY : parentId;

      loadingParentsRef.current[parentId] = true;
      setLoadingParents((prev) => ({ ...prev, [parentId]: true }));

      try {
        const children = await getFilesystemTreeChildren(evidenceId, partitionId, parentPathKey);

        setTreeItems((prev) => {
          const next = { ...prev };
          for (const child of children) next[child.id] = child;
          return next;
        });
        setChildrenByParent((prev) => ({
          ...prev,
          [parentId]: children.map((c) => c.id),
        }));
        loadedParentsRef.current[parentId] = true;
        setLoadedParents((prev) => ({ ...prev, [parentId]: true }));
        setTreeError(null);
      } catch (error) {
        setTreeError(error instanceof Error ? error.message : String(error));
      } finally {
        loadingParentsRef.current[parentId] = false;
        setLoadingParents((prev) => ({ ...prev, [parentId]: false }));
      }
    },
    [evidenceId, partitionId],
  );

  // Reset when evidence/partition changes
  React.useEffect(() => {
    setSelectedItemId(ROOT_ITEM_ID);
    setExpandedItems([ROOT_ITEM_ID]);
    setFilterModel(EMPTY_FILTER_MODEL);
    setTreeError(null);
    setTreeItems({ [ROOT_ITEM_ID]: ROOT_TREE_ITEM });
    setChildrenByParent({});
    setLoadedParents({});
    setLoadingParents({});
    loadedParentsRef.current = {};
    loadingParentsRef.current = {};
  }, [evidenceId, partitionId]);

  // Boot: load root children
  React.useEffect(() => {
    void loadChildren(ROOT_ITEM_ID);
  }, [loadChildren]);

  // Lazy-load on expand
  React.useEffect(() => {
    for (const itemId of expandedItems) {
      if (itemId !== ROOT_ITEM_ID && !treeItems[itemId]?.isDir) continue;
      void loadChildren(itemId);
    }
  }, [expandedItems, treeItems, loadChildren]);

  const selectedTreeItem = treeItems[selectedItemId] ?? ROOT_TREE_ITEM;

  const gridScope = React.useMemo<FileQueryScope>(() => {
    switch (selectedTreeItem.itemKind) {
      case "directory":
        return { kind: "directory", pathKey: selectedTreeItem.pathKey };
      case "file":
        return { kind: "file", pathKey: selectedTreeItem.pathKey };
      default:
        return { kind: "root" };
    }
  }, [selectedTreeItem]);

  const gridListingMode = "subtree-files";

  const selectionModeLabel = React.useMemo(() => {
    switch (selectedTreeItem.itemKind) {
      case "directory": return "Directory contents";
      case "file": return "Single entry";
      default: return "All files";
    }
  }, [selectedTreeItem.itemKind]);

  const selectionDescription =
    selectedTreeItem.itemKind === "root"
      ? "All indexed files in this partition."
      : selectedTreeItem.pathKey;

  const handleGridRowActivate = React.useCallback((row: File) => {
    const nextItemId = row.path_key;
    const isDir = Number(row.is_dir ?? 0) === 1;

    setTreeItems((prev) => {
      if (prev[nextItemId]) return prev;
      return {
        ...prev,
        [nextItemId]: {
          id: nextItemId,
          label: isDir ? `${row.name}/` : row.name,
          pathKey: row.path_key,
          parentPathKey: row.parent_path_key,
          absolutePath: row.absolute_path,
          name: row.name,
          ftype: row.ftype,
          isDir,
          childrenCount: 0,
          itemKind: isDir ? "directory" : "file",
        },
      };
    });

    setSelectedItemId(nextItemId);

    if (isDir) {
      setExpandedItems((prev) =>
        prev.includes(nextItemId) ? prev : [...prev, nextItemId],
      );
    }
  }, []);

  const renderTreeLabel = React.useCallback((item: FilesystemTreeItem) => {
    const icon =
      item.itemKind === "root" ? (
        <StorageOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
      ) : item.isDir ? (
        <FolderOutlinedIcon sx={{ fontSize: 18, color: "warning.main" }} />
      ) : (
        <InsertDriveFileOutlinedIcon sx={{ fontSize: 18, color: "info.main" }} />
      );

    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, py: 0.25 }}>
        {icon}
        <Typography variant="body2" noWrap title={item.label}>{item.label}</Typography>
      </Stack>
    );
  }, []);

  const renderTreeNode = React.useCallback(
    (itemId: string): React.ReactNode => {
      const item = treeItems[itemId];
      if (!item) return null;

      const childIds = childrenByParent[itemId] ?? [];
      const shouldShowPlaceholder =
        item.childrenCount > 0 && childIds.length === 0 && !loadedParents[itemId];

      return (
        <TreeItem itemId={item.id} label={renderTreeLabel(item)} key={item.id}>
          {childIds.map((childId) => renderTreeNode(childId))}
          {shouldShowPlaceholder && (
            <TreeItem
              itemId={`${item.id}::__loading`}
              label={loadingParents[itemId] ? "Loading…" : "Expand to load"}
              disabled
            />
          )}
        </TreeItem>
      );
    },
    [childrenByParent, loadedParents, loadingParents, renderTreeLabel, treeItems],
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "320px minmax(0, 1fr)" },
        gridTemplateRows: {
          xs: "minmax(220px, 0.85fr) minmax(0, 1.15fr)",
          lg: "1fr",
        },
        gap: 2,
        minWidth: 0,
        minHeight: 0,
        height: "100%",
      }}
    >
      {/* ── Left panel: tree view ── */}
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1.25 }}
        >
          <Typography variant="subtitle2">Filesystem</Typography>
          <Chip size="small" variant="outlined" label={selectionModeLabel} />
        </Stack>
        <Divider />
        {treeError && (
          <Alert severity="error" sx={{ m: 1.5, mb: 0 }}>{treeError}</Alert>
        )}
        <Box
          sx={{
            flexGrow: 1,
            minHeight: 0,
            overflowX: "auto",
            overflowY: "auto",
            px: 1,
            py: 1.5,
          }}
        >
          <SimpleTreeView
            key={`${evidenceId}:${partitionId}`}
            expansionTrigger="iconContainer"
            expandedItems={expandedItems}
            selectedItems={selectedItemId}
            onExpandedItemsChange={(_e, itemIds) => setExpandedItems(itemIds)}
            onSelectedItemsChange={(_e, itemId) => {
              if (typeof itemId !== "string") return; // null = MUI deselect event, keep current
              if (itemId.endsWith("::__loading")) return; // loading placeholder, ignore
              setSelectedItemId(itemId);
            }}
            sx={{
              minWidth: "max-content",
              pr: 1,
              "& .MuiTreeItem-content": { borderRadius: 1 },
              "& .MuiTreeItem-content.Mui-selected": { backgroundColor: "action.selected" },
              "& .MuiTreeItem-label": { minWidth: 0 },
            }}
          >
            {renderTreeNode(ROOT_ITEM_ID)}
          </SimpleTreeView>
        </Box>
      </Paper>

      {/* ── Right panel: file data grid ── */}
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          height: "100%",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        {/* Header */}
        <Stack spacing={0.5} sx={{ px: 1.5, py: 1.25, flexShrink: 0 }}>
          <Stack
            direction="row"
            sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}
          >
            <Typography variant="subtitle2">Contents</Typography>
            <Chip size="small" variant="outlined" label={selectionModeLabel} />
          </Stack>
          <Typography
            variant="body2"
            sx={{ color: "text.secondary", wordBreak: "break-all" }}
          >
            {selectionDescription}
          </Typography>
        </Stack>
        <Divider sx={{ flexShrink: 0 }} />

        {/*
         * Stretch wrapper: grows to fill remaining Paper height.
         * position: relative gives the absolutely-placed DataGrid a concrete
         * containing block, bypassing the height:100% resolution chain entirely.
         * The inner box is inset 12 px (= MUI spacing 1.5) from each edge.
         */}
        <Box sx={{ flexGrow: 1, minHeight: 0, position: "relative" }}>
          <Box
            sx={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              bottom: 12,
            }}
          >
            <FileDataGrid
              key={`${evidenceId}:${partitionId}:${gridScope.kind === "root" ? "root" : gridScope.pathKey}`}
              evidence_id={evidenceId}
              partition_id={partitionId}
              onRowActivate={handleGridRowActivate}
              filterModel={filterModel}
              onFilterModelChange={setFilterModel}
              scope={gridScope}
              listingMode={gridListingMode}
            />
          </Box>
        </Box>
      </Paper>
    </Box>
  );
};

export default FilesExplorer;
