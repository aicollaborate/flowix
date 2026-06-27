import type { Notebook } from '@features/memo';
import { memos, settings, tags } from '@platform/tauri/client';
import type { SortType } from '@features/memo/services/memo-repository';

const TAG_ORDER_SETTING_PREFIX = 'tag_order:';
const TAG_LAYOUT_SETTING_PREFIX = 'tag_layout:';
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
  tagOptions: MemoTagTreeItem[];
  tagOrder: string[];
  tagLayout: MemoTagLayoutItem[];
  hiddenTagIds: string[];
  selectedTagId: string | null;
}

export interface MemoTagLayoutItem {
  id: string;
  parentId: string | null;
}

export interface MemoTagTreeItem extends MemoTagLayoutItem {
  name: string;
  depth: number;
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

function getTagLayoutSettingKey(notebookId: string): string {
  return `${TAG_LAYOUT_SETTING_PREFIX}${notebookId}`;
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

function parseTagLayoutSetting(value: string | null | undefined): MemoTagLayoutItem[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): MemoTagLayoutItem | null => {
        if (!item || typeof item !== 'object') return null;
        const id = 'id' in item ? item.id : null;
        const parentId = 'parentId' in item ? item.parentId : null;
        if (typeof id !== 'string') return null;
        return {
          id,
          parentId: typeof parentId === 'string' ? parentId : null,
        };
      })
      .filter((item): item is MemoTagLayoutItem => Boolean(item));
  } catch (error) {
    console.warn('[memo-list-metadata-service] Failed to parse saved tag layout:', error);
    return [];
  }
}

function normalizeTagLayout({
  usedTagIds,
  savedLayout,
  savedOrder,
}: {
  usedTagIds: string[];
  savedLayout: MemoTagLayoutItem[];
  savedOrder: string[];
}): MemoTagLayoutItem[] {
  const usedTagIdSet = new Set(usedTagIds);
  const seen = new Set<string>();
  const base = savedLayout.length > 0
    ? savedLayout
    : savedOrder.map((id) => ({ id, parentId: null }));
  const normalized: MemoTagLayoutItem[] = [];

  for (const item of base) {
    if (!usedTagIdSet.has(item.id) || seen.has(item.id)) continue;
    normalized.push({
      id: item.id,
      parentId: item.parentId && usedTagIdSet.has(item.parentId) && item.parentId !== item.id
        ? item.parentId
        : null,
    });
    seen.add(item.id);
  }

  for (const id of usedTagIds) {
    if (!seen.has(id)) {
      normalized.push({ id, parentId: null });
      seen.add(id);
    }
  }

  const parentById = new Map(normalized.map((item) => [item.id, item.parentId]));
  for (const item of normalized) {
    let cursor = item.parentId;
    const visited = new Set<string>([item.id]);
    while (cursor) {
      if (visited.has(cursor)) {
        item.parentId = null;
        parentById.set(item.id, null);
        break;
      }
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  return normalized;
}

function buildTagTreeOptions({
  layout,
  tagById,
}: {
  layout: MemoTagLayoutItem[];
  tagById: Map<string, string>;
}): MemoTagTreeItem[] {
  const childrenByParent = new Map<string | null, MemoTagLayoutItem[]>();
  for (const item of layout) {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  }

  const result: MemoTagTreeItem[] = [];
  const visited = new Set<string>();

  const visit = (item: MemoTagLayoutItem, depth: number) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const name = tagById.get(item.id);
    if (!name) return;
    result.push({
      id: item.id,
      name,
      parentId: item.parentId,
      depth,
    });
    for (const child of childrenByParent.get(item.id) ?? []) {
      visit(child, depth + 1);
    }
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }
  for (const item of layout) {
    visit({ ...item, parentId: null }, 0);
  }

  return result;
}

export function shouldShowMetadataParseLoading(content: string | null | undefined): boolean {
  return (content?.length ?? 0) >= PARSE_LOADING_THRESHOLD_BYTES;
}

export async function loadMemoLibraryMetadata({
  notebook,
  selectedTagId,
  beforeLargeParse,
}: LoadMemoLibraryMetadataParams): Promise<MemoLibraryMetadata | null> {
  const [tagsResult, usedTagIdsResult, tagOrderSetting, tagLayoutSetting, hiddenTagsSetting] = await Promise.all([
    tags.getAll(notebook.id).catch((error) => {
      console.warn('[memo-list-metadata-service] Failed to load tags:', error);
      return { tags: [] };
    }),
    memos.getUsedTagIds(notebook.id).catch((error) => {
      console.warn('[memo-list-metadata-service] Failed to load used tags:', error);
      return { usedTagIds: [] };
    }),
    settings.get(getTagOrderSettingKey(notebook.id)).catch(() => ({ value: null })),
    settings.get(getTagLayoutSettingKey(notebook.id)).catch(() => ({ value: null })),
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
  const savedLayout = parseTagLayoutSetting(tagLayoutSetting?.value);
  const tagLayout = normalizeTagLayout({
    usedTagIds,
    savedLayout,
    savedOrder,
  });
  const tagOrder = tagLayout.map((item) => item.id);

  const tagById = new Map(
    usedTagIds.map((id) => [
      id,
      tagMap[id] ?? allTagDefinitions.find((tag) => tag.id === id)?.name ?? id,
    ]),
  );
  const tagOptions = buildTagTreeOptions({ layout: tagLayout, tagById });

  const savedHidden = parseStringArraySetting(hiddenTagsSetting?.value, 'saved hidden tags');
  const hiddenTagIds = savedHidden.filter((id) => usedTagIdSet.has(id));

  return {
    tagMap,
    tagOptions,
    tagOrder,
    tagLayout,
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

export async function persistTagLayout(
  nextLayout: MemoTagLayoutItem[],
  notebookId: string | null | undefined
): Promise<void> {
  if (!notebookId) return;
  await Promise.all([
    settings.set(getTagLayoutSettingKey(notebookId), JSON.stringify(nextLayout)),
    settings.set(getTagOrderSettingKey(notebookId), JSON.stringify(nextLayout.map((item) => item.id))),
  ]);
}

export async function persistHiddenTags(nextHidden: string[], notebookId: string | null | undefined): Promise<void> {
  if (!notebookId) return;
  await settings.set(getHiddenTagsSettingKey(notebookId), JSON.stringify(nextHidden));
}
