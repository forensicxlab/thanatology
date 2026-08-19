// thanatology/src/components/evidences/investigate/categories/summary/ExfatLayout.tsx
import { Box, Typography } from "@mui/material";

type AnyObj = Record<string, any>;

function bytesToHex(n: number) {
  return "0x" + Math.max(0, Math.floor(n)).toString(16);
}

function asciiFromBytes(arr?: number[]) {
  if (!Array.isArray(arr)) return "";
  return String.fromCharCode(...arr)
    .replace(/\0/g, "")
    .trim();
}

function num(v: any, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : fallback;
}

type Section = {
  name: string;
  sectors: number;
  color: string;
  placeholder?: boolean;
};

function LayoutBar({
  sections,
  bytesPerSector,
  scale,
}: {
  sections: Section[];
  bytesPerSector: number;
  scale: (sectors: number) => number;
}) {
  const totalScaled =
    sections.reduce((sum, s) => sum + scale(s.sectors), 0) || 1;

  let currentOffsetBytes = 0;

  return (
    <Box
      sx={{
        display: "flex",
        border: "1px solid #ccc",
        borderRadius: "2px",
        overflow: "hidden",
        position: "relative"
      }}>
      {sections.map((section, idx) => {
        const widthPercent = (scale(section.sectors) / totalScaled) * 100;
        const offsetHex = bytesToHex(currentOffsetBytes);
        const sectionBytes = section.sectors * bytesPerSector;
        currentOffsetBytes += sectionBytes;

        return (
          <Box
            key={idx}
            sx={{
              flex: `0 0 ${widthPercent}%`,
              bgcolor: section.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",

              borderRight:
                idx < sections.length - 1 ? "1px solid #fff" : "none",

              minWidth: section.sectors > 0 ? "26px" : undefined
            }}>
            <Typography variant="caption" align="center" sx={{ p: 0.5 }}>
              {section.name}
              <br />
              {section.placeholder
                ? "many sectors"
                : `${section.sectors.toLocaleString()} sectors`}
            </Typography>
            <Box
              sx={{
                position: "absolute",
                bottom: "-20px",
                left: "0",
                fontSize: "0.7rem"
              }}>
              {offsetHex}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export default function ExfatLayout({ metadata }: { metadata: AnyObj }) {
  // Normalize: BPB fields sometimes live under metadata.bpb
  const m: AnyObj = (metadata?.bpb ?? metadata ?? {}) as AnyObj;

  const bytesPerSectorShift = num(
    m.bytes_per_sector_shift,
    num(metadata?.bytes_per_sector_shift, 9),
  );
  const sectorsPerClusterShift = num(
    m.sectors_per_cluster_shift,
    num(metadata?.sectors_per_cluster_shift, 0),
  );

  const bytesPerSector = 1 << bytesPerSectorShift;
  const sectorsPerCluster = 1 << sectorsPerClusterShift;

  const totalSectors = num(m.volume_length, num(metadata?.volume_length, 0));
  const totalBytes = totalSectors * bytesPerSector;

  const fatOffset = num(m.fat_offset, num(metadata?.fat_offset, 0));
  const fatLength = num(m.fat_length, num(metadata?.fat_length, 0));
  const numFats = num(m.num_fats, num(metadata?.num_fats, 1));
  const clusterHeapOffset = num(
    m.cluster_heap_offset,
    num(metadata?.cluster_heap_offset, 0),
  );

  const rootDirFirstCluster = num(
    m.root_dir_first_cluster,
    num(metadata?.root_dir_first_cluster, 2),
  );

  const fatSectorsTotal = fatLength * numFats;

  // Regions (in sectors)
  const bootAndReservedSectors = Math.max(0, fatOffset);
  const fatRegionSectors = Math.max(0, fatSectorsTotal);
  const systemTailSectors = Math.max(
    0,
    clusterHeapOffset - (fatOffset + fatSectorsTotal),
  );
  const clusterHeapSectors = Math.max(0, totalSectors - clusterHeapOffset);

  // Root dir absolute position (sector/byte)
  const rootDirSector =
    clusterHeapOffset +
    Math.max(0, rootDirFirstCluster - 2) * sectorsPerCluster;
  const rootDirByteOffset = rootDirSector * bytesPerSector;

  const sections: Section[] = [
    {
      name: "Boot + Reserved",
      sectors: bootAndReservedSectors,
      color: "#145369",
    },
    { name: `FAT (${numFats})`, sectors: fatRegionSectors, color: "#D94827" },
    {
      name: "System Area Tail",
      sectors: systemTailSectors,
      color: "#041014",
      placeholder: systemTailSectors > 0,
    },
    {
      name: "Cluster Heap (Data)",
      sectors: clusterHeapSectors,
      color: "#BAB03D",
    },
  ].filter((s) => s.sectors > 0);

  // Log scale so small regions stay visible
  const logScale = (sectors: number) => Math.log10(sectors + 1);

  const oem =
    asciiFromBytes(m.oem_name) || asciiFromBytes(metadata?.oem_name) || "EXFAT";

  return (
    <>
      <Box sx={{
        mb: 1
      }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          exFAT ({oem}) — {bytesPerSector} B/sector, {sectorsPerCluster}{" "}
          sectors/cluster
        </Typography>
      </Box>
      <LayoutBar
        sections={sections}
        bytesPerSector={bytesPerSector}
        scale={logScale}
      />
      <Box sx={{
        mt: 3
      }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          Root dir starts @ cluster {rootDirFirstCluster} (≈ byte offset{" "}
          {rootDirByteOffset.toLocaleString()}).
        </Typography>
        <br />
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          Total: {totalSectors.toLocaleString()} sectors (
          {totalBytes.toLocaleString()} bytes)
        </Typography>
      </Box>
    </>
  );
}
