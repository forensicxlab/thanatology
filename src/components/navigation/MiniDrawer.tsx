import * as React from "react";
import { styled, Theme, CSSObject } from "@mui/material/styles";
import Box from "@mui/material/Box";
import MuiDrawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import IconButton from "@mui/material/IconButton";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import BottomActionBar from "./BottomActionBar";
import {
  Dashboard,
  Work,
  Memory,
  QuestionMark,
  Settings,
  ChevronRight,
  ChevronLeft,
} from "@mui/icons-material";
import { Outlet, Link } from "react-router";
import TitlebarNav from "./TitlebarNav";

const drawerWidth = 200;
const collapsedDrawerWidth = 52;
const collapsedDrawerWidthSm = 58;

const TITLEBAR_HEIGHT = 40;

const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: "hidden",
  marginTop: TITLEBAR_HEIGHT,
});

const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: "hidden",
  width: `${collapsedDrawerWidth}px`,
  [theme.breakpoints.up("sm")]: {
    width: `${collapsedDrawerWidthSm}px`,
  },
  marginTop: TITLEBAR_HEIGHT,
});

// const DrawerHeader = styled("div")(({ theme }) => ({
//   display: "flex",
//   alignItems: "center",
//   justifyContent: "flex-end",
//   padding: theme.spacing(0, 1),
//   // necessary for content to be below app bar
//   ...theme.mixins.toolbar,
// }));

function renderIcon(index: number) {
  switch (index) {
    case 0:
      return <Dashboard />;
    case 1:
      return <Work />;
    case 2:
      return <Memory />;
    case 3:
      return <Settings />;
    default:
      return <QuestionMark />;
  }
}

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: "nowrap",
  boxSizing: "border-box",
  "& .MuiDrawer-paper": {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
  },
  ...(open && {
    ...openedMixin(theme),
    "& .MuiDrawer-paper": {
      ...openedMixin(theme),
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
    },
  }),
  ...(!open && {
    ...closedMixin(theme),
    "& .MuiDrawer-paper": {
      ...closedMixin(theme),
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
    },
  }),
}));

export default function MiniDrawer() {
  const [open, setOpen] = React.useState(false);

  const handleDrawerOpen = () => {
    setOpen(true);
  };

  const handleDrawerClose = () => {
    setOpen(false);
  };

  return (
    <>
      <TitlebarNav />
      <Box sx={{ display: "flex", pt: `${TITLEBAR_HEIGHT}px` }}>
        <Drawer variant="permanent" open={open}>
          <Box
            sx={{
              display: "flex",
              justifyContent: open ? "flex-end" : "center",
              px: open ? 1 : 0,
              py: 0.5,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <IconButton
              size="small"
              onClick={open ? handleDrawerClose : handleDrawerOpen}
              aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
              sx={{ color: "text.primary" }}
            >
              {open ? <ChevronLeft /> : <ChevronRight />}
            </IconButton>
          </Box>
          <List>
            {["", "Cases", "Tasks", "Settings"].map((text, index) => (
              <ListItem key={index} disablePadding sx={{ display: "block" }}>
                <ListItemButton
                  sx={{
                    minHeight: 40,
                    justifyContent: open ? "initial" : "center",
                    px: open ? 1.5 : 0,
                  }}
                  component={Link}
                  to={`/${text.toLowerCase().replace(" ", "")}`}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: open ? 1.5 : 0,
                      justifyContent: "center",
                      "& .MuiSvgIcon-root": {
                        fontSize: 20,
                      },
                    }}
                  >
                    {renderIcon(index)}
                  </ListItemIcon>
                  <ListItemText
                    primary={text === "" ? "Dashboard" : text}
                    sx={{
                      opacity: open ? 1 : 0,
                      display: open ? "block" : "none",
                    }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Drawer>
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 1,
            width: "90%",
          }}
        >
          <Outlet />
        </Box>
        <BottomActionBar />
      </Box>
    </>
  );
}
