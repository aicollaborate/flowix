import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/lib/constants';

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
  appview: AppViewState;
  memoListVisible: boolean;
  noteNavigationVisible: boolean;
  agentPanelVisible: boolean;
  agentColWidth: number;
  toolbarCollapsed: boolean;
  setReasoningCollapsed: (collapsed: boolean) => void;
  toggleReasoningCollapsed: () => void;
  setAppViewMode: (mode: AppViewMode) => void;
  setAppViewModeAllSize: (size: { w: number; h: number }) => void;
  setMemoListVisible: (visible: boolean) => void;
  toggleMemoListVisible: () => void;
  setNoteNavigationVisible: (visible: boolean) => void;
  toggleNoteNavigationVisible: () => void;
  setAgentPanelVisible: (visible: boolean) => void;
  toggleAgentPanelVisible: () => void;
  setAgentColWidth: (width: number) => void;
  setToolbarCollapsed: (collapsed: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      reasoningCollapsed: false,
      appview: {
        mode: 'all',
      },
      memoListVisible: true,
      noteNavigationVisible: false,
      agentPanelVisible: true,
      agentColWidth: 360,
      toolbarCollapsed: false,
      setReasoningCollapsed: (collapsed) => set({ reasoningCollapsed: collapsed }),
      toggleReasoningCollapsed: () =>
        set((state) => ({ reasoningCollapsed: !state.reasoningCollapsed })),
      setAppViewMode: (mode) => set((state) => ({
        appview: { ...state.appview, mode }
      })),
      setAppViewModeAllSize: (size) => set((state) => ({
        appview: { ...state.appview, modeAll: size }
      })),
      setMemoListVisible: (visible) => set({ memoListVisible: visible }),
      toggleMemoListVisible: () => set((state) => ({ memoListVisible: !state.memoListVisible })),
      setNoteNavigationVisible: (visible) => set({ noteNavigationVisible: visible }),
      toggleNoteNavigationVisible: () =>
        set((state) => ({ noteNavigationVisible: !state.noteNavigationVisible })),
      setAgentPanelVisible: (visible) => set({ agentPanelVisible: visible }),
      toggleAgentPanelVisible: () => set((state) => ({ agentPanelVisible: !state.agentPanelVisible })),
      setAgentColWidth: (width) => set({ agentColWidth: width }),
      setToolbarCollapsed: (collapsed) => set({ toolbarCollapsed: collapsed }),
    }),
    {
      name: STORAGE_KEYS.SETTINGS,
      partialize: (state) => ({
        reasoningCollapsed: state.reasoningCollapsed,
        appview: state.appview,
        memoListVisible: state.memoListVisible,
        noteNavigationVisible: state.noteNavigationVisible,
        agentPanelVisible: state.agentPanelVisible,
        agentColWidth: state.agentColWidth,
        toolbarCollapsed: state.toolbarCollapsed,
      }),
    }
  )
);
