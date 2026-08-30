import * as React from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import type { GridPaginationModel } from "@mui/x-data-grid-pro";

import type {
  DiscussionConversationRow,
  DiscussionMessageRow,
} from "../../../../../../dbutils/types";
import DiscussionBrowser from "../DiscussionBrowser";
import TimeFilterBanner from "../../../TimeFilterBanner";
import { useTimeFilter } from "../../../../../../store/timeFilterStore";

interface ApplicationDiscussionsProps {
  evidenceId: number;
  partitionId: number;
  emptyLabel: string;
  getConversations: (
    evidenceId: number,
    partitionId: number,
  ) => Promise<DiscussionConversationRow[]>;
  getMessages: (params: {
    evidenceId: number;
    partitionId: number;
    conversationId: string;
    offset: number;
    limit: number;
    search?: string;
  }) => Promise<{ rows: DiscussionMessageRow[]; rowCount: number }>;
}

const DEFAULT_PAGE_SIZE = 50;

export default function ApplicationDiscussions({
  evidenceId,
  partitionId,
  emptyLabel,
  getConversations,
  getMessages,
}: ApplicationDiscussionsProps) {
  const { start: tfStart, end: tfEnd } = useTimeFilter();
  const [conversations, setConversations] = React.useState<
    DiscussionConversationRow[]
  >([]);
  const [messages, setMessages] = React.useState<DiscussionMessageRow[]>([]);
  const [selectedConversationId, setSelectedConversationId] =
    React.useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = React.useState(false);
  const [messageLoading, setMessageLoading] = React.useState(false);
  const [messageRowCount, setMessageRowCount] = React.useState(0);
  const [searchValue, setSearchValue] = React.useState("");
  const [paginationModel, setPaginationModel] =
    React.useState<GridPaginationModel>({
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });

  const loadConversations = React.useCallback(async () => {
    setConversationLoading(true);
    try {
      const rows = await getConversations(evidenceId, partitionId);
      setConversations(rows);
      setSelectedConversationId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } finally {
      setConversationLoading(false);
    }
  }, [evidenceId, getConversations, partitionId, tfStart, tfEnd]);

  React.useEffect(() => {
    setSelectedConversationId(null);
    setSearchValue("");
    setPaginationModel({ page: 0, pageSize: DEFAULT_PAGE_SIZE });
    void loadConversations();
  }, [loadConversations]);

  React.useEffect(() => {
    setPaginationModel((current) => ({ ...current, page: 0 }));
  }, [selectedConversationId, searchValue]);

  const loadMessages = React.useCallback(async () => {
    if (!selectedConversationId) {
      setMessages([]);
      setMessageRowCount(0);
      return;
    }

    setMessageLoading(true);
    try {
      const { rows, rowCount } = await getMessages({
        evidenceId,
        partitionId,
        conversationId: selectedConversationId,
        offset: paginationModel.page * paginationModel.pageSize,
        limit: paginationModel.pageSize,
        search: searchValue,
      });
      setMessages(rows);
      setMessageRowCount(rowCount);
    } finally {
      setMessageLoading(false);
    }
  }, [
    evidenceId,
    getMessages,
    paginationModel,
    partitionId,
    searchValue,
    selectedConversationId,
    tfStart,
    tfEnd,
  ]);

  React.useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  if (conversationLoading && conversations.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!conversationLoading && conversations.length === 0) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <TimeFilterBanner noun="messages" timestampLabel="message time" />
        <Box sx={{ p: 3 }}>
          <Typography color="text.secondary">{emptyLabel}</Typography>
        </Box>
      </Box>
    );
  }

  const inWindowTotal = conversations.reduce(
    (sum, c) => sum + (c.in_window_count ?? 0),
    0,
  );
  const grandTotal = conversations.reduce((sum, c) => sum + (c.message_count ?? 0), 0);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <TimeFilterBanner
        noun="messages"
        timestampLabel="message time"
        shown={inWindowTotal}
        total={grandTotal}
      />
      <DiscussionBrowser
      conversations={conversations}
      messages={messages}
      selectedConversationId={selectedConversationId}
      messageRowCount={messageRowCount}
      conversationsLoading={conversationLoading}
      messagesLoading={messageLoading}
      paginationModel={paginationModel}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onPaginationModelChange={setPaginationModel}
      onSelectConversation={setSelectedConversationId}
      onRefresh={() => {
        void loadConversations();
        void loadMessages();
      }}
      />
    </Box>
  );
}
