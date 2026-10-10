import "@fontsource-variable/plus-jakarta-sans";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { watchForStaleBuild } from "./staleBuild.ts";

watchForStaleBuild();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
