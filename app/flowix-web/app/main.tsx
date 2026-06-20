import { createRoot } from "react-dom/client";
import "@/styles/index.css";
import App from "@app/App";

// Initialize Tauri RPC
import { initTauriClient } from "@platform/tauri/client";

try {
  initTauriClient();
} catch (err) {
  console.error("[main.tsx] Failed to initialize Tauri:", err);
}

createRoot(document.getElementById("root")!).render(
  <>
    {/* <StrictMode> */}
    <App />
    {/* </StrictMode> */}
  </>,
);
