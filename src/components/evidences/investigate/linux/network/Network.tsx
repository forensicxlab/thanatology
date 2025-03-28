// thanatology/src/components/evidences/investigate/linux/network/Network.tsx
import React, { useEffect, useState } from "react";
import { DataGridPro, GridColDef, GridToolbar } from "@mui/x-data-grid-pro";
import { Box, Backdrop, CircularProgress } from "@mui/material";
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
import { LinuxFile } from "../../../../../dbutils/types";

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
  const [rows, setRows] = useState<NetworkArtefactRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Returns a colorful icon based on the artefact category.
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Network Interfaces / Scripts":
        return <SettingsEthernet style={{ marginRight: 4 }} color="primary" />;
      case "DNS / Name Resolution":
        return <Dns style={{ marginRight: 4 }} color="secondary" />;
      case "Firewall / Packet Filtering":
        return <Security style={{ marginRight: 4 }} color="error" />;
      case "Routing and ARP":
        return <Router style={{ marginRight: 4 }} color="warning" />;
      case "Proxy / Additional Network Config":
        return <Build style={{ marginRight: 4 }} color="info" />;
      case "NetworkManager":
        return <NetworkWifi style={{ marginRight: 4 }} color="action" />;
      case "SSH Configuration":
        return <VpnKey style={{ marginRight: 4 }} color="primary" />;
      default:
        return <Info style={{ marginRight: 4 }} />;
    }
  };

  useEffect(() => {
    const fetchArtefacts = async () => {
      try {
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

        // Combine each artefact group into one single list.
        const allArtefacts: NetworkArtefactRow[] = [];
        const addFiles = (artefact: {
          category: string;
          files: LinuxFile[];
        }) => {
          artefact.files.forEach((file) => {
            allArtefacts.push({
              id: file.id, // assuming each LinuxFile has a unique id
              category: artefact.category,
              absolute_path: file.absolute_path,
              file_name: file.filename, // if available – otherwise we'll derive from path
            });
          });
        };

        [
          interfacesScripts,
          dnsNameResolution,
          firewallConfig,
          routingARP,
          proxyConfig,
          networkManager,
          sshConfig,
        ].forEach(addFiles);

        setRows(allArtefacts);
      } catch (err) {
        console.error(err);
        setError("Failed to load network artefacts.");
      } finally {
        setLoading(false);
      }
    };

    fetchArtefacts();
  }, [evidenceId, partitionId]);

  // Define the DataGrid columns.
  const columns: GridColDef[] = [
    {
      field: "id",
      headerName: "ID",
      flex: 0.5,
    },
    {
      field: "category",
      headerName: "Category",
      flex: 1,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {getCategoryIcon(params.value)}
          <span>{params.value}</span>
        </div>
      ),
    },
    {
      field: "absolute_path",
      headerName: "Source",
      flex: 2,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value}
        </div>
      ),
    },
    {
      field: "file_name",
      headerName: "File Name",
      flex: 1,
      renderCell: (params) => (
        <div style={{ display: "flex", alignItems: "center" }}>
          {params.value || params.row.absolute_path.split("/").pop()}
        </div>
      ),
    },
  ];

  return (
    <Box sx={{ height: "80vh", width: "100%" }}>
      {loading ? (
        <Backdrop
          sx={(theme) => ({ color: "#fff", zIndex: theme.zIndex.drawer + 1 })}
          open={loading}
        >
          <CircularProgress color="inherit" />
        </Backdrop>
      ) : error ? (
        <div style={{ color: "red" }}>{error}</div>
      ) : (
        <DataGridPro
          rows={rows}
          columns={columns}
          checkboxSelection
          pagination
          rowHeight={30}
          autoPageSize
          slots={{ toolbar: GridToolbar }}
          disableRowSelectionOnClick
          sx={{
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: "#1976d2",
              color: "#fff",
            },
            "& .MuiDataGrid-row:hover": {
              backgroundColor: "rgba(25, 118, 210, 0.1)",
            },
          }}
        />
      )}
    </Box>
  );
};

export default Network;
