import React from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import WhiteBoardApp from "./WhiteBoardApp";
import { glassTheme } from "./glassTheme";

createRoot(document.getElementById("whiteboard") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={glassTheme}>
      <CssBaseline />
      <WhiteBoardApp />
    </ThemeProvider>
  </React.StrictMode>,
);
