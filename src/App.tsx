import React, { useState } from "react";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import MiniDrawer from "./components/MiniDrawer";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import Dashboard from "./components/Dashboard";
import Cases from "./components/cases/Cases";
import Tasks from "./components/Tasks";
import Settings from "./components/Settings";
import FirstLaunch from "./components/firstLaunch/FirstLaunch";
import { SnackbarProvider } from "./components/SnackbarProvider";
import CaseCreationStepper from "./components/cases/steppers/CaseCreationStepper";
import DiskImage from "./components/preprocessing/DiskImage";
import { EvidenceData, ProcessedEvidenceMetadata } from "./dbutils/types";

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
    const users = await db.select("SELECT * from users");
    console.log(users);
    users ? setFirstLaunch(false) : setFirstLaunch(true);
  };

  React.useEffect(() => {
    loadDatabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dummyEvidenceData: EvidenceData = {
    evidenceName: "Dummy Disk Image",
    evidenceType: "Disk image",
    evidenceLocation:
      "/Users/k1nd0ne/Work/Thanatology/framework/samples/RAW/s4a-challenge4",
    evidenceDescription: "This is a dummy disk image used for testing.",
    sealNumber: "SEAL123",
    sealingDateTime: new Date().toISOString(),
    sealingLocation: "Test Lab",
    sealingPerson: "Test User",
    sealReason: "For testing purposes",
    sealReferenceFile: null,
  };

  const handlePreprocessingComplete = (metadata: ProcessedEvidenceMetadata) => {
    console.log("Preprocessing complete:", metadata);
  };

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
                <Route path="cases" element={<Cases />} />
                <Route path="case/new" element={<CaseCreationStepper />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="settings" element={<Settings />} />
                <Route
                  path="/evidence/preprocess"
                  element={
                    <DiskImage
                      evidenceData={dummyEvidenceData}
                      onComplete={handlePreprocessingComplete}
                    />
                  }
                />

                {/*
                <Route path="evidences/:id" element={<EvidenceDetail />} />
                <Route path="cases/:id" element={<CaseDetail />} /> */}
              </Route>
            </Routes>
          </Router>
        )}
      </SnackbarProvider>
    </ThemeProvider>
  );
};

export default App;
