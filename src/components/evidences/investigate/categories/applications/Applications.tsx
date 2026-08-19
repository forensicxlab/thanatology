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
import ChatDiscussions from "./ChatDiscussions";
import CallsGrid from "../mobile/CallsGrid";
import BrowserHistoryGrid from "../mobile/BrowserHistoryGrid";
import CalendarGrid from "../mobile/CalendarGrid";
import MailGrid from "../mobile/MailGrid";
import NotesGrid from "../mobile/NotesGrid";

interface ApplicationsProps {
  evidenceId: number;
  partitionId: number;
}

const CHAT_PARSERS = [
  "mobile_ios_imessage",
  "mobile_ios_whatsapp",
  "mobile_android_sms",
  "macos_imessage",
  "macos_whatsapp",
] as const;

const BROWSER_PARSERS = [
  "mobile_ios_safari",
  "macos_safari",
  "macos_chromium",
  "macos_firefox",
] as const;

const loadApplicationGroups = (evidenceId: number, partitionId: number) =>
  fetchArtifactTagDescriptors(evidenceId, partitionId, "Application");

const Applications: React.FC<ApplicationsProps> = ({
  evidenceId,
  partitionId,
}) => {
  const viewsForItem = useCallback(
    (item: ArtifactTagDescriptor): CategoryTagView[] => {
      const views: CategoryTagView[] = [];

      if (hasParserCapability(item, ...CHAT_PARSERS)) {
        views.push({
          id: "discussions",
          label: "Discussions",
          node: (
            <ChatDiscussions
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
            />
          ),
        });
      }
      if (hasParserCapability(item, ...BROWSER_PARSERS)) {
        views.push({
          id: "browsing",
          label: "Browsing",
          node: (
            <BrowserHistoryGrid
              evidenceId={evidenceId}
              partitionId={partitionId}
              tag={item.tag}
            />
          ),
        });
      }
      if (hasParserCapability(item, "mobile_ios_callhistory")) {
        views.push({
          id: "calls",
          label: "Calls",
          node: <CallsGrid evidenceId={evidenceId} partitionId={partitionId} />,
        });
      }
      if (hasParserCapability(item, "mobile_ios_calendar")) {
        views.push({
          id: "events",
          label: "Events",
          node: <CalendarGrid evidenceId={evidenceId} partitionId={partitionId} />,
        });
      }
      if (hasParserCapability(item, "mobile_ios_mail")) {
        views.push({
          id: "mail",
          label: "Messages",
          node: <MailGrid evidenceId={evidenceId} partitionId={partitionId} />,
        });
      }
      if (hasParserCapability(item, "mobile_ios_notes")) {
        views.push({
          id: "notes",
          label: "Notes",
          node: <NotesGrid evidenceId={evidenceId} partitionId={partitionId} />,
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
        category="Application"
        tag={item.tag}
      />
    ),
    [evidenceId, partitionId],
  );

  return (
    <CategoryTagWorkspace<ArtifactTagDescriptor>
      evidenceId={evidenceId}
      partitionId={partitionId}
      workspaceLabel="Application artifacts"
      loadItems={loadApplicationGroups}
      viewsForItem={viewsForItem}
      filesForItem={filesForItem}
      emptyMessage="No application artifacts found for this partition."
    />
  );
};

export default Applications;
