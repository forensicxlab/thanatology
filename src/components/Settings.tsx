import { useState, useEffect } from "react";
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

const Item = styled(Paper)(({ theme }) => ({
  ...theme.typography.body2,
  padding: theme.spacing(3),
  textAlign: "left",
  color: theme.palette.text.secondary,
}));

export default function Settings() {
  const { display_message } = useSnackbar();
  const { themeMode, setThemeMode } = useThemeMode();

  // AI Configuration State
  const [aiProvider, setAiProvider] = useState("ollama");
  const [aiEndpoint, setAiEndpoint] = useState("http://localhost:11434");
  const [aiModel, setAiModel] = useState("llama3.1:latest");
  const [aiApiKey, setAiApiKey] = useState("");

  const [enableImageSpecialist, setEnableImageSpecialist] = useState(false);
  const [enableTextSpecialist, setEnableTextSpecialist] = useState(false);
  const [enableAudioSpecialist, setEnableAudioSpecialist] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const provider = localStorage.getItem("aiProvider");
    if (provider) setAiProvider(provider);

    const endpoint = localStorage.getItem("aiEndpoint");
    if (endpoint) setAiEndpoint(endpoint);

    const model = localStorage.getItem("aiModel");
    if (model) setAiModel(model);

    const apiKey = localStorage.getItem("aiApiKey");
    if (apiKey) setAiApiKey(apiKey);

    const imgSpec = localStorage.getItem("enableImageSpecialist");
    if (imgSpec) setEnableImageSpecialist(imgSpec === "true");

    const txtSpec = localStorage.getItem("enableTextSpecialist");
    if (txtSpec) setEnableTextSpecialist(txtSpec === "true");

    const audSpec = localStorage.getItem("enableAudioSpecialist");
    if (audSpec) setEnableAudioSpecialist(audSpec === "true");
  }, []);

  const handleSaveAIConfig = () => {
    localStorage.setItem("aiProvider", aiProvider);
    localStorage.setItem("aiEndpoint", aiEndpoint);
    localStorage.setItem("aiModel", aiModel);
    localStorage.setItem("aiApiKey", aiApiKey);

    localStorage.setItem("enableImageSpecialist", enableImageSpecialist.toString());
    localStorage.setItem("enableTextSpecialist", enableTextSpecialist.toString());
    localStorage.setItem("enableAudioSpecialist", enableAudioSpecialist.toString());

    if (display_message) {
      display_message("success", "AI Configuration saved to browser storage.");
    }
  };

  const handleThemeChange = (_: React.MouseEvent<HTMLElement>, newMode: "light" | "dark" | null) => {
    if (newMode) setThemeMode(newMode);
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
                  value={aiProvider}
                  label="Provider"
                  onChange={(e) => {
                    const newProv = e.target.value;
                    setAiProvider(newProv);
                    if (newProv === "openai" && aiEndpoint === "http://localhost:11434") {
                      setAiEndpoint("https://api.openai.com/v1");
                      setAiModel("gpt-4o");
                    } else if (newProv === "ollama" && aiEndpoint === "https://api.openai.com/v1") {
                      setAiEndpoint("http://localhost:11434");
                      setAiModel("llama3.1:latest");
                    }
                  }}
                >
                  <MenuItem value={"ollama"}>Ollama (Local / Private)</MenuItem>
                  <MenuItem value={"openai"}>OpenAI (Cloud)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                fullWidth
                label="Endpoint URL"
                variant="outlined"
                value={aiEndpoint}
                onChange={(e) => setAiEndpoint(e.target.value)}
                helperText="For Ollama: http://localhost:11434. For OpenAI: https://api.openai.com/v1"
              />

              <TextField
                fullWidth
                label="Model Name"
                variant="outlined"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                helperText="Make sure the model is pulled locally if using Ollama."
              />

              {aiProvider === "openai" && (
                <TextField
                  fullWidth
                  label="API Token"
                  variant="outlined"
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
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
                    Uses OpenAI Vision API to scan photos and graphics for relevant context.
                  </Typography>
                </Box>
                <input
                  type="checkbox"
                  checked={enableImageSpecialist}
                  onChange={(e) => setEnableImageSpecialist(e.target.checked)}
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
                  checked={enableTextSpecialist}
                  onChange={(e) => setEnableTextSpecialist(e.target.checked)}
                  style={{ transform: "scale(1.5)" }}
                />
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Box>
                  <Typography variant="subtitle1">Audio Specialist</Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Uses OpenAI Whisper API to transcribe and score audio recordings.
                  </Typography>
                </Box>
                <input
                  type="checkbox"
                  checked={enableAudioSpecialist}
                  onChange={(e) => setEnableAudioSpecialist(e.target.checked)}
                  style={{ transform: "scale(1.5)" }}
                />
              </Box>
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
