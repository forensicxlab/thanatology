import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Typography,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { invoke } from "@tauri-apps/api/core";

import {
  CenterFocusWeak,
  DeveloperBoard,
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
      icon: <NoteAddIcon sx={{ fontSize: 50, mb: 1 }} />,
      enabled: true,
      onClick: () => {
        navigate(`/case/new`);
      },
    },
    {
      title: "Whiteboard",
      subtitle: "Open the Whiteboard",
      icon: <ShapeLine sx={{ fontSize: 50, mb: 1 }} />,
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
      title: "PCILeech",
      subtitle: "coming soon",
      icon: <DeveloperBoard sx={{ fontSize: 50, mb: 1 }} />,
      enabled: false,
    },
    {
      title: "Malware Analysis",
      subtitle: "coming soon",
      icon: <CenterFocusWeak sx={{ fontSize: 50, mb: 1 }} />,
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
      <Grid container spacing={3} justifyContent="center">
        {tiles.map((tile, index) => (
          <Grid key={index}>
            <Card
              sx={{
                width: 220,
                textAlign: "center",
                opacity: tile.enabled ? 1 : 0.5,
              }}
            >
              {tile.enabled ? (
                <CardActionArea onClick={tile.onClick}>
                  <CardContent>
                    {tile.icon}
                    <Typography variant="h6" component="div">
                      {tile.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {tile.subtitle}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              ) : (
                // For disabled tiles, render without the CardActionArea
                <Box sx={{ p: 2 }}>
                  {tile.icon}
                  <Typography variant="h6" component="div">
                    {tile.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tile.subtitle}
                  </Typography>
                </Box>
              )}
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;
