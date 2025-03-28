import React from "react";
import {
  getNetworkInterfacesAndScripts,
  getDNSAndNameResolution,
  getFirewallConfig,
  getRoutingAndARP,
  getProxyAndAdditionalNetworkConfig,
  getNetworkManagerConfig,
  getSSHConfig,
} from "../dbutils/artefacts/network";

/**
 * The "network" command:
 * - Fetches all known network artefacts (using all the network-dbutil calls).
 * - Returns a JSX.Element that displays the category and the absolute path of each file found.
 */
export async function network(
  evidenceId: number,
  partitionId: number,
): Promise<JSX.Element> {
  try {
    // Fetch each category of network artefacts in parallel
    const results = await Promise.all([
      getNetworkInterfacesAndScripts(null, evidenceId, partitionId),
      getDNSAndNameResolution(null, evidenceId, partitionId),
      getFirewallConfig(null, evidenceId, partitionId),
      getRoutingAndARP(null, evidenceId, partitionId),
      getProxyAndAdditionalNetworkConfig(null, evidenceId, partitionId),
      getNetworkManagerConfig(null, evidenceId, partitionId),
      getSSHConfig(null, evidenceId, partitionId),
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
