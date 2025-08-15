import React, { useCallback, useMemo } from "react";
import Artifacts from "../../Artifacts";
interface SystemProps {
  evidenceId: number;
  partitionId: number;
}

const System: React.FC<SystemProps> = ({ evidenceId, partitionId }) => {
  return (
    <Artifacts
      evidence_id={evidenceId}
      partition_id={partitionId}
      category="System"
    />
  );
};

export default System;
