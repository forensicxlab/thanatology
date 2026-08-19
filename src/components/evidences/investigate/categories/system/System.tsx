import React, { useCallback } from "react";
import Artifacts from "../../Artifacts";
import {
  ArtifactTagDescriptor,
  fetchArtifactTagDescriptors,
  hasParserCapability,
} from "../../../../../dbutils/artifactCapabilities";
import CategoryTagWorkspace, {
  CategoryTagView,
} from "../common/CategoryTagWorkspace";
import KeychainGrid from "../macos/KeychainGrid";
import PersistenceGrid from "../macos/PersistenceGrid";

interface SystemProps {
  evidenceId: number;
  partitionId: number;
}

const loadSystemGroups = (evidenceId: number, partitionId: number) =>
  fetchArtifactTagDescriptors(evidenceId, partitionId, "System");

const System: React.FC<SystemProps> = ({ evidenceId, partitionId }) => {
  const viewsForItem = useCallback(
    (item: ArtifactTagDescriptor): CategoryTagView[] => {
      const views: CategoryTagView[] = [];
      if (hasParserCapability(item, "macos_keychain")) {
        views.push({
          id: "keychains",
          label: "Keychains",
          node: (
            <KeychainGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
              category="System"
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_launchd")) {
        views.push({
          id: "persistence",
          label: "Persistence",
          node: (
            <PersistenceGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
              category="System"
            />
          ),
        });
      }
      return views;
    },
    [evidenceId, partitionId],
  );

  const filesForItem = useCallback(
    (item: ArtifactTagDescriptor) => (
      <Artifacts
        key={item.tag}
        evidence_id={evidenceId}
        partition_id={partitionId}
        category="System"
        tag={item.tag}
      />
    ),
    [evidenceId, partitionId],
  );

  return (
    <CategoryTagWorkspace<ArtifactTagDescriptor>
      evidenceId={evidenceId}
      partitionId={partitionId}
      workspaceLabel="System artifacts"
      loadItems={loadSystemGroups}
      viewsForItem={viewsForItem}
      filesForItem={filesForItem}
      emptyMessage="No system artifacts found for this partition."
    />
  );
};

export default System;
