import React, { useCallback, useMemo } from "react";
import Artifacts from "../../Artifacts";

interface ApplicationsProps {
  evidenceId: number;
  partitionId: number;
}

const Applications: React.FC<ApplicationsProps> = ({
  evidenceId,
  partitionId,
}) => {
  return (
    <Artifacts
      evidence_id={evidenceId}
      partition_id={partitionId}
      category="Application"
    />
  );
};

export default Applications;
