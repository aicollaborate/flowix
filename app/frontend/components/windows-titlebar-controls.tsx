import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isWindowsPlatform(): boolean {
  return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

function isTauriApp(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function WindowsTitlebarControls() {
  if (!isWindowsPlatform() || !isTauriApp()) return null;

  return (
    <div className="fixed top-0 right-0 z-[100] flex h-9 select-none bg-[#f7f7f7]/95">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => getCurrentWindow().minimize()}
        className="flex h-9 w-[42px] items-center justify-center text-[#3f424a] transition-colors hover:bg-black/5"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Maximize"
        title="Maximize"
        onClick={() => getCurrentWindow().toggleMaximize()}
        className="flex h-9 w-[42px] items-center justify-center text-[#3f424a] transition-colors hover:bg-black/5"
      >
        <Square className="h-3 w-3" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={() => getCurrentWindow().close()}
        className="flex h-9 w-[42px] items-center justify-center text-[#3f424a] transition-colors hover:bg-[#e81123] hover:text-white"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
