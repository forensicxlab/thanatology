import { IconButton, Tooltip } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useNavHistory } from "./NavHistory";
import {
  WindowDragRegion,
  WindowTitlebar,
} from "../windows/shared/WindowTitlebar";

export default function TitlebarNav() {
  const { canBack, canForward, back, forward } = useNavHistory();

  return (
    <WindowTitlebar windowName="Thanatology" position="fixed">
      <Tooltip title="Back">
        <span>
          <IconButton size="small" disabled={!canBack} onClick={back} sx={{ width: 24, height: 24 }}>
            <ArrowBackIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Forward">
        <span>
          <IconButton size="small" disabled={!canForward} onClick={forward} sx={{ width: 24, height: 24 }}>
            <ArrowForwardIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </span>
      </Tooltip>

      <WindowDragRegion sx={{ pl: 0.5 }} />
    </WindowTitlebar>
  );
}
