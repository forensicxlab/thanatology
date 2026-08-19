// thanatology/src/components/evidences/investigate/categories/summary/NtfsLayout.tsx
import { Box, Typography } from "@mui/material";

function bytesToHex(n: number) {
  return "0x" + Math.max(0, Math.floor(n)).toString(16);
}

function asciiFromBytes(arr?: number[]) {
  if (!arr?.length) return "";
  return String.fromCharCode(...arr)
    .replace(/\0/g, "")
    .trim();
}

export default function NtfsLayout({ metadata }: { metadata: any }) {
  const bytesPerSector = metadata.bytes_per_sector || 512;
  const sectorsPerCluster = metadata.sectors_per_cluster || 8;
  const totalSectors = metadata.total_sectors || 0;
  const totalBytes = totalSectors * bytesPerSector;

  const mftStartSector = metadata.mft_cluster * sectorsPerCluster;
  const mftMirrorSector = metadata.mft_mirror_cluster * sectorsPerCluster;

  // Display-only: MFT grows/shrinks; we render a small “start here” placeholder.
  const mftDisplaySectors = Math.min(
    Math.max(sectorsPerCluster, 1),
    Math.max(1, totalSectors - mftStartSector),
  );

  const bootSectors = Math.min(1, totalSectors);
  const preMftSectors = Math.max(
    0,
    Math.min(totalSectors, mftStartSector) - bootSectors,
  );
  const postMftSectors = Math.max(
    0,
    totalSectors - (bootSectors + preMftSectors + mftDisplaySectors),
  );

  const layout = [
    { name: "Boot Sector", sectors: bootSectors, color: "#145369" },
    {
      name: "System / Reserved Area",
      sectors: preMftSectors,
      color: "#041014",
      placeholder: preMftSectors > 0,
    },
    {
      name: "MFT (starts)",
      sectors: mftDisplaySectors,
      color: "#81c784",
      placeholder: true,
    },
    { name: "Data Area", sectors: postMftSectors, color: "#BAB03D" },
  ].filter((s) => s.sectors > 0);

  const totalLayoutSectors = layout.reduce((sum, s) => sum + s.sectors, 0) || 1;

  const mftMirrorPercent =
    totalSectors > 0
      ? Math.min(100, Math.max(0, (mftMirrorSector / totalSectors) * 100))
      : 0;

  let currentOffsetBytes = 0;

  return (
    <>
      <Box sx={{
        mb: 1
      }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          NTFS ({asciiFromBytes(metadata.oem_id) || "NTFS"}) — {bytesPerSector}{" "}
          B/sector, {sectorsPerCluster} sectors/cluster
        </Typography>
      </Box>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          border: "1px solid #ccc",
          borderRadius: "2px",
          overflow: "hidden"
        }}>
        {layout.map((section, idx) => {
          const widthPercent = (section.sectors / totalLayoutSectors) * 100;
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
                  idx < layout.length - 1 ? "1px solid #fff" : "none"
              }}>
              <Typography variant="caption" align="center" sx={{ p: 0.5 }}>
                {section.name}
                <br />
                {section.placeholder
                  ? "many sectors"
                  : `${section.sectors} sectors`}
              </Typography>
              {/* Offset label below */}
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

        {/* MFT Mirror marker */}
        {Number.isFinite(mftMirrorPercent) &&
          mftMirrorPercent >= 0 &&
          mftMirrorPercent <= 100 && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: `${mftMirrorPercent}%`,
                height: "100%",
                width: "2px",
                bgcolor: "rgba(255,255,255,0.9)"
              }}>
              <Box
                sx={{
                  position: "absolute",
                  top: "-18px",
                  left: "-36px",
                  fontSize: "0.7rem",
                  bgcolor: "rgba(0,0,0,0.35)",
                  px: 0.5,
                  borderRadius: 1
                }}>
                MFTMirr
              </Box>
            </Box>
          )}
      </Box>
      <Box sx={{
        mt: 3
      }}>
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          MFT @ cluster {metadata.mft_cluster} (sector {mftStartSector}),
          MFTMirr @ cluster {metadata.mft_mirror_cluster} (sector{" "}
          {mftMirrorSector})
        </Typography>
        <br />
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          Total: {totalSectors} sectors ({totalBytes.toLocaleString()} bytes)
        </Typography>
      </Box>
    </>
  );
}
