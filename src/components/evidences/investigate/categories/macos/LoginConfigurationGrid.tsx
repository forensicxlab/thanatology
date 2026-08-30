import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  primary: "User / item / phase",
  secondary: "Path / setting",
  tertiary: "Scope",
  detail: "Bundle / build",
  state: "Record kind",
  numeric: "Item count",
};

export default function LoginConfigurationGrid({
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
      panel="login_configuration"
      labels={LABELS}
      defaultSortField="tertiary_value"
      defaultSortDirection="asc"
      timeMode="timeless"
      timeNoun="login configuration records"
      searchPlaceholder="Search user, login item, hook, scope or source"
      emptyMessage="No parsed macOS login configuration was found in this scope."
    />
  );
}
