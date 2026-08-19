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
import ContactsGrid from "../mobile/ContactsGrid";
import TccGrid from "../mobile/TccGrid";
import InteractionsGrid from "../mobile/InteractionsGrid";
import ActivityView from "../mobile/ActivityView";
import RecentItemsGrid from "../macos/RecentItemsGrid";
import KeychainGrid from "../macos/KeychainGrid";
import QuarantineGrid from "../macos/QuarantineGrid";
import PersistenceGrid from "../macos/PersistenceGrid";
import LoginConfigurationGrid from "../macos/LoginConfigurationGrid";

interface UsersProps {
  evidenceId: number;
  partitionId: number;
}

const loadUserGroups = (evidenceId: number, partitionId: number) =>
  fetchArtifactTagDescriptors(evidenceId, partitionId, "Users");

const Users: React.FC<UsersProps> = ({ evidenceId, partitionId }) => {
  const viewsForItem = useCallback(
    (item: ArtifactTagDescriptor): CategoryTagView[] => {
      const views: CategoryTagView[] = [];

      if (hasParserCapability(item, "mobile_ios_contacts")) {
        views.push({
          id: "contacts",
          label: "Contacts",
          node: (
            <ContactsGrid evidenceId={evidenceId} partitionId={partitionId} />
          ),
        });
      }
      if (hasParserCapability(item, "mobile_ios_tcc")) {
        views.push({
          id: "permissions",
          label: "Permissions",
          node: <TccGrid evidenceId={evidenceId} partitionId={partitionId} />,
        });
      }
      if (hasParserCapability(item, "mobile_ios_knowledgec")) {
        views.push({
          id: "activity",
          label: "Activity",
          node: <ActivityView evidenceId={evidenceId} partitionId={partitionId} />,
        });
      }
      if (hasParserCapability(item, "mobile_ios_interactionc")) {
        views.push({
          id: "interactions",
          label: "Interactions",
          node: (
            <InteractionsGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_sharedfilelist")) {
        views.push({
          id: "recent-items",
          label: "Recent Items",
          node: (
            <RecentItemsGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_keychain")) {
        views.push({
          id: "keychains",
          label: "Keychains",
          node: (
            <KeychainGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
              category="Users"
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_quarantine")) {
        views.push({
          id: "quarantine",
          label: "Quarantine",
          node: (
            <QuarantineGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
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
              category="Users"
            />
          ),
        });
      }
      if (hasParserCapability(item, "macos_loginwindow")) {
        views.push({
          id: "login-configuration",
          label: "Login Configuration",
          node: (
            <LoginConfigurationGrid
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
        category="Users"
        tag={item.tag}
      />
    ),
    [evidenceId, partitionId],
  );

  return (
    <CategoryTagWorkspace<ArtifactTagDescriptor>
      evidenceId={evidenceId}
      partitionId={partitionId}
      workspaceLabel="User artifacts"
      loadItems={loadUserGroups}
      viewsForItem={viewsForItem}
      filesForItem={filesForItem}
      emptyMessage="No user artifacts found for this partition."
    />
  );
};

export default Users;
