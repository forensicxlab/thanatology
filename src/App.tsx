import React from "react";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import Database from "@tauri-apps/plugin-sql";
import "./App.css";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import MiniDrawer from "./components/MiniDrawer";
import { BrowserRouter as Router, Routes, Route } from "react-router";
import Dashboard from "./components/Dashboard";
import Cases from "./components/cases/Cases";
import Tasks from "./components/Tasks";
import Settings from "./components/Settings";
import FirstLaunch from "./components/firstLaunch/FirstLaunch";
import { SnackbarProvider } from "./components/SnackbarProvider";
import CaseCreationStepper from "./components/cases/steppers/CaseCreationStepper";
import CaseDetails from "./components/cases/CaseDetails";
import PreProcessing from "./components/evidences/preprocessing/Preprocessing";
import Processing from "./components/evidences/processing/Processing";
import LinuxInvestigation from "./components/evidences/investigate/linux/Main";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const App: React.FC = () => {
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
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <SnackbarProvider>
        {firstLaunch ? (
          <FirstLaunch database={database} setFirstLaunch={setFirstLaunch} />
        ) : (
          <Router>
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
                <Route path="evidences/process/:id" element={<Processing />} />
                <Route
                  path="evidences/investigate/:id"
                  element={<LinuxInvestigation />}
                />
              </Route>
            </Routes>
          </Router>
        )}
      </SnackbarProvider>
    </ThemeProvider>
  );
};

export default App;
