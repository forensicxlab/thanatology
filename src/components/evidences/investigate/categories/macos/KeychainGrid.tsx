import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  timestamp: "Modified (UTC)",
  secondaryTimestamp: "Created (UTC)",
  primary: "Service / server",
  secondary: "Account",
  tertiary: "Class",
  detail: "Access group",
  state: "Protection / format",
  numeric: "Port / count",
};

export default function KeychainGrid({
  evidenceId,
  partitionId,
  tag,
  category,
}: {
  evidenceId: number;
  partitionId: number;
  tag: string;
  category: "Users" | "System";
}) {
  return (
    <MacosArtifactGrid
      evidenceId={evidenceId}
      partitionId={partitionId}
      tag={tag}
      category={category}
      panel="keychain"
      labels={LABELS}
      defaultSortField="timestamp_ms"
      timeMode="intrinsic"
      timeNoun="keychain metadata records"
      timestampLabel="created or modified time"
      searchPlaceholder="Search service, account, class or access group"
      emptyMessage="No parsed macOS keychain metadata was found in this scope."
      notice="Keychain secrets remain encrypted. This panel permanently displays metadata only and does not attempt password, key, or token decryption."
    />
  );
}
