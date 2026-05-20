import React, { useEffect, useState } from "react";
import { getPartitions } from "../../../dbutils/sqlite";
import {
  MBRPartitionEntry,
  GPTPartitionEntry,
  LogicalPartitionEntry,
} from "../../../dbutils/types";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";

type PartitionKind = "MBR" | "GPT" | "LOGICAL";

interface PartitionOption {
  id: number;
  type: PartitionKind;
  description?: string | null;
}

interface PartitionSelectionProps {
  onPartitionChange?: (
    partitionId: number | null,
    partitionType: PartitionKind | null,
  ) => void;
  evidenceId: number;
}

export const PartitionSelection: React.FC<PartitionSelectionProps> = ({
  evidenceId,
  onPartitionChange,
}) => {
  const [partitions, setPartitions] = useState<PartitionOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPartitions = async () => {
      try {
        const { mbrRows, gptRows, logicalRows } =
          await getPartitions(evidenceId);

        const combined: PartitionOption[] = [
          ...mbrRows.map((row: MBRPartitionEntry) => ({
            id: row.id,
            type: "MBR" as const,
            description: (row as any).description ?? null,
          })),
          ...gptRows.map((row: GPTPartitionEntry) => ({
            id: row.id,
            type: "GPT" as const,
            description: (row as any).description ?? null,
          })),
          ...logicalRows.map((row: LogicalPartitionEntry) => ({
            id: row.id,
            type: "LOGICAL" as const,
            description:
              row.description ??
              `Logical snapshot (${Intl.NumberFormat().format(row.size)} bytes)`,
          })),
        ];

        setPartitions(combined);
        setError(null);
        setSelectedKey("");
      } catch (err) {
        console.error("Failed to fetch partitions:", err);
        setError("Failed to load partition data.");
      }
    };

    fetchPartitions();
  }, [evidenceId]);

  const handlePartitionChange = (event: SelectChangeEvent) => {
    const value = event.target.value as string;
    setSelectedKey(value);

    if (!onPartitionChange) {
      return;
    }

    if (!value) {
      onPartitionChange(null, null);
      return;
    }

    const [type, idStr] = value.split(":");
    onPartitionChange(Number(idStr), type as PartitionKind);
  };

  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }

  const mbrItems = partitions.filter((p) => p.type === "MBR");
  const gptItems = partitions.filter((p) => p.type === "GPT");
  const logicalItems = partitions.filter((p) => p.type === "LOGICAL");

  return (
    <FormControl
      size="small"
      fullWidth
      sx={{
        minWidth: { xs: "100%", sm: 340 },
        maxWidth: { xs: "100%", md: 460 },
        mb: 0,
      }}
    >
      <InputLabel id="partition-selector-label">Select a partition</InputLabel>
      <Select
        labelId="partition-selector-label"
        id="partition-selector"
        label="Select a partition"
        value={selectedKey}
        onChange={handlePartitionChange}
      >
        {logicalItems.length > 0 && (
          <MenuItem disabled sx={{ opacity: 0.7, typography: "caption" }}>
            Logical
          </MenuItem>
        )}
        {logicalItems.map((p) => (
          <MenuItem key={`LOGICAL:${p.id}`} value={`LOGICAL:${p.id}`}>
            (LOGICAL) #{p.id}
            {p.description ? ` | ${p.description}` : ""}
          </MenuItem>
        ))}

        {mbrItems.length > 0 && (
          <MenuItem disabled sx={{ opacity: 0.7, typography: "caption" }}>
            MBR
          </MenuItem>
        )}
        {mbrItems.map((p) => (
          <MenuItem key={`MBR:${p.id}`} value={`MBR:${p.id}`}>
            (MBR) #{p.id}
            {p.description ? ` | ${p.description}` : ""}
          </MenuItem>
        ))}

        {gptItems.length > 0 && (
          <MenuItem disabled sx={{ opacity: 0.7, typography: "caption" }}>
            GPT
          </MenuItem>
        )}
        {gptItems.map((p) => (
          <MenuItem key={`GPT:${p.id}`} value={`GPT:${p.id}`}>
            (GPT) #{p.id}
            {p.description ? ` | ${p.description}` : ""}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
