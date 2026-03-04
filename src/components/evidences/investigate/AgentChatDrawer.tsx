import React, { useState, useRef, useEffect } from "react";
import Drawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import AgentChat from "./AgentChat";

interface AgentChatDrawerProps {
    open: boolean;
    onClose: () => void;
}

const AgentChatDrawer: React.FC<AgentChatDrawerProps> = ({ open, onClose }) => {
    const [width, setWidth] = useState<number>(window.innerWidth * 0.3); // Default 30% width
    const [full, setFull] = useState(false);

    // Dragging state
    const isResizing = useRef(false);
    const startX = useRef(0);
    const startWidth = useRef(0);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || full) return;
            // When dragging from the left edge, moving left increases width (since it's anchored right)
            const deltaX = startX.current - e.clientX;
            let newWidth = Math.min(
                window.innerWidth * 0.9, // Max 90%
                Math.max(300, startWidth.current + deltaX) // Min 300px
            );
            setWidth(newWidth);
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
        startX.current = e.clientX;
        startWidth.current = width;
        document.body.style.cursor = "ew-resize";
        e.preventDefault();
    };

    const toggleFullScreen = () => setFull((f) => !f);

    return (
        <Drawer
            anchor="right"
            variant="persistent"
            open={open}
            onClose={onClose}
            hideBackdrop
            ModalProps={{ keepMounted: true }}
            slotProps={{
                paper: {
                    sx: {
                        width: full ? "100vw" : `${width}px`,
                        p: 0,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "row", // Handle on left, content on right
                        zIndex: (theme) => theme.zIndex.drawer + 3,
                        borderLeft: "1px solid",
                        borderColor: "divider",
                    },
                },
            }}
        >
            {/* Resize handle (Left side of the drawer) */}
            <Box
                sx={{
                    width: 6,
                    bgcolor: "divider",
                    cursor: full ? "default" : "ew-resize",
                    "&:hover": { bgcolor: "text.secondary" },
                    height: "100%",
                }}
                onMouseDown={startResize}
            />

            {/* Main Content Area */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Toolbar variant="dense" sx={{ minHeight: 40, borderBottom: 1, borderColor: "divider", px: 1, justifyContent: "space-between" }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: "bold" }}>Agent Copilot</Typography>
                    <Box>
                        <IconButton size="small" onClick={toggleFullScreen}>
                            {full ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
                        </IconButton>
                        <IconButton size="small" onClick={onClose}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                </Toolbar>

                <Box sx={{ flex: 1, overflow: "hidden" }}>
                    <AgentChat />
                </Box>
            </Box>
        </Drawer>
    );
};

export default AgentChatDrawer;
