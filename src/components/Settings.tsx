import { useEffect } from "react";
import { styled } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Select from "@mui/material/Select";
import InputLabel from "@mui/material/InputLabel";
import FormControl from "@mui/material/FormControl";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import { useSnackbar } from "./SnackbarProvider";
import { useThemeMode } from "../ThemeContext";
import { useAiConfigStore } from "../store/aiConfigStore";

const Item = styled(Paper)(({ theme }) => ({
  ...theme.typography.body2,
  padding: theme.spacing(3),
  textAlign: "left",
  color: theme.palette.text.secondary,
}));

export default function Settings() {
  const { display_message } = useSnackbar();
  const { themeMode, setThemeMode } = useThemeMode();
  const { config, loaded, setConfig, loadConfig, saveConfig } = useAiConfigStore();

  useEffect(() => {
    if (!loaded) loadConfig();
  }, [loaded, loadConfig]);

  const handleSaveAIConfig = async () => {
    await saveConfig();
    if (display_message) {
      display_message("success", "AI Configuration saved.");
    }
  };

  const handleThemeChange = (_: React.MouseEvent<HTMLElement>, newMode: "light" | "dark" | null) => {
    if (newMode) setThemeMode(newMode);
  };

  const handleProviderChange = (newProv: string) => {
    if (newProv === "copilot") {
      setConfig({ provider: newProv, endpoint: "http://10.0.0.198", model: "forensic-qwen" });
    } else if (newProv === "openai") {
      setConfig({ provider: newProv, endpoint: "https://api.openai.com/v1", model: "gpt-4o" });
    } else if (newProv === "ollama") {
      setConfig({ provider: newProv, endpoint: "http://localhost:11434", model: "llama3.1:latest" });
    }
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Item>
            <Typography variant="h6" gutterBottom sx={{ color: "text.primary" }}>
              AI Copilot Configuration
            </Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>
              Configure the background AI provider used to investigate the loaded cases.
            </Typography>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <FormControl fullWidth>
                <InputLabel id="ai-provider-label">Provider</InputLabel>
                <Select
                  labelId="ai-provider-label"
                  id="ai-provider-select"
                  value={config.provider}
                  label="Provider"
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <MenuItem value={"copilot"}>DFI Copilot (Local GPU Stack)</MenuItem>
                  <MenuItem value={"ollama"}>Ollama (Local / Private)</MenuItem>
                  <MenuItem value={"openai"}>OpenAI (Cloud)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Endpoint URL"
                variant="outlined"
                value={config.endpoint}
                onChange={(e) => setConfig({ endpoint: e.target.value })}
                helperText={
                  config.provider === "copilot"
                    ? "Base IP/hostname of the dfi-copilot stack (e.g. http://10.0.0.198). Services are auto-discovered on :8000–:8002."
                    : config.provider === "openai"
                    ? "OpenAI API base: https://api.openai.com/v1"
                    : "Ollama base URL: http://localhost:11434"
                }
              />

              <TextField
                fullWidth
                label="Model Name"
                variant="outlined"
                value={config.model}
                onChange={(e) => setConfig({ model: e.target.value })}
                helperText={
                  config.provider === "copilot"
                    ? "Model served by the vLLM forensic-llm container (default: forensic-qwen)."
                    : config.provider === "ollama"
                    ? "Make sure the model is pulled locally."
                    : "OpenAI model ID (e.g. gpt-4o)."
                }
              />

              {config.provider === "openai" && (
                <TextField
                  fullWidth
                  label="API Token"
                  variant="outlined"
                  type="password"
                  value={config.api_key}
                  onChange={(e) => setConfig({ api_key: e.target.value })}
                  helperText="Your OpenAI secret key."
                />
              )}

              <Button
                variant="contained"
                color="primary"
                onClick={handleSaveAIConfig}
                sx={{ alignSelf: "flex-start", mt: 2 }}
              >
                Save Settings
              </Button>
            </Box>
          </Item>

          <Item sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ color: "text.primary" }}>
              Post-Processing AI Specialists
            </Typography>
            <Typography variant="body2" sx={{ mb: 3 }}>
              Enable these background agents to autonomously analyze extracted evidence files during indexation.
            </Typography>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography variant="subtitle1">Image Specialist</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Uses a vision model (OpenAI gpt-4o or dfi-copilot image2text) to scan photos and graphics for forensic relevance.
                  </Typography>
                </Box>
                <input
                  type="checkbox"
                  checked={config.enable_image_specialist}
                  onChange={(e) => setConfig({ enable_image_specialist: e.target.checked })}
                  style={{ transform: "scale(1.5)" }}
                />
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography variant="subtitle1">Text Specialist</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Scans configuration files, scripts, and pure text files for credentials or suspicious traits.
                  </Typography>
                </Box>
                <input
                  type="checkbox"
                  checked={config.enable_text_specialist}
                  onChange={(e) => setConfig({ enable_text_specialist: e.target.checked })}
                  style={{ transform: "scale(1.5)" }}
                />
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography variant="subtitle1">Audio Specialist</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Transcribes audio recordings via Whisper (OpenAI or dfi-copilot audio2text) and scores forensic relevance.
                  </Typography>
                </Box>
                <input
                  type="checkbox"
                  checked={config.enable_audio_specialist}
                  onChange={(e) => setConfig({ enable_audio_specialist: e.target.checked })}
                  style={{ transform: "scale(1.5)" }}
                />
              </Box>

              <TextField
                label="Batch Size"
                type="number"
                variant="outlined"
                value={config.batch_size}
                onChange={(e) => setConfig({ batch_size: Math.max(1, parseInt(e.target.value) || 1) })}
                slotProps={{ htmlInput: { min: 1, max: 100 } }}
                helperText="Number of files processed per AI batch. Lower values reduce GPU pressure."
                sx={{ maxWidth: 200 }}
              />

              <Button
                variant="contained"
                color="primary"
                onClick={handleSaveAIConfig}
                sx={{ alignSelf: "flex-start", mt: 1 }}
              >
                Save Settings
              </Button>
            </Box>
          </Item>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Item>
            <Typography variant="h6" gutterBottom sx={{ color: "text.primary" }}>
              Appearance
            </Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Choose the application colour theme.
            </Typography>
            <ToggleButtonGroup
              value={themeMode}
              exclusive
              onChange={handleThemeChange}
              aria-label="theme mode"
              fullWidth
            >
              <ToggleButton value="light" aria-label="light mode">
                <LightModeIcon sx={{ mr: 1, fontSize: 18 }} />
                Light
              </ToggleButton>
              <ToggleButton value="dark" aria-label="dark mode">
                <DarkModeIcon sx={{ mr: 1, fontSize: 18 }} />
                Dark
              </ToggleButton>
            </ToggleButtonGroup>
          </Item>

          <Item sx={{ mt: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ color: "text.primary" }}>
              About
            </Typography>
            <Typography variant="body2">
              Thanatology Desktop Application Settings.
              Restarting the app or opening a new case will utilize the configurations saved here.
            </Typography>
          </Item>
        </Grid>
      </Grid>
    </Box>
  );
}
