'use client';

import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface WindowSize {
  width: number;
  height: number;
}

interface WindowSizeActions {
  setSize: (width: number, height: number) => Promise<boolean>;
  getSize: () => Promise<WindowSize>;
}

/**
 * Hook for window size management using Tauri RPC
 */
export function useWindowSize(): WindowSizeActions {
  const setSize = useCallback(async (width: number, height: number): Promise<boolean> => {
    try {
      const result = await invoke<{ success: boolean }>('window:setSize', { width, height });
      return result?.success ?? false;
    } catch (error) {
      console.error('[useWindowSize] Failed to set size:', error);
      return false;
    }
  }, []);

  const getSize = useCallback(async (): Promise<WindowSize> => {
    try {
      const result = await invoke<WindowSize>('window:getSize', {});
      return result ?? { width: 0, height: 0 };
    } catch (error) {
      console.error('[useWindowSize] Failed to get size:', error);
      return { width: 0, height: 0 };
    }
  }, []);

  return { setSize, getSize };
}