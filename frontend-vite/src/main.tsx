import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./i18n";
import { App } from "./App";

// Apply the saved appearance before first paint so every route (including
// the standalone /draw tab) opens in the theme the user picked in the app.
try {
  if (localStorage.getItem("strawie:theme") === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
} catch { /* storage disabled */ }

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
