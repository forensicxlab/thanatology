import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

const FILES_PANE = "__category_files__";

/** A parsed-data view available for the currently selected artifact tag. */
export interface CategoryTagView {
  /** Stable and unique within a tag. */
  id: string;
  label: React.ReactNode;
  node: React.ReactNode;
  disabled?: boolean;
}

/**
 * Minimum shape required by the workspace. Callers normally provide their
 * concrete `ArtifactCapability` type as the capability value.
 */
export interface CategoryTagDescriptor<TCapability = unknown> {
  tag: string;
  capabilities: readonly TCapability[];
}

export interface CategoryTagWorkspaceProps<
  TDescriptor extends CategoryTagDescriptor,
> {
  evidenceId: number;
  partitionId: number;
  /** Used in accessible labels and compact loading/error states. */
  workspaceLabel: string;
  /**
   * Load the artifact tags available in this category and partition.
   *
   * Pass an imported function or a `useCallback`-stabilized closure so the
   * workspace only reloads when its evidence scope actually changes.
   */
  loadItems: (
    evidenceId: number,
    partitionId: number,
  ) => Promise<readonly TDescriptor[]>;
  /** Return zero or more semantic views from the tag's actual capabilities. */
  viewsForItem: (item: TDescriptor) => readonly CategoryTagView[];
  /** Render the raw source-file fallback for the descriptor's `tag`. */
  filesForItem: (item: TDescriptor) => React.ReactNode;
  emptyMessage: React.ReactNode;
  filesLabel?: React.ReactNode;
  loadingMessage?: React.ReactNode;
  tagLabel?: (item: TDescriptor) => React.ReactNode;
}

function normalizeItems<TDescriptor extends CategoryTagDescriptor>(
  items: readonly TDescriptor[],
): TDescriptor[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.tag || seen.has(item.tag)) {
      return false;
    }
    seen.add(item.tag);
    return true;
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The artifact groups could not be loaded.";
}

/**
 * Shared category shell for artifact tags, semantic parsed views, and their
 * underlying source files. The component owns the async/loading lifecycle and
 * keeps every content pane constrained for dense grids and inspectors.
 */
function CategoryTagWorkspace<TDescriptor extends CategoryTagDescriptor>({
  evidenceId,
  partitionId,
  workspaceLabel,
  loadItems,
  viewsForItem,
  filesForItem,
  emptyMessage,
  filesLabel = "Files",
  loadingMessage,
  tagLabel = (item) => item.tag,
}: CategoryTagWorkspaceProps<TDescriptor>) {
  const [items, setItems] = useState<TDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedTagIndex, setSelectedTagIndex] = useState(0);
  const [selectedPane, setSelectedPane] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);
    setSelectedTagIndex(0);
    setSelectedPane(null);

    loadItems(evidenceId, partitionId)
      .then((nextItems) => {
        if (active) {
          setItems(normalizeItems(nextItems));
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setItems([]);
          setError(getErrorMessage(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [evidenceId, loadItems, partitionId, reloadVersion]);

  const activeItem = items[selectedTagIndex] ?? items[0];
  const parsedViews = useMemo(
    () => (activeItem ? [...viewsForItem(activeItem)] : []),
    [activeItem, viewsForItem],
  );

  const validSelectedPane =
    selectedPane === FILES_PANE ||
    parsedViews.some(
      (view) => `view:${view.id}` === selectedPane && !view.disabled,
    );
  const firstAvailableView = parsedViews.find((view) => !view.disabled);
  const paneValue = validSelectedPane
    ? selectedPane!
    : firstAvailableView
      ? `view:${firstAvailableView.id}`
      : FILES_PANE;

  if (loading) {
    return (
      <Box
        role="status"
        aria-label={`Loading ${workspaceLabel}`}
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.25,
          color: "text.secondary",
        }}
      >
        <CircularProgress size={22} thickness={5} />
        <Typography variant="body2">
          {loadingMessage ?? `Loading ${workspaceLabel.toLowerCase()}…`}
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 1.5 }}>
        <Alert
          severity="error"
          variant="outlined"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              Retry
            </Button>
          }
          sx={{ alignItems: "center" }}
        >
          <Typography variant="body2" component="span">
            {error}
          </Typography>
        </Alert>
      </Box>
    );
  }

  if (!activeItem) {
    return (
      <Box
        sx={{
          height: "100%",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  const selectedView = parsedViews.find(
    (view) => `view:${view.id}` === paneValue,
  );
  const filesNode = filesForItem(activeItem);

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Tabs
        value={selectedTagIndex}
        onChange={(_, nextIndex: number) => {
          setSelectedTagIndex(nextIndex);
          setSelectedPane(null);
        }}
        aria-label={`${workspaceLabel} artifact groups`}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          minHeight: 38,
          flexShrink: 0,
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTab-root": {
            minHeight: 38,
            minWidth: 72,
            px: 1.5,
            py: 0.5,
            fontSize: "0.75rem",
          },
        }}
      >
        {items.map((item) => (
          <Tab key={item.tag} label={tagLabel(item)} />
        ))}
      </Tabs>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {parsedViews.length > 0 && (
          <Tabs
            value={paneValue}
            onChange={(_, nextPane: string) => setSelectedPane(nextPane)}
            aria-label={`${activeItem.tag} parsed views`}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 34,
              flexShrink: 0,
              borderBottom: 1,
              borderColor: "divider",
              "& .MuiTab-root": {
                minHeight: 34,
                minWidth: 64,
                px: 1.25,
                py: 0.25,
                fontSize: "0.72rem",
              },
            }}
          >
            {parsedViews.map((view) => (
              <Tab
                key={view.id}
                value={`view:${view.id}`}
                label={view.label}
                disabled={view.disabled}
              />
            ))}
            <Tab value={FILES_PANE} label={filesLabel} />
          </Tabs>
        )}

        <Box
          key={`${activeItem.tag}:${paneValue}`}
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {selectedView?.node ?? filesNode}
        </Box>
      </Box>
    </Box>
  );
}

export default CategoryTagWorkspace;
