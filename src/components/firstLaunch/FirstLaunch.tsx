import React, { useState, ChangeEvent, FormEvent } from "react";
import {
  Box,
  Button,
  Container,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import Database from "@tauri-apps/plugin-sql";
import { createUser } from "../../dbutils/sqlite"; // Removed createModules as it's now handled via migrations.
import { useSnackbar } from "../SnackbarProvider";

interface PgCredentials {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

interface FirstLaunchProps {
  database: Database | null;
  setFirstLaunch: React.Dispatch<React.SetStateAction<Boolean>>;
}

const FirstLaunch: React.FC<FirstLaunchProps> = ({
  database,
  setFirstLaunch,
}) => {
  const { display_message } = useSnackbar();

  const [username, setUsername] = useState<string>("");
  const [dbType, setDbType] = useState<"sqlite" | "postgres">("sqlite");
  const [pgCredentials, setPgCredentials] = useState<PgCredentials>({
    host: "",
    port: "",
    user: "",
    password: "",
    database: "",
  });

  // Handle changes in PostgreSQL credentials form fields
  const handlePgCredentialsChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPgCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Submit handler for the form
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const formData = {
      username,
      dbType,
      ...(dbType === "postgres" ? { pgCredentials } : {}),
    };
    console.log("Form Data:", formData);
    if (dbType === "sqlite") {
      if (username.length < 3) {
        display_message(
          "warning",
          "Please enter a username with at least 3 characters",
        );
      } else {
        createUser(username, database)
          .then(() => setFirstLaunch(false))
          .catch((error: any) => {
            console.log(error);
            display_message("warning", error);
          });
      }
    } else {
      console.log("TODO (Postgresql) : ");
    }
  };

  return (
    <Container maxWidth="sm">
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
      >
        {/* Logo Placeholder */}
        <Box mb={3}>
          <img src="/Thanatology.svg" alt="Logo" width={500} />
        </Box>

        <Typography variant="h4" gutterBottom>
          Thanatology
        </Typography>
        <Typography variant="subtitle2" gutterBottom>
          Post-Mortem Forensics
        </Typography>

        {/* User Form */}
        <form onSubmit={handleSubmit} style={{ width: "100%" }}>
          {/* Username Field */}
          <Box mb={2}>
            <TextField
              fullWidth
              label="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Box>

          {/* Database Selection */}
          <FormControl component="fieldset" fullWidth margin="normal">
            <FormLabel component="legend">Choose your database</FormLabel>
            <RadioGroup
              row
              name="dbType"
              value={dbType}
              onChange={(e) =>
                setDbType(e.target.value as "sqlite" | "postgres")
              }
            >
              <FormControlLabel
                value="sqlite"
                control={<Radio />}
                label="SQLite - For local use and no collaboration"
              />
              <FormControlLabel
                value="postgres"
                control={<Radio />}
                label="PostgreSQL - Create or join a Thanatology database and collaborate"
              />
            </RadioGroup>
          </FormControl>

          {/* PostgreSQL Credentials (conditionally rendered) */}
          {dbType === "postgres" && (
            <Box mt={2}>
              <TextField
                fullWidth
                label="Host"
                name="host"
                value={pgCredentials.host}
                onChange={handlePgCredentialsChange}
                margin="normal"
              />
              <TextField
                fullWidth
                label="Port"
                name="port"
                value={pgCredentials.port}
                onChange={handlePgCredentialsChange}
                margin="normal"
              />
              <TextField
                fullWidth
                label="User"
                name="user"
                value={pgCredentials.user}
                onChange={handlePgCredentialsChange}
                margin="normal"
              />
              <TextField
                fullWidth
                label="Password"
                name="password"
                type="password"
                value={pgCredentials.password}
                onChange={handlePgCredentialsChange}
                margin="normal"
              />
              <TextField
                fullWidth
                label="Database"
                name="database"
                value={pgCredentials.database}
                onChange={handlePgCredentialsChange}
                margin="normal"
              />
            </Box>
          )}

          {/* Submit Button */}
          <Box mt={3} display="flex" justifyContent="center">
            <Button type="submit" variant="contained" color="primary">
              Begin
            </Button>
          </Box>
        </form>
      </Box>
    </Container>
  );
};

export default FirstLaunch;
