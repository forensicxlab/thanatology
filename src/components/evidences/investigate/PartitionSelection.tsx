// thanatology/src/components/evidences/investigate/PartitionSelection.tsx
import React, { useEffect, useState } from "react";
import { getSelectedPartitions } from "../../../dbutils/sqlite";
import { MBRPartitionEntry, GPTPartitionEntry } from "../../../dbutils/types";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";

type PartitionKind = "MBR" | "GPT";

interface PartitionOption {
  /** Database primary-key */
  id: number;
  /** “MBR” or “GPT” so callers know which table to query next */
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

/**
 * <PartitionSelection>
 * ─────────────────────
 * Fetches the GPT *and* MBR partitions for an Evidence record
 * and lets the user pick one.  The (id, type) tuple is returned
 * via `onPartitionChange`, so call-sites can decide which table
 * to query next.
 */
export const PartitionSelection: React.FC<PartitionSelectionProps> = ({
  evidenceId,
  onPartitionChange,
}) => {
  const [partitions, setPartitions] = useState<PartitionOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>(""); // e.g. "GPT:3"
  const [error, setError] = useState<string | null>(null);

  /* ──────────────────────────────────────────────────────────
     Fetch partitions when the Evidence ID changes
  ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const fetchPartitions = async () => {
      try {
        const db = null; // provide your custom DB instance here if you have one
        const { mbrRows, gptRows } = await getSelectedPartitions(
          evidenceId,
          db,
        );
        /* Normalise rows → PartitionOption */
        const combined: PartitionOption[] = [
          ...mbrRows.map((row: MBRPartitionEntry) => ({
            id: row.id,
            type: "MBR" as const,
            description: row.description,
          })),
          ...gptRows.map((row: GPTPartitionEntry) => ({
            id: row.id,
            type: "GPT" as const,
            description: row.description,
          })),
        ];

        setPartitions(combined);
        setError(null);
      } catch (err) {
        console.error("Failed to fetch partitions:", err);
        setError("Failed to load partition data.");
      }
    };

    fetchPartitions();
  }, [evidenceId]);

  /* ──────────────────────────────────────────────────────────
     Change handler
  ────────────────────────────────────────────────────────── */
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

  /* ──────────────────────────────────────────────────────────
     Render
  ────────────────────────────────────────────────────────── */
  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }

  return (
    <FormControl style={{ marginBottom: "1rem", minWidth: 220 }}>
      <InputLabel id="partition-selector-label">Partition</InputLabel>
      <Select
        labelId="partition-selector-label"
        id="partition-selector"
        label="Partition"
        value={selectedKey}
        onChange={handlePartitionChange}
        displayEmpty
      >
        {/* MBR rows */}
        {partitions
          .filter((p) => p.type === "MBR")
          .map((p) => (
            <MenuItem key={`MBR:${p.id}`} value={`MBR:${p.id}`}>
              (MBR) Partition #{p.id}
              {p.description ? ` | ${p.description}` : ""}
            </MenuItem>
          ))}

        {/* GPT rows */}
        {partitions
          .filter((p) => p.type === "GPT")
          .map((p) => (
            <MenuItem key={`GPT:${p.id}`} value={`GPT:${p.id}`}>
              (GPT) Partition #{p.id}
              {p.description ? ` | ${p.description}` : ""}
            </MenuItem>
          ))}
      </Select>
    </FormControl>
  );
};
