import * as React from "react";
import { AppBar, Box, IconButton, Toolbar, Tooltip } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import CloseIcon from "@mui/icons-material/Close";
import { useNavigate } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavHistory } from "./NavHistory";

const TITLEBAR_HEIGHT = 40;
const BTN = 32; // button square size inside the 40px bar

export default function TitlebarNav() {
  const navigate = useNavigate();
  const appWindow = React.useMemo(() => getCurrentWindow(), []);
  const { canBack, canForward, back, forward } = useNavHistory();

  const iconBtnSx = {
    width: BTN,
    height: BTN,
    p: 0, // remove default padding that causes visual “drop”
    alignSelf: "center", // ensure vertical centering
  } as const;

  return (
    <AppBar
      position="fixed"
      elevation={0}
      color="default"
      sx={{
        height: TITLEBAR_HEIGHT,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Toolbar
        disableGutters
        sx={{
          height: TITLEBAR_HEIGHT,
          minHeight: `${TITLEBAR_HEIGHT}px !important`, // override MUI defaults
          px: 1,
          alignItems: "center",
        }}
      >
        <IconButton
          size="small"
          sx={{
            ...iconBtnSx,
            color: "#ef4444",
            "&:hover": { bgcolor: "rgba(239, 68, 68, 0.12)" },
          }}
          onClick={() => appWindow.close()}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          sx={{
            ...iconBtnSx,
            color: "#f59e0b",
            "&:hover": { bgcolor: "rgba(245, 158, 11, 0.12)" },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => appWindow.minimize()}
        >
          <MinimizeIcon
            fontSize="small"
            sx={{ transform: "translateY(-5px)" }}
          />
        </IconButton>
        <IconButton
          size="small"
          sx={{
            ...iconBtnSx,
            color: "#22c55e",
            "&:hover": { bgcolor: "rgba(34, 197, 94, 0.12)" },
          }}
          onClick={() => appWindow.toggleMaximize()}
        >
          <CropSquareIcon fontSize="small" />
        </IconButton>

        {/* Drag region (keep buttons OUTSIDE of this box) */}
        <Tooltip title="Back">
          <IconButton disabled={!canBack} onClick={back}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Forward">
          <IconButton disabled={!canForward} onClick={forward}>
            <ArrowForwardIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box data-tauri-drag-region sx={{ flex: 1, height: "100%", pl: 1 }} />
      </Toolbar>
    </AppBar>
  );
}
