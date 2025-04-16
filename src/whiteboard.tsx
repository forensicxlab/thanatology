import React from "react";
import ReactDOM from "react-dom/client";
import WhiteBoardApp from "./WhiteBoardApp";

ReactDOM.createRoot(
  document.getElementById("whiteboard") as HTMLElement,
).render(
  <React.StrictMode>
    <WhiteBoardApp />
  </React.StrictMode>,
);
