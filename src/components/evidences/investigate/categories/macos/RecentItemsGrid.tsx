import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  primary: "Item",
  secondary: "Target path",
  tertiary: "Recent list",
  detail: "Volume",
  state: "Bookmark UUID",
  numeric: "CNIDs",
};

export default function RecentItemsGrid({
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
      panel="recent_items"
      labels={LABELS}
      defaultSortField="primary_value"
      defaultSortDirection="asc"
      searchPlaceholder="Search recent item, path, list or source"
      emptyMessage="No parsed macOS recent items were found in this scope."
    />
  );
}
