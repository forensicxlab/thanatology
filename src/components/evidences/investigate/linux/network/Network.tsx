import React, { useCallback, useMemo } from "react";
import { GridColDef } from "@mui/x-data-grid-pro";
import ArtefactsGrid from "../../../../common/ArtefactsGrid";
import {
  SettingsEthernet,
  Dns,
  Security,
  Router,
  Build,
  NetworkWifi,
  VpnKey,
  Info,
} from "@mui/icons-material";
import {
  getNetworkInterfacesAndScripts,
  getDNSAndNameResolution,
  getFirewallConfig,
  getRoutingAndARP,
  getProxyAndAdditionalNetworkConfig,
  getNetworkManagerConfig,
  getSSHConfig,
} from "../../../../../dbutils/artefacts/network";
import { File } from "../../../../../dbutils/types";

interface NetworkArtefactRow {
  id: number;
  category: string;
  absolute_path: string;
  file_name?: string;
}

interface NetworkProps {
  evidenceId: number;
  partitionId: number;
}

const Network: React.FC<NetworkProps> = ({ evidenceId, partitionId }) => {
  /** Maps a category to its coloured icon */
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Network Interfaces / Scripts":
        return <SettingsEthernet sx={{ mr: 0.5 }} color="primary" />;
      case "DNS / Name Resolution":
        return <Dns sx={{ mr: 0.5 }} color="secondary" />;
      case "Firewall / Packet Filtering":
        return <Security sx={{ mr: 0.5 }} color="error" />;
      case "Routing and ARP":
        return <Router sx={{ mr: 0.5 }} color="warning" />;
      case "Proxy / Additional Network Config":
        return <Build sx={{ mr: 0.5 }} color="info" />;
      case "NetworkManager":
        return <NetworkWifi sx={{ mr: 0.5 }} color="action" />;
      case "SSH Configuration":
        return <VpnKey sx={{ mr: 0.5 }} color="primary" />;
      default:
        return <Info sx={{ mr: 0.5 }} />;
    }
  };

  /** One async function that returns the finished row array */
  const fetchRows = useCallback(async (): Promise<NetworkArtefactRow[]> => {
    const db = null;
    const [
      interfacesScripts,
      dnsNameResolution,
      firewallConfig,
      routingARP,
      proxyConfig,
      networkManager,
      sshConfig,
    ] = await Promise.all([
      getNetworkInterfacesAndScripts(db, evidenceId, partitionId),
      getDNSAndNameResolution(db, evidenceId, partitionId),
      getFirewallConfig(db, evidenceId, partitionId),
      getRoutingAndARP(db, evidenceId, partitionId),
      getProxyAndAdditionalNetworkConfig(db, evidenceId, partitionId),
      getNetworkManagerConfig(db, evidenceId, partitionId),
      getSSHConfig(db, evidenceId, partitionId),
    ]);

    const rows: NetworkArtefactRow[] = [];
    const add = (a: { category: string; files: File[] }) =>
      a.files.forEach((f) =>
        rows.push({
          id: f.id,
          category: a.category,
          absolute_path: f.absolute_path,
        }),
      );

    [
      interfacesScripts,
      dnsNameResolution,
      firewallConfig,
      routingARP,
      proxyConfig,
      networkManager,
      sshConfig,
    ].forEach(add);

    return rows;
  }, [evidenceId, partitionId]);

  /** Column definition is memoised to avoid recreating on every render */
  const columns: GridColDef<NetworkArtefactRow>[] = useMemo(
    () => [
      { field: "id", headerName: "ID", flex: 0.5 },
      {
        field: "category",
        headerName: "Category",
        flex: 1,
        renderCell: ({ value }) => (
          <span style={{ display: "flex", alignItems: "center" }}>
            {getCategoryIcon(value)} {value}
          </span>
        ),
      },
      { field: "absolute_path", headerName: "Source", flex: 2 },
      {
        field: "file_name",
        headerName: "File Name",
        flex: 1,
        valueGetter: (p) => p.value || p.row.absolute_path.split("/").pop(),
      },
    ],
    [],
  );

  return <ArtefactsGrid fetchRows={fetchRows} columns={columns} />;
};

export default Network;
