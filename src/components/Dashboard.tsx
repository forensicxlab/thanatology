import { useEffect } from "react";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { invoke } from "@tauri-apps/api/core";

import {
  CenterFocusWeak,
  DeveloperBoard,
  Pageview,
  ShapeLine,
} from "@mui/icons-material";
import { useNavigate } from "react-router";
import ExternalApplicationIcon from "./externalApps/ExternalApplicationIcon";
import { openExternalApplication } from "../externalApps/launcher";
import { useExternalApplicationsStore } from "../store/externalApplicationsStore";
import { useSnackbar } from "./SnackbarProvider";

const Dashboard = () => {
  const navigate = useNavigate();
  const { display_message } = useSnackbar();
  const applications = useExternalApplicationsStore((state) => state.applications);
  const loaded = useExternalApplicationsStore((state) => state.loaded);
  const load = useExternalApplicationsStore((state) => state.load);

  useEffect(() => {
    if (!loaded) void load().catch(() => undefined);
  }, [load, loaded]);

  // Define the tile configuration
  const tiles = [
    {
      key: "new-case",
      title: "New case",
      subtitle: "Create a new case",
      icon: <NoteAddIcon sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: true,
      onClick: () => {
        navigate(`/case/new`);
      },
    },
    {
      key: "whiteboard",
      title: "Whiteboard",
      subtitle: "Open the Whiteboard",
      icon: <ShapeLine sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: true,
      onClick: async () => {
        try {
          await invoke("new_whiteboard");
        } catch (error) {
          console.error("Error opening the whiteboard:", error);
        }
      },
    },
    {
      key: "fileviewer",
      title: "FileViewer",
      subtitle: "Open the advanced file viewer",
      icon: <Pageview sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: true,
      onClick: async () => {
        try {
          await invoke("new_fileviewer");
        } catch (error) {
          console.error("Error opening the file viewer:", error);
        }
      },
    },
    {
      key: "leechcore",
      title: "LeechCore",
      subtitle: "Validate DMA and run memory modules",
      icon: <DeveloperBoard sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: true,
      onClick: async () => {
        try {
          await invoke("new_leechcore");
        } catch (error) {
          console.error("Error opening the LeechCore workspace:", error);
        }
      },
    },
    {
      key: "malware-analysis",
      title: "Malware Analysis",
      subtitle: "coming soon",
      icon: <CenterFocusWeak sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: false,
    },
  ];

  const externalTiles = applications
    .filter((application) => application.enabled && application.showDashboard)
    .map((application) => ({
      key: `external-${application.id}`,
      title: application.name,
      subtitle: application.description || application.url,
      icon: (
        <Box sx={{ display: "flex", justifyContent: "center", mb: 0.5 }}>
          <ExternalApplicationIcon
            name={application.name}
            iconDataUrl={application.iconDataUrl}
            size={36}
          />
        </Box>
      ),
      enabled: true,
      onClick: async () => {
        try {
          await openExternalApplication(application);
        } catch (error) {
          display_message(
            "error",
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    }));

  const visibleTiles = [...tiles, ...externalTiles].filter((tile) => tile.enabled);

  return (
    <Box
      sx={{
        flexGrow: 1,
        minHeight: "80vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Grid
        container
        spacing={2}
        sx={{
          justifyContent: "center",
        }}
      >
        {visibleTiles.map((tile) => (
          <Grid key={tile.key}>
            <Card
              sx={{
                width: 160,
                textAlign: "center",
              }}
            >
              <CardActionArea onClick={tile.onClick} sx={{ height: "100%" }}>
                <CardContent sx={{ py: 1.5, px: 2 }}>
                  {tile.icon}
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {tile.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                      overflow: "hidden",
                    }}
                  >
                    {tile.subtitle}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;
