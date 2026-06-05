import { create } from 'zustand';

export type DocumentSource = 'memo' | 'external';

export interface DocumentStore {
  currentDocumentPath: string | null;
  currentDocumentSource: DocumentSource | null;
  setCurrentDocumentPath: (path: string | null) => void;
  setCurrentMemoDocumentPath: (path: string | null) => void;
  setCurrentExternalDocumentPath: (path: string | null) => void;
}

function documentState(path: string | null, source: DocumentSource | null) {
  return {
    currentDocumentPath: path,
    currentDocumentSource: path ? source : null,
  };
}

export const useDocumentStore = create<DocumentStore>()(
  (set) => ({
    currentDocumentPath: null,
    currentDocumentSource: null,
    setCurrentDocumentPath: (path) => set(documentState(path, 'memo')),
    setCurrentMemoDocumentPath: (path) => set(documentState(path, 'memo')),
    setCurrentExternalDocumentPath: (path) => set(documentState(path, 'external')),
  })
);
