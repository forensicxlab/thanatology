import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import { getEvidencesStatus } from "../dbutils/sqlite";
import { Evidence } from "../dbutils/types";
import ProcessingTask from "./evidences/processing/ProcessingTask";

export default function Tasks() {
  const [activeTasks, setActiveTasks] = useState<Evidence[]>([]);

  const fetchTasks = async () => {
    try {
      const evidences = await getEvidencesStatus(null);
      setActiveTasks(evidences);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTasks();
    // Poll to keep tasks list up to date in case they finish
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom>
        Tasks
      </Typography>

      <List sx={{ width: "100%", bgcolor: "background.paper" }}>
        {activeTasks.length === 0 ? (
          <Typography variant="body1" sx={{ p: 2 }}>
            No active tasks.
          </Typography>
        ) : (
          activeTasks.map((ev) => (
            <ProcessingTask
              key={ev.id}
              evidence={ev}
              onComplete={fetchTasks}
            />
          ))
        )}
      </List>
    </Box>
  );
}
