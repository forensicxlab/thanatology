// glassTheme.js
import { createTheme } from "@mui/material/styles";

const apple = {
  accentBlue: "#0A84FF",
  accentGreen: "#30D158",
  background: "#0b0c10",
  backgroundElevated: "rgba(28, 28, 30, 0.72)",
  surface: "rgba(44, 44, 46, 0.72)",
  surfaceHeader: "rgba(58, 58, 60, 0.8)",
  surfaceHover: "rgba(72, 72, 74, 0.85)",
  textPrimary: "rgba(242, 242, 247, 0.95)",
  textSecondary: "rgba(235, 235, 245, 0.6)",
};

const glass = {
  // Tweak these to taste
  blur: "14px",
  bg: "rgba(44, 44, 46, 0.52)",
  bgElevated: "rgba(58, 58, 60, 0.5)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  shadow: "0 10px 36px rgba(0, 0, 0, 0.45)",
  saturate: "140%",
};

export const glassTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: apple.accentBlue },
    secondary: { main: apple.accentGreen },
    background: {
      default: apple.background,
      paper: apple.backgroundElevated,
    },

    divider: "rgba(255,255,255,0.14)",
    text: {
      primary: apple.textPrimary,
      secondary: apple.textSecondary,
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '"SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
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
          backgroundColor: apple.surface,
          border: glass.border,
          borderRadius: "16px",
          boxShadow: glass.shadow,
          color: apple.textPrimary,
          transition: "background-color 0.3s ease, box-shadow 0.3s ease",
        },

        // Header
        columnHeaders: {
          backgroundColor: apple.surfaceHeader,
          borderBottom: "1px solid rgba(255,255,255,0.16)",
          color: apple.textPrimary,
          fontWeight: 600,
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
        },

        // Rows
        row: {
          backgroundColor: apple.surface,
          "&:hover": {
            backgroundColor: apple.surfaceHover,
          },
        },

        // Cells
        cell: {
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        },

        // Footer
        footerContainer: {
          backgroundColor: apple.surfaceHeader,
          borderTop: "1px solid rgba(255,255,255,0.14)",
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
          backgroundColor: apple.background,
          backgroundImage: `radial-gradient(1200px 800px at 8% 0%, rgba(10,132,255,0.16), transparent 60%),
             radial-gradient(920px 620px at 92% 14%, rgba(48,209,88,0.12), transparent 62%),
             radial-gradient(720px 520px at 50% 110%, rgba(94,92,230,0.08), transparent 62%),
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
          backgroundColor: "rgba(28, 28, 30, 0.5)",
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
          backgroundColor: "rgba(44, 44, 46, 0.72)",
          backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
          border: glass.border,
        },
      },
    },

    MuiModal: {
      styleOverrides: {
        root: { backdropFilter: "none" },
        backdrop: { backgroundColor: "rgba(0,0,0,0.55)" },
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
          backgroundColor: "rgba(48,209,88,0.24)",
          "&:hover": {
            backgroundColor: "rgba(48,209,88,0.32)",
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
      defaultProps: { variant: "outlined", size: "small" },
    },
    MuiFormControl: {
      defaultProps: { size: "small" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(58,58,60,0.4)",
          backdropFilter: `saturate(${glass.saturate}) blur(6px)`,
          WebkitBackdropFilter: `saturate(${glass.saturate}) blur(6px)`,
          fontSize: "0.9rem",
          "& fieldset": { borderColor: "rgba(255,255,255,0.22)" },
          "&:hover fieldset": { borderColor: "rgba(255,255,255,0.34)" },
          "&.Mui-focused fieldset": { borderColor: apple.accentBlue },
          "&.MuiInputBase-sizeSmall": {
            minHeight: 34,
          },
        },
        input: {
          color: apple.textPrimary,
          padding: "8px 10px",
        },
        inputSizeSmall: {
          padding: "6px 10px",
        },
        inputMultiline: {
          padding: 0,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: "0.85rem",
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        select: {
          minHeight: "unset",
          paddingTop: 8,
          paddingBottom: 8,
        },
        selectSizeSmall: {
          paddingTop: 6,
          paddingBottom: 6,
        },
      },
    },
    MuiAutocomplete: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        inputRoot: {
          "& .MuiAutocomplete-input": {
            minWidth: 0,
          },
        },
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
