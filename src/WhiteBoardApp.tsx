import React from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { Box } from "@mui/material";

const WhiteBoard: React.FC = () => {
  return (
    <Box height={"100vh"}>
      <Excalidraw />
    </Box>
  );
};

export default WhiteBoard;
