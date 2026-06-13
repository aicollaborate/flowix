import { useCallback } from 'react';

import { memos as memosClient } from '../../../../lib/tauri/client';
import type { MemoItem } from '../../../../lib/store';

interface UseMemoMetadataSyncOptions {
  memoId: string | null;
  isExternalDocument: boolean;
  upsertMemo: (memo: MemoItem) => void;
}

export function useMemoMetadataSync({
  memoId,
  isExternalDocument,
  upsertMemo,
}: UseMemoMetadataSyncOptions) {
  const syncMemoMetadata = useCallback((content: string, refreshList: boolean) => {
    if (!memoId || isExternalDocument) return;

    memosClient.updateMemoDb(
      memoId,
      undefined,
      content,
      undefined,
      true,
    ).then(async () => {
      if (!refreshList) return;
      const latestMemo = await memosClient.readMemo(memoId) as MemoItem | null;
      if (latestMemo) {
        upsertMemo(latestMemo);
      }
    }).catch((error) => {
      console.error('[DocumentContainer] Failed to sync memo metadata:', error);
    });
  }, [memoId, isExternalDocument, upsertMemo]);

  return { syncMemoMetadata };
}
