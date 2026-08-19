import MacosArtifactGrid, { MacosArtifactGridLabels } from "./MacosArtifactGrid";

const LABELS: MacosArtifactGridLabels = {
  timestamp: "Observed / connected (UTC)",
  secondaryTimestamp: "Expiry / captive login (UTC)",
  primary: "Network / service",
  secondary: "Interface / BSSID",
  tertiary: "Record type",
  detail: "Method / security / router",
  state: "Enabled / active",
  numeric: "Lease / mode",
};

export default function NetworkConfigurationView({
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
      category="Network"
      panel="network_configuration"
      labels={LABELS}
      defaultSortField="tertiary_value"
      defaultSortDirection="asc"
      searchPlaceholder="Search Wi-Fi, service, interface, IP or source"
      emptyMessage="No parsed macOS network configuration was found in this scope."
    />
  );
}
