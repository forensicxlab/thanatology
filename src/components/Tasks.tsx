import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import Avatar from "@mui/material/Avatar";
import { CircularProgress } from "@mui/material";
import { Check } from "@mui/icons-material";

export default function Tasks() {
  return (
    <Box sx={{ flexGrow: 1 }}>
      <Typography variant="h4" gutterBottom>
        Tasks
      </Typography>

      <List sx={{ width: "100%", bgcolor: "background.paper" }}>
        <ListItem>
          <ListItemAvatar>
            <Avatar sx={{ background: "transparent" }}>
              <CircularProgress />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Evidence Name" secondary="Log line" />
        </ListItem>

        <ListItem>
          <ListItemAvatar>
            <Avatar sx={{ background: "green" }}>
              <Check />
            </Avatar>
          </ListItemAvatar>
          <ListItemText primary="Evidence Name" secondary="Finished" />
        </ListItem>
      </List>
    </Box>
  );
}
