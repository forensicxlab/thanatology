import React from "react";
import ReactDOM from "react-dom/client";
import FileViewerApp from "./FileViewerApp";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { emit, emitTo, listen } from "@tauri-apps/api/event";

import CssBaseline from "@mui/material/CssBaseline";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

listen("message", (event) => {
  console.log(event.payload);
});

ReactDOM.createRoot(
  document.getElementById("fileviewer") as HTMLElement,
).render(
  <React.StrictMode>
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <FileViewerApp />
    </ThemeProvider>
  </React.StrictMode>,
);
