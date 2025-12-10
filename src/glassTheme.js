// glassTheme.js
import { createTheme } from "@mui/material/styles";

const glass = {
  // Tweak these to taste
  blur: "14px",
  bg: "rgba(255, 255, 255, 0.08)",
  bgElevated: "rgba(255, 255, 255, 0.12)",
  border: "1px solid rgba(255, 255, 255, 0.18)",
  shadow: "0 10px 40px rgba(0, 0, 0, 0.35)",
  saturate: "140%",
};

export const glassTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#8AB4F8" },
    secondary: { main: "#FFB1F3" },
    background: {
      default: "#0b0f14",
      paper: "rgba(255,255,255,0.06)",
    },

    divider: "rgba(255,255,255,0.12)",
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '"Inter", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
    h1: { fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontWeight: 700, letterSpacing: "-0.02em" },
    h3: { fontWeight: 700, letterSpacing: "-0.02em" },
  },
  shadows: ["none", ...Array.from({ length: 24 }, () => glass.shadow)],
  components: {
    MuiDataGrid: {
      styleOverrides: {
        root: {
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          backgroundColor: "rgba(18, 22, 27, 0.75)", // darker translucent background
          border: glass.border,
          borderRadius: "16px",
          boxShadow: glass.shadow,
          color: "rgba(255, 255, 255, 0.92)",
          transition: "background-color 0.3s ease, box-shadow 0.3s ease",
        },

        // Header
        columnHeaders: {
          backgroundColor: "rgba(30, 36, 42, 0.85)", // darker header band
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255, 255, 255, 0.95)",
          fontWeight: 600,
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
        },

        // Rows
        row: {
          backgroundColor: "rgba(20, 24, 30, 0.65)",
          "&:hover": {
            backgroundColor: "rgba(40, 48, 58, 0.85)",
          },
        },

        // Cells
        cell: {
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        },

        // Footer
        footerContainer: {
          backgroundColor: "rgba(28, 32, 38, 0.85)",
          borderTop: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
        },
      },
    },

    MuiCssBaseline: {
      styleOverrides: {
        "*, *::before, *::after": {
          boxSizing: "border-box",
        },
        html: { height: "100%" },
        body: {
          minHeight: "100%",
          backgroundColor: "#0b0f14",
          backgroundImage: `radial-gradient(1200px 800px at 10% 0%, rgba(138,180,248,0.12), transparent 60%),
             radial-gradient(900px 600px at 90% 20%, rgba(255,177,243,0.10), transparent 60%),
             radial-gradient(700px 500px at 50% 110%, rgba(0,255,194,0.08), transparent 60%),
             linear-gradient(transparent, transparent)`,
          backgroundAttachment: "fixed",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "::backdrop": { backgroundColor: "rgba(0,0,0,0.6)" },
      },
    },

    // ---- Core glass look on surfaces ----
    MuiPaper: {
      styleOverrides: {
        root: {
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          backgroundColor: glass.bg,
          border: glass.border,
          boxShadow: glass.shadow,
        },
        outlined: {
          backgroundColor: glass.bgElevated,
        },
      },
      variants: [
        {
          props: { variant: "glass" },
          style: {
            backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            backgroundColor: glass.bgElevated,
            border: glass.border,
            boxShadow: glass.shadow,
          },
        },
      ],
    },

    MuiCard: {
      defaultProps: { elevation: 8, variant: "elevation" },
      styleOverrides: {
        root: {
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          backgroundColor: glass.bgElevated,
          border: glass.border,
        },
      },
      variants: [
        {
          props: { variant: "glass" },
          style: { backgroundColor: glass.bgElevated },
        },
      ],
    },

    MuiAppBar: {
      defaultProps: { elevation: 6 },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: "rgba(10,12,16,0.4)",
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          borderBottom: glass.border,
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: { backdropFilter: "inherit", WebkitBackdropFilter: "inherit" },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: glass.bg,
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          borderRight: glass.border,
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: "rgba(20, 24, 31, 0.6)",
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          border: glass.border,
        },
      },
    },

    MuiModal: {
      styleOverrides: {
        root: { backdropFilter: "none" },
        backdrop: { backgroundColor: "rgba(4,6,9,0.55)" },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: "rgba(255,255,255,0.08)",
          border: glass.border,
          backdropFilter: `saturate(${glass.saturate}) blur(8px)`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(8px)`,
        },
      },
    },

    MuiFab: {
      defaultProps: {
        color: "primary",
      },
      styleOverrides: {
        root: {
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          backgroundColor: "rgba(255, 255, 255, 0.10)", // translucent glass
          border: glass.border,
          boxShadow: glass.shadow,
          color: "#fff",
          transition: "all 0.25s ease",
          "&:hover": {
            backgroundColor: "rgba(255, 255, 255, 0.18)",
            boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
            transform: "translateY(-2px)",
          },
          "&:active": {
            backgroundColor: "rgba(255, 255, 255, 0.24)",
            transform: "translateY(0px) scale(0.97)",
          },
          "& .MuiSvgIcon-root": {
            filter: "drop-shadow(0 0 6px rgba(0,0,0,0.5))",
          },
        },

        // Secondary Fab style (slightly tinted)
        secondary: {
          backgroundColor: "rgba(138,180,248,0.18)",
          "&:hover": {
            backgroundColor: "rgba(138,180,248,0.25)",
          },
        },

        // Extended Fabs
        extended: {
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          backgroundColor: "rgba(255, 255, 255, 0.10)",
          border: glass.border,
          boxShadow: glass.shadow,
          paddingInline: "20px",
          fontWeight: 500,
          "&:hover": {
            backgroundColor: "rgba(255, 255, 255, 0.18)",
          },
        },
      },
    },

    // ---- Buttons & Inputs ----
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 14,
          textTransform: "none",
          color: "#fff", // <-- Force white text globally
          fontWeight: 500,
          backdropFilter: `saturate(${glass.saturate}) blur(4px)`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(4px)`,
          transition: "all 0.25s ease",
          "& svg": { color: "#fff !important" }, // icons stay white too
        },

        contained: {
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))",
          border: glass.border,
          boxShadow: glass.shadow,
          color: "#fff", // ensure white text for contained
          "&:hover": {
            filter: "brightness(1.08)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))",
            boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
          },
          "&:active": {
            transform: "translateY(1px)",
          },
        },

        outlined: {
          border: glass.border,
          backgroundColor: "rgba(255,255,255,0.04)",
          color: "#fff",
          "&:hover": {
            backgroundColor: "rgba(255,255,255,0.08)",
            borderColor: "rgba(255,255,255,0.4)",
          },
        },

        text: {
          color: "#fff",
          backgroundColor: "transparent",
          "&:hover": {
            backgroundColor: "rgba(255,255,255,0.08)",
          },
        },
      },

      // Optional glass variant
      variants: [
        {
          props: { variant: "glass" },
          style: {
            backgroundColor: glass.bgElevated,
            border: glass.border,
            boxShadow: glass.shadow,
            color: "#fff",
            "&:hover": {
              backgroundColor: "rgba(255,255,255,0.18)",
            },
          },
        },
      ],
    },

    MuiTextField: {
      defaultProps: { variant: "outlined" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(255,255,255,0.06)",
          backdropFilter: `saturate(${glass.saturate}) blur(6px)`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(6px)`,
          "& fieldset": { borderColor: "rgba(255,255,255,0.22)" },
          "&:hover fieldset": { borderColor: "rgba(255,255,255,0.34)" },
          "&.Mui-focused fieldset": { borderColor: "#8AB4F8" },
        },
        input: { color: "rgba(255,255,255,0.92)" },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: "rgba(255,255,255,0.12)",
          backdropFilter: "inherit",
          WebkitBackdropFilter: "inherit",
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(255,255,255,0.08)",
          border: glass.border,
          backdropFilter: `saturate(${glass.saturate}) blur(6px)`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(6px)`,
        },
      },
    },
  },
});
