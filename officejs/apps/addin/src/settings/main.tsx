import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./settings.css";
import { SettingsApp } from "./SettingsApp";
import { isWpsHost } from "../wps-host";

const isWpsDialog = new URLSearchParams(window.location.search).get("wpsDialog") === "1";
if (isWpsHost() || isWpsDialog) document.documentElement.dataset.host = "wps";

const rootElement = document.querySelector<HTMLDivElement>("#settings-root");
if (!rootElement) throw new Error("settings-root-missing");

rootElement.dataset.reactMounted = "true";
createRoot(rootElement).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
