import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { resolveDefaultClient } from "./app/defaultClient.js";
import "./styles.css";

const { factory, isMock } = resolveDefaultClient(
  import.meta.env.VITE_COLLECTOR_URL,
);

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <App clientFactory={factory} isMock={isMock} />
  </StrictMode>,
);
