import React, { useState, useRef } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import Drawer from "@mui/material/Drawer";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import RemoveOutlinedIcon from "@mui/icons-material/RemoveOutlined";

// ────────────────────────────────────────────────────────────────────────────────
// Keep your existing xterm wrapper exactly as-is and just import it here.
// ────────────────────────────────────────────────────────────────────────────────
import Terminal from "./Terminal";

interface TermDescriptor {
  id: number;
  label: string;
}

/**
 * BottomActionBar — VS Code‑style bottom panel with terminal tabs.
 */
export default function BottomActionBar() {
  // ───────── Drawer state ─────────
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState<number>(window.innerHeight * 0.5); // px
  const [full, setFull] = useState(false);

  // ───────── Terminal‑manager state ─────────
  const [tabs, setTabs] = useState<TermDescriptor[]>([]); // start empty → auto‑spawn on first open
  const [activeTab, setActiveTab] = useState(0);
  const nextId = useRef(0);

  // ──────────────────────────────────────────────────────────────────────────────
  // Drawer helpers
  // ──────────────────────────────────────────────────────────────────────────────
  const toggleFullScreen = () => setFull((f) => !f);

  /**
   * Toggle drawer visibility from the toolbar icon.
   * – If opening and there are no tabs, create one automatically.
   */
  const handleToolbarToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && tabs.length === 0) {
        // lazily create the very first terminal
        setTabs([{ id: nextId.current++, label: `Shell` }]);
        setActiveTab(0);
      }
      return next;
    });
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // Tab helpers
  // ──────────────────────────────────────────────────────────────────────────────
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

      // update active tab index *after* computing remaining array
      setActiveTab((prev) => {
        if (remaining.length === 0) return 0; // will be ignored once drawer auto‑closes
        if (prev > idx) return prev - 1; // indices shifted left
        if (prev === idx) return Math.max(0, idx - 1); // select previous sibling
        return prev; // unaffected
      });

      // auto‑hide drawer if that was the last tab
      if (remaining.length === 0) {
        setOpen(false);
      }

      return remaining;
    });
  };

  // ──────────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ───────── Bottom app‑bar (quick actions) ───────── */}
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
          sx={{ minHeight: 28, justifyContent: "flex-end", px: 1 }}
        >
          <IconButton size="small" onClick={handleToolbarToggle}>
            {/* Change icon color when drawer is active */}
            <TerminalIcon
              fontSize="small"
              color={open ? "primary" : "inherit"}
            />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* ───────── Bottom Drawer (terminal pane) ───────── */}
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        hideBackdrop
        ModalProps={{ keepMounted: true }} // Preserve xterms while hidden
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
        {/* Drag‑bar / resize‑handle (placeholder, non‑interactive) */}
        <Box sx={{ height: 4, bgcolor: "divider", zIndex: 1 }} />

        {/* ───────── Tab‑bar & actions ───────── */}
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
                        e.stopPropagation(); // keep tab-selection intact
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

          {/* add / full‑screen / hide‑drawer buttons */}
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

        {/* ───────── Terminals themselves ───────── */}
        <Box sx={{ flex: 1, position: "relative" }}>
          {tabs.map((t, idx) => (
            <Box
              key={t.id}
              sx={{
                display: idx === activeTab ? "block" : "none",
                height: "100%",
              }}
            >
              {/*
                The Terminal component is responsible for spawning and wiring its PTY.
                We simply mount / unmount it.
              */}
              <Terminal />
            </Box>
          ))}
        </Box>
      </Drawer>
    </>
  );
}
