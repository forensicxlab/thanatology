import * as React from "react";
import { useNavigate } from "react-router";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import AccountCircle from "@mui/icons-material/AccountCircle";
import MenuItem from "@mui/material/MenuItem";
import Menu from "@mui/material/Menu";
import { Typography } from "@mui/material";
function ResponsiveAppBar() {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const username = localStorage.getItem("username");
  const navigate = useNavigate();

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("username");
    navigate("/login");
    handleClose();
  };

  return (
    <AppBar position="fixed">
      <Toolbar
        variant="dense"
        sx={{
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
        disableGutters
      >
        <Box
          sx={{
            flexGrow: 10,
            width: "auto",
            height: "auto",
            display: { xs: "flex", md: "flex" },
            ml: 1,
            alignItems: "center",
          }}
        >
          <img src="/Thanatology.svg" alt="Logo" width={70} />
          <Typography variant="h6" noWrap component="div">
            Thanatology
          </Typography>
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default ResponsiveAppBar;
