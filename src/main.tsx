import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TerminalContextProvider } from "react-terminal";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TerminalContextProvider>
      <App />
    </TerminalContextProvider>
  </React.StrictMode>,
);
