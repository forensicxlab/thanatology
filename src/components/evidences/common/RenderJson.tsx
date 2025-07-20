import { Box, List, ListItem, Typography } from "@mui/material";

const RenderJson = ({ data }: { data: any }) => {
  if (typeof data !== "object" || data === null) {
    return <Typography component="span">{String(data)}</Typography>;
  }

  return (
    <List dense sx={{ paddingLeft: 2 }}>
      {Object.entries(data).map(([key, value]) => (
        <ListItem
          key={key}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            paddingY: 0.5,
          }}
        >
          <Box sx={{ display: "flex", gap: 1 }}>
            <Typography variant="body2" component="span" fontWeight="bold">
              {key}:
            </Typography>
            {typeof value !== "object" || value === null ? (
              <Typography variant="body2" component="span">
                {String(value)}
              </Typography>
            ) : null}
          </Box>
          {typeof value === "object" && value !== null && (
            <RenderJson data={value} />
          )}
        </ListItem>
      ))}
    </List>
  );
};

export default RenderJson;
