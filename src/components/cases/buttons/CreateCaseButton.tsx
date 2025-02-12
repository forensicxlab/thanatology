// CreateCaseButton.tsx
import React from "react";
import Button from "@mui/material/Button";
import { useNavigate } from "react-router";

const CreateCaseButton: React.FC = () => {
  const navigate = useNavigate();

  const handleCreateCase = () => {
    // Redirect to the "/case/new" route
    navigate("/case/new");
  };

  return (
    <Button variant="contained" color="primary" onClick={handleCreateCase}>
      Create New Case
    </Button>
  );
};

export default CreateCaseButton;
