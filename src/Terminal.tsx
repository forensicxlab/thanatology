import { ReactTerminal } from "react-terminal";

import React, { useState } from "react";
import Drawer from "@mui/material/Drawer";
import { Box, Fab } from "@mui/material";
import { TerminalContextProvider } from "react-terminal";
import { TerminalOutlined } from "@mui/icons-material";
import { Evidence } from "./components/evidences/lists/EvidenceList";

interface TerminalProps {
  evidence: Evidence;
}

const Terminal: React.FC<TerminalProps> = ({ evidence }) => {
  const commands = {
    whoami: "jackharper",
    cd: (directory: any) => `changed path to ${directory}`,
  };

  const [open, setOpen] = useState(false);

  const toggleDrawer = () => {
    setOpen((prev) => !prev);
  };

  return (
    <>
      {/* This button can go anywhere in your UI to trigger the drawer */}
      <Fab color="secondary" aria-label="add" onClick={toggleDrawer}>
        <TerminalOutlined />
      </Fab>

      <Drawer anchor="bottom" open={open} onClose={toggleDrawer}>
        {/* You can tweak the height and other styling here */}
        <Box sx={{ height: "40vh", p: 2 }}>
          <TerminalContextProvider>
            <ReactTerminal
              commands={commands}
              themes={{
                thanatology: {
                  themeBGColor: "#121212",
                  themeToolbarColor: "#121212",
                  themeColor: "#FFFFFF",
                  themePromptColor: "#a917a8",
                },
              }}
              showControlBar={false}
              prompt="/"
              theme="thanatology"
              welcomeMessage={evidence.name}
            />
          </TerminalContextProvider>
        </Box>
      </Drawer>
    </>
  );
};

export default Terminal;
