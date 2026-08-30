import React from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { Box } from "@mui/material";
import { WindowFrame } from "./components/windows/shared/WindowTitlebar";

const WhiteBoard: React.FC = () => {
  return (
    <WindowFrame windowName="Whiteboard" title="Whiteboard">
      <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
        <Excalidraw />
      </Box>
    </WindowFrame>
  );
};

export default WhiteBoard;
