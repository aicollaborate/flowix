import { createRoot } from "react-dom/client";
import "./css/index.css";
import "./css/editor.css";
import "./css/monaco.css";
import "./css/fonts.css";
import App from "./App";

// Initialize Tauri RPC
import { initTauriClient } from "./lib/tauri/client";

// [DEBUG] 临时挂全局 listen 用于诊断 memo-event 链路
import { listen as debugListen } from "@tauri-apps/api/event";
if (typeof window !== "undefined") {
  (async () => {
    try {
      const unlisten = await debugListen("memo-event", (event) => {
        // eslint-disable-next-line no-console
        console.log("[DEBUG memo-event]", event.payload);
        (window as any).__lastMemoEvent = event.payload;
      });
      (window as any).__memoEventUnlisten = unlisten;
      // eslint-disable-next-line no-console
      console.log("[DEBUG memo-event] listener registered");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[DEBUG memo-event] failed to listen:", err);
    }
  })();
}

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
  </>
);
