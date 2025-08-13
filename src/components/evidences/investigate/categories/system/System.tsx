import React, { useCallback, useMemo } from "react";
import Artifacts from "../../Artifacts";
interface SystemProps {
  evidenceId: number;
  partitionId: number;
  isVisible: boolean; // <-- new
}

const System: React.FC<SystemProps> = ({
  evidenceId,
  partitionId,
  isVisible,
}) => {
  return (
    <Artifacts
      evidence_id={evidenceId}
      partition_id={partitionId}
      category="System"
      isVisible={isVisible}
    />
  );
};

export default System;
