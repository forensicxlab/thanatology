import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  timestamp: "Quarantined (UTC)",
  primary: "Agent",
  secondary: "Downloaded URL",
  tertiary: "Origin URL",
  detail: "Origin / sender",
  state: "Event ID",
  numeric: "Type",
};

export default function QuarantineGrid({
  evidenceId,
  partitionId,
  tag,
}: {
  evidenceId: number;
  partitionId: number;
  tag: string;
}) {
  return (
    <MacosArtifactGrid
      evidenceId={evidenceId}
      partitionId={partitionId}
      tag={tag}
      category="Users"
      panel="quarantine"
      labels={LABELS}
      defaultSortField="timestamp_ms"
      timeMode="intrinsic"
      timeNoun="quarantine events"
      timestampLabel="quarantine time"
      searchPlaceholder="Search agent, URL, origin, sender or source"
      emptyMessage="No parsed macOS quarantine events were found in this scope."
    />
  );
}
