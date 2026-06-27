'use client';

import { useEffect, useMemo, useState } from 'react';
import YAML from 'yaml';
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { CalendarBlankIcon } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Input } from '@shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { cn } from '@/lib/utils';

type PropertyType = 'Text' | 'Number' | 'Date' | 'URL' | 'Tags';

interface PropertyRow {
  id: string;
  key: string;
  type: PropertyType;
  value: string;
}

interface NotePropertiesDialogProps {
  open: boolean;
  content: string;
  onOpenChange: (open: boolean) => void;
  onSave: (nextContent: string) => void | Promise<void>;
}

const PROPERTY_TYPES: PropertyType[] = ['Text', 'Number', 'Date', 'URL', 'Tags'];
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const URL_RE = /^https?:\/\/\S+$/i;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
let rowIdSeq = 0;

function createRowId(): string {
  rowIdSeq += 1;
  return `property-${rowIdSeq}`;
}

function inferType(value: unknown): PropertyType {
  if (Array.isArray(value)) return 'Tags';
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Date';
    if (URL_RE.test(value)) return 'URL';
  }
  return 'Text';
}

function stringifyValue(value: unknown, type: PropertyType): string {
  if (type === 'Tags') {
    return Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value ?? '');
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

function extractFrontmatter(content: string): {
  yamlContent: string;
  body: string;
  hasFrontmatter: boolean;
  parseError: string | null;
  data: Record<string, unknown>;
} {
  const match = FRONTMATTER_RE.exec(content);
  const yamlContent = match?.[1]?.trim() ?? '';
  const body = match ? content.slice(match[0].length) : content;

  if (!match) {
    return { yamlContent: '', body, hasFrontmatter: false, parseError: null, data: {} };
  }

  try {
    const parsed = YAML.parse(yamlContent) || {};
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    return { yamlContent, body, hasFrontmatter: true, parseError: null, data };
  } catch (error) {
    return {
      yamlContent,
      body,
      hasFrontmatter: true,
      parseError: error instanceof Error ? error.message : String(error),
      data: {},
    };
  }
}

function rowsFromData(data: Record<string, unknown>): PropertyRow[] {
  return Object.entries(data).map(([key, value]) => {
    const type = inferType(value);
    return {
      id: createRowId(),
      key,
      type,
      value: stringifyValue(value, type),
    };
  });
}

function convertRowValue(row: PropertyRow): unknown {
  const value = row.value.trim();
  switch (row.type) {
    case 'Number': {
      if (!value) return '';
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }
    case 'Tags':
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    case 'Date':
    case 'URL':
    case 'Text':
    default:
      return row.value;
  }
}

function tagsFromValue(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatYamlKey(key: string): string {
  return YAML.stringify(key).trim();
}

function formatYamlScalarRow(key: string, value: unknown): string {
  return YAML.stringify({ [key]: value }, { lineWidth: 0 }).trim();
}

function buildContentWithFrontmatter(content: string, rows: PropertyRow[]): string {
  const { body } = extractFrontmatter(content);
  const yamlLines: string[] = [];

  rows.forEach((row) => {
    const key = row.key.trim();
    if (!key) return;
    if (row.type === 'Tags') {
      const tags = tagsFromValue(row.value);
      yamlLines.push(`${formatYamlKey(key)}: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`);
      return;
    }
    yamlLines.push(formatYamlScalarRow(key, convertRowValue(row)));
  });

  const yamlContent = yamlLines.length > 0 ? yamlLines.join('\n') : '{}';

  return `---\n${yamlContent}\n---\n${body.replace(/^\r?\n/, '')}`;
}

function getDuplicateKeys(rows: PropertyRow[]): Set<string> {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = row.key.trim();
    if (!key) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function coerceValueForType(value: string, nextType: PropertyType): string {
  if (nextType === 'Date') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    return match?.[0] ?? '';
  }
  return value;
}

function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthDays(viewMonth: Date): Array<{ date: Date; inMonth: boolean }> {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, inMonth: date.getMonth() === month };
  });
}

function getMonthTitle(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function TagsInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const tags = tagsFromValue(value);
  const [draft, setDraft] = useState('');

  const commitDraft = () => {
    const nextTag = draft.trim();
    if (!nextTag) return;
    if (!tags.includes(nextTag)) {
      onChange([...tags, nextTag].join(', '));
    }
    setDraft('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag).join(', '));
  };

  return (
    <div
      className={cn(
        'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-background px-2 py-1 text-sm focus-within:border-[var(--primary)]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-5 items-center gap-1 rounded-md bg-[var(--muted)] px-1.5 text-xs text-[var(--foreground)]"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              aria-label={`删除标签 ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        placeholder={tags.length === 0 ? '输入标签后回车' : ''}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === 'Backspace' && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1).join(', '));
          }
        }}
        className="min-w-[88px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}

function DateValueInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseDateValue(value);
  const [viewMonth, setViewMonth] = useState(() => selectedDate ?? new Date());

  useEffect(() => {
    if (selectedDate) {
      setViewMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate?.getFullYear(), selectedDate?.getMonth()]);

  const monthDays = useMemo(() => getMonthDays(viewMonth), [viewMonth]);

  const changeMonth = (offset: number) => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const selectDate = (date: Date) => {
    onChange(formatDateValue(date));
    setOpen(false);
  };

  const clearDate = (event: React.MouseEvent) => {
    event.stopPropagation();
    onChange('');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'group flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-sm transition-colors',
            'hover:bg-[var(--muted)]/40 focus-visible:border-[var(--primary)] focus-visible:outline-none',
            open && 'border-[var(--primary)]',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <CalendarBlankIcon
            className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]"
            weight="regular"
            aria-hidden="true"
          />
          <span className={cn('min-w-0 flex-1 truncate', value ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]')}>
            {value || '选择日期'}
          </span>
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              onClick={clearDate}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--muted-foreground)] opacity-0 transition-opacity hover:bg-[var(--muted)] hover:text-[var(--foreground)] group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-label="清空日期"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[272px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl"
      >
        <div className="rounded-lg bg-[var(--card)]">
          <div className="mb-2 flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="上个月"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-medium text-[var(--foreground)]">
              {getMonthTitle(viewMonth)}
            </div>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              aria-label="下个月"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-1 pb-1 text-center text-[11px] font-medium text-[var(--muted-foreground)]">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="flex h-6 items-center justify-center">
                {weekday}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthDays.map(({ date, inMonth }) => {
              const dateValue = formatDateValue(date);
              const isSelected = value === dateValue;
              const isToday = dateValue === formatDateValue(new Date());

              return (
                <button
                  key={dateValue}
                  type="button"
                  onClick={() => selectDate(date)}
                  className={cn(
                    'flex h-8 items-center justify-center rounded-md text-sm transition-colors',
                    inMonth ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] opacity-45',
                    'hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
                    isToday && !isSelected && 'ring-1 ring-inset ring-[var(--border)]',
                    isSelected && 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)] hover:text-[var(--primary-foreground)]'
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotePropertiesDialog({
  open,
  content,
  onOpenChange,
  onSave,
}: NotePropertiesDialogProps) {
  const frontmatter = useMemo(() => extractFrontmatter(content), [content]);
  const [rows, setRows] = useState<PropertyRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(rowsFromData(frontmatter.data));
  }, [frontmatter.data, open]);

  const duplicateKeys = useMemo(() => getDuplicateKeys(rows), [rows]);
  const hasInvalidKey = rows.some((row) => !row.key.trim());
  const canSave = !isSaving && !frontmatter.parseError && !hasInvalidKey && duplicateKeys.size === 0;

  const updateRow = (id: string, patch: Partial<PropertyRow>) => {
    setRows((current) => current.map((row) => {
      if (row.id !== id) return row;
      const nextType = patch.type ?? row.type;
      const nextValue = patch.type ? coerceValueForType(row.value, nextType) : row.value;
      return { ...row, ...patch, value: patch.value ?? nextValue };
    }));
  };

  const addRow = () => {
    let index = rows.length + 1;
    let key = `property_${index}`;
    const keys = new Set(rows.map((row) => row.key.trim()));
    while (keys.has(key)) {
      index += 1;
      key = `property_${index}`;
    }
    setRows((current) => [
      ...current,
      { id: createRowId(), key, type: 'Text', value: '' },
    ]);
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave(buildContentWithFrontmatter(content, rows));
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[640px] max-w-[calc(100vw-32px)]">
        <DialogHeader>
          <DialogTitle>属性</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {frontmatter.parseError && (
            <div className="rounded-lg border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,transparent)] px-3 py-2 text-xs text-[var(--destructive)]">
              当前 YAML 无法解析，请先修复后再编辑属性。
            </div>
          )}

          <div className="max-h-[360px] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            <div className="grid grid-cols-[minmax(88px,0.67fr)_96px_minmax(192px,1.73fr)_32px] gap-2 px-1 pb-1 text-xs font-medium text-[var(--muted-foreground)]">
              <span>字段</span>
              <span>类型</span>
              <span>值</span>
              <span />
            </div>

            <div className="space-y-2">
              {rows.map((row) => {
                const keyInvalid = !row.key.trim() || duplicateKeys.has(row.key.trim());
                const isKeyField = row.key.trim() === 'key';
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-[minmax(88px,0.67fr)_96px_minmax(192px,1.73fr)_32px] items-center gap-2"
                  >
                    <Input
                      value={row.key}
                      onChange={(event) => updateRow(row.id, { key: event.target.value })}
                      disabled={isKeyField}
                      className={cn('h-8', keyInvalid && 'border-[var(--destructive)]')}
                    />
                    <Select
                      value={row.type}
                      onValueChange={(value) => updateRow(row.id, { type: value as PropertyType })}
                      disabled={isKeyField}
                    >
                      <SelectTrigger className={cn('h-8 rounded-lg', isKeyField && 'pointer-events-none opacity-50')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" className="w-[96px] min-w-[96px]">
                        {PROPERTY_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {row.type === 'Tags' ? (
                      <TagsInput
                        value={row.value}
                        disabled={isKeyField}
                        onChange={(value) => updateRow(row.id, { value })}
                      />
                    ) : row.type === 'Date' ? (
                      <DateValueInput
                        value={row.value}
                        disabled={isKeyField}
                        onChange={(value) => updateRow(row.id, { value })}
                      />
                    ) : (
                      <Input
                        type={row.type === 'URL' ? 'url' : row.type === 'Number' ? 'number' : 'text'}
                        value={row.value}
                        onChange={(event) => updateRow(row.id, { value: event.target.value })}
                        disabled={isKeyField}
                        className="h-8"
                      />
                    )}
                    {isKeyField ? (
                      <div className="h-8 w-8" />
                    ) : (
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--destructive)]"
                      aria-label="删除字段"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                );
              })}
            </div>

            {rows.length === 0 && !frontmatter.parseError && (
              <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted-foreground)]">
                暂无属性
              </div>
            )}
          </div>

          {duplicateKeys.size > 0 && (
            <div className="text-xs text-[var(--destructive)]">字段名不能重复。</div>
          )}
          {hasInvalidKey && (
            <div className="text-xs text-[var(--destructive)]">字段名不能为空。</div>
          )}

          <button
            type="button"
            onClick={addRow}
            disabled={!!frontmatter.parseError}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            新增字段
          </button>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-lg px-3 text-sm hover:bg-[var(--muted)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="h-8 rounded-lg bg-[var(--primary)] px-3 text-sm text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
