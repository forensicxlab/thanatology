import React, { useCallback, useMemo } from "react";
import Artifacts from "../../Artifacts";

interface NetworkProps {
  evidenceId: number;
  partitionId: number;
}

const Network: React.FC<NetworkProps> = ({ evidenceId, partitionId }) => {
  return (
    <Artifacts
      evidence_id={evidenceId}
      partition_id={partitionId}
      category="Network"
    />
  );
};

export default Network;
