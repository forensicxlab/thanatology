import LanguageIcon from "@mui/icons-material/Language";
import Box from "@mui/material/Box";

interface ExternalApplicationIconProps {
  name: string;
  iconDataUrl: string | null;
  size?: number;
}

export default function ExternalApplicationIcon({
  name,
  iconDataUrl,
  size = 24,
}: ExternalApplicationIconProps) {
  const safeIconDataUrl =
    iconDataUrl && /^data:image\/(?:png|jpeg|webp);base64,/i.test(iconDataUrl)
      ? iconDataUrl
      : null;

  if (safeIconDataUrl) {
    return (
      <Box
        component="img"
        src={safeIconDataUrl}
        alt={`${name} icon`}
        sx={{
          width: size,
          height: size,
          objectFit: "contain",
          borderRadius: size >= 32 ? 1 : 0.5,
          flexShrink: 0,
        }}
      />
    );
  }

  return <LanguageIcon sx={{ fontSize: size }} aria-label={`${name} icon`} />;
}
