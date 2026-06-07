'use client';

import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "./components/error-boundary";
import { Toaster } from "sonner";
import { useUserSettings } from "./lib/hooks/useUserSettings";
import { useUserSettingsStore } from "./lib/store/user-settings-store";
import { useApplyFontSettings } from "./lib/hooks/useApplyFontSettings";
import { useMemoEvents } from "./lib/hooks/useMemoEvents";
import { ThemeProvider } from "./lib/theme";
import { listenToUserConfigChanges, stopListeningToUserConfigChanges } from "./lib/tauri/client";

const MainLayout = lazy(() =>
  import("./windows/main/main-layout").then((module) => ({ default: module.MainLayout }))
);

const PreferencesView = lazy(() =>
  import("./windows/preferences/preferences-view").then((module) => ({ default: module.PreferencesView }))
);

function AppToaster() {
  return <Toaster position="top-center" richColors={false} closeButton={false} />;
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  // 全局应用用户在 Preferences → Format 中选择的字体设置。
  // 主窗口 / 偏好设置窗口都会挂载 App, 因此两侧都会即时同步。
  const { settings } = useUserSettings();
  const loadInitial = useUserSettingsStore((s) => s.loadInitial);
  const flushPending = useUserSettingsStore((s) => s.flushPending);
  useApplyFontSettings(settings.format);

  // 跨窗口订阅后端 `memo-event` (统一事件总线) — 用户 / Agent / 外部工具
  // 任何一方的笔记变更都走这条管道, 前端一个监听器派发到 memo-store。
  // 挂顶层让主窗口和偏好设置窗口都同步。
  useMemoEvents();

  // 启动加载一次, 卸载前 flush 防止拖动滑块过程中关窗丢改动
  useEffect(() => {
    loadInitial();
    return () => {
      void flushPending();
    };
  }, [loadInitial, flushPending]);

  // 跨窗口同步: 另一窗口成功写入 ~/.flowix/preference.json 后, 后端 emit
  // 'user-config-changed', 收到后从磁盘重新 loadInitial — 保证两窗口
  // 的 useUserSettingsStore 收敛。ai_config 由 agent 段自己监听 (见
  // windows/preferences/sections/agent.tsx)。
  useEffect(() => {
    void listenToUserConfigChanges((kind) => {
      if (kind === "preference") {
        void loadInitial();
      }
    });
    return () => {
      stopListeningToUserConfigChanges();
    };
  }, [loadInitial]);

  useEffect(() => {
    const loading = document.getElementById("app-loading");
    if (loading) loading.remove();
  }, []);

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // Check if this is a preferences view
  if (hash.startsWith("#preferences")) {
    const tab = hash.split("/")[1] || undefined;
    return (
      <ErrorBoundary>
        <AppToaster />
        <ThemeProvider>
          <Suspense fallback={null}>
            <PreferencesView initialTab={tab} />
          </Suspense>
        </ThemeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AppToaster />
      <ThemeProvider>
        <Suspense fallback={null}>
          <MainLayout />
        </Suspense>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
