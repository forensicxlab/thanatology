import React from "react";
import {
  getFileByEvidenceAndAbsolutePath,
  getFilesByEvidenceAndParent,
  searchLinuxFiles,
} from "../dbutils/sqlite";
import { LinuxFile } from "../dbutils/types";
import { system } from "./system";
import { network } from "./network";

// The terminal state holds the context for file operations.
interface TerminalState {
  evidenceId: number;
  partitionId: number;
  cwd: string;
}

// Initialize the terminal state with default values.
let terminalState: TerminalState = {
  evidenceId: 0,
  partitionId: 0,
  cwd: "/",
};

/**
 * Set the context for file operations.
 */
export function setTerminalContext(evidenceId: number, partitionId: number) {
  terminalState = { evidenceId, partitionId, cwd: "/" };
}

/**
 * Change the current working directory.
 * - "cd ." leaves the directory unchanged.
 * - "cd .." goes to the parent directory.
 * - "cd directoryName" changes to a directory under the current path.
 */
export async function cd(directory: string): Promise<string> {
  directory = directory.trim();

  // Handle "cd ." (no change)
  if (directory === ".") {
    return `Remains in ${terminalState.cwd}`;
  }

  // Handle "cd .." or "cd ../"
  if (directory === ".." || directory === "../") {
    if (terminalState.cwd === "/") {
      return "Already at root directory.";
    }
    const parts = terminalState.cwd.split("/").filter(Boolean);
    parts.pop();
    terminalState.cwd = "/" + parts.join("/");
    if (terminalState.cwd === "") {
      terminalState.cwd = "/";
    }
    return ``;
  }

  // --- NEW LOGIC: If path is absolute, look it up directly ---
  if (directory.startsWith("/")) {
    // Optional: normalize trailing slash
    const normalized = directory.replace(/\/+$/, "") || "/";

    // Special case: If user typed just "/"
    if (normalized === "/") {
      terminalState.cwd = "/";
      return ``;
    }

    // Look up the file to see if it is a directory
    const file = await getFileByEvidenceAndAbsolutePath(
      null,
      terminalState.evidenceId,
      terminalState.partitionId,
      normalized,
    );

    if (!file) {
      return `Directory "${directory}" not found.`;
    }
    if (file.file_type !== "dir") {
      return `"${directory}" is not a directory.`;
    }
    // If it’s valid, set the new CWD
    terminalState.cwd = normalized;
    return ``;
  }

  // --- EXISTING RELATIVE LOGIC: single-step into subdirectory ---
  try {
    const files = await getFilesByEvidenceAndParent(
      null,
      terminalState.evidenceId,
      terminalState.partitionId,
      terminalState.cwd,
    );

    const target = files.find(
      (file) => file.filename === directory && file.file_type === "dir",
    );

    if (!target) {
      return `Directory "${directory}" not found in ${terminalState.cwd}`;
    }

    // If user is in "/", building "newCwd" is just "/subdir"
    // otherwise "/current/path + /subdir"
    terminalState.cwd =
      terminalState.cwd === "/"
        ? `/${directory}`
        : `${terminalState.cwd}/${directory}`;

    return ``;
  } catch (error: any) {
    return `Error changing directory: ${error.message}`;
  }
}

/**
 * Helper: Format file permissions from numeric mode to a string (e.g. "rwxr-xr-x").
 */
function formatPermissions(mode: number): string {
  const octal = (mode & 0o777).toString(8).padStart(3, "0");
  const map: { [key: string]: string } = {
    "0": "---",
    "1": "--x",
    "2": "-w-",
    "3": "-wx",
    "4": "r--",
    "5": "r-x",
    "6": "rw-",
    "7": "rwx",
  };
  return map[octal[0]] + map[octal[1]] + map[octal[2]];
}

/**
 * Helper: Format a file (or directory) to include type, permissions, size, and filename.
 */
function formatFile(file: LinuxFile): string {
  // Use "d" for directories and "-" for regular files.
  const permissions = formatPermissions(file.permissions_mode);
  return `: ${permissions} ${file.owner_uid} ${file.group_gid} ${file.modification_time} ${file.size_bytes} `;
}

/**
 * Lists files with behavior similar to Linux ls:
 * - ls [no args]: lists the current directory.
 * - ls <name>: if <name> is a directory in the current directory, lists its contents;
 *   if it's a file, shows that file's info.
 *
 * Returns HTML with <br/> tags for line breaks.
 */
export async function ls(arg?: string): Promise<JSX.Element> {
  try {
    // If no argument, list contents of current working directory
    if (!arg || arg.trim() === "") {
      const files = await getFilesByEvidenceAndParent(
        null,
        terminalState.evidenceId,
        terminalState.partitionId,
        terminalState.cwd,
      );
      if (!files || files.length === 0) {
        return <>No files found.</>;
      }
      return formatListing(files);
    }

    // Trim and handle absolute vs. relative
    arg = arg.trim();

    // ----- 1) ABSOLUTE PATH -----
    if (arg.startsWith("/")) {
      // Optional: remove trailing slash from user’s input:
      const normalizedPath = arg.replace(/\/+$/, "") || "/";

      // Special case for root "/" – just list root
      if (normalizedPath === "/") {
        const files = await getFilesByEvidenceAndParent(
          null,
          terminalState.evidenceId,
          terminalState.partitionId,
          "/",
        );
        if (!files || files.length === 0) {
          return <>No files found in root.</>;
        }
        return formatListing(files);
      }

      // Check if this absolute path is found
      const target = await getFileByEvidenceAndAbsolutePath(
        null,
        terminalState.evidenceId,
        terminalState.partitionId,
        normalizedPath,
      );
      if (!target) {
        return <>Path "{arg}" not found.</>;
      }

      // If it’s a directory, list its contents
      if (target.file_type === "dir") {
        const subfiles = await getFilesByEvidenceAndParent(
          null,
          terminalState.evidenceId,
          terminalState.partitionId,
          normalizedPath,
        );
        if (!subfiles || subfiles.length === 0) {
          return <>No files found in "{arg}".</>;
        }
        return formatListing(subfiles);
      } else {
        // It’s a single file
        return (
          <>
            <span style={{ color: "green" }}>{target.inode_number}</span>/
            <span
              style={{
                color:
                  target.file_type === "dir"
                    ? "#42a5f5"
                    : target.file_type === "file"
                      ? "#ba68c8"
                      : "#ff5722",
              }}
            >
              {target.file_type}
            </span>
            {formatFile(target)}
            <span
              style={{
                color:
                  target.file_type === "dir"
                    ? "#42a5f5"
                    : target.file_type === "file"
                      ? "#ba68c8"
                      : "#ff5722",
              }}
            >
              {target.filename}
            </span>
            <br />
          </>
        );
      }
    }

    // ----- 2) RELATIVE PATH (existing logic) -----
    // We fetch the current directory’s files, then see if `arg` is a subdir or file
    const files = await getFilesByEvidenceAndParent(
      null,
      terminalState.evidenceId,
      terminalState.partitionId,
      terminalState.cwd,
    );
    const target = files.find((file) => file.filename === arg);
    if (!target) {
      return (
        <>
          {arg} not found in {terminalState.cwd}
        </>
      );
    }
    // If directory, list contents
    if (target.file_type === "dir") {
      const path =
        terminalState.cwd === "/" ? `/${arg}` : `${terminalState.cwd}/${arg}`;
      const subfiles = await getFilesByEvidenceAndParent(
        null,
        terminalState.evidenceId,
        terminalState.partitionId,
        path,
      );
      if (!subfiles || subfiles.length === 0) {
        return <>No files found in directory "{arg}"</>;
      }
      return formatListing(subfiles);
    } else {
      // It’s a single file
      return (
        <>
          <span style={{ color: "green" }}>{target.inode_number}</span>/
          <span
            style={{
              color:
                target.file_type === "dir"
                  ? "#42a5f5"
                  : target.file_type === "file"
                    ? "#ba68c8"
                    : "#ff5722",
            }}
          >
            {target.file_type}
          </span>
          {formatFile(target)}
          <span
            style={{
              color:
                target.file_type === "dir"
                  ? "#42a5f5"
                  : target.file_type === "file"
                    ? "#ba68c8"
                    : "#ff5722",
            }}
          >
            {target.filename}
          </span>
          <br />
        </>
      );
    }
  } catch (error: any) {
    return <>Error listing files: {error.message}</>;
  }
}

/**
 * Helper: takes an array of LinuxFiles, returns a React fragment
 * that lists them.
 */
function formatListing(files: LinuxFile[]): JSX.Element {
  return (
    <>
      {files.map((file, index) => (
        <span key={index}>
          <span style={{ color: "green" }}>{file.inode_number}</span>/
          <span
            style={{
              color:
                file.file_type === "dir"
                  ? "#42a5f5"
                  : file.file_type === "file"
                    ? "#ba68c8"
                    : "#ff5722",
            }}
          >
            {file.file_type}
          </span>
          {formatFile(file)}
          <span
            style={{
              color:
                file.file_type === "dir"
                  ? "#42a5f5"
                  : file.file_type === "file"
                    ? "#ba68c8"
                    : "#ff5722",
            }}
          >
            {file.filename}
          </span>
          <br />
        </span>
      ))}
    </>
  );
}

/**
 * Helper: takes an array of LinuxFiles, returns a React fragment
 * that lists the full path.
 */
function formatPaths(files: LinuxFile[]): JSX.Element {
  return (
    <>
      {files.map((file, index) => (
        <span key={index}>
          <span style={{ color: "green" }}>{file.inode_number}</span>/
          <span
            style={{
              color:
                file.file_type === "dir"
                  ? "#42a5f5"
                  : file.file_type === "file"
                    ? "#ba68c8"
                    : "#ff5722",
            }}
          >
            {file.file_type}
          </span>
          <span> {file.absolute_path}</span>
          <br />
        </span>
      ))}
    </>
  );
}

/**
 * Returns the current working directory.
 */
export function pwd(): string {
  return terminalState.cwd;
}

/**
 * Expose a getter to access the current working directory.
 */
export function getCwd(): string {
  return terminalState.cwd;
}

export async function search(searchTerm: string): Promise<JSX.Element> {
  if (!searchTerm || searchTerm.trim() === "") {
    return <>Please provide a search term.</>;
  }
  searchTerm = searchTerm.trim();
  let files: LinuxFile[] = [];
  // Otherwise, perform SQL search using LIKE.
  const pattern = `%${searchTerm}%`;
  files = await searchLinuxFiles(
    null,
    terminalState.evidenceId,
    terminalState.partitionId,
    pattern,
  );
  if (!files || files.length === 0) {
    return <>No files found matching "{searchTerm}".</>;
  }
  return formatPaths(files);
}

/**
 * The available commands in the terminal.
 */
export const commands = {
  whoami: "nobody",
  cd: cd,
  ls: ls,
  pwd: pwd,
  system: async () => {
    return system(terminalState.evidenceId, terminalState.partitionId);
  },
  network: async () => {
    return network(terminalState.evidenceId, terminalState.partitionId);
  },
  search: search,
};
