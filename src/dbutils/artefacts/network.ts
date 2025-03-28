/**
 * thanatology/src/dbutils/artefacts/network.ts
 */

import Database from "@tauri-apps/plugin-sql";
import { LinuxFile } from "../types";

/**
 * Fetch Interfaces / Network Scripts
 *   Common Paths:
 *     - /etc/network/interfaces (Debian/Ubuntu)
 *     - /etc/network/interfaces.d/ (Debian/Ubuntu)
 *     - /etc/sysconfig/network-scripts/ (RedHat/CentOS)
 *     - /etc/netplan/ (Ubuntu with netplan)
 */
export async function getNetworkInterfacesAndScripts(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/network/interfaces",
    "/etc/network/interfaces.d",
    "/etc/sysconfig/network-scripts",
    "/etc/netplan",
  ];

  // We’ll look for either the path or the parent directory
  // as a quick approach to matching entire directories.
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path IN (${placeholders})
        OR parent_directory IN (${placeholders})
      )
    ORDER BY absolute_path
  `;
  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Network Interfaces / Scripts",
    files,
  };
}

/**
 * Fetch DNS and Name Resolution Config
 *   Common Paths:
 *     - /etc/resolv.conf
 *     - /etc/hosts
 *     - /etc/nsswitch.conf
 *     - /etc/host.conf (older distributions)
 */
export async function getDNSAndNameResolution(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/resolv.conf",
    "/etc/hosts",
    "/etc/nsswitch.conf",
    "/etc/host.conf",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND absolute_path IN (${placeholders})
    ORDER BY absolute_path
  `;
  const params = [evidenceId, partitionId, ...candidatePaths];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "DNS / Name Resolution",
    files,
  };
}

/**
 * Fetch Firewall / Packet Filtering Config
 *   Common Paths:
 *     - /etc/iptables
 *     - /etc/sysconfig/iptables (RedHat-based)
 *     - /etc/sysconfig/ip6tables (RedHat-based)
 *     - /etc/ufw (Ubuntu UFW)
 *     - /etc/firewalld (Firewalld on RedHat-based)
 */
export async function getFirewallConfig(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/iptables",
    "/etc/sysconfig/iptables",
    "/etc/sysconfig/ip6tables",
    "/etc/ufw",
    "/etc/firewalld",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path IN (${placeholders})
        OR parent_directory IN (${placeholders})
      )
    ORDER BY absolute_path
  `;
  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Firewall / Packet Filtering",
    files,
  };
}

/**
 * Fetch Routing and ARP Artefacts
 *   Common Paths / Files:
 *     - /proc/net/route
 *     - /proc/net/arp
 *     - /etc/sysconfig/static-routes (RedHat-based)
 *     - /etc/netplan/ (could also hold routing info)
 */
export async function getRoutingAndARP(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/proc/net/route",
    "/proc/net/arp",
    "/etc/sysconfig/static-routes",
    "/etc/netplan",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path IN (${placeholders})
        OR parent_directory IN (${placeholders})
      )
    ORDER BY absolute_path
  `;
  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Routing and ARP",
    files,
  };
}

/**
 * Fetch Proxy or Additional Network Config
 *   Common Paths:
 *     - /etc/environment (system-wide env variables)
 *     - /etc/profile.d/* (scripts that could set proxy variables)
 *     - /etc/wgetrc or ~/.wgetrc (proxy settings for wget)
 *     - /etc/curlrc or ~/.curlrc (proxy settings for curl)
 */
export async function getProxyAndAdditionalNetworkConfig(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Looking for well-known proxy config files or directories that might hold scripts
  const candidatePaths = [
    "/etc/environment",
    "/etc/profile.d",
    "/etc/wgetrc",
    "/etc/curlrc",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path IN (${placeholders})
        OR parent_directory IN (${placeholders})
      )
    ORDER BY absolute_path
  `;
  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Proxy / Additional Network Config",
    files,
  };
}

/**
 * (Optional) Fetch NetworkManager Config
 *   Common Paths:
 *     - /etc/NetworkManager
 *     - /etc/NetworkManager/NetworkManager.conf
 *     - /etc/NetworkManager/system-connections/ (stores connection profiles)
 */
export async function getNetworkManagerConfig(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/NetworkManager",
    "/etc/NetworkManager/NetworkManager.conf",
    "/etc/NetworkManager/system-connections",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path IN (${placeholders})
        OR parent_directory IN (${placeholders})
      )
    ORDER BY absolute_path
  `;

  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "NetworkManager",
    files,
  };
}

/**
 * (Optional) Fetch SSH Configuration
 *   Common Paths:
 *     - /etc/ssh/ssh_config
 *     - /etc/ssh/sshd_config
 *     - /etc/ssh/ssh_known_hosts
 */
export async function getSSHConfig(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/ssh/ssh_config",
    "/etc/ssh/sshd_config",
    "/etc/ssh/ssh_known_hosts",
  ];
  const placeholders = candidatePaths.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND absolute_path IN (${placeholders})
    ORDER BY absolute_path
  `;
  const params = [evidenceId, partitionId, ...candidatePaths];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "SSH Configuration",
    files,
  };
}
