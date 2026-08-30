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
import SpotlightExplore from "../explore/SpotlightExplore";

interface ApplicationsProps {
  evidenceId: number;
  partitionId: number;
  onRevealFile: (fileId: number) => void;
}

type ApplicationTagDescriptor = ArtifactTagDescriptor & {
  sourceCategory: "Application" | "System";
  sourceTag: string;
  sourceParser?: string;
};

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

/**
 * Spotlight used to be catalogued as System/filesystem. Merge that legacy
 * capability into Applications so already-processed evidence is immediately
 * usable; newly identified evidence arrives as Application/spotlight.
 */
const loadApplicationGroups = async (
  evidenceId: number,
  partitionId: number,
): Promise<ApplicationTagDescriptor[]> => {
  const [applicationGroups, systemGroups] = await Promise.all([
    fetchArtifactTagDescriptors(evidenceId, partitionId, "Application"),
    fetchArtifactTagDescriptors(evidenceId, partitionId, "System"),
  ]);

  const currentSpotlight = applicationGroups.find((item) =>
    hasParserCapability(item, "macos_spotlight"),
  );
  const legacySpotlight = systemGroups.find((item) =>
    hasParserCapability(item, "macos_spotlight"),
  );
  const regular: ApplicationTagDescriptor[] = applicationGroups
    .filter((item) => !hasParserCapability(item, "macos_spotlight"))
    .map((item) => ({
      ...item,
      sourceCategory: "Application" as const,
      sourceTag: item.tag,
    }));
  const spotlightSource = currentSpotlight ?? legacySpotlight;
  if (spotlightSource) {
    regular.push({
      tag: "spotlight",
      capabilities: spotlightSource.capabilities.filter(
        ({ parser }) => parser === "macos_spotlight" || parser == null,
      ),
      sourceCategory: currentSpotlight ? "Application" : "System",
      sourceTag: spotlightSource.tag,
      sourceParser: "macos_spotlight",
    });
  }
  return regular.sort((left, right) => left.tag.localeCompare(right.tag));
};

const Applications: React.FC<ApplicationsProps> = ({
  evidenceId,
  partitionId,
  onRevealFile,
}) => {
  const viewsForItem = useCallback(
    (item: ApplicationTagDescriptor): CategoryTagView[] => {
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
      if (hasParserCapability(item, "macos_spotlight")) {
        views.push({
          id: "spotlight",
          label: "Spotlight",
          node: (
            <SpotlightExplore
              evidenceId={evidenceId}
              partitionId={partitionId}
              onRevealFile={onRevealFile}
            />
          ),
        });
      }

      return views;
    },
    [evidenceId, onRevealFile, partitionId],
  );

  const filesForItem = useCallback(
    (item: ApplicationTagDescriptor) => (
      <Artifacts
        key={item.tag}
        evidence_id={evidenceId}
        partition_id={partitionId}
        category={item.sourceCategory}
        tag={item.sourceTag}
        parser={item.sourceParser}
      />
    ),
    [evidenceId, partitionId],
  );

  return (
    <CategoryTagWorkspace<ApplicationTagDescriptor>
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
