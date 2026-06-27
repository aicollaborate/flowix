import type { Notebook } from '@features/memo';
import { memos, settings, tags } from '@platform/tauri/client';
import type { SortType } from '@features/memo/services/memo-repository';

const TAG_ORDER_SETTING_PREFIX = 'tag_order:';
const HIDDEN_TAGS_SETTING_PREFIX = 'hidden_tags:';
const PARSE_LOADING_THRESHOLD_BYTES = 80_000;

export interface MemoTodoMetadataEntry {
  content: string;
  status: string;
  memoId: string;
  priority?: string;
  timeRange?: string;
  owner?: string;
  assignee?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MemoLibraryMetadata {
  tagMap: Record<string, string>;
  tagOptions: Array<{ id: string; name: string }>;
  tagOrder: string[];
  hiddenTagIds: string[];
  selectedTagId: string | null;
}

interface LoadMemoLibraryMetadataParams {
  notebook: Notebook;
  selectedTagId: string | null;
  beforeLargeParse?: (content: string) => Promise<boolean>;
}

interface LoadTodoMetadataParams {
  notebookId: string;
  sort: SortType;
  beforeLargeParse?: () => Promise<boolean>;
}

function getTagOrderSettingKey(notebookId: string): string {
  return `${TAG_ORDER_SETTING_PREFIX}${notebookId}`;
}

function getHiddenTagsSettingKey(notebookId: string): string {
  return `${HIDDEN_TAGS_SETTING_PREFIX}${notebookId}`;
}

function parseStringArraySetting(value: string | null | undefined, warningLabel: string): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch (error) {
    console.warn(`[memo-list-metadata-service] Failed to parse ${warningLabel}:`, error);
    return [];
  }
}

export function shouldShowMetadataParseLoading(content: string | null | undefined): boolean {
  return (content?.length ?? 0) >= PARSE_LOADING_THRESHOLD_BYTES;
}

export async function loadMemoLibraryMetadata({
  notebook,
  selectedTagId,
  beforeLargeParse,
}: LoadMemoLibraryMetadataParams): Promise<MemoLibraryMetadata | null> {
  const [tagsResult, usedTagIdsResult, tagOrderSetting, hiddenTagsSetting] = await Promise.all([
    tags.getAll(notebook.id).catch((error) => {
      console.warn('[memo-list-metadata-service] Failed to load tags:', error);
      return { tags: [] };
    }),
    memos.getUsedTagIds(notebook.id).catch((error) => {
      console.warn('[memo-list-metadata-service] Failed to load used tags:', error);
      return { usedTagIds: [] };
    }),
    settings.get(getTagOrderSettingKey(notebook.id)).catch(() => ({ value: null })),
    settings.get(getHiddenTagsSettingKey(notebook.id)).catch(() => ({ value: null })),
  ]);
  void beforeLargeParse;

  const tagMap: Record<string, string> = {};
  const allTagDefinitions = tagsResult.tags ?? [];
  for (const tag of allTagDefinitions) {
    tagMap[tag.id] = tag.name;
  }

  const usedTagIds = usedTagIdsResult.usedTagIds;
  const usedTagIdSet = new Set(usedTagIds);

  const savedOrder = parseStringArraySetting(tagOrderSetting?.value, 'saved tag order');
  const savedOrderFiltered = savedOrder.filter((id) => usedTagIdSet.has(id));
  const missingIds = usedTagIds.filter((id) => !savedOrderFiltered.includes(id));
  const tagOrder = [...savedOrderFiltered, ...missingIds];

  const tagById = new Map(
    usedTagIds.map((id) => [
      id,
      tagMap[id] ?? allTagDefinitions.find((tag) => tag.id === id)?.name ?? id,
    ]),
  );
  const tagOptions = tagOrder
    .map((id) => ({ id, name: tagById.get(id) ?? id }))
    .filter((tag) => tagById.has(tag.id));

  const savedHidden = parseStringArraySetting(hiddenTagsSetting?.value, 'saved hidden tags');
  const hiddenTagIds = savedHidden.filter((id) => usedTagIdSet.has(id));

  return {
    tagMap,
    tagOptions,
    tagOrder,
    hiddenTagIds,
    selectedTagId: selectedTagId && usedTagIdSet.has(selectedTagId) ? selectedTagId : null,
  };
}

export async function loadTodoMetadata({
  notebookId,
  sort,
  beforeLargeParse,
}: LoadTodoMetadataParams): Promise<MemoTodoMetadataEntry[] | null> {
  void beforeLargeParse;
  return await memos.getTodoMetadata(notebookId, sort);
}

export async function getNotebookTodoCount(notebookId: string): Promise<number> {
  return await memos.getTodoCount(notebookId);
}

export async function persistTagOrder(nextOrder: string[], notebookId: string | null | undefined): Promise<void> {
  if (!notebookId) return;
  await settings.set(getTagOrderSettingKey(notebookId), JSON.stringify(nextOrder));
}

export async function persistHiddenTags(nextHidden: string[], notebookId: string | null | undefined): Promise<void> {
  if (!notebookId) return;
  await settings.set(getHiddenTagsSettingKey(notebookId), JSON.stringify(nextHidden));
}
