import { createRoot } from "react-dom/client";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { CssBaseline, ThemeProvider } from "@mui/material";
import AgentWorkspace from "./components/agent/AgentWorkspace";
import { createGlassTheme } from "./glassTheme";
import { ThemeModeProvider, useThemeMode } from "./ThemeContext";

function AgentApp() {
  const { themeMode } = useThemeMode();
  const params = new URLSearchParams(window.location.search);
  const evidenceId = Number(params.get("evidenceId"));
  const theme = createGlassTheme(themeMode);

  if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div style={{ padding: 24 }}>
          The agent window requires a valid evidence identifier.
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AgentWorkspace evidenceId={evidenceId} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("agent") as HTMLElement).render(
  <ThemeModeProvider>
    <AgentApp />
  </ThemeModeProvider>,
);
