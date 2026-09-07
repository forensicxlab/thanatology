import * as React from "react";
import type { GridFilterModel } from "@mui/x-data-grid-pro";
import { SimpleTreeView, TreeItem } from "@mui/x-tree-view";
import { useSimpleTreeViewApiRef } from "@mui/x-tree-view/hooks";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import {
  getFilesystemTreeChildren,
  getFilesystemTreeTrail,
  ROOT_PATH_KEY,
} from "../../../../../dbutils/sqlite";
import type {
  File,
  FileQueryScope,
  FilesystemTreeItem,
} from "../../../../../dbutils/types";
import DirectoryExportDialog, {
  type DirectoryExportSource,
} from "./DirectoryExportDialog";
import FileDataGrid from "./FilesDataGrid";

interface FilesExplorerProps {
  evidenceId: number;
  partitionId: number;
  revealFile?: { fileId: number; requestId: number } | null;
}

const ROOT_ITEM_ID = "__filesystem_root__";
const LOADING_ITEM_PREFIX = "__filesystem_loading__:";
const MAX_TRAIL_CACHE_ENTRIES = 256;
const EMPTY_FILTER_MODEL: GridFilterModel = { items: [] };
const ROOT_TREE_ITEM: FilesystemTreeItem = {
  id: ROOT_ITEM_ID,
  fileId: null,
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
  revealFile,
}) => {
  const [selectedItemId, setSelectedItemId] = React.useState(ROOT_ITEM_ID);
  const [gridScopeItemId, setGridScopeItemId] = React.useState(ROOT_ITEM_ID);
  const [expandedItems, setExpandedItems] = React.useState<string[]>([ROOT_ITEM_ID]);
  const [filterModel, setFilterModel] = React.useState<GridFilterModel>(EMPTY_FILTER_MODEL);
  const [treeError, setTreeError] = React.useState<string | null>(null);
  const [treeItems, setTreeItems] = React.useState<Record<string, FilesystemTreeItem>>({
    [ROOT_ITEM_ID]: ROOT_TREE_ITEM,
  });
  const [childrenByParent, setChildrenByParent] = React.useState<Record<string, string[]>>({});
  const [loadedParents, setLoadedParents] = React.useState<Record<string, boolean>>({});
  const [loadingParents, setLoadingParents] = React.useState<Record<string, boolean>>({});
  const [directoryExportOpen, setDirectoryExportOpen] = React.useState(false);

  // Refs mirror state for synchronous guard checks so loadChildren stays stable.
  const loadedParentsRef = React.useRef<Record<string, boolean>>({});
  const loadingParentsRef = React.useRef<Record<string, boolean>>({});
  const scopeGenerationRef = React.useRef(0);
  const trailRequestRef = React.useRef(0);
  const pendingScrollRef = React.useRef<{
    itemId: string;
    ancestorIds: string[];
    requestId: number;
    generation: number;
  } | null>(null);
  const treeScrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const trailLoadsRef = React.useRef(
    new Map<number, Promise<FilesystemTreeItem[]>>(),
  );
  const treeApiRef = useSimpleTreeViewApiRef();

  const loadChildren = React.useCallback(
    async (parentId: string, parentPathKey: string) => {
      if (loadedParentsRef.current[parentId] || loadingParentsRef.current[parentId]) return;
      const generation = scopeGenerationRef.current;

      loadingParentsRef.current[parentId] = true;
      setLoadingParents((prev) => ({ ...prev, [parentId]: true }));

      try {
        const children = await getFilesystemTreeChildren(evidenceId, partitionId, parentPathKey);
        if (scopeGenerationRef.current !== generation) return;

        // A database row has one stable UI id. Keep the list defensive because
        // the evidence schema deliberately does not enforce unique path rows.
        const childIds = Array.from(new Set(children.map((child) => child.id)));

        setTreeItems((prev) => {
          const next = { ...prev };
          for (const child of children) next[child.id] = child;
          return next;
        });
        setChildrenByParent((prev) => ({
          ...prev,
          [parentId]: childIds,
        }));
        loadedParentsRef.current[parentId] = true;
        setLoadedParents((prev) => ({ ...prev, [parentId]: true }));
        setTreeError(null);
      } catch (error) {
        if (scopeGenerationRef.current === generation) {
          setTreeError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (scopeGenerationRef.current === generation) {
          loadingParentsRef.current[parentId] = false;
          setLoadingParents((prev) => ({ ...prev, [parentId]: false }));
        }
      }
    },
    [evidenceId, partitionId],
  );

  // Reset when evidence/partition changes
  React.useEffect(() => {
    const generation = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = generation;
    trailRequestRef.current += 1;
    pendingScrollRef.current = null;
    trailLoadsRef.current.clear();
    setSelectedItemId(ROOT_ITEM_ID);
    setGridScopeItemId(ROOT_ITEM_ID);
    setExpandedItems([ROOT_ITEM_ID]);
    setFilterModel(EMPTY_FILTER_MODEL);
    setTreeError(null);
    setTreeItems({ [ROOT_ITEM_ID]: ROOT_TREE_ITEM });
    setChildrenByParent({});
    setLoadedParents({});
    setLoadingParents({});
    loadedParentsRef.current = {};
    loadingParentsRef.current = {};
    return () => {
      if (scopeGenerationRef.current === generation) {
        scopeGenerationRef.current += 1;
      }
      trailRequestRef.current += 1;
    };
  }, [evidenceId, partitionId]);

  // Boot: load root children
  React.useEffect(() => {
    void loadChildren(ROOT_ITEM_ID, ROOT_PATH_KEY);
  }, [loadChildren]);

  // Lazy-load on expand
  React.useEffect(() => {
    for (const itemId of expandedItems) {
      if (itemId !== ROOT_ITEM_ID && !treeItems[itemId]?.isDir) continue;
      const item = treeItems[itemId];
      if (!item) continue;
      void loadChildren(itemId, item.pathKey);
    }
  }, [expandedItems, treeItems, loadChildren]);

  const loadFilesystemTrail = React.useCallback(
    (fileId: number) => {
      const existing = trailLoadsRef.current.get(fileId);
      if (existing) return existing;

      if (trailLoadsRef.current.size >= MAX_TRAIL_CACHE_ENTRIES) {
        const oldestFileId = trailLoadsRef.current.keys().next().value;
        if (typeof oldestFileId === "number") {
          trailLoadsRef.current.delete(oldestFileId);
        }
      }
      const request = getFilesystemTreeTrail(evidenceId, partitionId, fileId);
      trailLoadsRef.current.set(fileId, request);
      void request.catch(() => {
        if (trailLoadsRef.current.get(fileId) === request) {
          trailLoadsRef.current.delete(fileId);
        }
      });
      return request;
    },
    [evidenceId, partitionId],
  );

  const revealTreeFile = React.useCallback(
    async (
      fileId: number,
      options: { updateGridScope: boolean; scrollIntoView: boolean },
    ) => {
      const requestId = trailRequestRef.current + 1;
      trailRequestRef.current = requestId;
      const generation = scopeGenerationRef.current;
      pendingScrollRef.current = null;
      try {
        const rawTrail = await loadFilesystemTrail(fileId);
        if (
          scopeGenerationRef.current !== generation ||
          trailRequestRef.current !== requestId
        ) {
          return;
        }

        // The component owns a synthetic root for every filesystem. Never add
        // an indexed physical '/' row beside it or both roots render the same
        // top-level subtree. De-duplicate malformed/cyclic trails as a second
        // line of defence before handing item ids to MUI X.
        const seen = new Set<string>();
        const trail = rawTrail.filter((item) => {
          if (item.pathKey === ROOT_PATH_KEY || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });

        if (trail.length === 0) {
          throw new Error(`Cannot reveal indexed file ${fileId}: no filesystem trail was found.`);
        }
        if (trail[0].parentPathKey !== ROOT_PATH_KEY) {
          throw new Error(
            `Cannot reveal ${trail[trail.length - 1].absolutePath}: its indexed parent chain is incomplete.`,
          );
        }

        setTreeItems((previous) => {
          const next = { ...previous };
          for (const item of trail) next[item.id] = item;
          return next;
        });
        setChildrenByParent((previous) => {
          const next = { ...previous };
          let parentId = ROOT_ITEM_ID;
          for (const item of trail) {
            const siblings = next[parentId] ?? [];
            if (!siblings.includes(item.id)) next[parentId] = [...siblings, item.id];
            parentId = item.id;
          }
          return next;
        });
        setExpandedItems((previous) => {
          const next = new Set(previous);
          next.add(ROOT_ITEM_ID);
          for (const item of trail) if (item.isDir) next.add(item.id);
          return Array.from(next);
        });
        const targetItemId = trail[trail.length - 1].id;
        pendingScrollRef.current = options.scrollIntoView
          ? {
              itemId: targetItemId,
              ancestorIds: [
                ROOT_ITEM_ID,
                ...trail.filter((item) => item.isDir).map((item) => item.id),
              ],
              requestId,
              generation,
            }
          : null;
        setSelectedItemId(targetItemId);
        if (options.updateGridScope) setGridScopeItemId(targetItemId);
        setTreeError(null);
      } catch (reason) {
        if (
          scopeGenerationRef.current === generation &&
          trailRequestRef.current === requestId
        ) {
          setTreeError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    },
    [loadFilesystemTrail],
  );

  // A result can reveal one exact indexed file without materializing unrelated
  // branches. Normal lazy loading supplies siblings after its chain is merged.
  React.useEffect(() => {
    if (!revealFile) return;
    void revealTreeFile(revealFile.fileId, {
      updateGridScope: true,
      scrollIntoView: true,
    });
  }, [revealFile?.fileId, revealFile?.requestId, revealTreeFile]);

  // Reveals can add and expand a deep chain in one render. Scroll only after
  // MUI has registered the newly materialized TreeItem; do not steal keyboard
  // focus from the DataGrid that initiated the selection.
  React.useEffect(() => {
    const pendingScroll = pendingScrollRef.current;
    if (!pendingScroll || selectedItemId !== pendingScroll.itemId) return;

    let frameId = 0;
    let attempts = 0;
    const scrollSelectedItem = () => {
      if (
        pendingScrollRef.current !== pendingScroll ||
        scopeGenerationRef.current !== pendingScroll.generation ||
        trailRequestRef.current !== pendingScroll.requestId
      ) {
        return;
      }
      const scrollContainer = treeScrollContainerRef.current;
      const selectedContent = scrollContainer?.querySelector<HTMLElement>(
        '[role="treeitem"] > [data-selected]',
      );
      const itemElement =
        selectedContent ??
        treeApiRef.current?.getItemDOMElement?.(pendingScroll.itemId) ??
        null;
      if (!itemElement || !scrollContainer) {
        attempts += 1;
        if (attempts < 12) {
          frameId = window.requestAnimationFrame(scrollSelectedItem);
        }
        return;
      }

      const itemRect = itemElement.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      let nextScrollTop = scrollContainer.scrollTop;
      const verticalInset = 12;
      if (
        itemRect.top < containerRect.top + verticalInset ||
        itemRect.bottom > containerRect.bottom - verticalInset
      ) {
        const itemCenter = (itemRect.top + itemRect.bottom) / 2;
        const containerCenter = (containerRect.top + containerRect.bottom) / 2;
        nextScrollTop += itemCenter - containerCenter;
      }
      scrollContainer.scrollTop = Math.max(0, nextScrollTop);

      let nextScrollLeft = scrollContainer.scrollLeft;
      if (itemRect.left < containerRect.left) {
        nextScrollLeft -= containerRect.left - itemRect.left;
      } else if (itemRect.right > containerRect.right) {
        nextScrollLeft += itemRect.right - containerRect.right;
      }
      scrollContainer.scrollLeft = Math.max(0, nextScrollLeft);

      const ancestorsLoaded = pendingScroll.ancestorIds.every(
        (ancestorId) => loadedParentsRef.current[ancestorId],
      );
      const ancestorsLoading = pendingScroll.ancestorIds.some(
        (ancestorId) => loadingParentsRef.current[ancestorId],
      );
      if (ancestorsLoaded || !ancestorsLoading) {
        pendingScrollRef.current = null;
      }
    };
    frameId = window.requestAnimationFrame(scrollSelectedItem);
    return () => window.cancelAnimationFrame(frameId);
  }, [expandedItems, loadedParents, loadingParents, selectedItemId, treeApiRef, treeItems]);

  const gridScopeTreeItem = treeItems[gridScopeItemId] ?? ROOT_TREE_ITEM;
  const gridScopeItemKind = gridScopeTreeItem.itemKind;
  const gridScopeFileId = gridScopeTreeItem.fileId;
  const gridScopePathKey = gridScopeTreeItem.pathKey;

  const gridScope = React.useMemo<FileQueryScope>(() => {
    switch (gridScopeItemKind) {
      case "directory":
        return { kind: "directory", pathKey: gridScopePathKey };
      case "file":
        return gridScopeFileId == null
          ? { kind: "root" }
          : {
              kind: "file",
              fileId: gridScopeFileId,
              pathKey: gridScopePathKey,
            };
      default:
        return { kind: "root" };
    }
  }, [gridScopeFileId, gridScopeItemKind, gridScopePathKey]);

  const gridListingMode = "subtree-files";

  const selectionModeLabel = React.useMemo(() => {
    switch (gridScopeItemKind) {
      case "directory": return "Directory contents";
      case "file": return "Single entry";
      default: return "All files";
    }
  }, [gridScopeItemKind]);

  const selectionDescription =
    gridScopeItemKind === "root"
      ? "All indexed files in this partition."
      : gridScopePathKey;

  // Export the browsing scope, not the transient tree highlight. A DataGrid
  // click reveals a file in the tree without changing the directory currently
  // shown in the grid, so the export source remains predictable.
  const directoryExportSource = React.useMemo<DirectoryExportSource | null>(
    () =>
      gridScopeItemKind === "directory" && gridScopeFileId != null
        ? {
            systemFileId: gridScopeFileId,
            name: gridScopeTreeItem.name,
            absolutePath: gridScopeTreeItem.absolutePath,
          }
        : null,
    [
      gridScopeFileId,
      gridScopeItemKind,
      gridScopeTreeItem.absolutePath,
      gridScopeTreeItem.name,
    ],
  );
  const handleRunningDirectoryExportRecovered = React.useCallback(() => {
    setDirectoryExportOpen(true);
  }, []);

  const handleGridRowSelect = React.useCallback(
    (row: File) => {
      void revealTreeFile(row.id, {
        updateGridScope: false,
        scrollIntoView: true,
      });
    },
    [revealTreeFile],
  );

  const handleGridRowActivate = React.useCallback(
    (row: File) => {
      void revealTreeFile(row.id, {
        updateGridScope: true,
        scrollIntoView: true,
      });
    },
    [revealTreeFile],
  );

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

  const renderedTree = React.useMemo(() => {
    const renderedIds = new Set<string>();
    let omittedNodes = 0;

    const renderTreeNode = (
      itemId: string,
      ancestors: ReadonlySet<string>,
    ): React.ReactNode => {
      const item = treeItems[itemId];
      if (!item) return null;
      if (ancestors.has(itemId) || renderedIds.has(itemId)) {
        omittedNodes += 1;
        return null;
      }
      renderedIds.add(itemId);

      const childIds = Array.from(new Set(childrenByParent[itemId] ?? []));
      const shouldShowPlaceholder =
        item.isDir &&
        item.childrenCount > 0 &&
        childIds.length === 0 &&
        !loadedParents[itemId];
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(itemId);

      return (
        <TreeItem itemId={item.id} label={renderTreeLabel(item)} key={item.id}>
          {childIds.map((childId) => renderTreeNode(childId, nextAncestors))}
          {shouldShowPlaceholder && (
            <TreeItem
              itemId={`${LOADING_ITEM_PREFIX}${item.id}`}
              label={loadingParents[itemId] ? "Loading…" : "Expand to load"}
              disabled
            />
          )}
        </TreeItem>
      );
    };

    return {
      node: renderTreeNode(ROOT_ITEM_ID, new Set<string>()),
      omittedNodes,
    };
  }, [childrenByParent, loadedParents, loadingParents, renderTreeLabel, treeItems]);

  return (
    <>
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
        {renderedTree.omittedNodes > 0 && (
          <Alert severity="warning" sx={{ m: 1.5, mb: 0 }}>
            {renderedTree.omittedNodes} repeated or cyclic filesystem node
            {renderedTree.omittedNodes === 1 ? " was" : "s were"} omitted.
          </Alert>
        )}
        <Box
          ref={treeScrollContainerRef}
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
            apiRef={treeApiRef}
            expansionTrigger="iconContainer"
            expandedItems={expandedItems}
            selectedItems={selectedItemId}
            onExpandedItemsChange={(_e, itemIds) => setExpandedItems(itemIds)}
            onSelectedItemsChange={(_e, itemId) => {
              if (typeof itemId !== "string") return; // null = MUI deselect event, keep current
              if (itemId.startsWith(LOADING_ITEM_PREFIX)) return;
              trailRequestRef.current += 1;
              pendingScrollRef.current = null;
              setSelectedItemId(itemId);
              setGridScopeItemId(itemId);
              setTreeError(null);
            }}
            sx={{
              minWidth: "max-content",
              pr: 1,
              "& .MuiTreeItem-content": { borderRadius: 1 },
              "& .MuiTreeItem-content.Mui-selected": { backgroundColor: "action.selected" },
              "& .MuiTreeItem-label": { minWidth: 0 },
            }}
          >
            {renderedTree.node}
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
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
              <Tooltip
                title={
                  directoryExportSource
                    ? `Export ${directoryExportSource.absolutePath}`
                    : "Select a real directory in the filesystem tree to export it"
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileDownloadOutlinedIcon />}
                    disabled={!directoryExportSource}
                    onClick={() => setDirectoryExportOpen(true)}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    Export directory…
                  </Button>
                </span>
              </Tooltip>
              <Chip size="small" variant="outlined" label={selectionModeLabel} />
            </Stack>
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
              key={`${evidenceId}:${partitionId}:${gridScopeItemId}`}
              evidence_id={evidenceId}
              partition_id={partitionId}
              onRowSelect={handleGridRowSelect}
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

      <DirectoryExportDialog
        open={directoryExportOpen}
        evidenceId={evidenceId}
        partitionId={partitionId}
        source={directoryExportSource}
        onClose={() => setDirectoryExportOpen(false)}
        onRunningJobRecovered={handleRunningDirectoryExportRecovered}
      />
    </>
  );
};

export default FilesExplorer;
