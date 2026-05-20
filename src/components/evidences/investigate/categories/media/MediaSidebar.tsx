import React, { useCallback, useMemo, useRef, useEffect } from "react";
import {
    Box,
    Chip,
    InputAdornment,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Paper,
    Stack,
    TextField,
    Typography,
} from "@mui/material";
import {
    Search as SearchIcon,
    Image as ImageIcon,
    Videocam as VideoIcon,
    AudioFile as AudioIcon,
    PhotoLibrary,
} from "@mui/icons-material";
import { FixedSizeList, ListChildComponentProps } from "react-window";
import type { File } from "../../../../../dbutils/types";
import type { MediaStats } from "../../../../../dbutils/sqlite";

/* ─── helpers ─────────────────────────────────────────────────────── */

const basename = (p?: string | null) => (p ? p.split(/[\\/]/).pop() || p : "");

const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const mimeIcon = (mime?: string | null) => {
    if (!mime) return <ImageIcon fontSize="small" />;
    if (mime.startsWith("video")) return <VideoIcon fontSize="small" />;
    if (mime.startsWith("audio")) return <AudioIcon fontSize="small" />;
    return <ImageIcon fontSize="small" />;
};

const mimeChipColor = (mime?: string | null): "primary" | "secondary" | "warning" => {
    if (!mime) return "primary";
    if (mime.startsWith("video")) return "secondary";
    if (mime.startsWith("audio")) return "warning";
    return "primary";
};

/* ─── types ───────────────────────────────────────────────────────── */

export interface MediaTypeFilter {
    images: boolean;
    videos: boolean;
    audio: boolean;
}

interface MediaSidebarProps {
    searchText: string;
    onSearchChange: (text: string) => void;
    typeFilter: MediaTypeFilter;
    onTypeFilterChange: (filter: MediaTypeFilter) => void;
    stats: MediaStats;
    files: File[];
    selectedFileId: number | null;
    onFileSelect: (file: File) => void;
}

/* ─── virtualised file row ────────────────────────────────────────── */

interface RowData {
    files: File[];
    selectedFileId: number | null;
    onFileSelect: (file: File) => void;
}

const FileRow = React.memo(function FileRow({
    index,
    style,
    data,
}: ListChildComponentProps<RowData>) {
    const { files, selectedFileId, onFileSelect } = data;
    const file = files[index];
    if (!file) return null;

    const isSelected = file.identifier === selectedFileId;

    return (
        <ListItemButton
            style={style}
            selected={isSelected}
            onClick={() => onFileSelect(file)}
            sx={{
                borderRadius: 1,
                mx: 0.5,
                transition: "background-color 0.15s ease",
                "&.Mui-selected": {
                    backgroundColor: "rgba(10, 132, 255, 0.18)",
                    "&:hover": { backgroundColor: "rgba(10, 132, 255, 0.24)" },
                },
            }}
        >
            <ListItemIcon sx={{ minWidth: 32 }}>
                {mimeIcon(file.sig_mime)}
            </ListItemIcon>
            <ListItemText
                primary={
                    <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontSize: "0.78rem", fontWeight: isSelected ? 600 : 400 }}
                    >
                        {basename(file.absolute_path)}
                    </Typography>
                }
                secondary={
                    <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                        <Chip
                            label={file.sig_mime?.split("/")[0]}
                            size="small"
                            color={mimeChipColor(file.sig_mime)}
                            variant="outlined"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                        />
                        <Typography component="span" variant="caption" sx={{ color: "text.secondary", fontSize: "0.65rem" }}>
                            {formatSize(file.size)}
                        </Typography>
                    </Stack>
                }
                slotProps={{ secondary: { component: "span" } }}
            />
        </ListItemButton>
    );
});

/* ─── main component ──────────────────────────────────────────────── */

const MediaSidebar: React.FC<MediaSidebarProps> = ({
    searchText,
    onSearchChange,
    typeFilter,
    onTypeFilterChange,
    stats,
    files,
    selectedFileId,
    onFileSelect,
}) => {
    const listRef = useRef<FixedSizeList>(null);

    // Scroll to selected file when it changes from gallery
    useEffect(() => {
        if (selectedFileId == null) return;
        const idx = files.findIndex((f) => f.identifier === selectedFileId);
        if (idx >= 0) {
            listRef.current?.scrollToItem(idx, "smart");
        }
    }, [selectedFileId, files]);

    const toggleType = useCallback(
        (type: keyof MediaTypeFilter) => {
            onTypeFilterChange({ ...typeFilter, [type]: !typeFilter[type] });
        },
        [typeFilter, onTypeFilterChange],
    );

    const itemData = useMemo<RowData>(
        () => ({ files, selectedFileId, onFileSelect }),
        [files, selectedFileId, onFileSelect],
    );

    return (
        <Paper
            variant="outlined"
            sx={{
                width: 320,
                minWidth: 320,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                borderRadius: 3,
            }}
        >
            {/* Search */}
            <Box sx={{ p: 1.5, pb: 1 }}>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="Search media files…"
                    value={searchText}
                    onChange={(e) => onSearchChange(e.target.value)}
                    slotProps={{
                        input: {
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
                                </InputAdornment>
                            ),
                        },
                    }}
                    sx={{
                        "& .MuiOutlinedInput-root": {
                            borderRadius: 2,
                            fontSize: "0.82rem",
                        },
                    }}
                />
            </Box>

            {/* Type filter chips */}
            <Stack direction="row" spacing={0.75} sx={{ px: 1.5, pb: 1 }}>
                <Chip
                    icon={<ImageIcon />}
                    label="Images"
                    size="small"
                    color={typeFilter.images ? "primary" : "default"}
                    variant={typeFilter.images ? "filled" : "outlined"}
                    onClick={() => toggleType("images")}
                    sx={{ fontSize: "0.72rem" }}
                />
                <Chip
                    icon={<VideoIcon />}
                    label="Videos"
                    size="small"
                    color={typeFilter.videos ? "secondary" : "default"}
                    variant={typeFilter.videos ? "filled" : "outlined"}
                    onClick={() => toggleType("videos")}
                    sx={{ fontSize: "0.72rem" }}
                />
                <Chip
                    icon={<AudioIcon />}
                    label="Audio"
                    size="small"
                    color={typeFilter.audio ? "warning" : "default"}
                    variant={typeFilter.audio ? "filled" : "outlined"}
                    onClick={() => toggleType("audio")}
                    sx={{ fontSize: "0.72rem" }}
                />
            </Stack>

            {/* Stats card */}
            <Paper
                elevation={0}
                sx={{
                    mx: 1.5,
                    mb: 1,
                    px: 1.5,
                    py: 1,
                    borderRadius: 2,
                    backgroundColor: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                }}
            >
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 0.5 }}>
                    <PhotoLibrary fontSize="small" sx={{ color: "primary.main", fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.72rem" }}>
                        Media Statistics
                    </Typography>
                </Stack>
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
                    {stats.images} Images · {stats.videos} Videos · {stats.audio} Audio
                    <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: "text.primary", fontWeight: 600, ml: 1, fontSize: "0.7rem" }}
                    >
                        {stats.total} Total
                    </Typography>
                </Typography>
            </Paper>

            {/* File list header */}
            <Box sx={{ px: 1.5, pb: 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, fontSize: "0.7rem" }}>
                    Files ({files.length})
                </Typography>
            </Box>

            {/* Virtualised file list */}
            <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                <FixedSizeList
                    ref={listRef}
                    height={600}
                    width="100%"
                    itemCount={files.length}
                    itemSize={56}
                    itemData={itemData}
                    overscanCount={8}
                    style={{ overflowX: "hidden" }}
                >
                    {FileRow}
                </FixedSizeList>
            </Box>
        </Paper>
    );
};

export default MediaSidebar;
