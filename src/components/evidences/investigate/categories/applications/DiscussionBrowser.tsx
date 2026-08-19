import * as React from "react";
import {
  DataGridPro,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
} from "@mui/x-data-grid-pro";
import {
  Box,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Pagination,
  Stack,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import TableRowsIcon from "@mui/icons-material/TableRows";

import UnixToISO8601UTC from "../../../common/UnixToUTC";
import type {
  DiscussionConversationRow,
  DiscussionMessageRow,
} from "../../../../../dbutils/types";
import BubbleThread from "./discussions/BubbleThread";

interface DiscussionBrowserProps {
  conversations: DiscussionConversationRow[];
  messages: DiscussionMessageRow[];
  selectedConversationId: string | null;
  messageRowCount: number;
  conversationsLoading?: boolean;
  messagesLoading?: boolean;
  paginationModel: GridPaginationModel;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onPaginationModelChange: (model: GridPaginationModel) => void;
  onSelectConversation: (conversationId: string) => void;
  onRefresh: () => void;
}

function displayTimestamp(value: number | null | undefined) {
  return value ? <UnixToISO8601UTC timestamp={value} /> : <span>-</span>;
}

function prettyJson(raw: string | null | undefined) {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function MessageDetailPanel({ row }: { row: DiscussionMessageRow }) {
  const pretty = prettyJson(row.json_raw);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="subtitle2">Message JSON</Typography>
        <Tooltip title="Copy JSON">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Divider sx={{ my: 1 }} />
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          maxHeight: 360,
          overflow: "auto",
          bgcolor: "background.default",
          border: 1,
          borderColor: "divider",
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {pretty || "(empty)"}
      </Box>
    </Box>
  );
}

export default function DiscussionBrowser({
  conversations,
  messages,
  selectedConversationId,
  messageRowCount,
  conversationsLoading = false,
  messagesLoading = false,
  paginationModel,
  searchValue,
  onSearchChange,
  onPaginationModelChange,
  onSelectConversation,
  onRefresh,
}: DiscussionBrowserProps) {
  const [viewMode, setViewMode] = React.useState<"bubbles" | "table">(
    "bubbles",
  );
  const [selectedMessageId, setSelectedMessageId] = React.useState<
    number | null
  >(null);

  const columns = React.useMemo<GridColDef<DiscussionMessageRow>[]>(
    () => [
      {
        field: "timestamp_ms",
        headerName: "Timestamp (UTC)",
        minWidth: 210,
        renderCell: (params: GridRenderCellParams<DiscussionMessageRow>) =>
          displayTimestamp(params.value as number | null),
      },
      {
        field: "direction",
        headerName: "Direction",
        minWidth: 120,
        renderCell: (params) => (
          <Chip
            size="small"
            variant="outlined"
            label={params.value ?? "unknown"}
            color={params.value === "outgoing" ? "primary" : "default"}
          />
        ),
      },
      {
        field: "sender",
        headerName: "Sender",
        flex: 0.8,
        minWidth: 180,
        valueGetter: (_value, row) => row.sender ?? row.sender_jid ?? "-",
      },
      {
        field: "text",
        headerName: "Message",
        flex: 1.5,
        minWidth: 280,
        renderCell: (params) => (
          <Typography
            variant="body2"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {params.value || params.row.type_family || "-"}
          </Typography>
        ),
      },
      {
        field: "type_family",
        headerName: "Type",
        minWidth: 150,
        renderCell: (params) => (
          <Chip size="small" variant="outlined" label={params.value ?? "-"} />
        ),
      },
      {
        field: "media_path",
        headerName: "Media",
        minWidth: 90,
        renderCell: (params) =>
          params.row.attachments.length > 0 ? (
            <Tooltip
              title={params.row.attachments
                .map((attachment) => attachment.file_name ?? attachment.local_path)
                .filter(Boolean)
                .join(", ")}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
                <AttachFileIcon fontSize="small" />
                <span>{params.row.attachments.length}</span>
              </Stack>
            </Tooltip>
          ) : (
            <span>-</span>
          ),
      },
    ],
    [],
  );

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );
  const totalBubblePages = Math.max(
    1,
    Math.ceil(messageRowCount / paginationModel.pageSize),
  );

  React.useEffect(() => {
    setSelectedMessageId(null);
  }, [selectedConversationId, paginationModel.page, viewMode]);

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "340px minmax(0, 1fr)" },
        gridTemplateRows: { xs: "280px minmax(0, 1fr)", lg: "1fr" },
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          minHeight: 0,
          overflow: "auto",
          borderRight: { lg: 1 },
          borderBottom: { xs: 1, lg: 0 },
          borderColor: "divider",
        }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 1,
          }}
        >
          <Typography variant="subtitle2">
            Discussions ({conversations.length})
          </Typography>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={onRefresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Divider />
        <List dense disablePadding aria-busy={conversationsLoading}>
          {conversations.map((conversation) => (
            <ListItemButton
              key={conversation.id}
              selected={conversation.id === selectedConversationId}
              onClick={() => onSelectConversation(conversation.id)}
              sx={{
                alignItems: "flex-start",
                py: 1,
                // Correspondents are never hidden by the time scope — a quiet
                // contact is still evidence the relationship exists — but ones
                // with nothing in the window are de-emphasised.
                opacity: conversation.in_window_count === 0 ? 0.45 : 1,
              }}
            >
              <Box sx={{ minWidth: 0, width: "100%" }}>
                <Stack
                  direction="row"
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      pr: 1,
                    }}
                  >
                    {conversation.title || conversation.chat_jid || "Unknown"}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {conversation.in_window_count !== conversation.message_count
                      ? `${conversation.in_window_count} of ${conversation.message_count}`
                      : conversation.message_count}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    color: "text.secondary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conversation.subtitle || conversation.source_path || "-"}
                </Typography>
                <Stack
                  direction="row"
                  sx={{ gap: 0.5, mt: 0.5, flexWrap: "wrap" }}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`in ${conversation.incoming_count}`}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`out ${conversation.outgoing_count}`}
                  />
                  {conversation.media_count > 0 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<AttachFileIcon />}
                      label={conversation.media_count}
                    />
                  ) : null}
                </Stack>
              </Box>
            </ListItemButton>
          ))}
        </List>
      </Box>

      <Box
        sx={{
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          sx={{
            gap: 1,
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between",
            px: 1.5,
            py: 1,
            flexShrink: 0,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {selectedConversation?.title ||
                selectedConversation?.chat_jid ||
                "No discussion selected"}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {selectedConversation?.last_timestamp_ms
                ? displayTimestamp(selectedConversation.last_timestamp_ms)
                : null}
            </Typography>
          </Box>
          <Stack
            direction="row"
            sx={{
              gap: 1,
              alignItems: "center",
              width: { xs: "100%", md: "auto" },
            }}
          >
            <TextField
              size="small"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search messages"
              sx={{ width: { xs: "100%", md: 320 } }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              value={viewMode}
              onChange={(_, value) => {
                if (value) setViewMode(value);
              }}
            >
              <ToggleButton value="bubbles" aria-label="Bubble view">
                <ChatBubbleOutlineIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="table" aria-label="Table view">
                <TableRowsIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        <Divider />
        {viewMode === "bubbles" ? (
          <>
            <BubbleThread
              messages={messages}
              loading={messagesLoading}
              selectedMessageId={selectedMessageId}
              onSelectMessage={(message) => setSelectedMessageId(message.id)}
            />
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                px: 1.5,
                py: 0.75,
                borderTop: 1,
                borderColor: "divider",
                flexShrink: 0,
              }}
            >
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {messageRowCount} messages
              </Typography>
              <Pagination
                count={totalBubblePages}
                page={paginationModel.page + 1}
                onChange={(_, page) =>
                  onPaginationModelChange({
                    ...paginationModel,
                    page: page - 1,
                  })
                }
                size="small"
                shape="rounded"
              />
            </Stack>
          </>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <DataGridPro
              rows={messages}
              columns={columns}
              loading={messagesLoading}
              rowCount={messageRowCount}
              pagination
              paginationMode="server"
              paginationModel={paginationModel}
              onPaginationModelChange={onPaginationModelChange}
              pageSizeOptions={[25, 50, 100, 250]}
              density="compact"
              showToolbar
              disableRowSelectionOnClick
              getDetailPanelContent={(params) => (
                <MessageDetailPanel row={params.row as DiscussionMessageRow} />
              )}
              getDetailPanelHeight={() => 420}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
