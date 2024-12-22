import { useState } from "react";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import MiniDrawer from "./components/MiniDrawer";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router";
import Dashboard from "./components/Dashboard";
import Cases from "./components/Cases";
import Tasks from "./components/Tasks";
import Settings from "./components/Settings";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const App: React.FC = () => {
  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { "test" }));
  // }
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Router>
        <Routes>
          <Route path="/" element={<MiniDrawer />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="cases" element={<Cases />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="settings" element={<Settings />} />
            {/*
            <Route path="evidences/:id" element={<EvidenceDetail />} />
            <Route path="cases/:id" element={<CaseDetail />} /> */}
          </Route>
        </Routes>
      </Router>
    </ThemeProvider>
  );
};

export default App;
