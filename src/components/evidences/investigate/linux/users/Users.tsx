import React, { useCallback, useMemo } from "react";
import Artifacts from "../../Artifacts";

interface UsersProps {
  evidenceId: number;
  partitionId: number;
}

const Users: React.FC<UsersProps> = ({ evidenceId, partitionId }) => {
  return (
    <Artifacts
      evidence_id={evidenceId}
      partition_id={partitionId}
      category="Users"
    />
  );
};

export default Users;
