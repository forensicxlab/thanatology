import React, { useState, useEffect } from "react";
import { ReactTerminal } from "react-terminal";
import Drawer from "@mui/material/Drawer";
import { Box, Fab } from "@mui/material";
import { TerminalContextProvider } from "react-terminal";
import { TerminalOutlined } from "@mui/icons-material";
import { Evidence } from "./evidences/lists/EvidenceList";
import { commands, setTerminalContext, getCwd } from "../commands/main";

interface TerminalProps {
  evidence: Evidence;
  partitionId: number;
}

const Terminal: React.FC<TerminalProps> = ({ evidence, partitionId }) => {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("/");

  const toggleDrawer = () => setOpen((prev) => !prev);

  // Set the terminal context when the component mounts or context changes.
  useEffect(() => {
    setTerminalContext(evidence.id, partitionId);
    setPrompt(getCwd());
  }, [evidence.id, partitionId]);

  // Update the prompt every 500ms to reflect the current working directory.
  useEffect(() => {
    const interval = setInterval(() => {
      setPrompt(getCwd());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Fab
        color="secondary"
        size="small"
        aria-label="new-terminal"
        onClick={toggleDrawer}
      >
        <TerminalOutlined />
      </Fab>
      <Drawer anchor="bottom" open={open} onClose={toggleDrawer}>
        <Box sx={{ height: "70vh", p: 2 }}>
          <TerminalContextProvider>
            <ReactTerminal
              commands={commands}
              showControlBar={false}
              prompt={prompt}
              theme="material-dark"
              errorMessage="command not found"
              welcomeMessage={evidence.name}
            />
          </TerminalContextProvider>
        </Box>
      </Drawer>
    </>
  );
};

export default Terminal;
