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
const Dashboard = () => {
  const navigate = useNavigate();

  // Define the tile configuration
  const tiles = [
    {
      title: "New case",
      subtitle: "Create a new case",
      icon: <NoteAddIcon sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: true,
      onClick: () => {
        navigate(`/case/new`);
      },
    },
    {
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
      title: "Malware Analysis",
      subtitle: "coming soon",
      icon: <CenterFocusWeak sx={{ fontSize: 36, mb: 0.5 }} />,
      enabled: false,
    },
  ];

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
      <Grid container spacing={2} sx={{
        justifyContent: "center"
      }}>
        {tiles.filter((tile) => tile.enabled).map((tile, index) => (
          <Grid key={index}>
            <Card
              sx={{
                width: 160,
                textAlign: "center",
              }}
            >
              {tile.enabled ? (
                <CardActionArea onClick={tile.onClick}>
                  <CardContent sx={{ py: 1.5, px: 2 }}>
                    {tile.icon}
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {tile.title}
                    </Typography>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>
                      {tile.subtitle}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              ) : (
                // For disabled tiles, render without the CardActionArea
                (<Box sx={{ py: 1.5, px: 2 }}>
                  {tile.icon}
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {tile.title}
                  </Typography>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>
                    {tile.subtitle}
                  </Typography>
                </Box>)
              )}
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;
