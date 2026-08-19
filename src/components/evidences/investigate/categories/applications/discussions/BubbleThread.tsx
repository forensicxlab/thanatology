import * as React from "react";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { unixToISO8601UTCString } from "../../../../common/UnixToUTC";
import type { DiscussionMessageRow } from "../../../../../../dbutils/types";
import MediaAttachmentPreview from "./MediaAttachmentPreview";

interface BubbleThreadProps {
  messages: DiscussionMessageRow[];
  loading?: boolean;
  selectedMessageId: number | null;
  onSelectMessage: (message: DiscussionMessageRow) => void;
}

function directionOf(message: DiscussionMessageRow) {
  if (
    message.type_family === "service_or_system" ||
    message.type_family === "reaction"
  ) {
    return "system";
  }
  if (message.direction === "outgoing") return "outgoing";
  if (message.direction === "incoming") return "incoming";
  return "unknown";
}

function bodyFallback(message: DiscussionMessageRow) {
  if (message.type_family === "reaction") return "Reaction";
  if (message.type_family === "link_preview") return "Link preview";
  if (message.type_family === "media_reference") return "Media reference";
  return message.type_family || "Media message";
}

function timestampLabel(value: number | null) {
  return value ? unixToISO8601UTCString(value) : "";
}

function MessageBubble({
  message,
  selected,
  onSelect,
}: {
  message: DiscussionMessageRow;
  selected: boolean;
  onSelect: (message: DiscussionMessageRow) => void;
}) {
  const direction = directionOf(message);
  const outgoing = direction === "outgoing";
  const system = direction === "system";
  const body = message.text || bodyFallback(message);

  if (system) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", my: 1 }}>
        <Box
          onClick={() => onSelect(message)}
          sx={{
            px: 1.25,
            py: 0.5,
            maxWidth: "78%",
            bgcolor: selected ? "action.selected" : "background.default",
            border: 1,
            borderColor: selected ? "primary.main" : "divider",
            cursor: "pointer",
          }}
        >
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {body}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: outgoing ? "flex-end" : "flex-start",
        my: 0.75,
      }}
    >
      <Box
        onClick={() => onSelect(message)}
        sx={{
          maxWidth: { xs: "88%", md: "72%" },
          minWidth: 120,
          px: 1.25,
          py: 0.85,
          bgcolor: outgoing ? "primary.dark" : "background.paper",
          color: outgoing ? "primary.contrastText" : "text.primary",
          border: 1,
          borderColor: selected
            ? "primary.light"
            : outgoing
              ? "primary.dark"
              : "divider",
          borderRadius: 2,
          borderTopRightRadius: outgoing ? 0.5 : 2,
          borderTopLeftRadius: outgoing ? 2 : 0.5,
          cursor: "pointer",
          boxShadow: selected ? 2 : 0,
        }}
      >
        {!outgoing && message.sender ? (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              color: "text.secondary",
              mb: 0.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {message.sender}
          </Typography>
        ) : null}

        {message.text ? (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              lineHeight: 1.45,
            }}
          >
            {message.text}
          </Typography>
        ) : null}

        {message.attachments.map((attachment) => (
          <MediaAttachmentPreview key={attachment.id} attachment={attachment} />
        ))}

        {!message.text && message.attachments.length === 0 ? (
          <Typography variant="body2">{body}</Typography>
        ) : null}

        <Stack
          direction="row"
          sx={{
            mt: 0.5,
            gap: 0.75,
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: outgoing ? "rgba(255,255,255,0.72)" : "text.secondary",
            }}
          >
            {timestampLabel(message.timestamp_ms)}
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
}

export default function BubbleThread({
  messages,
  loading = false,
  selectedMessageId,
  onSelectMessage,
}: BubbleThreadProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [messages[0]?.id]);

  return (
    <Box
      ref={scrollRef}
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        px: { xs: 1, md: 2 },
        py: 1.5,
        bgcolor: "background.default",
      }}
    >
      {loading && messages.length === 0 ? (
        <Box
          sx={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CircularProgress size={24} />
        </Box>
      ) : (
        messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            selected={message.id === selectedMessageId}
            onSelect={onSelectMessage}
          />
        ))
      )}
    </Box>
  );
}
