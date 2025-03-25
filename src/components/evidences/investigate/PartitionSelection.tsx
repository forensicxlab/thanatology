import React, { useEffect, useState } from "react";
import { getSelectedPartitions } from "../../../dbutils/sqlite";
import { MBRPartitionEntry } from "../../../dbutils/types";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";

interface PartitionSelectionProps {
  evidenceId: number;
  onPartitionChange?: (partitionId: number | null) => void;
}

/**
 * PartitionSelection is a React component that:
 * 1) Fetches partitions associated with a given Evidence ID.
 * 2) Lists them in a <select> for user selection.
 * 3) Tracks the user-selected partition in state and notifies callers (onPartitionChange).
 */
export const PartitionSelection: React.FC<PartitionSelectionProps> = ({
  evidenceId,
  onPartitionChange,
}) => {
  const [partitions, setPartitions] = useState<MBRPartitionEntry[]>([]);
  const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Fetch the partitions on mount / whenever evidenceId changes
  useEffect(() => {
    const fetchPartitions = async () => {
      try {
        // If you have a custom DB instance, replace null accordingly:
        const db = null;
        const result = await getSelectedPartitions(evidenceId, db);
        setPartitions(result);
      } catch (err: any) {
        console.error("Failed to fetch partitions:", err);
        setError("Failed to load partition data.");
      }
    };
    fetchPartitions();
  }, [evidenceId]);

  // Handle user selection
  const handlePartitionChange = (event: SelectChangeEvent) => {
    const partitionId = parseInt(event.target.value, 10);
    setSelectedPartitionId(partitionId);
    onPartitionChange?.(partitionId);
  };

  if (error) {
    return <div style={{ color: "red" }}>{error}</div>;
  }

  // If you don’t want an immediate default selection, you can ensure the value is "" if null:
  return (
    <FormControl style={{ marginBottom: "1rem", minWidth: 200 }}>
      <InputLabel id="partition-selector-label">Partition</InputLabel>
      <Select
        labelId="partition-selector-label"
        id="partition-selector"
        label="Partition"
        value={selectedPartitionId?.toString() || ""}
        onChange={handlePartitionChange}
      >
        {partitions.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            Partition #{p.id} | {p.description}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};
