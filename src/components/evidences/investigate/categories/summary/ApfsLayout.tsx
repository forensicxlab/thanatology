import { Box, Typography, Divider } from "@mui/material";

type AnyObj = Record<string, any>;

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

function num(v: any, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

type Section = {
  name: string;
  blocks: number;
  color: string;
  placeholder?: boolean;
};

function LayoutBar({ sections, blockSize }: { sections: Section[]; blockSize: number }) {
  const logScale = (b: number) => Math.log10(b + 1);
  const totalScaled = sections.reduce((s, sec) => s + logScale(sec.blocks), 0) || 1;
  let currentOffsetBytes = 0;

  return (
    <Box sx={{ display: "flex", border: "1px solid #ccc", borderRadius: "2px", overflow: "hidden", position: "relative" }}>
      {sections.map((sec, idx) => {
        const widthPct = (logScale(sec.blocks) / totalScaled) * 100;
        const offsetHex = "0x" + currentOffsetBytes.toString(16).toUpperCase();
        currentOffsetBytes += sec.blocks * blockSize;

        return (
          <Box
            key={idx}
            sx={{
              flex: `0 0 ${widthPct}%`,
              bgcolor: sec.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              minWidth: "26px",
              borderRight: idx < sections.length - 1 ? "1px solid #fff" : "none",
            }}
          >
            <Typography variant="caption" align="center" sx={{ p: 0.5 }}>
              {sec.name}
              <br />
              {sec.placeholder ? "many blocks" : `${sec.blocks.toLocaleString()} blocks`}
            </Typography>
            <Box sx={{ position: "absolute", bottom: "-20px", left: "0", fontSize: "0.7rem" }}>
              {offsetHex}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default function ApfsLayout({ metadata }: { metadata: AnyObj }) {
  const container: AnyObj = metadata?.container ?? {};
  const blockSize = num(container.block_size, 4096);
  const blockCount = num(container.block_count, 0);
  const uuid: string = container.uuid ?? "—";
  const xpDescBase = num(container.xp_desc_base, 0);
  const xpDescBlocks = num(container.xp_desc_blocks, 0);
  const xpDataBase = num(container.xp_data_base, 0);
  const xpDataBlocks = num(container.xp_data_blocks, 0);

  const selectedVolume: AnyObj = metadata?.selected_volume ?? {};
  const volumes: AnyObj[] = Array.isArray(metadata?.volumes) ? metadata.volumes : [];
  const volumeName: string = selectedVolume.volume_name ?? "—";

  // Simplified APFS container layout:
  // [Checkpoint Descriptor Area] [Checkpoint Data Area] [Volume Data (rest)]
  const preDescBlocks = Math.max(0, xpDescBase - 1);
  const descBlocks = xpDescBlocks;
  const dataGapBlocks = Math.max(0, xpDataBase - (xpDescBase + xpDescBlocks));
  const dataBlocks = xpDataBlocks;
  const remainingBlocks = Math.max(0, blockCount - (xpDataBase + xpDataBlocks));

  const sections: Section[] = [
    { name: "Container SB", blocks: 1, color: "#145369" },
    ...(preDescBlocks > 0 ? [{ name: "Reserved", blocks: preDescBlocks, color: "#041014", placeholder: true }] : []),
    { name: "Checkpoint Desc.", blocks: descBlocks, color: "#D94827" },
    ...(dataGapBlocks > 0 ? [{ name: "Gap", blocks: dataGapBlocks, color: "#041014", placeholder: true }] : []),
    { name: "Checkpoint Data", blocks: dataBlocks, color: "#4db6ac" },
    { name: "Volume Data", blocks: remainingBlocks, color: "#BAB03D", placeholder: true },
  ].filter((s) => s.blocks > 0);

  return (
    <>
      <Box sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Apple File System (APFS) — {formatBytes(blockSize)}/block, {blockCount.toLocaleString()} blocks
        </Typography>
      </Box>

      <LayoutBar sections={sections} blockSize={blockSize} />

      <Box sx={{ mt: 3 }}>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Container UUID: {uuid}
        </Typography>
        <br />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Checkpoint Desc. @ block {xpDescBase} ({xpDescBlocks} blocks) | Checkpoint Data @ block {xpDataBase} ({xpDataBlocks} blocks)
        </Typography>
        <br />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Total: {blockCount.toLocaleString()} blocks ({formatBytes(blockCount * blockSize)})
        </Typography>
      </Box>

      {volumes.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
            <strong>Volumes ({volumes.length}):</strong> (selected: {volumeName})
          </Typography>
          {volumes.map((vol: AnyObj, i: number) => (
            <Typography key={i} variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              [{vol.fs_index ?? i}] {vol.volume_name || "(unnamed)"}{" "}
              {vol.role ? `— role: 0x${num(vol.role).toString(16)}` : ""}
            </Typography>
          ))}
        </Box>
      )}
    </>
  );
}
