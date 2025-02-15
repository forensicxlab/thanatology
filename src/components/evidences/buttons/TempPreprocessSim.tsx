// CreateCaseButton.tsx
import React from "react";
import Button from "@mui/material/Button";
import { useNavigate } from "react-router";

const TempPreprocessSim: React.FC = () => {
  const navigate = useNavigate();

  const handleEvidencePreProcess = () => {
    // Redirect to the "/case/new" route
    navigate("/evidence/preprocess");
  };

  return (
    <Button
      variant="contained"
      color="primary"
      onClick={handleEvidencePreProcess}
    >
      Simulate evidence preprocess
    </Button>
  );
};

export default TempPreprocessSim;
