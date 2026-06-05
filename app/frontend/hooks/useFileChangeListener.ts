'use client';

import { useEffect } from 'react';

interface FileChangeDetail {
  spacePath: string;
  [key: string]: unknown;
}

interface UseFileChangeListenerOptions {
  spacePath: string | undefined;
  onRefresh: () => void;
}

/**
 * Listen for file change events and trigger refresh when files in the space change
 */
export function useFileChangeListener({ spacePath, onRefresh }: UseFileChangeListenerOptions) {
  useEffect(() => {
    if (!spacePath) return;

    const handleFileChange = (e: CustomEvent<FileChangeDetail>) => {
      if (e.detail.spacePath === spacePath) {
        onRefresh();
      }
    };

    window.addEventListener('file-change', handleFileChange as EventListener);
    return () => window.removeEventListener('file-change', handleFileChange as EventListener);
  }, [spacePath, onRefresh]);
}