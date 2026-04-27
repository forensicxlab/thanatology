import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { glassTheme } from "./glassTheme";
import { SnackbarProvider } from "./components/SnackbarProvider";
import LeechCore from "./components/memory/LeechCore";

createRoot(document.getElementById("leechcore") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={glassTheme}>
      <CssBaseline />
      <SnackbarProvider>
        <LeechCore />
      </SnackbarProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
