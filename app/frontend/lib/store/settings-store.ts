import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settings } from '../tauri/client';
import { STORAGE_KEYS } from '../../constants';

export type FontType = 'default' | 'serif';
export type AppViewMode = 'ai' | 'write' | 'all';

export interface AppViewState {
  mode: AppViewMode;
  modeAll?: {
    w: number;
    h: number;
  };
}

export interface SettingsStore {
  reasoningCollapsed: boolean;
  fontType: FontType;
  appview: AppViewState;
  memoListVisible: boolean;
  agentPanelVisible: boolean;
  agentColWidth: number;
  setReasoningCollapsed: (collapsed: boolean) => void;
  toggleReasoningCollapsed: () => void;
  setFontType: (font: FontType) => void;
  setAppViewMode: (mode: AppViewMode) => void;
  setAppViewModeAllSize: (size: { w: number; h: number }) => void;
  setMemoListVisible: (visible: boolean) => void;
  toggleMemoListVisible: () => void;
  setAgentPanelVisible: (visible: boolean) => void;
  toggleAgentPanelVisible: () => void;
  setAgentColWidth: (width: number) => void;
  loadSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  deleteSetting: (key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      reasoningCollapsed: false,
      fontType: 'default',
      appview: {
        mode: 'all',
      },
      memoListVisible: true,
      agentPanelVisible: true,
      agentColWidth: 360,
      setReasoningCollapsed: (collapsed) => set({ reasoningCollapsed: collapsed }),
      toggleReasoningCollapsed: () =>
        set((state) => ({ reasoningCollapsed: !state.reasoningCollapsed })),
      setFontType: (font) => set({ fontType: font }),
      setAppViewMode: (mode) => set((state) => ({
        appview: { ...state.appview, mode }
      })),
      setAppViewModeAllSize: (size) => set((state) => ({
        appview: { ...state.appview, modeAll: size }
      })),
      setMemoListVisible: (visible) => set({ memoListVisible: visible }),
      toggleMemoListVisible: () => set((state) => ({ memoListVisible: !state.memoListVisible })),
      setAgentPanelVisible: (visible) => set({ agentPanelVisible: visible }),
      toggleAgentPanelVisible: () => set((state) => ({ agentPanelVisible: !state.agentPanelVisible })),
      setAgentColWidth: (width) => set({ agentColWidth: width }),

      loadSettings: async () => {
        const response = await settings.getAll();
        const s = response.settings;
        if (s.fontType) set({ fontType: s.fontType as FontType });
        if (s.appviewMode) {
          try {
            set({ appview: { mode: JSON.parse(s.appviewMode) as AppViewMode } });
          } catch {}
        }
      },

      setSetting: async (key: string, value: string) => {
        await settings.set(key, value);
      },

      deleteSetting: async (key: string) => {
        await settings.delete(key);
      },
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      partialize: (state) => ({
        reasoningCollapsed: state.reasoningCollapsed,
        fontType: state.fontType,
        appview: state.appview,
        memoListVisible: state.memoListVisible,
        agentPanelVisible: state.agentPanelVisible,
        agentColWidth: state.agentColWidth,
      }),
    }
  )
);
