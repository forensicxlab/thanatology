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
import DataUsageGrid from "../mobile/DataUsageGrid";
import NetworkConfigurationView from "../macos/NetworkConfigurationView";

interface NetworkProps {
  evidenceId: number;
  partitionId: number;
}

const loadNetworkGroups = (evidenceId: number, partitionId: number) =>
  fetchArtifactTagDescriptors(evidenceId, partitionId, "Network");

const Network: React.FC<NetworkProps> = ({ evidenceId, partitionId }) => {
  const viewsForItem = useCallback(
    (item: ArtifactTagDescriptor): CategoryTagView[] => {
      const views: CategoryTagView[] = [];
      if (hasParserCapability(item, "mobile_ios_datausage")) {
        views.push({
          id: "data-usage",
          label: "Data Usage",
          node: (
            <DataUsageGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_network")) {
        views.push({
          id: "network-configuration",
          label: "Configuration",
          node: (
            <NetworkConfigurationView
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
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
        category="Network"
        tag={item.tag}
      />
    ),
    [evidenceId, partitionId],
  );

  return (
    <CategoryTagWorkspace<ArtifactTagDescriptor>
      evidenceId={evidenceId}
      partitionId={partitionId}
      workspaceLabel="Network artifacts"
      loadItems={loadNetworkGroups}
      viewsForItem={viewsForItem}
      filesForItem={filesForItem}
      emptyMessage="No network artifacts found for this partition."
    />
  );
};

export default Network;
