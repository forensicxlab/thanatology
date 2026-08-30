import * as React from "react";
import { Alert, CssBaseline, ThemeProvider } from "@mui/material";
import { createGlassTheme } from "../glassTheme";
import { ThemeModeProvider, useThemeMode } from "../ThemeContext";
import { WindowFrame } from "../components/windows/shared/WindowTitlebar";
import { parseSpatiotemporalIdentity } from "./identity";
import LinkedWorkspaceWindow from "./LinkedWorkspaceWindow";
import SynchronizedWorkspaceContent from "./SynchronizedWorkspaceContent";
import type { SpatiotemporalRole } from "./types";

function ThemedWindow({ role }: { role: SpatiotemporalRole }) {
  const { themeMode } = useThemeMode();
  const theme = React.useMemo(() => createGlassTheme(themeMode), [themeMode]);
  const identity = React.useMemo(() => parseSpatiotemporalIdentity(role), [role]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {identity ? (
        <LinkedWorkspaceWindow identity={identity}>
          {(session) => (
            <SynchronizedWorkspaceContent identity={identity} session={session} />
          )}
        </LinkedWorkspaceWindow>
      ) : (
        <WindowFrame
          windowName={role === "timeline" ? "Timeline" : "Location"}
          title={`${role === "timeline" ? "Timeline" : "Location"} workspace`}
        >
          <Alert severity="error" sx={{ m: 2 }}>
            This window requires positive evidenceId and partitionId query parameters.
          </Alert>
        </WindowFrame>
      )}
    </ThemeProvider>
  );
}

export default function SpatiotemporalWindowApp({ role }: { role: SpatiotemporalRole }) {
  return (
    <ThemeModeProvider>
      <ThemedWindow role={role} />
    </ThemeModeProvider>
  );
}
