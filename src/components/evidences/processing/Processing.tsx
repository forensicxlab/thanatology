import Box from "@mui/material/Box";
import React, { useState, useEffect } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { useSnackbar } from "../../SnackbarProvider";
import DiskImageProcessing from "./DiskImageProcessing";
import EvidenceDetails from "./EvidenceDetails";
import { Evidence } from "../../../dbutils/types";
import { getEvidence } from "../../../dbutils/sqlite";
import { useParams } from "react-router";

const Processing: React.FC = () => {
  const { display_message } = useSnackbar();
  const { id: evidence_id } = useParams<{ id: string }>();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    async function fetchEvidence() {
      try {
        // Fetch evidence info.
        const fetchedEvidence: Evidence = await getEvidence(null, evidence_id);
        setEvidence(fetchedEvidence);
      } catch (error) {
        console.error("Error fetching processing data", error);
        display_message("error", "Error fetching processing data");
      } finally {
        setLoading(false);
      }
    }
    fetchEvidence();
  }, [evidence_id, display_message]);

  return (
    <Box sx={{ flexGrow: 1 }}>
      {loading ? (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          height="100vh"
        >
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ flexGrow: 1, p: 2 }}>
          {evidence && evidence.status < 3 && (
            <EvidenceDetails evidence={evidence} />
          )}
          {evidence && (
            <DiskImageProcessing
              evidence={evidence}
              setEvidence={setEvidence}
            />
          )}
        </Box>
      )}
    </Box>
  );
};

export default Processing;
