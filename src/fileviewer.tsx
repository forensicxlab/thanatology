import { createRoot } from "react-dom/client";
import FileViewerApp from "./FileViewerApp";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { ThemeProvider } from "@mui/material/styles";
import { glassTheme } from "./glassTheme";
import React from "react";

import CssBaseline from "@mui/material/CssBaseline";

createRoot(
  document.getElementById("fileviewer") as HTMLElement,
).render(
  <React.StrictMode>
    <ThemeProvider theme={glassTheme}>
      <CssBaseline />
      <FileViewerApp />
    </ThemeProvider>
  </React.StrictMode>,
);
