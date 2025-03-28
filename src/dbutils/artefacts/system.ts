import Database from "@tauri-apps/plugin-sql";
import { LinuxFile } from "../types";

/**
 * Fetch OS Release Files
 *   Typically: /etc/os-release, /usr/lib/os-release, /etc/lsb-release, /etc/issue, etc.
 */
export async function getOsReleaseFiles(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/os-release",
    "/usr/lib/os-release",
    "/etc/lsb-release",
    "/etc/issue",
    "/etc/issue.net",
    "/etc/debian_version",
    "/etc/redhat-release",
    "/etc/centos-release",
  ];

  // Generate placeholders for parameterized query
  const placeholders = candidatePaths.map((_, i) => `?`).join(", ");

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
    category: "Operating System Information",
    files,
  };
}

/**
 * Fetch Boot Configuration
 *   Typical paths: /boot/grub/grub.cfg, /boot/grub2/grub.cfg, /boot/config-*, etc.
 */
export async function getBootConfiguration(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // For demonstration, searching for "grub.cfg" or files beginning with "config-" in /boot
  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path LIKE '/boot/grub/grub.cfg' OR
        absolute_path LIKE '/boot/grub2/grub.cfg' OR
        absolute_path GLOB '/boot/config-*'
      )
    ORDER BY absolute_path
  `;
  const files: LinuxFile[] = await db.select(query, [evidenceId, partitionId]);

  return {
    category: "Boot Configuration",
    files,
  };
}

/**
 * Fetch Container / Virtualization Configuration
 *   Typical directories: /etc/docker, /etc/lxc, /var/lib/docker, /var/lib/lxc, /etc/systemd/nspawn, etc.
 */
export async function getContainerVirtualizationConfig(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // We can look for known container/virtualization directories or config files
  const candidates = [
    "/etc/docker",
    "/etc/lxc",
    "/etc/systemd/nspawn",
    "/var/lib/docker",
    "/var/lib/lxc",
  ];
  const placeholders = candidates.map(() => "?").join(", ");

  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        parent_directory IN (${placeholders})
        OR absolute_path IN (${placeholders})
      )
    ORDER BY absolute_path
  `;
  // We list them twice (once for parent_directory, once for absolute_path).
  const params = [evidenceId, partitionId, ...candidates, ...candidates];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Container/Virtualization",
    files,
  };
}

/**
 * Fetch System Logging
 *   Typical log paths: /var/log/syslog, /var/log/messages, /var/log/dmesg, /var/log/secure, etc.
 */
export async function getSystemLogs(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidateLogs = [
    "/var/log/syslog",
    "/var/log/messages",
    "/var/log/dmesg",
    "/var/log/secure",
    "/var/log/auth.log",
  ];

  const placeholders = candidateLogs.map((_) => "?").join(", ");
  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND absolute_path IN (${placeholders})
    ORDER BY absolute_path
  `;
  const params = [evidenceId, partitionId, ...candidateLogs];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "System Logging",
    files,
  };
}

/**
 * Fetch Timezone and Localtime
 *   Typical: /etc/timezone, /etc/localtime
 */
export async function getTimezoneAndLocaltime(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = ["/etc/timezone", "/etc/localtime"];
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
    category: "Timezone/Localtime",
    files,
  };
}

/**
 * Fetch Localization Settings
 *   Typical: /etc/locale.conf, /etc/default/locale, /etc/locale.gen
 */
export async function getLocalizationSettings(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/etc/locale.conf",
    "/etc/default/locale",
    "/etc/locale.gen",
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
    category: "Localization Settings",
    files,
  };
}

/**
 * Fetch System Services and Daemons
 *   Typical: /etc/systemd/system/*, /lib/systemd/system/*, /etc/init.d/*, etc.
 */
export async function getSystemServicesAndDaemons(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Example: Looking for anything under these directories
  const candidateDirs = [
    "/etc/systemd/system",
    "/lib/systemd/system",
    "/etc/init.d",
  ];
  const placeholders = candidateDirs.map(() => "?").join(", ");

  // Searching by parent_directory
  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND parent_directory IN (${placeholders})
    ORDER BY absolute_path
  `;
  const params = [evidenceId, partitionId, ...candidateDirs];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "System Services And Daemons",
    files,
  };
}

/**
 * Fetch Kernel Modules
 *   Typical: /etc/modules, /etc/modprobe.d/, /lib/modules/...
 */
export async function getKernelModules(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // For demonstration, let's look for the /etc/modules file,
  // the /etc/modprobe.d directory, and the /lib/modules directory.
  const candidatePaths = ["/etc/modules", "/etc/modprobe.d", "/lib/modules"];
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
  // We pass them in twice: one set for absolute_path check, one for parent_directory.
  const params = [
    evidenceId,
    partitionId,
    ...candidatePaths,
    ...candidatePaths,
  ];

  const files: LinuxFile[] = await db.select(query, params);

  return {
    category: "Kernel Modules",
    files,
  };
}

/**
 * Fetch System Architecture / Hardware Info
 *   Typically from /proc: /proc/cpuinfo, /proc/meminfo, /proc/partitions, /proc/modules, etc.
 */
export async function getSystemArchitectureHardware(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  const candidatePaths = [
    "/proc/cpuinfo",
    "/proc/meminfo",
    "/proc/partitions",
    "/proc/modules",
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
    category: "System Architecture Hardware",
    files,
  };
}

/**
 * Fetch Kernel Version / Bootloader
 *   Typical: /proc/version, /boot/vmlinuz*, /boot/initrd*, etc.
 */
export async function getKernelVersionAndBootloader(
  db: Database | null,
  evidenceId: number,
  partitionId: number,
): Promise<{ category: string; files: LinuxFile[] }> {
  if (!db) {
    db = await Database.load("sqlite:thanatology.db");
  }

  // Searching /proc/version plus any files that match /boot/vmlinuz* or /boot/initrd*
  const query = `
    SELECT *
    FROM linux_files
    WHERE evidence_id = ?
      AND partition_id = ?
      AND (
        absolute_path = '/proc/version'
        OR absolute_path GLOB '/boot/vmlinuz*'
        OR absolute_path GLOB '/boot/initrd*'
      )
    ORDER BY absolute_path
  `;
  const files: LinuxFile[] = await db.select(query, [evidenceId, partitionId]);

  return {
    category: "Kernel Version Bootloader",
    files,
  };
}
