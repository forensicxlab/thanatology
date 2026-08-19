import { useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ExternalApplicationIcon from "../externalApps/ExternalApplicationIcon";
import { useSnackbar } from "../SnackbarProvider";
import { openExternalApplication, testExternalApplication } from "../../externalApps/launcher";
import {
  DEFAULT_EXTERNAL_APPLICATION_INPUT,
  isLocalOrPrivateHttpUrl,
  toExternalApplicationInput,
  validateExternalApplication,
} from "../../externalApps/types";
import type {
  ExternalApplication,
  ExternalApplicationInput,
} from "../../externalApps/types";
import { useExternalApplicationsStore } from "../../store/externalApplicationsStore";

const ACCEPTED_ICON_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_SOURCE_ICON_BYTES = 2 * 1024 * 1024;
const ICON_SIZE = 128;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

function processIcon(file: File): Promise<string> {
  if (!ACCEPTED_ICON_TYPES.has(file.type)) {
    return Promise.reject(new Error("Choose a PNG, JPEG, or WebP icon."));
  }
  if (file.size > MAX_SOURCE_ICON_BYTES) {
    return Promise.reject(new Error("The source icon cannot exceed 2 MB."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected icon could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("The selected file is not a valid image."));
      image.onload = () => {
        const scale = Math.min(1, ICON_SIZE / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("The icon processor is unavailable."));
          return;
        }
        context.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
        context.drawImage(
          image,
          Math.round((ICON_SIZE - width) / 2),
          Math.round((ICON_SIZE - height) / 2),
          width,
          height,
        );
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl.length > 700_000) {
          reject(new Error("The processed icon is too large."));
          return;
        }
        resolve(dataUrl);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function ExternalApplicationsSettingsPanel() {
  const { display_message } = useSnackbar();
  const applications = useExternalApplicationsStore((state) => state.applications);
  const loaded = useExternalApplicationsStore((state) => state.loaded);
  const loading = useExternalApplicationsStore((state) => state.loading);
  const storeError = useExternalApplicationsStore((state) => state.error);
  const load = useExternalApplicationsStore((state) => state.load);
  const save = useExternalApplicationsStore((state) => state.save);
  const remove = useExternalApplicationsStore((state) => state.remove);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ExternalApplicationInput>({
    ...DEFAULT_EXTERNAL_APPLICATION_INPUT,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probeMessage, setProbeMessage] = useState<{
    severity: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExternalApplication | null>(null);

  useEffect(() => {
    if (!loaded) void load().catch(() => undefined);
  }, [load, loaded]);

  const publicInsecureHttp = useMemo(() => {
    try {
      return new URL(form.url.trim()).protocol === "http:" && !isLocalOrPrivateHttpUrl(form.url);
    } catch {
      return false;
    }
  }, [form.url]);

  const openCreateDialog = () => {
    setEditingId(null);
    setForm({ ...DEFAULT_EXTERNAL_APPLICATION_INPUT });
    setErrors({});
    setProbeMessage(null);
    setDialogOpen(true);
  };

  const openEditDialog = (application: ExternalApplication) => {
    setEditingId(application.id);
    setForm(toExternalApplicationInput(application));
    setErrors({});
    setProbeMessage(null);
    setDialogOpen(true);
  };

  const updateForm = <K extends keyof ExternalApplicationInput>(
    key: K,
    value: ExternalApplicationInput[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setProbeMessage(null);
  };

  const handleSave = async () => {
    const validationErrors = validateExternalApplication(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      await save(editingId, form);
      setDialogOpen(false);
      display_message(
        "success",
        editingId === null ? "External tool added." : "External tool updated.",
      );
    } catch (error) {
      display_message("error", describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const validationErrors = validateExternalApplication({
      ...form,
      name: form.name || "Connection test",
    });
    if (validationErrors.url) {
      setErrors((current) => ({ ...current, url: validationErrors.url }));
      return;
    }

    setTesting(true);
    setProbeMessage(null);
    try {
      const result = await testExternalApplication(form);
      const severity = result.status < 400 ? "success" : result.status < 500 ? "warning" : "error";
      setProbeMessage({
        severity,
        text: `HTTP ${result.status} ${result.statusText} — ${result.finalUrl}`,
      });
    } catch (error) {
      setProbeMessage({ severity: "error", text: describeError(error) });
    } finally {
      setTesting(false);
    }
  };

  const handleIconFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      updateForm("iconDataUrl", await processIcon(file));
    } catch (error) {
      setErrors((current) => ({ ...current, icon: describeError(error) }));
    }
  };

  const handleLaunch = async (application: ExternalApplication) => {
    try {
      await openExternalApplication(application);
    } catch (error) {
      display_message("error", describeError(error));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      display_message("success", `${deleteTarget.name} removed.`);
      setDeleteTarget(null);
    } catch (error) {
      display_message("error", describeError(error));
    }
  };

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 2,
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h6" sx={{ color: "text.primary" }}>
            External Tools
          </Typography>
          <Typography variant="body2">
            Add local or remote web applications to the Thanatology dashboard and navigation.
          </Typography>
        </Box>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreateDialog}
          sx={{ flexShrink: 0 }}
        >
          Add tool
        </Button>
      </Box>

      {storeError && (
        <Alert
          severity="error"
          sx={{ mb: 1.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => void load(true).catch(() => undefined)}
            >
              Retry
            </Button>
          }
        >
          {storeError}
        </Alert>
      )}

      {loading && applications.length === 0 ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading configured tools…</Typography>
        </Box>
      ) : applications.length === 0 ? (
        <Box
          sx={{
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1.5,
            px: 2,
            py: 2.5,
          }}
        >
          <Typography variant="body2" sx={{ color: "text.primary", fontWeight: 600 }}>
            No external tools configured
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Add Hash2Polis or another web service to make it available throughout the workstation.
          </Typography>
        </Box>
      ) : (
        <Stack divider={<Divider flexItem />}>
          {applications.map((application) => (
            <Box
              key={application.id}
              sx={{
                display: "grid",
                gridTemplateColumns: "40px minmax(0, 1fr) auto",
                gap: 1.5,
                alignItems: "center",
                py: 1.25,
                opacity: application.enabled ? 1 : 0.6,
              }}
            >
              <ExternalApplicationIcon
                name={application.name}
                iconDataUrl={application.iconDataUrl}
                size={32}
              />
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="subtitle2" sx={{ color: "text.primary" }}>
                    {application.name}
                  </Typography>
                  {!application.enabled && <Chip label="Disabled" size="small" />}
                  <Chip
                    label={application.openMode === "managed" ? "Thanatology window" : "Browser"}
                    size="small"
                    variant="outlined"
                  />
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: "block" }}
                >
                  {hostLabel(application.url)}
                  {application.description ? ` — ${application.description}` : ""}
                </Typography>
              </Box>
              <Box sx={{ display: "flex" }}>
                <Tooltip title="Open tool">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!application.enabled}
                      onClick={() => void handleLaunch(application)}
                      aria-label={`Open ${application.name}`}
                    >
                      <LaunchIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Edit tool">
                  <IconButton
                    size="small"
                    onClick={() => openEditDialog(application)}
                    aria-label={`Edit ${application.name}`}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Remove tool">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => setDeleteTarget(application)}
                    aria-label={`Remove ${application.name}`}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingId === null ? "Add external tool" : "Edit external tool"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="info" variant="outlined">
              External pages run without access to Thanatology commands, evidence, or local files.
            </Alert>

            <Box sx={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 2, alignItems: "center" }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1.5,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <ExternalApplicationIcon
                  name={form.name || "External tool"}
                  iconDataUrl={form.iconDataUrl}
                  size={44}
                />
              </Box>
              <Box>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <Button component="label" size="small" variant="outlined" startIcon={<UploadFileIcon />}>
                    Choose icon
                    <input
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        void handleIconFile(event.currentTarget.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </Button>
                  <Button
                    size="small"
                    startIcon={<RestartAltIcon />}
                    disabled={!form.iconDataUrl}
                    onClick={() => updateForm("iconDataUrl", null)}
                  >
                    Default icon
                  </Button>
                </Stack>
                <Typography variant="caption" color={errors.icon ? "error" : "text.secondary"}>
                  {errors.icon ?? "PNG, JPEG, or WebP; resized locally to 128 × 128."}
                </Typography>
              </Box>
            </Box>

            <TextField
              label="Tool name"
              required
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              error={Boolean(errors.name)}
              helperText={errors.name ?? `${form.name.length}/64 characters`}
              slotProps={{ htmlInput: { maxLength: 64 } }}
            />
            <TextField
              label="Endpoint URL"
              required
              value={form.url}
              onChange={(event) => updateForm("url", event.target.value)}
              error={Boolean(errors.url)}
              helperText={errors.url ?? "For example: http://localhost:8080 or https://hash2polis.example.org"}
              slotProps={{ htmlInput: { spellCheck: false } }}
            />

            {publicInsecureHttp && (
              <Alert severity="warning" variant="outlined">
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.allowInsecureHttp}
                      onChange={(event) => updateForm("allowInsecureHttp", event.target.checked)}
                    />
                  }
                  label="Allow this unencrypted public HTTP endpoint"
                />
              </Alert>
            )}

            <TextField
              label="Description"
              multiline
              minRows={2}
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              error={Boolean(errors.description)}
              helperText={errors.description ?? `${form.description.length}/256 characters`}
              slotProps={{ htmlInput: { maxLength: 256 } }}
            />
            <TextField
              select
              label="Open in"
              value={form.openMode}
              onChange={(event) =>
                updateForm("openMode", event.target.value as ExternalApplicationInput["openMode"])
              }
              helperText="A Thanatology window keeps the tool in the workstation; browser mode is the compatibility fallback."
            >
              <MenuItem value="managed">Thanatology window</MenuItem>
              <MenuItem value="browser">System browser</MenuItem>
            </TextField>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" }, gap: 1 }}>
              <FormControlLabel
                control={<Switch checked={form.enabled} onChange={(event) => updateForm("enabled", event.target.checked)} />}
                label="Enabled"
              />
              <FormControlLabel
                control={<Switch checked={form.showDashboard} onChange={(event) => updateForm("showDashboard", event.target.checked)} />}
                label="Dashboard"
              />
              <FormControlLabel
                control={<Switch checked={form.showSidebar} onChange={(event) => updateForm("showSidebar", event.target.checked)} />}
                label="Sidebar"
              />
            </Box>

            {probeMessage && <Alert severity={probeMessage.severity}>{probeMessage.text}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void handleTest()} disabled={testing || saving} startIcon={testing ? <CircularProgress size={16} /> : undefined}>
            Test connection
          </Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : undefined}>
            {editingId === null ? "Add tool" : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove external tool?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteTarget?.name} will be removed from Settings, the dashboard, and the sidebar. The external service and its data are not affected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void handleDelete()}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
