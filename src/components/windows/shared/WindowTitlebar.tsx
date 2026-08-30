import * as React from "react";
import {
  Box,
  IconButton,
  Paper,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import MinimizeIcon from "@mui/icons-material/Minimize";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const WINDOW_TITLEBAR_HEIGHT = 32;

type WindowTitlebarProps = {
  windowName: string;
  title?: React.ReactNode;
  children?: React.ReactNode;
  position?: "fixed" | "relative";
  sx?: SxProps<Theme>;
};

type WindowControlsProps = {
  windowName: string;
};

const CONTROL_SIZE = 24;
const GLYPH_SIZE = 14;

function useFullscreenState() {
  const appWindow = React.useMemo(() => getCurrentWindow(), []);
  const [fullscreen, setFullscreenState] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      setFullscreenState(await appWindow.isFullscreen());
    } catch (error) {
      console.error("Unable to read the window fullscreen state", error);
    }
  }, [appWindow]);

  React.useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void refresh();
    void appWindow.onResized(() => {
      if (!disposed) void refresh();
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [appWindow, refresh]);

  const toggleFullscreen = React.useCallback(async () => {
    try {
      const next = !(await appWindow.isFullscreen());
      await appWindow.setFullscreen(next);
      setFullscreenState(next);
    } catch (error) {
      console.error("Unable to change the window fullscreen state", error);
    }
  }, [appWindow]);

  return { appWindow, fullscreen, toggleFullscreen };
}

export function WindowControls({ windowName }: WindowControlsProps) {
  const { appWindow, fullscreen, toggleFullscreen } = useFullscreenState();
  const controlSx = {
    width: CONTROL_SIZE,
    height: CONTROL_SIZE,
    p: 0,
    flexShrink: 0,
    "& .MuiSvgIcon-root": { fontSize: GLYPH_SIZE },
  } as const;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.125, flexShrink: 0 }}>
      <Tooltip title={`Close ${windowName}`}>
        <IconButton
          aria-label={`Close ${windowName}`}
          size="small"
          sx={{
            ...controlSx,
            color: "#ef4444",
            "&:hover": { bgcolor: "rgba(239, 68, 68, 0.12)" },
          }}
          onClick={() => void appWindow.close()}
        >
          <CloseIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Minimize ${windowName}`}>
        <IconButton
          aria-label={`Minimize ${windowName}`}
          size="small"
          sx={{
            ...controlSx,
            color: "#f59e0b",
            "&:hover": { bgcolor: "rgba(245, 158, 11, 0.12)" },
          }}
          onClick={() => void appWindow.minimize()}
        >
          <MinimizeIcon sx={{ transform: "translateY(-3px)" }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={fullscreen ? `Exit fullscreen ${windowName}` : `Fullscreen ${windowName}`}>
        <IconButton
          aria-label={fullscreen ? `Exit fullscreen ${windowName}` : `Fullscreen ${windowName}`}
          aria-pressed={fullscreen}
          size="small"
          sx={{
            ...controlSx,
            color: "#22c55e",
            "&:hover": { bgcolor: "rgba(34, 197, 94, 0.12)" },
          }}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function WindowDragRegion({
  children,
  sx,
}: {
  children?: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      data-tauri-drag-region
      sx={[
        {
          height: "100%",
          minWidth: 0,
          flexGrow: 1,
          display: "flex",
          alignItems: "center",
          // Tauri's drag handler checks the exact pointer target. The region
          // contains display-only title/status content, so let pointer hits
          // fall through to this attributed element instead of its children.
          "& *": { pointerEvents: "none" },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}

export function WindowTitlebar({
  windowName,
  title,
  children,
  position = "relative",
  sx,
}: WindowTitlebarProps) {
  return (
    <Paper
      component="header"
      square
      elevation={0}
      sx={[
        {
          position,
          inset: position === "fixed" ? "0 0 auto 0" : undefined,
          zIndex: (theme) => theme.zIndex.appBar,
          height: WINDOW_TITLEBAR_HEIGHT,
          flexShrink: 0,
          borderWidth: 0,
          borderBottom: 1,
          borderColor: "divider",
          borderRadius: 0,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Toolbar
        disableGutters
        sx={{
          height: WINDOW_TITLEBAR_HEIGHT,
          minHeight: `${WINDOW_TITLEBAR_HEIGHT}px !important`,
          px: 0.5,
          gap: 0.5,
        }}
      >
        <WindowControls windowName={windowName} />
        {children ?? (
          <WindowDragRegion sx={{ px: 0.75 }}>
            <Typography
              data-tauri-drag-region
              variant="caption"
              noWrap
              sx={{ fontWeight: 600 }}
            >
              {title ?? windowName}
            </Typography>
          </WindowDragRegion>
        )}
      </Toolbar>
    </Paper>
  );
}

export function WindowFrame({
  windowName,
  title,
  children,
}: {
  windowName: string;
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ height: "100vh", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <WindowTitlebar windowName={windowName} title={title} />
      <Box sx={{ minHeight: 0, flexGrow: 1, overflow: "hidden" }}>{children}</Box>
    </Box>
  );
}
