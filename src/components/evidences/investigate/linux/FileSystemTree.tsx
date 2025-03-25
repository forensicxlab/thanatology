import React, { useState, useEffect, useCallback } from "react";
import { SimpleTreeView } from "@mui/x-tree-view/SimpleTreeView";
import { TreeItem } from "@mui/x-tree-view/TreeItem";
import { Folder, InsertDriveFile } from "@mui/icons-material";
import { Evidence, LinuxFile } from "../../../../dbutils/types";
import { getFilesByEvidenceAndParent } from "../../../../dbutils/sqlite";
import { CircularProgress, Typography } from "@mui/material";

interface FileSystemTreeProps {
  evidence: Evidence;
}

const FileSystemTree: React.FC<FileSystemTreeProps> = ({ evidence }) => {
  // Map: directory path => array of LinuxFiles
  const [treeData, setTreeData] = useState<Record<string, LinuxFile[]>>({});
  // By default, expand the root so we see it and can test the children
  const [expanded, setExpanded] = useState<string[]>(["ROOT"]);
  // Track which nodes are loading
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  // Track errors
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(
    async (parentDirectory: string, itemId: string) => {
      try {
        if (loadingNodes.has(itemId)) return;

        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.add(itemId);
          return next;
        });

        const db = null; // Load or pass your DB instance here if needed
        const files = await getFilesByEvidenceAndParent(
          db,
          evidence.id,
          parentDirectory,
        );

        setTreeData((prev) => ({ ...prev, [itemId]: files }));
      } catch (err) {
        console.error("Error fetching files:", err);
        setError("Failed to load files.");
      } finally {
        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [evidence.id, loadingNodes],
  );

  // Initial load
  useEffect(() => {
    if (evidence.id) {
      // Preemptively load root directory; use parentDirectory "/" with itemId "ROOT"
      loadFiles("/", "ROOT");
    }
  }, [evidence.id, loadFiles]);

  // Handle expansion/collapse.
  const handleExpandedItemsChange = (
    event: React.SyntheticEvent,
    newExpanded: string[],
  ) => {
    const newlyExpanded = newExpanded.filter((id) => !expanded.includes(id));
    newlyExpanded.forEach((id) => {
      if (!treeData[id] && !loadingNodes.has(id)) {
        loadFiles(id === "ROOT" ? "/" : id, id);
      }
    });
    setExpanded(newExpanded);
  };

  // Optional: handle item click for selection or other behavior
  const handleItemClick = (event: React.MouseEvent, itemId: string) => {
    console.log("Clicked item:", itemId);
  };

  /**
   * Recursively render children for the given directory itemId.
   * Pass a visited set to avoid infinite loops from cyclical references.
   */
  const renderChildren = (
    itemId: string,
    visited: Set<string> = new Set<string>(),
  ): React.ReactNode => {
    // If we have seen this directory before, skip to prevent cycles
    if (visited.has(itemId)) return null;
    visited.add(itemId);

    // If children not loaded or still fetching
    const files = treeData[itemId];
    if (!files) {
      return (
        <TreeItem
          itemId={`${itemId}-loading`}
          label={<CircularProgress size={20} />}
        />
      );
    }

    return files.map((file) => {
      const isDirectory = file.file_type === "Directory";
      const childNodeId = isDirectory
        ? file.absolute_path
        : `${file.absolute_path}:${file.id}`;

      return (
        <TreeItem
          key={childNodeId}
          itemId={childNodeId}
          label={
            <div style={{ display: "flex", alignItems: "center" }}>
              {isDirectory ? (
                <Folder style={{ marginRight: 4 }} />
              ) : (
                <InsertDriveFile style={{ marginRight: 4 }} />
              )}
              <Typography variant="body2">{file.filename}</Typography>
            </div>
          }
        >
          {/* If folder is expanded, render its children—avoiding cycles. */}
          {isDirectory && expanded.includes(childNodeId)
            ? renderChildren(childNodeId, new Set(visited))
            : null}
        </TreeItem>
      );
    });
  };

  return (
    <div>
      {error && (
        <Typography color="error" variant="body2" gutterBottom>
          {error}
        </Typography>
      )}

      <SimpleTreeView
        aria-label="filesystem navigator"
        expandedItems={expanded}
        onExpandedItemsChange={handleExpandedItemsChange}
        onItemClick={handleItemClick}
        sx={{ flexGrow: 1, overflow: "auto" }}
      >
        <TreeItem
          itemId="ROOT"
          label={
            <div style={{ display: "flex", alignItems: "center" }}>
              <Folder style={{ marginRight: 4 }} />
              <Typography variant="body2">/</Typography>
            </div>
          }
        >
          {expanded.includes("ROOT") ? renderChildren("ROOT") : null}
        </TreeItem>
      </SimpleTreeView>
    </div>
  );
};

export default FileSystemTree;
