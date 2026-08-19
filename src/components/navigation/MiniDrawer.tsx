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
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import BottomActionBar from "./BottomActionBar";
import {
  Dashboard,
  Work,
  Memory,
  DeveloperBoard,
  QuestionMark,
  Settings,
  ChevronRight,
  ChevronLeft,
} from "@mui/icons-material";
import { Outlet, Link } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import TitlebarNav from "./TitlebarNav";
import ExternalApplicationIcon from "../externalApps/ExternalApplicationIcon";
import { openExternalApplication } from "../../externalApps/launcher";
import { useExternalApplicationsStore } from "../../store/externalApplicationsStore";
import { useSnackbar } from "../SnackbarProvider";

const drawerWidth = 180;
const collapsedDrawerWidth = 44;
const collapsedDrawerWidthSm = 44;

const TITLEBAR_HEIGHT = 32;

type NavItem = {
  label: string;
  icon: React.ReactNode;
  to?: string;
  action?: () => Promise<void>;
};

const primaryNavItems: NavItem[] = [
  { label: "Dashboard", icon: <Dashboard />, to: "/" },
  { label: "Cases", icon: <Work />, to: "/cases" },
  { label: "Tasks", icon: <Memory />, to: "/tasks" },
  {
    label: "LeechCore",
    icon: <DeveloperBoard />,
    action: async () => {
      await invoke("new_leechcore");
    },
  },
];

const settingsNavItem: NavItem = {
  label: "Settings",
  icon: <Settings />,
  to: "/settings",
};

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
  const { display_message } = useSnackbar();
  const applications = useExternalApplicationsStore((state) => state.applications);
  const loaded = useExternalApplicationsStore((state) => state.loaded);
  const load = useExternalApplicationsStore((state) => state.load);

  React.useEffect(() => {
    if (!loaded) void load().catch(() => undefined);
  }, [load, loaded]);

  const externalApplications = applications.filter(
    (application) => application.enabled && application.showSidebar,
  );

  const handleDrawerOpen = () => {
    setOpen(true);
  };

  const handleDrawerClose = () => {
    setOpen(false);
  };

  const handleAction = async (label: string, action?: () => Promise<void>) => {
    if (!action) {
      return;
    }

    try {
      await action();
    } catch (error) {
      console.error("Navigation action failed:", error);
      display_message(
        "error",
        `Could not open ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const renderNavItem = (item: NavItem, key = item.label) => {
    const content = (
      <>
        <ListItemIcon
          sx={{
            minWidth: 0,
            mr: open ? 1.5 : 0,
            justifyContent: "center",
            "& .MuiSvgIcon-root": {
              fontSize: 18,
            },
          }}
        >
          {item.icon ?? <QuestionMark />}
        </ListItemIcon>
        <ListItemText
          primary={item.label}
          sx={{
            opacity: open ? 1 : 0,
            display: open ? "block" : "none",
          }}
        />
      </>
    );

    const button = item.to ? (
      <ListItemButton
        sx={{
          minHeight: 32,
          justifyContent: open ? "initial" : "center",
          px: open ? 1.5 : 0,
        }}
        component={Link}
        to={item.to}
      >
        {content}
      </ListItemButton>
    ) : (
      <ListItemButton
        sx={{
          minHeight: 32,
          justifyContent: open ? "initial" : "center",
          px: open ? 1.5 : 0,
        }}
        onClick={() => void handleAction(item.label, item.action)}
      >
        {content}
      </ListItemButton>
    );

    return (
      <ListItem key={key} disablePadding sx={{ display: "block" }}>
        <Tooltip title={item.label} placement="right" disableHoverListener={open}>
          {button}
        </Tooltip>
      </ListItem>
    );
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
              px: open ? 0.5 : 0,
              py: 0.25,
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
            {primaryNavItems.map((item) => renderNavItem(item))}
            {externalApplications.length > 0 && (
              <>
                <Divider sx={{ my: 0.5 }} />
                {open && (
                  <Typography
                    variant="overline"
                    sx={{ display: "block", px: 1.5, pt: 0.25, color: "text.secondary", lineHeight: 1.8 }}
                  >
                    Tools
                  </Typography>
                )}
                {externalApplications.map((application) =>
                  renderNavItem(
                    {
                      label: application.name,
                      icon: (
                        <ExternalApplicationIcon
                          name={application.name}
                          iconDataUrl={application.iconDataUrl}
                          size={18}
                        />
                      ),
                      action: () => openExternalApplication(application),
                    },
                    `external-${application.id}`,
                  ),
                )}
              </>
            )}
            <Divider sx={{ my: 0.5 }} />
            {renderNavItem(settingsNavItem)}
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
