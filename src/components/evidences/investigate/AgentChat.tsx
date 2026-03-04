import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, Typography, Paper, CircularProgress, List, ListItem, ListItemButton, ListItemText } from "@mui/material";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useEvidenceStore } from '../../../store/evidenceStore';

interface MentionFileResult {
    file_id: number;
    partition_id: number;
    name: string;
    absolute_path: string;
}

interface Report {
    summary: string;
    findings: string[];
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    backendContent?: string;
    report?: Report;
}

const AgentChat: React.FC = () => {
    const { activeEvidenceDbPath } = useEvidenceStore();
    const [instruction, setInstruction] = useState("");
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Mention state
    const [mentionResults, setMentionResults] = useState<MentionFileResult[]>([]);
    const [contextFiles, setContextFiles] = useState<MentionFileResult[]>([]);
    const [isMentionOpen, setIsMentionOpen] = useState(false);
    const [mentionIndex, setMentionIndex] = useState(-1);
    const textFieldRef = useRef<HTMLTextAreaElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);

    const handleInstructionChange = async (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        setInstruction(value);

        // Simple check for @ mention
        const cursorPosition = e.target.selectionStart || 0;
        const textBeforeCursor = value.slice(0, cursorPosition);

        // Match @ followed by any word characters leading up to cursor
        const match = textBeforeCursor.match(/@([\w.-]*)$/);

        if (match) {
            const query = match[1];
            if (query.length > 0) {
                setIsMentionOpen(true);
                setMentionIndex(match.index || 0);
                try {
                    const results = await invoke<MentionFileResult[]>("search_files_for_mention", {
                        evidenceDbPath: activeEvidenceDbPath,
                        query: query,
                    });
                    setMentionResults(results);
                } catch (err) {
                    console.error("Failed to search mention:", err);
                    setMentionResults([]);
                }
            } else {
                setIsMentionOpen(false);
                setMentionResults([]);
            }
        } else {
            setIsMentionOpen(false);
            setMentionResults([]);
        }
    };

    const handleMentionSelect = (file: MentionFileResult) => {
        if (mentionIndex !== -1) {
            const before = instruction.slice(0, mentionIndex);

            // Find the end of the current mention word to replace it
            const afterCursor = instruction.slice(mentionIndex);
            const spaceIndex = afterCursor.indexOf(" ");
            const after = spaceIndex !== -1 ? afterCursor.slice(spaceIndex) : "";

            // Inject just the clean syntax visually
            const injectedText = `@${file.name}`;

            setInstruction(before + injectedText + after + " ");
            setContextFiles(prev => {
                const newFiles = prev.filter(f => f.file_id !== file.file_id);
                return [...newFiles, file];
            });
        }
        setIsMentionOpen(false);
        setMentionResults([]);
        setMentionIndex(-1);
    };

    const handleInvestigate = async () => {
        if (!instruction.trim()) return;

        const currentInstruction = instruction;
        setInstruction(""); // Clear input box explicitly immediately
        setContextFiles([]); // Flush contexts
        setLoading(true);
        setError(null);

        let processedInstruction = currentInstruction;
        contextFiles.forEach(file => {
            const safeName = file.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`@${safeName}\\b`, 'g');
            processedInstruction = processedInstruction.replace(
                regex,
                `@${file.name} (identifier: ${file.file_id}, partition_id: ${file.partition_id})`
            );
        });

        // Assemble prior messages for LLM context without sending explicit parsed reports back
        const historyData = messages.map(m => ({ role: m.role, content: m.backendContent || m.content }));

        // Optimistically put user's message in the thread feed
        setMessages(prev => [...prev, { role: "user", content: currentInstruction, backendContent: processedInstruction }]);

        try {
            const aiProvider = localStorage.getItem("aiProvider") || "ollama";
            const aiEndpoint = localStorage.getItem("aiEndpoint") || "http://localhost:11434";
            const aiModel = localStorage.getItem("aiModel") || "llama3.1:latest";
            const aiApiKey = localStorage.getItem("aiApiKey") || "";

            const response = await invoke<Report>("investigate_with_agent", {
                evidenceDbPath: activeEvidenceDbPath,
                instruction: processedInstruction,
                history: historyData,
                aiProvider,
                aiEndpoint,
                aiModel,
                aiApiKey,
            });

            setMessages(prev => [...prev, { role: "assistant", content: response.summary, report: response }]);
        } catch (err) {
            console.error("Agent error:", err);
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    if (!activeEvidenceDbPath) {
        return (
            <Box sx={{ p: 2, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Typography color="text.secondary">Please open an evidence case to start investigating.</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", gap: 2 }}>

            {/* Scrollable Chat Area */}
            <Box sx={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                <Box>
                    <Typography variant="h6">Investigator Copilot</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Ask the agent to investigate the extracted evidence database.
                    </Typography>
                </Box>

                {error && (
                    <Paper sx={{ p: 2, bgcolor: "error.light", color: "error.contrastText" }}>
                        <Typography variant="subtitle2">Error during investigation:</Typography>
                        <Typography variant="body2">{error}</Typography>
                    </Paper>
                )}

                {messages.map((msg, index) => (
                    <Paper
                        key={index}
                        sx={{
                            p: 2,
                            display: "flex",
                            flexDirection: "column",
                            gap: 1,
                            bgcolor: msg.role === "user" ? "action.hover" : "background.paper",
                            ml: msg.role === "user" ? 6 : 0,
                            mr: msg.role === "assistant" ? 6 : 0,
                        }}
                    >
                        <Typography variant="subtitle2" color={msg.role === "user" ? "text.secondary" : "primary"}>
                            {msg.role === "user" ? "You" : "Investigator Copilot"}
                        </Typography>

                        <Box sx={{ "& *": { fontFamily: "inherit", margin: 0 } }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                            </ReactMarkdown>
                        </Box>

                        {msg.report?.findings && msg.report.findings.length > 0 && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="caption" color="text.secondary" gutterBottom>Structured Findings</Typography>
                                <ul>
                                    {msg.report.findings.map((f, i) => (
                                        <li key={i} style={{ fontSize: '0.875rem' }}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{f}</ReactMarkdown>
                                        </li>
                                    ))}
                                </ul>
                            </Box>
                        )}
                    </Paper>
                ))}
            </Box>

            {/* Bottom Fixed Input Area */}
            <Box sx={{ display: "flex", flexDirection: "column" }}>
                {(messages.length > 0 || error || instruction.length > 0) && (
                    <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
                        <Button
                            color="inherit"
                            size="small"
                            variant="text"
                            onClick={() => {
                                setMessages([]);
                                setError(null);
                                setInstruction("");
                                setContextFiles([]);
                                setIsMentionOpen(false);
                            }}
                        >
                            Clear Chat
                        </Button>
                    </Box>
                )}

                <Box sx={{ display: "flex", gap: 1, position: "relative", alignItems: "flex-end" }}>
                    <Box sx={{
                        position: "relative",
                        flex: 1,
                        minHeight: "56px",
                        backgroundColor: "background.paper",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1,
                        "&:hover": { borderColor: "text.primary" },
                        "&:focus-within": { borderColor: "primary.main", borderWidth: 2 },
                        overflow: "hidden"
                    }}>
                        {/* Highlights Overlay */}
                        <Box
                            ref={backdropRef}
                            sx={{
                                position: "absolute",
                                top: 0, left: 0, right: 0, bottom: 0,
                                padding: "16.5px 14px", // Matches textarea
                                margin: 0,
                                fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
                                fontSize: "1rem",
                                lineHeight: "1.5",
                                letterSpacing: "0.00938em",
                                whiteSpace: "pre-wrap",
                                wordWrap: "break-word",
                                color: "transparent",
                                overflowY: "auto",
                                overflowX: "hidden",
                                pointerEvents: "none",
                                zIndex: 0,
                                scrollbarWidth: "none",
                                "&::-webkit-scrollbar": { display: "none" },
                            }}
                        >
                            {(() => {
                                if (contextFiles.length === 0) return instruction + "\n";
                                const names = contextFiles.map(f => f.name).sort((a, b) => b.length - a.length);
                                const escapedNames = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                                const regex = new RegExp(`(@(?:${escapedNames.join('|')}))\\b`, 'g');
                                const parts = instruction.split(regex);
                                return parts.map((part, i) => {
                                    if (part && part.startsWith('@') && names.includes(part.slice(1))) {
                                        return <mark key={i} style={{ backgroundColor: 'rgba(25, 118, 210, 0.4)', color: 'transparent', borderRadius: '4px' }}>{part}</mark>;
                                    }
                                    return <span key={i}>{part}</span>;
                                }).concat(<span key="end">{"\n"}</span>);
                            })()}
                        </Box>

                        {/* Text Input */}
                        <Box
                            component="textarea"
                            ref={textFieldRef}
                            placeholder="E.g., Find all Windows Registry files and list their paths."
                            value={instruction}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleInstructionChange(e)}
                            onScroll={(e: React.UIEvent<HTMLTextAreaElement>) => {
                                if (backdropRef.current) {
                                    backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                                }
                            }}
                            onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                                if (isMentionOpen && mentionResults.length > 0) {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        handleMentionSelect(mentionResults[0]);
                                        return;
                                    }
                                    if (e.key === "Escape") {
                                        setIsMentionOpen(false);
                                        return;
                                    }
                                }

                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleInvestigate();
                                }
                            }}
                            disabled={loading}
                            sx={{
                                position: "absolute",
                                top: 0, left: 0,
                                width: "100%", height: "100%",
                                padding: "16.5px 14px", // Matches overlay
                                margin: 0,
                                border: "none",
                                outline: "none",
                                background: "transparent",
                                resize: "none",
                                fontFamily: '"Roboto","Helvetica","Arial",sans-serif',
                                fontSize: "1rem",
                                lineHeight: "1.5",
                                letterSpacing: "0.00938em",
                                boxSizing: "border-box",
                                color: "text.primary",
                                zIndex: 2
                            }}
                        />
                    </Box>
                    <Button
                        variant="contained"
                        onClick={handleInvestigate}
                        disabled={loading || !instruction.trim()}
                        sx={{ mb: 0.5 }} // Slight margin to align baseline with multiline input
                    >
                        {loading ? <CircularProgress size={24} /> : "Ask"}
                    </Button>

                    {isMentionOpen && mentionResults.length > 0 && (
                        <Paper
                            elevation={4}
                            sx={{
                                position: "absolute",
                                bottom: "100%", // Float upwards
                                left: 0,
                                right: 0,
                                zIndex: 10,
                                maxHeight: 200,
                                overflow: "auto",
                                mb: 1,
                            }}
                        >
                            <List dense>
                                {mentionResults.map((res, i) => (
                                    <ListItem disablePadding key={`${res.file_id}-${i}`}>
                                        <ListItemButton onClick={() => handleMentionSelect(res)}>
                                            <ListItemText
                                                primary={res.name}
                                                secondary={res.absolute_path}
                                                secondaryTypographyProps={{ style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                ))}
                            </List>
                        </Paper>
                    )}
                </Box>
            </Box>
        </Box>
    );
};

export default AgentChat;
