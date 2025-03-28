import React from "react";
import {
  getOsReleaseFiles,
  getBootConfiguration,
  getContainerVirtualizationConfig,
  getSystemLogs,
  getTimezoneAndLocaltime,
  getLocalizationSettings,
  getSystemServicesAndDaemons,
  getKernelModules,
  getSystemArchitectureHardware,
  getKernelVersionAndBootloader,
} from "../dbutils/artefacts/system";

/**
 * The "system" command:
 * - Fetches all known system artefacts (using all the system-dbutil calls).
 * - Returns a JSX.Element that displays the category and the absolute path of each file found.
 */
export async function system(
  evidenceId: number,
  partitionId: number,
): Promise<JSX.Element> {
  try {
    // Fetch each category of system artefacts in parallel
    const results = await Promise.all([
      getOsReleaseFiles(null, evidenceId, partitionId),
      getBootConfiguration(null, evidenceId, partitionId),
      getContainerVirtualizationConfig(null, evidenceId, partitionId),
      getSystemLogs(null, evidenceId, partitionId),
      getTimezoneAndLocaltime(null, evidenceId, partitionId),
      getLocalizationSettings(null, evidenceId, partitionId),
      getSystemServicesAndDaemons(null, evidenceId, partitionId),
      getKernelModules(null, evidenceId, partitionId),
      getSystemArchitectureHardware(null, evidenceId, partitionId),
      getKernelVersionAndBootloader(null, evidenceId, partitionId),
    ]);

    return (
      <>
        {results.map((artefactGroup, index) => (
          <React.Fragment key={index}>
            {/* Category Heading */}
            <strong>{artefactGroup.category}</strong>
            <br />
            {/* If no files found, say so */}
            {artefactGroup.files.length === 0 && (
              <>
                <em>No files found</em>
                <br />
              </>
            )}
            {/* Otherwise, list the file paths */}
            {artefactGroup.files.map((file, i) => (
              <div key={i}>{file.absolute_path}</div>
            ))}
            <br />
          </React.Fragment>
        ))}
      </>
    );
  } catch (error: any) {
    return <>Error fetching system artefacts: {error.message}</>;
  }
}
