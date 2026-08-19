import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  primary: "Launchd label",
  secondary: "Executable",
  tertiary: "Job type",
  detail: "Domain",
  state: "Launch state",
  numeric: "Interval (s)",
};

export default function PersistenceGrid({
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
      panel="persistence"
      labels={LABELS}
      defaultSortField="primary_value"
      defaultSortDirection="asc"
      searchPlaceholder="Search label, executable, domain or source"
      emptyMessage="No parsed macOS launchd persistence records were found in this scope."
    />
  );
}
