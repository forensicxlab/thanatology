import React, { useState, useRef, useEffect } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Drawer from "@mui/material/Drawer";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import RemoveOutlinedIcon from "@mui/icons-material/RemoveOutlined";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import { invoke } from "@tauri-apps/api/core";

import Terminal from "../Terminal";
import { useEvidenceStore } from "../../store/evidenceStore";

interface TermDescriptor {
  id: number;
  label: string;
}

export default function BottomActionBar() {
  const [open, setOpen] = useState(false);
  const [openingAgent, setOpeningAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(window.innerHeight * 0.5);
  const [full, setFull] = useState(false);
  const activeEvidenceId = useEvidenceStore((state) => state.activeEvidenceId);

  const [tabs, setTabs] = useState<TermDescriptor[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const nextId = useRef(0);

  // Dragging state
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || full) return;
      const deltaY = startY.current - e.clientY;
      let newHeight = Math.min(
        window.innerHeight,
        Math.max(100, startHeight.current + deltaY),
      );
      setHeight(newHeight);
      e.preventDefault();
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [full]);

  const startResize = (e: React.MouseEvent) => {
    isResizing.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "ns-resize";
    e.preventDefault();
  };

  const toggleFullScreen = () => setFull((f) => !f);

  const handleToolbarToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && tabs.length === 0) {
        setTabs([{ id: nextId.current++, label: `Shell` }]);
        setActiveTab(0);
      }
      return next;
    });
  };

  const addTerminal = () => {
    setTabs((ts) => {
      const newTabs = [...ts, { id: nextId.current++, label: `Shell` }];
      setActiveTab(newTabs.length - 1);
      return newTabs;
    });
  };

  const closeTerminal = (id: number) => {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const remaining = ts.filter((t) => t.id !== id);

      setActiveTab((prev) => {
        if (remaining.length === 0) return 0;
        if (prev > idx) return prev - 1;
        if (prev === idx) return Math.max(0, idx - 1);
        return prev;
      });

      if (remaining.length === 0) {
        setOpen(false);
      }

      return remaining;
    });
  };

  const openAgentWorkspace = async () => {
    if (!activeEvidenceId || openingAgent) return;
    setOpeningAgent(true);
    setAgentError(null);
    try {
      await invoke("open_agent_window", { evidenceId: activeEvidenceId });
    } catch (error) {
      setAgentError(String(error));
    } finally {
      setOpeningAgent(false);
    }
  };

  return (
    <>
      <AppBar
        position="fixed"
        sx={(theme) => ({
          top: "auto",
          bottom: 0,
          height: 28,
          backgroundColor: theme.palette.background.paper,
          borderTop: `1px solid ${theme.palette.divider}`,
          zIndex: theme.zIndex.drawer + 2,
        })}
      >
        <Toolbar
          variant="dense"
          sx={{ minHeight: 28, justifyContent: "flex-end", px: 1, gap: 1 }}
        >
          <Tooltip
            title={
              activeEvidenceId
                ? "Open Exhume Agent workspace"
                : "Open an evidence investigation to use Exhume Agent"
            }
          >
            <span>
              <IconButton
                aria-label="Open Exhume Agent workspace"
                size="small"
                disabled={!activeEvidenceId || openingAgent}
                onClick={() => void openAgentWorkspace()}
              >
                <SmartToyIcon
                  fontSize="small"
                  color={activeEvidenceId ? "primary" : "inherit"}
                />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={handleToolbarToggle}>
            <TerminalIcon
              fontSize="small"
              color={open ? "primary" : "inherit"}
            />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        anchor="bottom"
        variant="persistent"
        open={open}
        onClose={() => setOpen(false)}
        hideBackdrop
        ModalProps={{ keepMounted: true }}
        slotProps={{
          paper: {
            sx: {
              height: full ? "100vh" : `${height}px`,
              p: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            },
          },
        }}
      >
        {/* Resize handle */}
        <Box
          sx={{
            height: 6,
            bgcolor: "divider",
            cursor: full ? "default" : "ns-resize",
            "&:hover": { bgcolor: "text.secondary" },
          }}
          onMouseDown={startResize}
        />

        <Toolbar variant="dense" sx={{ minHeight: 32, pr: 1 }}>
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ flex: 1, minHeight: 32 }}
          >
            {tabs.map((t, idx) => (
              <Tab
                key={t.id}
                value={idx}
                component="div"
                sx={{ minHeight: 32, maxHeight: 32 }}
                label={
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    {t.label}
                    <IconButton
                      size="small"
                      sx={{ ml: 0.5 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTerminal(t.id);
                      }}
                    >
                      <CloseIcon fontSize="inherit" />
                    </IconButton>
                  </Box>
                }
              />
            ))}
          </Tabs>

          <IconButton size="small" sx={{ ml: 0.5 }} onClick={addTerminal}>
            <AddIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" sx={{ ml: 0.5 }} onClick={toggleFullScreen}>
            {full ? (
              <CloseFullscreenIcon fontSize="small" />
            ) : (
              <OpenInFullIcon fontSize="small" />
            )}
          </IconButton>
          <IconButton
            size="small"
            sx={{ ml: 0.5 }}
            onClick={() => setOpen(false)}
          >
            <RemoveOutlinedIcon fontSize="small" />
          </IconButton>
        </Toolbar>

        <Box sx={{ flex: 1, position: "relative" }}>
          {tabs.map((t, idx) => (
            <Box
              key={t.id}
              sx={{
                display: idx === activeTab ? "block" : "none",
                height: "100%",
              }}
            >
              <Terminal />
            </Box>
          ))}
        </Box>
      </Drawer>

      <Snackbar
        open={agentError !== null}
        autoHideDuration={6000}
        onClose={() => setAgentError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          severity="error"
          variant="outlined"
          onClose={() => setAgentError(null)}
        >
          Failed to open Exhume Agent: {agentError}
        </Alert>
      </Snackbar>
    </>
  );
}
