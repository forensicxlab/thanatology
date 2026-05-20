import React from "react";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import Database from "@tauri-apps/plugin-sql";
import "./App.css";
import { ThemeProvider } from "@mui/material";
import CssBaseline from "@mui/material/CssBaseline";
import MiniDrawer from "./components/navigation/MiniDrawer";
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router";
import Dashboard from "./components/Dashboard";
import Cases from "./components/cases/Cases";
import Tasks from "./components/Tasks";
import Settings from "./components/Settings";
import FirstLaunch from "./components/firstLaunch/FirstLaunch";
import { SnackbarProvider } from "./components/SnackbarProvider";
import CaseCreationStepper from "./components/cases/steppers/CaseCreationStepper";
import CaseDetails from "./components/cases/CaseDetails";
import PreProcessing from "./components/evidences/preprocessing/PreProcessing";
import Processing from "./components/evidences/processing/Processing";
import LinuxInvestigation from "./components/evidences/investigate/Main";
import { LicenseInfo } from "@mui/x-license";
import RawViewer from "./RawViewer";
import { createGlassTheme } from "./glassTheme";
import { NavHistoryProvider } from "./components/navigation/NavHistory";
import { ThemeModeProvider, useThemeMode } from "./ThemeContext";

const ViewerRoute: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <RawViewer
      fileId={parseInt(id ?? "0", 10)}
      fileSize={0}
      height="80vh"
      language="plaintext"
      theme="vs-dark"
      chunkSize={64 * 1024}
    />
  );
};

LicenseInfo.setLicenseKey("LICENCE_KEY_HERE");

const AppWithTheme: React.FC = () => {
  const { themeMode } = useThemeMode();
  const theme = React.useMemo(() => createGlassTheme(themeMode), [themeMode]);

  const [database, setDatabase] = React.useState<Database | null>(null);
  const [firstLaunch, setFirstLaunch] = React.useState<Boolean>(false);

  const loadDatabase = async () => {
    const db = await Database.load("sqlite:thanatology.db");
    setDatabase(db);
    const users: Array<any> = await db.select("SELECT * from users");
    console.log(users);
    users.length > 0 ? setFirstLaunch(false) : setFirstLaunch(true);
  };

  React.useEffect(() => {
    loadDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider>
        {firstLaunch ? (
          <FirstLaunch database={database} setFirstLaunch={setFirstLaunch} />
        ) : (
          <Router>
            <NavHistoryProvider>
              <Routes>
                <Route path="/" element={<MiniDrawer />}>
                  <Route path="" element={<Dashboard />} />
                  <Route path="cases" element={<Cases database={database} />} />
                  <Route
                    path="case/new"
                    element={<CaseCreationStepper database={database} />}
                  />
                  <Route path="tasks" element={<Tasks />} />
                  <Route path="settings" element={<Settings />} />
                  <Route
                    path="cases/:id"
                    element={<CaseDetails database={database} />}
                  />
                  <Route
                    path="evidences/preprocess/:id"
                    element={<PreProcessing database={database} />}
                  />
                  <Route
                    path="evidences/process/:id"
                    element={<Processing />}
                  />
                  <Route
                    path="evidences/investigate/:id"
                    element={<LinuxInvestigation />}
                  />
                  <Route path="viewer/:id" element={<ViewerRoute />} />
                </Route>
              </Routes>
            </NavHistoryProvider>
          </Router>
        )}
      </SnackbarProvider>
    </ThemeProvider>
  );
};

const App: React.FC = () => (
  <ThemeModeProvider>
    <AppWithTheme />
  </ThemeModeProvider>
);

export default App;
