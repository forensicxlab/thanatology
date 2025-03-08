import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CaseList from "./lists/CaseList";
import React, { useState, useEffect } from "react";
import { Case } from "../../dbutils/types";
import { getCases, deleteCases } from "../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";
import { useSnackbar } from "../SnackbarProvider";

interface CasesProps {
  database: Database | null;
}

const Cases: React.FC<CasesProps> = ({ database }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const { display_message } = useSnackbar();

  // This function will be passed to the CaseList component
  const handleDeleteCases = (selectedIds: number[]) => {
    // Call the deleteCases function (assumed to return a Promise)
    deleteCases(selectedIds)
      .then(() => {
        setCases((prevCases) =>
          prevCases.filter((c) => !selectedIds.includes(c.id)),
        );
      })
      .then(() => {
        display_message("success", `Case(s) deleted successfully`);
      })
      .catch((error) => {
        display_message("error", `Error deleting cases: ${error}`);
        console.error("Error deleting cases:", error);
      });
  };

  useEffect(() => {
    getCases(database)
      .then((result: Case[]) => {
        setCases(result);
      })
      .catch((error: any) => {
        console.log(error);
      });
  }, [database]);
  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom>
        Cases
      </Typography>
      <CaseList cases={cases} onDeleteCases={handleDeleteCases} />
    </Box>
  );
};

export default Cases;
