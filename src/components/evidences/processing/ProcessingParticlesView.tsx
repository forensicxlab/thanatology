import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  CircularProgress,
  IconButton,
  Step,
  StepLabel,
  Stepper,
  Tooltip,
  Typography,
} from "@mui/material";
import { StopCircle } from "@mui/icons-material";
import { Evidence } from "../../../dbutils/types";
import ParserActivityStatus, {
  ParserProgressPayload,
} from "./ParserActivityStatus";

interface ProcessingParticlesViewProps {
  evidence: Evidence;
  onComplete?: () => void;
}

interface ProgressPayload {
  current: number;
  total: number;
  message?: string;
}

interface ProgressMessagePayload {
  message: string;
  status?: number;
  phase?: ProcessingPhase;
}

type ProcessingPhase =
  | "artefact_identification"
  | "artefact_parsing"
  | "ai_analysis"
  | "complete";

function getProgressMessage(payload: string | ProgressMessagePayload): string {
  return typeof payload === "string" ? payload : payload.message;
}

const PIPELINE_STEPS = [
  "Indexing files",
  "File types",
  "Artefact discovery",
  "Artefact parsing",
  "AI specialists",
];

function stepForStatus(status: number): number {
  if (status >= 6) return PIPELINE_STEPS.length;
  if (status >= 5) return 4;
  if (status >= 4) return 2;
  if (status >= 3) return 1;
  return 0;
}

function stepForPhase(phase?: ProcessingPhase): number | null {
  switch (phase) {
    case "artefact_identification": return 2;
    case "artefact_parsing": return 3;
    case "ai_analysis": return 4;
    case "complete": return PIPELINE_STEPS.length;
    default: return null;
  }
}

// ─── Particle system ──────────────────────────────────────────────────────────

const PARTICLE_COUNT = 1000;
const CLUSTER_RADIUS = 150;

interface RGB { r: number; g: number; b: number }

const COL_WHITE:  RGB = { r: 210, g: 215, b: 235 };
const COL_BLUE:   RGB = { r: 64,  g: 150, b: 240 };
const COL_GREEN:  RGB = { r: 72,  g: 199, b: 142 };
const COL_PURPLE: RGB = { r: 167, g: 105, b: 255 };

interface Particle {
  hx: number;    // fixed home x (offset from canvas centre)
  hy: number;    // fixed home y
  phase: number; // unique per-particle wave phase — prevents co-located lock-step
  radius: number;
  color: RGB;
  target: RGB;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c: RGB, t: RGB, alpha: number): RGB {
  return {
    r: lerp(c.r, t.r, alpha),
    g: lerp(c.g, t.g, alpha),
    b: lerp(c.b, t.b, alpha),
  };
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const r     = Math.sqrt(Math.random()) * CLUSTER_RADIUS; // uniform density
    return {
      hx:     Math.cos(angle) * r,
      hy:     Math.sin(angle) * r,
      phase:  Math.random() * Math.PI * 2,
      radius: 0.5 + Math.random() * 0.9,
      color:  { ...COL_WHITE },
      target: { ...COL_WHITE },
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const ProcessingParticlesView: React.FC<ProcessingParticlesViewProps> = ({
  evidence,
  onComplete,
}) => {
  const evidenceId = evidence.id;

  const [activeStep, setActiveStep] = useState(stepForStatus(evidence.status));
  const [cancelling, setCancelling] = useState(false);
  const [mainProgress, setMainProgress] = useState("");
  const [moduleProgress, setModuleProgress] = useState("Initializing…");
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [parserActivity, setParserActivity] = useState<ParserProgressPayload | null>(null);

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>(makeParticles());
  const animRef      = useRef<number>(0);

  // Update colour targets whenever progress or pipeline step changes.
  // Phase colour rules:
  //   step 0, total ≤ 0  → discovery: stay WHITE
  //   step 0, total > 0  → indexing:  WHITE → BLUE  by %
  //   steps 1-2          → identification: BLUE → GREEN by %
  //   step 3+            → parsing/AI: GREEN → PURPLE by %
  useEffect(() => {
    const ps    = particlesRef.current;
    const hasPct = progress !== null && progress.total > 0;
    const n = hasPct
      ? Math.min(
          Math.round((progress!.current / progress!.total) * PARTICLE_COUNT),
          PARTICLE_COUNT,
        )
      : 0;

    if (activeStep >= 3) {
      ps.forEach((p, i) => { p.target = i < n ? { ...COL_PURPLE } : { ...COL_GREEN }; });
    } else if (activeStep >= 1) {
      ps.forEach((p, i) => { p.target = i < n ? { ...COL_GREEN } : { ...COL_BLUE }; });
    } else if (hasPct) {
      ps.forEach((p, i) => { p.target = i < n ? { ...COL_BLUE } : { ...COL_WHITE }; });
    }
    // discovery (total ≤ 0, step 0): leave targets as white
  }, [progress, activeStep]);

  // ── Canvas animation ──────────────────────────────────────────────────────
  //
  // KEY DESIGN DECISION — no velocity / no flow field:
  //   display_pos = home_pos + wave_displacement(home_pos, time, phase)
  //
  // Because position is computed directly from a closed-form expression
  // (not integrated over time), there is no inertia and no streamline
  // following. Particles cannot form worms or clusters — each one is fully
  // independent. The spatial correlation of the displacement function is
  // what makes the result look like a wave passing through the cloud.
  //
  // Three travelling plane waves at different angles, speeds and spatial
  // frequencies are superimposed. Each particle adds its own `phase` offset
  // (a time offset) so two particles that share the same home position are
  // never at the same point in their cycle → they always stay apart.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sizeRef = { w: 0, h: 0 };
    const updateSize = () => {
      sizeRef.w = canvas.offsetWidth;
      sizeRef.h = canvas.offsetHeight;
      canvas.width  = sizeRef.w;
      canvas.height = sizeRef.h;
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Wave parameters:  K = spatial frequency,  W = temporal frequency
    // Three waves propagating at ~0°, ~120°, ~240° to cover all directions.
    // Using irrational W ratios prevents periodic recurrence.
    const K1 = 0.026, W1 = 0.82;   // λ ≈ 242 px, slow
    const K2 = 0.021, W2 = 1.13;   // λ ≈ 299 px, medium
    const K3 = 0.017, W3 = 0.61;   // λ ≈ 370 px, slow but large scale

    // Unit direction vectors for each wave
    // Wave 1 → right-ish  (cos 20°, sin 20°)
    const D1x = 0.940, D1y = 0.342;
    // Wave 2 → upper-left (cos 140°, sin 140°)
    const D2x = -0.766, D2y = 0.643;
    // Wave 3 → lower-left (cos 250°, sin 250°)
    const D3x = -0.342, D3y = -0.940;

    // Max displacement amplitude (px). Keeps particles within ≈ home ± AMP.
    const AMP = 38;

    let lastTime = 0;

    const frame = (now: number) => {
      // dt only used for colour lerp — no velocity integration
      const dt = Math.min((now - lastTime) / 16.67, 2.5);
      lastTime = now;

      const W = sizeRef.w;
      const H = sizeRef.h;
      if (W === 0 || H === 0) { animRef.current = requestAnimationFrame(frame); return; }
      const cx = W / 2;
      const cy = H / 2;

      ctx.clearRect(0, 0, W, H);

      const t  = now * 0.001;
      const ps = particlesRef.current;

      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];

        // Project home position onto each wave's propagation direction,
        // then add temporal phase and per-particle phase offset.
        const phi1 = (p.hx * D1x + p.hy * D1y) * K1 + t * W1 + p.phase;
        const phi2 = (p.hx * D2x + p.hy * D2y) * K2 + t * W2 + p.phase * 1.37;
        const phi3 = (p.hx * D3x + p.hy * D3y) * K3 + t * W3 + p.phase * 0.71;

        // Each wave contributes a 2-D displacement perpendicular to its
        // direction (transverse wave). Mixing sin/cos gives elliptical
        // orbits per particle, not just back-and-forth oscillation.
        const dx =
          (Math.sin(phi1) * D1y - Math.cos(phi1) * D1x * 0.4) * 0.55 * AMP +
          (Math.sin(phi2) * D2y - Math.cos(phi2) * D2x * 0.4) * 0.30 * AMP +
          (Math.sin(phi3) * D3y - Math.cos(phi3) * D3x * 0.4) * 0.15 * AMP;

        const dy =
          (-Math.sin(phi1) * D1x - Math.cos(phi1) * D1y * 0.4) * 0.55 * AMP +
          (-Math.sin(phi2) * D2x - Math.cos(phi2) * D2y * 0.4) * 0.30 * AMP +
          (-Math.sin(phi3) * D3x - Math.cos(phi3) * D3y * 0.4) * 0.15 * AMP;

        const sx = cx + p.hx + dx;
        const sy = cy + p.hy + dy;

        // Colour lerp (dt drives the lerp speed independent of wave)
        p.color = lerpColor(p.color, p.target, 0.03 * dt);

        const { r, g, b } = p.color;
        const rx = Math.round(r), gx = Math.round(g), bx = Math.round(b);

        // Soft glow halo
        ctx.fillStyle = `rgba(${rx},${gx},${bx},0.13)`;
        ctx.beginPath();
        ctx.arc(sx, sy, p.radius * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Solid core
        ctx.fillStyle = `rgb(${rx},${gx},${bx})`;
        ctx.beginPath();
        ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animRef.current);
      observer.disconnect();
    };
  }, []);

  // ── Tauri event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const ev = {
      mainInfo:    `main_progress_info_${evidenceId}`,
      mainSuccess: `main_progress_success_${evidenceId}`,
      mainError:   `main_progress_error_${evidenceId}`,
      mainProgress: `main_progress_progress_${evidenceId}`,
      modInfo:     `module_progress_info_${evidenceId}`,
      modSuccess:  `module_progress_success_${evidenceId}`,
      modError:    `module_progress_error_${evidenceId}`,
      modProgress: `module_progress_progress_${evidenceId}`,
      modParser:   `module_progress_parser_${evidenceId}`,
    };

    const unsubs = [
      listen<number>(`pipeline_complete_${evidenceId}`, () => {
        setActiveStep(PIPELINE_STEPS.length);
        onComplete?.();
      }),
      listen<number>(`artefacts_complete_${evidenceId}`, () => {
        setActiveStep(4);
        onComplete?.();
      }),

      listen<string | ProgressMessagePayload>(ev.mainInfo, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        if (typeof payload !== "string") {
          const step = stepForPhase(payload.phase);
          if (step !== null) setActiveStep(step);
        }
      }),
      listen<string | ProgressMessagePayload>(ev.mainSuccess, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
        setProgress(null);
        if (typeof payload !== "string") {
          const step = stepForPhase(payload.phase) ?? stepForStatus(payload.status ?? evidence.status);
          setActiveStep(step);
          if (payload.phase !== "artefact_parsing") setParserActivity(null);
        } else {
          setActiveStep((previous) => Math.max(previous, 1));
        }
        onComplete?.();
      }),
      listen<string | ProgressMessagePayload>(ev.mainError, ({ payload }) => {
        setMainProgress(getProgressMessage(payload));
      }),
      listen<ProgressPayload>(ev.mainProgress, ({ payload }) => {
        setProgress({ current: payload.current, total: payload.total });
        if (payload.message) setModuleProgress(payload.message);
      }),

      listen<string | ProgressMessagePayload>(ev.modInfo, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
      }),
      listen<string | ProgressMessagePayload>(ev.modSuccess, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
        setProgress(null);
        setParserActivity(null);
      }),
      listen<string | ProgressMessagePayload>(ev.modError, ({ payload }) => {
        setModuleProgress(getProgressMessage(payload));
        setProgress(null);
      }),

      listen<ProgressPayload>(ev.modProgress, ({ payload }) => {
        setProgress({ current: payload.current, total: payload.total });
        if (payload.total <= 0) {
          setModuleProgress(
            payload.current > 0
              ? `Discovering files… ${payload.current} found so far.`
              : "Discovering files in the filesystem…",
          );
        } else if (payload.message) {
          setModuleProgress(payload.message);
        }
      }),
      listen<ParserProgressPayload>(ev.modParser, ({ payload }) => {
        setActiveStep(3);
        setParserActivity(payload);
        setModuleProgress(payload.message);
        setProgress({
          current:
            payload.phase === "started"
              ? Math.max(payload.current - 1, 0)
              : payload.current,
          total: payload.total,
        });
      }),
    ];

    return () => { unsubs.forEach((p) => p.then((u) => u())); };
  }, [evidence.status, evidenceId, onComplete]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await invoke("cancel_processing", { evidenceId });
      setMainProgress("Stopping…");
      setProgress(null);
      setParserActivity(null);
      onComplete?.();
    } catch (err) {
      setCancelling(false);
      console.error("Failed to cancel processing", err);
    }
  };

  const isDiscovery = activeStep === 0 && progress !== null && progress.total <= 0;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 2.5,
        px: 4,
        py: 4,
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {evidence.name}
      </Typography>

      <Stepper activeStep={activeStep} sx={{ width: "100%", maxWidth: 520 }}>
        {PIPELINE_STEPS.map((label, idx) => (
          <Step key={label} completed={idx < activeStep}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ width: "100%", maxWidth: 640, height: 380, borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </Box>

      <Box sx={{ textAlign: "center", maxWidth: 540 }}>
        {isDiscovery && progress && (
          <Typography variant="body2" sx={{ color: "info.main", mb: 0.5 }}>
            {progress.current > 0 ? `${progress.current} files discovered` : "Discovering files…"}
          </Typography>
        )}
        {mainProgress && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {mainProgress}
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {moduleProgress}
        </Typography>
        {parserActivity && (
          <ParserActivityStatus activity={parserActivity} />
        )}
      </Box>

      <Tooltip title={cancelling ? "Stopping…" : "Cancel Processing"}>
        <span>
          <IconButton onClick={handleCancel} disabled={cancelling} color="error" size="large">
            {cancelling
              ? <CircularProgress size={24} color="error" />
              : <StopCircle fontSize="large" />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
};

export default ProcessingParticlesView;
