import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
function ResponsiveAppBar() {
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
          <img src="/Thanatology.svg" alt="Logo" width={150} />
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default ResponsiveAppBar;
