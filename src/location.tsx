import { createRoot } from "react-dom/client";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import SpatiotemporalWindowApp from "./spatiotemporal/SpatiotemporalWindowApp";

createRoot(document.getElementById("location") as HTMLElement).render(
  <SpatiotemporalWindowApp role="location" />,
);

