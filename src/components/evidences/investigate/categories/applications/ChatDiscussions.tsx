import * as React from "react";
import { Alert, Box } from "@mui/material";
import {
  getChatConversations,
  getChatMessages,
  getLegacyChatMessageCount,
} from "../../../../../dbutils/sqlite";
import ApplicationDiscussions from "./discussions/ApplicationDiscussions";

interface ChatDiscussionsProps {
  evidenceId: number;
  partitionId: number;
  /**
   * Optional app facet. Omit to browse every messaging app in one thread list —
   * the canonical chat envelope means no per-app query code is needed either way.
   */
  parser?: string;
  /** Exact artifact group; allows the same parser to back several app tabs. */
  tag?: string;
  emptyLabel?: string;
}

export default function ChatDiscussions({
  evidenceId,
  partitionId,
  parser,
  tag,
  emptyLabel = "No parsed discussions found for this partition.",
}: ChatDiscussionsProps) {
  const [legacyCount, setLegacyCount] = React.useState(0);

  const getScopedConversations = React.useCallback(
    (nextEvidenceId: number, nextPartitionId: number) =>
      getChatConversations(nextEvidenceId, nextPartitionId, { parser, tag }),
    [parser, tag],
  );
  const getScopedMessages = React.useCallback(
    (args: Parameters<typeof getChatMessages>[0]) =>
      getChatMessages({ ...args, scope: { parser, tag } }),
    [parser, tag],
  );

  React.useEffect(() => {
    let alive = true;
    getLegacyChatMessageCount(evidenceId, partitionId, { parser, tag })
      .then((n) => alive && setLegacyCount(n))
      .catch(() => alive && setLegacyCount(0));
    return () => {
      alive = false;
    };
  }, [evidenceId, partitionId, parser, tag]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {legacyCount > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {legacyCount.toLocaleString()} message
          {legacyCount === 1 ? " was" : "s were"} parsed before the chat.v1 schema
          and cannot be threaded or displayed correctly. Re-process this evidence
          with a rebuilt backend to fix it.
        </Alert>
      )}
      <ApplicationDiscussions
        evidenceId={evidenceId}
        partitionId={partitionId}
        emptyLabel={emptyLabel}
        getConversations={getScopedConversations}
        getMessages={getScopedMessages}
      />
    </Box>
  );
}
