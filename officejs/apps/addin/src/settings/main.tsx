import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./settings.css";
import { SettingsApp } from "./SettingsApp";

const rootElement = document.querySelector<HTMLDivElement>("#settings-root");
if (!rootElement) throw new Error("settings-root-missing");

rootElement.dataset.reactMounted = "true";
createRoot(rootElement).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
