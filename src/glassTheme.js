import { alpha, createTheme } from "@mui/material/styles";

const darkColors = {
  accentBlue: "#0A84FF",
  accentGreen: "#30D158",
  accentRed: "#FF453A",
  background: "#0b0c10",
  backgroundElevated: "rgba(28, 28, 30, 0.72)",
  dataGridBase: "#202126",
  dataGridHeader: "#2e3037",
  dataGridPinned: "#272930",
  dataGridHover: "rgba(255, 255, 255, 0.04)",
  textPrimary: "rgba(242, 242, 247, 0.95)",
  textSecondary: "rgba(235, 235, 245, 0.6)",
};

const darkGlass = {
  blur: "14px",
  bg: "rgba(44, 44, 46, 0.52)",
  bgElevated: "rgba(58, 58, 60, 0.5)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  shadow: "0 10px 36px rgba(0, 0, 0, 0.45)",
  saturate: "140%",
};

const lightColors = {
  accentBlue: "#007AFF",
  accentGreen: "#34C759",
  accentRed: "#FF3B30",
  // macOS system gray — slightly cooler than pure iOS gray
  background: "#EBEBF0",
  backgroundElevated: "rgba(255, 255, 255, 0.78)",
  dataGridBase: "rgba(255, 255, 255, 0.96)",
  dataGridHeader: "rgba(246, 246, 250, 0.98)",
  dataGridPinned: "rgba(248, 248, 252, 0.98)",
  dataGridHover: "rgba(0, 0, 0, 0.035)",
  // Apple HIG label colors
  textPrimary: "rgba(0, 0, 0, 0.85)",
  textSecondary: "rgba(60, 60, 67, 0.60)",
};

const lightGlass = {
  // macOS Vibrancy: higher saturation + larger blur than dark mode
  blur: "20px",
  saturate: "180%",
  bg: "rgba(255, 255, 255, 0.72)",
  bgElevated: "rgba(255, 255, 255, 0.65)",
  // Apple-style separator — barely-there hairline
  border: "1px solid rgba(60, 60, 67, 0.14)",
  // Multi-layer Apple shadow: close ambient + far diffuse
  shadow:
    "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.07), 0 12px 28px rgba(0,0,0,0.05)",
};

export function createGlassTheme(mode) {
  const isDark = mode === "dark";
  const apple = isDark ? darkColors : lightColors;
  const glass = isDark ? darkGlass : lightGlass;

  return createTheme({
    palette: {
      mode,
      primary: { main: apple.accentBlue },
      secondary: { main: apple.accentGreen },
      background: {
        default: apple.background,
        paper: apple.backgroundElevated,
      },
      DataGrid: {
        bg: apple.dataGridBase,
        headerBg: apple.dataGridHeader,
        pinnedBg: apple.dataGridPinned,
      },
      divider: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)",
      text: {
        primary: apple.textPrimary,
        secondary: apple.textSecondary,
      },
    },
    shape: { borderRadius: 10 },
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
            "&.MuiDataGrid-root": {
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
              backgroundColor: apple.dataGridBase,
              border: glass.border,
              borderRadius: "10px",
              boxShadow: "none",
              color: apple.textPrimary,
              transition: "background-color 0.3s ease, box-shadow 0.3s ease",
            },
          },
          horizontal: {
            backgroundColor: "transparent",
            border: 0,
            borderRadius: 0,
          },
          vertical: {
            backgroundColor: "transparent",
            border: 0,
            borderRadius: 0,
          },
          columnHeaders: {
            backgroundColor: apple.dataGridHeader,
            borderBottom: isDark
              ? "1px solid rgba(255,255,255,0.16)"
              : "1px solid rgba(0,0,0,0.10)",
            color: apple.textPrimary,
            fontWeight: 600,
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
          },
          row: {
            backgroundColor: "transparent",
            "&:hover": { backgroundColor: apple.dataGridHover },
          },
          cell: {
            borderBottom: isDark
              ? "1px solid rgba(255,255,255,0.08)"
              : "1px solid rgba(0,0,0,0.06)",
          },
          footerContainer: {
            backgroundColor: apple.dataGridHeader,
            borderTop: isDark
              ? "1px solid rgba(255,255,255,0.14)"
              : "1px solid rgba(0,0,0,0.08)",
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
            minHeight: 36,
          },
          columnHeader: {
            height: "36px !important",
          },
          toolbarContainer: {
            padding: "4px 8px",
            minHeight: 36,
            gap: 4,
            "& .MuiButton-root": { fontSize: "0.75rem", padding: "3px 8px" },
            "& .MuiInputBase-root": { fontSize: "0.8rem" },
          },
        },
      },

      MuiCssBaseline: {
        styleOverrides: {
          "*, *::before, *::after": { boxSizing: "border-box" },
          html: { height: "100%" },
          body: {
            minHeight: "100%",
            backgroundColor: apple.background,
            backgroundImage: isDark
              ? `radial-gradient(1200px 800px at 8% 0%, rgba(10,132,255,0.16), transparent 60%),
                 radial-gradient(920px 620px at 92% 14%, rgba(48,209,88,0.12), transparent 62%),
                 radial-gradient(720px 520px at 50% 110%, rgba(94,92,230,0.08), transparent 62%),
                 linear-gradient(transparent, transparent)`
              // Barely-there tint — lets the frosted surfaces pop against a neutral bg
              : `radial-gradient(ellipse 1100px 550px at 15% -8%, rgba(0,122,255,0.06) 0%, transparent 55%),
                 radial-gradient(ellipse 900px 420px at 88% 8%, rgba(52,199,89,0.04) 0%, transparent 55%),
                 linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 30%)`,
            backgroundAttachment: "fixed",
            WebkitFontSmoothing: "antialiased",
            MozOsxFontSmoothing: "grayscale",
          },
          "::backdrop": {
            backgroundColor: isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.3)",
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: {
            backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            backgroundColor: glass.bg,
            border: glass.border,
            boxShadow: glass.shadow,
          },
          outlined: { backgroundColor: glass.bgElevated },
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
          { props: { variant: "glass" }, style: { backgroundColor: glass.bgElevated } },
        ],
      },

      MuiAppBar: {
        defaultProps: { elevation: 6 },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: isDark
              ? "rgba(28, 28, 30, 0.5)"
              // macOS toolbar: slightly more opaque than panels, warm-neutral
              : "rgba(246, 246, 248, 0.82)",
            backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            borderBottom: glass.border,
            // Lift text/icon color for light mode titlebar
            color: isDark ? undefined : "rgba(0,0,0,0.80)",
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
            // macOS sidebar vibrancy: push saturation higher and use near-transparent white
            backgroundColor: isDark
              ? glass.bg
              : "rgba(246, 246, 248, 0.78)",
            backdropFilter: isDark
              ? `saturate(${glass.saturate}) blur(${glass.blur})`
              : "saturate(220%) blur(28px)",
            WebkitBackdropFilter: isDark
              ? `saturate(${glass.saturate}) blur(${glass.blur})`
              : "saturate(220%) blur(28px)",
            borderRight: glass.border,
          },
        },
      },

      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark
              ? "rgba(44, 44, 46, 0.72)"
              : "rgba(255, 255, 255, 0.85)",
            backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
            border: glass.border,
          },
        },
      },

      MuiModal: {
        styleOverrides: {
          root: { backdropFilter: "none" },
          backdrop: {
            backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.3)",
          },
        },
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: isDark
            ? {
                backgroundColor: "rgba(255,255,255,0.08)",
                border: glass.border,
                backdropFilter: `saturate(${glass.saturate}) blur(8px)`,
                WebkitBackdropFilter: `saturate(${glass.saturate}) blur(8px)`,
                color: apple.textPrimary,
              }
            : {
                // macOS dark tooltip — solid charcoal, no blur
                backgroundColor: "rgba(36, 36, 38, 0.92)",
                border: "none",
                borderRadius: 6,
                color: "rgba(255,255,255,0.92)",
                fontSize: "0.78rem",
                padding: "4px 9px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.20)",
              },
        },
      },

      MuiFab: {
        defaultProps: { color: "primary" },
        styleOverrides: {
          root: isDark
            ? {
                backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
                WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
                backgroundColor: "rgba(255, 255, 255, 0.10)",
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
              }
            : {
                // macOS action button: solid white card, accent-colored icon
                backgroundColor: "#ffffff",
                border: "none",
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.10)",
                color: apple.accentBlue,
                transition: "all 0.2s ease",
                "&:hover": {
                  backgroundColor: "#f5f5f7",
                  boxShadow:
                    "0 2px 6px rgba(0,0,0,0.08), 0 6px 18px rgba(0,0,0,0.10)",
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  backgroundColor: "#ebebed",
                  transform: "translateY(0px) scale(0.97)",
                },
              },
          secondary: {
            backgroundColor: isDark
              ? "rgba(48,209,88,0.24)"
              : "rgba(52,199,89,0.20)",
            "&:hover": {
              backgroundColor: isDark
                ? "rgba(48,209,88,0.32)"
                : "rgba(52,199,89,0.28)",
            },
          },
          extended: isDark
            ? {
                backdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
                WebkitBackdropFilter: `saturate(${glass.saturate}) blur(${glass.blur})`,
                backgroundColor: "rgba(255, 255, 255, 0.10)",
                border: glass.border,
                boxShadow: glass.shadow,
                paddingInline: "20px",
                fontWeight: 500,
                "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.18)" },
              }
            : {
                backgroundColor: "#ffffff",
                border: "none",
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.10)",
                color: apple.accentBlue,
                paddingInline: "20px",
                fontWeight: 500,
                "&:hover": { backgroundColor: "#f5f5f7" },
              },
        },
      },

      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            textTransform: "none",
            fontWeight: 500,
            transition: "all 0.2s ease",
            ...(isDark
              ? {
                  backdropFilter: `saturate(${glass.saturate}) blur(4px)`,
                  WebkitBackdropFilter: `saturate(${glass.saturate}) blur(4px)`,
                  color: "#fff",
                  "& svg": { color: "#fff !important" },
                }
              : {}),
          },
          contained: isDark
            ? {
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))",
                border: glass.border,
                boxShadow: glass.shadow,
                color: "#fff",
                "&:hover": {
                  filter: "brightness(1.08)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))",
                  boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
                },
                "&:active": { transform: "translateY(1px)" },
              }
            : {
                // Apple: solid saturated fill, tight shadow, white label
                color: "#fff",
                boxShadow:
                  "0 1px 2px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.08)",
                "&:hover": {
                  filter: "brightness(0.93)",
                  boxShadow:
                    "0 2px 6px rgba(0,0,0,0.12), 0 4px 14px rgba(0,0,0,0.10)",
                },
                "&:active": {
                  filter: "brightness(0.87)",
                  transform: "translateY(1px)",
                },
              },
          outlined: isDark
            ? {
                border: glass.border,
                backgroundColor: "rgba(255,255,255,0.04)",
                color: "#fff",
                "&:hover": {
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderColor: "rgba(255,255,255,0.4)",
                },
              }
            : {
                // Tinted border matching the primary colour
                border: `1px solid rgba(0, 122, 255, 0.40)`,
                backgroundColor: "rgba(0, 122, 255, 0.05)",
                color: apple.accentBlue,
                "&:hover": {
                  backgroundColor: "rgba(0, 122, 255, 0.10)",
                  borderColor: "rgba(0, 122, 255, 0.65)",
                },
              },
          text: isDark
            ? {
                color: "#fff",
                backgroundColor: "transparent",
                "&:hover": { backgroundColor: "rgba(255,255,255,0.08)" },
              }
            : {
                // Text buttons use the accent colour directly
                color: apple.accentBlue,
                backgroundColor: "transparent",
                "&:hover": { backgroundColor: "rgba(0, 122, 255, 0.07)" },
              },
        },
        variants: [
          {
            props: { variant: "glass" },
            style: {
              backgroundColor: glass.bgElevated,
              border: glass.border,
              boxShadow: glass.shadow,
              color: isDark ? "#fff" : apple.textPrimary,
              "&:hover": {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.18)"
                  : "rgba(0,0,0,0.10)",
              },
            },
          },
        ],
      },

      MuiList: {
        defaultProps: { dense: true },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { minHeight: 32, paddingTop: 4, paddingBottom: 4, fontSize: "0.875rem" },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { padding: "6px 12px", fontSize: "0.82rem" },
          head: { padding: "5px 12px", fontWeight: 600, fontSize: "0.78rem" },
          sizeSmall: { padding: "4px 8px" },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined", size: "small" },
      },
      MuiFormControl: {
        defaultProps: { size: "small" },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: isDark
            ? {
                backgroundColor: "rgba(58,58,60,0.4)",
                backdropFilter: `saturate(${glass.saturate}) blur(6px)`,
                WebkitBackdropFilter: `saturate(${glass.saturate}) blur(6px)`,
                fontSize: "0.9rem",
                "& fieldset": { borderColor: "rgba(255,255,255,0.22)" },
                "&:hover fieldset": { borderColor: "rgba(255,255,255,0.34)" },
                "&.Mui-focused fieldset": { borderColor: apple.accentBlue },
                "&.MuiInputBase-sizeSmall": { minHeight: 34 },
              }
            : {
                // Apple text field: solid white, crisp border, blue focus ring
                backgroundColor: "#ffffff",
                fontSize: "0.9rem",
                borderRadius: 8,
                "& fieldset": {
                  borderColor: "rgba(60, 60, 67, 0.26)",
                  borderRadius: 8,
                },
                "&:hover fieldset": { borderColor: "rgba(60, 60, 67, 0.45)" },
                "&.Mui-focused fieldset": {
                  borderColor: apple.accentBlue,
                  borderWidth: "1.5px",
                  // Subtle focus glow
                  boxShadow: `0 0 0 3px rgba(0, 122, 255, 0.12)`,
                },
                "&.MuiInputBase-sizeSmall": { minHeight: 34 },
              },
          input: {
            color: apple.textPrimary,
            padding: "8px 10px",
          },
          inputSizeSmall: { padding: "6px 10px" },
          inputMultiline: { padding: 0 },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { fontSize: "0.85rem" },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: { minHeight: "unset", paddingTop: 8, paddingBottom: 8 },
          selectSizeSmall: { paddingTop: 6, paddingBottom: 6 },
        },
      },
      MuiAutocomplete: {
        defaultProps: { size: "small" },
        styleOverrides: {
          inputRoot: {
            "& .MuiAutocomplete-input": { minWidth: 0 },
          },
        },
      },

      MuiDivider: {
        styleOverrides: {
          root: {
            // Apple system separator color
            borderColor: isDark
              ? "rgba(255,255,255,0.12)"
              : "rgba(60, 60, 67, 0.18)",
            backdropFilter: "inherit",
            WebkitBackdropFilter: "inherit",
          },
        },
      },

      // Sidebar nav items in light mode: subtle hover, blue active tint
      MuiListItemButton: {
        styleOverrides: {
          root: isDark
            ? {
                borderRadius: 6,
                margin: "1px 4px",
                padding: "4px 8px",
              }
            : {
                borderRadius: 6,
                margin: "1px 4px",
                padding: "4px 8px",
                "&:hover": {
                  backgroundColor: "rgba(0, 0, 0, 0.05)",
                },
                "&.Mui-selected": {
                  backgroundColor: "rgba(0, 122, 255, 0.12)",
                  color: apple.accentBlue,
                  "&:hover": { backgroundColor: "rgba(0, 122, 255, 0.16)" },
                  "& .MuiListItemIcon-root": { color: apple.accentBlue },
                },
              },
        },
      },

      MuiListItemIcon: {
        styleOverrides: {
          root: isDark ? {} : { color: "rgba(60, 60, 67, 0.75)" },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: ({ ownerState }) => {
            const isSuccess = ownerState.color === "success";
            const isError = ownerState.color === "error";
            const isFilled = ownerState.variant === "filled";
            const isOutlined = ownerState.variant === "outlined";

            const successBase = {
              backgroundColor: alpha(apple.accentGreen, isFilled ? 0.3 : 0.14),
              border: `1px solid ${alpha(apple.accentGreen, 0.5)}`,
              color: isDark ? alpha("#ffffff", 0.96) : apple.textPrimary,
            };

            const errorBase = {
              backgroundColor: alpha(apple.accentRed, isFilled ? 0.28 : 0.12),
              border: `1px solid ${alpha(apple.accentRed, 0.5)}`,
              color: isDark ? alpha("#ffffff", 0.96) : apple.textPrimary,
            };

            return {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.06)",
              border: glass.border,
              color: apple.textPrimary,
              backdropFilter: `saturate(${glass.saturate}) blur(6px)`,
              WebkitBackdropFilter: `saturate(${glass.saturate}) blur(6px)`,
              transition:
                "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
              "& .MuiChip-icon, & .MuiChip-deleteIcon": { color: "inherit" },
              ...(isSuccess ? successBase : {}),
              ...(isError ? errorBase : {}),
              ...(isOutlined ? { boxShadow: "none" } : {}),
              ...(ownerState.clickable && isSuccess
                ? {
                    "&:hover": {
                      backgroundColor: alpha(
                        apple.accentGreen,
                        isFilled ? 0.38 : 0.2
                      ),
                      borderColor: alpha(apple.accentGreen, 0.65),
                    },
                  }
                : {}),
              ...(ownerState.clickable && isError
                ? {
                    "&:hover": {
                      backgroundColor: alpha(
                        apple.accentRed,
                        isFilled ? 0.36 : 0.18
                      ),
                      borderColor: alpha(apple.accentRed, 0.65),
                    },
                  }
                : {}),
            };
          },
        },
      },
    },
  });
}

export const glassTheme = createGlassTheme("dark");
