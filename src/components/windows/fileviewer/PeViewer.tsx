import React from "react";
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Chip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface PeViewerProps {
    data: any;
}

const SectionTable = ({ sections }: { sections: any[] }) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
        <Table size="small">
            <TableHead>
                <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Virtual Address</TableCell>
                    <TableCell>Virtual Size</TableCell>
                    <TableCell>Raw Size</TableCell>
                    <TableCell>Entropy</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {sections.map((section, index) => (
                    <TableRow key={index}>
                        <TableCell>{section.name}</TableCell>
                        <TableCell>{section.virtual_address}</TableCell>
                        <TableCell>{section.virtual_size}</TableCell>
                        <TableCell>{section.raw_size}</TableCell>
                        <TableCell>{section.entropy.toFixed(3)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>
);

const ImportsTable = ({ imports }: { imports: any[] }) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, maxHeight: 400 }}>
        <Table size="small" stickyHeader>
            <TableHead>
                <TableRow>
                    <TableCell>DLL</TableCell>
                    <TableCell>Function</TableCell>
                    <TableCell>RVA</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {imports.map((imp, index) => (
                    <TableRow key={index}>
                        <TableCell>{imp.dll}</TableCell>
                        <TableCell>{imp.name}</TableCell>
                        <TableCell>0x{imp.rva.toString(16)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>
);

const ExportsTable = ({ exports }: { exports: any[] }) => (
    <TableContainer component={Paper} variant="outlined" sx={{ mt: 2, maxHeight: 400 }}>
        <Table size="small" stickyHeader>
            <TableHead>
                <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>RVA</TableCell>
                    <TableCell>Offset</TableCell>
                </TableRow>
            </TableHead>
            <TableBody>
                {exports.map((exp, index) => (
                    <TableRow key={index}>
                        <TableCell>{exp.name || "(Ordinal)"}</TableCell>
                        <TableCell>0x{exp.rva.toString(16)}</TableCell>
                        <TableCell>0x{exp.offset.toString(16)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </TableContainer>
);

export const PeViewer: React.FC<PeViewerProps> = ({ data }) => {
    if (!data) return <Typography>No PE data available</Typography>;

    return (
        <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
            <Typography variant="h6" gutterBottom>
                Portable Executable Analysis
            </Typography>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2 }}>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2">Hashes</Typography>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
                            <Typography variant="body2">MD5: {data.hashes?.md5}</Typography>
                            <Typography variant="body2">SHA1: {data.hashes?.sha1}</Typography>
                            <Typography variant="body2">SHA256: {data.hashes?.sha256}</Typography>
                            <Typography variant="body2">Imphash: {data.hashes?.imphash}</Typography>
                        </Box>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2">Header Info</Typography>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1 }}>
                            <Typography variant="body2">Machine: {data.headers?.machine}</Typography>
                            <Typography variant="body2">Entry Point: {data.headers?.entry_point}</Typography>
                            <Typography variant="body2">Image Base: {data.headers?.image_base}</Typography>
                            <Typography variant="body2">Subsystem: {data.headers?.subsystem}</Typography>
                            <Box sx={{ mt: 1 }}>
                                {data.is_64bit && <Chip label="64-bit" size="small" color="primary" sx={{ mr: 1 }} />}
                                {data.is_lib && <Chip label="Library/DLL" size="small" color="secondary" />}
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Paper>

            <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Sections ({data.sections?.length || 0})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <SectionTable sections={data.sections || []} />
                </AccordionDetails>
            </Accordion>

            <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Imports ({data.imports?.length || 0})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <ImportsTable imports={data.imports || []} />
                </AccordionDetails>
            </Accordion>

            <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography>Exports ({data.exports?.length || 0})</Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <ExportsTable exports={data.exports || []} />
                </AccordionDetails>
            </Accordion>

            {data.rich_header && (
                <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography>Rich Header</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                            XOR Key: {data.rich_header.xor_key}
                        </Typography>
                        <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Product ID</TableCell>
                                        <TableCell>Build ID</TableCell>
                                        <TableCell>Count</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {data.rich_header.entries.map((entry: any, index: number) => (
                                        <TableRow key={index}>
                                            <TableCell>{entry.product_id}</TableCell>
                                            <TableCell>{entry.build_id}</TableCell>
                                            <TableCell>{entry.count}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </AccordionDetails>
                </Accordion>
            )}

        </Box>
    );
};
