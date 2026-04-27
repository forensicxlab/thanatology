import React from "react";
import { createRoot } from "react-dom/client";
import WhiteBoardApp from "./WhiteBoardApp";

createRoot(document.getElementById("whiteboard") as HTMLElement).render(
  <React.StrictMode>
    <WhiteBoardApp />
  </React.StrictMode>,
);
