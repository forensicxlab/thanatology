import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AddPhotoAlternate, CameraAlt, Delete } from "@mui/icons-material";
import {
  checkCameraPermission,
  requestCameraPermission,
} from "tauri-plugin-macos-permissions-api";
import {
  EvidenceImageDraft,
  EvidenceImageSourceKind,
} from "../../../dbutils/types";

interface EvidenceImageAttachmentsProps {
  images: EvidenceImageDraft[];
  onChange: (images: EvidenceImageDraft[]) => void;
}

type CameraDevice = {
  deviceId: string;
  label: string;
};

const videoConstraints: MediaStreamConstraints = {
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
};

const isMacOs = /Mac/i.test(navigator.userAgent);

async function blobToDraft(
  blob: Blob,
  sourceKind: EvidenceImageSourceKind,
  fileName: string,
): Promise<EvidenceImageDraft> {
  const buffer = await blob.arrayBuffer();
  return {
    id: crypto.randomUUID(),
    caption: "",
    file_name: fileName,
    mime_type: blob.type || "image/png",
    source_kind: sourceKind,
    bytes: Array.from(new Uint8Array(buffer)),
    preview_url: URL.createObjectURL(blob),
  };
}

const EvidenceImageAttachments: React.FC<EvidenceImageAttachmentsProps> = ({
  images,
  onChange,
}) => {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const knownUrlsRef = useRef<string[]>([]);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    const previousUrls = knownUrlsRef.current;
    const currentUrls = images.map((image) => image.preview_url);

    previousUrls
      .filter((url) => !currentUrls.includes(url))
      .forEach((url) => URL.revokeObjectURL(url));

    knownUrlsRef.current = currentUrls;
  }, [images]);

  useEffect(() => {
    return () => {
      stopStream();
      knownUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen) {
      stopStream();
      setAvailableCameras([]);
      setSelectedCameraId("");
      return;
    }

    let cancelled = false;

    const enumerateCameras = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        }));

      if (!cancelled) {
        setAvailableCameras(cameras);
      }

      return cameras;
    };

    const startCamera = async () => {
      try {
        setCameraError(null);
        setIsCameraLoading(true);

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: selectedCameraId
            ? {
                ...(typeof videoConstraints.video === "object"
                  ? videoConstraints.video
                  : {}),
                deviceId: { exact: selectedCameraId },
              }
            : videoConstraints.video,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stopStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const cameras = await enumerateCameras();
        const activeDeviceId =
          stream.getVideoTracks()[0]?.getSettings().deviceId ?? "";

        if (!selectedCameraId) {
          const initialDeviceId =
            cameras.find((camera) => camera.deviceId === activeDeviceId)
              ?.deviceId ??
            activeDeviceId ??
            cameras[0]?.deviceId ??
            "";

          if (initialDeviceId) {
            setSelectedCameraId(initialDeviceId);
          }
        }
      } catch (error) {
        console.error("Failed to open camera", error);
        const message =
          error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        setCameraError(
          `Unable to access a camera. Check OS permissions or connect a supported camera/phone webcam first. ${message}`,
        );
      } finally {
        if (!cancelled) {
          setIsCameraLoading(false);
        }
      }
    };

    startCamera();

    const handleDeviceChange = () => {
      enumerateCameras().catch((error) => {
        console.error("Failed to refresh camera list", error);
      });
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
      stopStream();
    };
  }, [cameraOpen, selectedCameraId]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportedFiles = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const nextImages = await Promise.all(
      files.map((file) => blobToDraft(file, "file", file.name)),
    );

    onChange([...images, ...nextImages]);
    event.target.value = "";
  };

  const handleRemove = (draftId: string) => {
    const current = images.find((image) => image.id === draftId);
    if (current) {
      URL.revokeObjectURL(current.preview_url);
    }
    onChange(images.filter((image) => image.id !== draftId));
  };

  const handleCaptionChange = (draftId: string, caption: string) => {
    onChange(
      images.map((image) =>
        image.id === draftId ? { ...image, caption } : image,
      ),
    );
  };

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera preview is not ready yet.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Unable to capture the current frame.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );

    if (!blob) {
      setCameraError("Failed to encode the screenshot.");
      return;
    }

    const captured = await blobToDraft(
      blob,
      "camera",
      `camera-capture-${Date.now()}.png`,
    );
    onChange([...images, captured]);
    setCameraOpen(false);
  };

  const handleOpenCamera = async () => {
    setCameraError(null);

    if (isMacOs) {
      try {
        const alreadyGranted = await checkCameraPermission();
        if (!alreadyGranted) {
          const granted = await requestCameraPermission();
          if (!granted) {
            setCameraError(
              "Camera access was denied by macOS. Allow it for Thanatology and reopen the capture dialog.",
            );
            return;
          }
        }
      } catch (error) {
        console.error("Failed to request macOS camera permission", error);
        setCameraError(
          "Unable to request macOS camera permission from the app.",
        );
        return;
      }
    }

    setCameraOpen(true);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{
        flexWrap: "wrap"
      }}>
        <Button
          variant="outlined"
          startIcon={<AddPhotoAlternate />}
          onClick={handleImportClick}
        >
          Add Image
        </Button>
        <Button
          variant="outlined"
          startIcon={<CameraAlt />}
          onClick={handleOpenCamera}
        >
          Capture With Camera
        </Button>
      </Stack>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleImportedFiles}
      />
      {images.length > 0 && (
        <Stack spacing={2}>
          <Typography variant="subtitle2">Attached images</Typography>
          {images.map((image) => (
            <Card key={image.id} variant="outlined">
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "220px 1fr" },
                }}
              >
                <CardMedia
                  component="img"
                  image={image.preview_url}
                  alt={image.caption || image.file_name}
                  sx={{ height: { xs: 220, sm: "100%" }, objectFit: "cover" }}
                />
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 2,
                      alignItems: "flex-start",
                    }}
                  >
                    <Box>
                      <Typography variant="subtitle1">{image.file_name}</Typography>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        Source: {image.source_kind === "camera" ? "Camera" : "File import"}
                      </Typography>
                    </Box>
                    <IconButton
                      color="error"
                      aria-label="remove image"
                      onClick={() => handleRemove(image.id)}
                    >
                      <Delete />
                    </IconButton>
                  </Box>
                  <TextField
                    label="Caption"
                    value={image.caption}
                    onChange={(event) =>
                      handleCaptionChange(image.id, event.target.value)
                    }
                    required
                    fullWidth
                    margin="normal"
                    helperText="A caption is required for every attached image."
                  />
                </CardContent>
              </Box>
            </Card>
          ))}
        </Stack>
      )}
      <Dialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Capture evidence image</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {cameraError && <Alert severity="error">{cameraError}</Alert>}
            <FormControl fullWidth disabled={isCameraLoading}>
              <InputLabel id="camera-select-label">Camera</InputLabel>
              <Select
                labelId="camera-select-label"
                label="Camera"
                value={selectedCameraId}
                onChange={(event) => setSelectedCameraId(event.target.value)}
              >
                {availableCameras.map((camera) => (
                  <MenuItem key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Box
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                bgcolor: "black",
                minHeight: 280,
                position: "relative",
              }}
            >
              <Box
                component="video"
                ref={videoRef}
                muted
                playsInline
                autoPlay
                sx={{ width: "100%", display: "block" }}
              />
              {isCameraLoading && (
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "rgba(0, 0, 0, 0.35)",
                  }}
                >
                  <CircularProgress />
                </Box>
              )}
            </Box>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              The app uses any camera exposed by the OS, including a phone acting as a webcam.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCameraOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCapture}>
            Capture
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EvidenceImageAttachments;
