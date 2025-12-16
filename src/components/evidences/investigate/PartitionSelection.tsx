// thanatology/src/components/evidences/investigate/PartitionSelection.tsx
import React, { useEffect, useState } from "react";
import { getPartitions, getSelectedPartitions } from "../../../dbutils/sqlite";
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
  /** Database primary-key */
  id: number;
  /** “MBR” | “GPT” | “LOGICAL” so callers know which table to query next */
  type: PartitionKind;
  /** Short text shown to the user */
  description?: string | null;
}

interface PartitionSelectionProps {
  evidenceId: number;
  /**
   * Receives the id **and** kind of the selected partition.
   * When the select is cleared, both values are `null`.
   */
  onPartitionChange?: (
    partitionId: number | null,
    partitionType: PartitionKind | null,
  ) => void;
}

export const PartitionSelection: React.FC<PartitionSelectionProps> = ({
  evidenceId,
  onPartitionChange,
}) => {
  const [partitions, setPartitions] = useState<PartitionOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(""); // e.g. "GPT:3"
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPartitions = async () => {
      try {
        const { mbrRows, gptRows, logicalRows } =
          await getPartitions(evidenceId);

        // Normalise rows → PartitionOption
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
            // Fall back to a sensible label if description isn't present
            description:
              row.description ??
              `Logical snapshot (${Intl.NumberFormat().format(row.size)} bytes)`,
          })),
        ];

        setPartitions(combined);
        setError(null);
        setSelectedKey(""); // reset selection when evidence changes
      } catch (err) {
        console.error("Failed to fetch partitions:", err);
        setError("Failed to load partition data.");
      }
    };

    fetchPartitions();
  }, [evidenceId]);

  const handlePartitionChange = (event: SelectChangeEvent) => {
    const value = event.target.value as string; // e.g. "GPT:5"
    setSelectedKey(value);

    if (!onPartitionChange) return;

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

  // Prepare groups so the UI is tidy
  const mbrItems = partitions.filter((p) => p.type === "MBR");
  const gptItems = partitions.filter((p) => p.type === "GPT");
  const logicalItems = partitions.filter((p) => p.type === "LOGICAL");

  return (
    <FormControl style={{ marginBottom: "1rem", minWidth: 260 }}>
      <InputLabel id="partition-selector-label">Partition</InputLabel>
      <Select
        labelId="partition-selector-label"
        id="partition-selector"
        label="Partition"
        value={selectedKey}
        onChange={handlePartitionChange}
        displayEmpty
      >
        {/* LOGICAL rows */}
        {logicalItems.length > 0 && (
          <MenuItem disabled style={{ opacity: 0.7 }}>
            — Logical —
          </MenuItem>
        )}
        {logicalItems.map((p) => (
          <MenuItem key={`LOGICAL:${p.id}`} value={`LOGICAL:${p.id}`}>
            (LOGICAL) #{p.id}
            {p.description ? ` | ${p.description}` : ""}
          </MenuItem>
        ))}

        {/* MBR rows */}
        {mbrItems.length > 0 && (
          <MenuItem disabled style={{ opacity: 0.7 }}>
            — MBR —
          </MenuItem>
        )}
        {mbrItems.map((p) => (
          <MenuItem key={`MBR:${p.id}`} value={`MBR:${p.id}`}>
            (MBR) #{p.id}
            {p.description ? ` | ${p.description}` : ""}
          </MenuItem>
        ))}

        {/* GPT rows */}
        {gptItems.length > 0 && (
          <MenuItem disabled style={{ opacity: 0.7 }}>
            — GPT —
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
