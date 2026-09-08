import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";
import CaseList from "./lists/CaseList";
import { Case } from "../../dbutils/types";
import { getCases, deleteCases } from "../../dbutils/sqlite";
import Database from "@tauri-apps/plugin-sql";
import { useSnackbar } from "../SnackbarProvider";
import type { UpdatedCaseMetadata } from "../../dbutils/cases";

interface CasesProps {
  database: Database | null;
}

const Cases: React.FC<CasesProps> = ({ database }) => {
  const [cases, setCases] = useState<Case[]>([]);
  const [deleting, setDeleting] = useState(false); // NEW ✔
  const { display_message } = useSnackbar();

  const handleCaseUpdated = (updatedCase: UpdatedCaseMetadata) => {
    setCases((currentCases) =>
      currentCases.map((caseItem) =>
        caseItem.id === updatedCase.id
          ? { ...caseItem, ...updatedCase }
          : caseItem,
      ),
    );
  };

  /* ---- handlers ---- */
  const handleDeleteCases = async (selectedIds: number[]) => {
    if (selectedIds.length === 0) return;

    try {
      setDeleting(true); // show loader
      await deleteCases(selectedIds); // wait for DB
      setCases((prev) => prev.filter((c) => !selectedIds.includes(c.id)));
      display_message("success", "Case(s) deleted successfully");
    } catch (error) {
      display_message("error", `Error deleting cases: ${error}`);
      console.error("Error deleting cases:", error);
    } finally {
      setDeleting(false); // hide loader
    }
  };

  /* ---- initial fetch ---- */
  useEffect(() => {
    let active = true;

    getCases(database)
      .then((result: Case[]) => {
        if (active) setCases(result);
      })
      .catch(() => {
        if (active) display_message("error", "Could not fetch cases.");
      });

    return () => {
      active = false;
    };
  }, [database, display_message]);

  /* ---- render ---- */
  return (
    <Box sx={{ flexGrow: 1, position: "relative" }}>
      <Typography variant="h4" gutterBottom>
        Cases
      </Typography>

      {/* Main list */}
      <CaseList
        cases={cases}
        database={database}
        onDeleteCases={handleDeleteCases}
        onCaseUpdated={handleCaseUpdated}
      />

      {/* Full-screen loader while deleting */}
      <Backdrop
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
        open={deleting}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </Box>
  );
};

export default Cases;
