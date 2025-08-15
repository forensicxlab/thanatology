import React from "react";
import TimelineScatter from "./TimelineScatter";
interface TimelinerProps {
  evidenceId: number;
  partitionId: number;
}

const Timeliner: React.FC<TimelinerProps> = ({ evidenceId, partitionId }) => {
  return (
    <TimelineScatter
      evidenceId={evidenceId}
      partitionId={partitionId}
    ></TimelineScatter>
  );
};

export default Timeliner;
