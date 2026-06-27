'use client';

import { Input } from '@shared/ui/input';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import {
  getNotebookIconOption,
  NotebookIcon,
  NOTEBOOK_ICON_OPTIONS,
  type Notebook,
} from '@features/memo';
import { cn } from '@/lib/utils';

interface NotebookDialogsProps {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  newNotebookName: string;
  onNewNotebookNameChange: (name: string) => void;
  newNotebookPath: string;
  onNewNotebookPathChange: (path: string) => void;
  newNotebookIcon: string | null;
  onNewNotebookIconChange: (icon: string | null) => void;
  onSelectDirectory: () => Promise<void>;
  onConfirmCreate: () => void;
  onCancelCreate: () => void;
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  editingNotebook: Notebook | null;
  editNotebookName: string;
  onEditNotebookNameChange: (name: string) => void;
  editNotebookIcon: string | null;
  onEditNotebookIconChange: (icon: string | null) => void;
  onConfirmEdit: () => void;
  onCancelEdit: () => void;
}

function NotebookIconPicker({
  value,
  notebookName,
  onChange,
}: {
  value: string | null;
  notebookName: string;
  onChange: (icon: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-[var(--muted-foreground)]">Icon</div>
      <div className="max-h-[162px] overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        <div className="grid grid-cols-8 gap-1.5">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
              value === null
                ? 'border-[var(--primary)] bg-[var(--accent)]'
                : 'border-[var(--border)] hover:bg-[var(--muted)]'
            )}
            aria-label="Use letter icon"
            title="Use letter icon"
          >
            <NotebookIcon
              name={notebookName}
              className="h-[26px] w-[26px] rounded-md bg-[var(--muted)] text-[12px] font-semibold text-[var(--secondary-foreground)]"
            />
          </button>
          {NOTEBOOK_ICON_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                value === option.id
                  ? 'border-[var(--primary)] bg-[var(--accent)]'
                  : 'border-[var(--border)] hover:bg-[var(--muted)]'
              )}
              aria-label={option.label}
              title={option.label}
            >
              <NotebookIcon
                icon={option.id}
                className="h-[26px] w-[26px] rounded-md bg-[var(--muted)] text-[var(--muted-foreground)]"
                imageClassName="h-[72%] w-[72%]"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function normalizeNotebookIconId(icon: string | null | undefined): string | null {
  return getNotebookIconOption(icon) ? icon! : null;
}

export function NotebookDialogs({
  createOpen,
  onCreateOpenChange,
  newNotebookName,
  onNewNotebookNameChange,
  newNotebookPath,
  onNewNotebookPathChange,
  newNotebookIcon,
  onNewNotebookIconChange,
  onSelectDirectory,
  onConfirmCreate,
  onCancelCreate,
  editOpen,
  onEditOpenChange,
  editingNotebook,
  editNotebookName,
  onEditNotebookNameChange,
  editNotebookIcon,
  onEditNotebookIconChange,
  onConfirmEdit,
  onCancelEdit,
}: NotebookDialogsProps) {
  return (
    <>
      <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
        <DialogContent className="w-[400px]">
          <DialogHeader>
            <DialogTitle>新建笔记本</DialogTitle>
          </DialogHeader>
          <div className="mt-1 space-y-3">
            <Input
              placeholder="笔记本名称"
              value={newNotebookName}
              onChange={(event) => onNewNotebookNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onConfirmCreate();
              }}
                autoFocus
            />
            <NotebookIconPicker
              value={newNotebookIcon}
              notebookName={newNotebookName}
              onChange={onNewNotebookIconChange}
            />
            <div className="flex gap-2">
              <Input
                placeholder="选择笔记存储文件夹"
                value={newNotebookPath}
                onChange={(event) => onNewNotebookPathChange(event.target.value)}
                className="flex-1"
                readOnly
              />
              <Button
                variant="outline"
                className="h-8"
                onClick={() => {
                  void onSelectDirectory();
                }}
              >
                选择
              </Button>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelCreate}
              className="h-8 px-3 text-sm rounded-lg hover:bg-[var(--muted)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirmCreate}
              className="h-8 px-3 text-sm rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
              disabled={!newNotebookName.trim() || !newNotebookPath.trim()}
            >
              创建
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={onEditOpenChange}>
        <DialogContent className="w-[400px]">
          <DialogHeader>
            <DialogTitle>编辑笔记本</DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <Input
              placeholder="笔记本名称"
              value={editNotebookName}
              onChange={(event) => onEditNotebookNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onConfirmEdit();
              }}
              autoFocus
            />
            <NotebookIconPicker
              value={editNotebookIcon}
              notebookName={editNotebookName}
              onChange={onEditNotebookIconChange}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelEdit}
              className="h-8 px-3 text-sm rounded-lg hover:bg-[var(--muted)]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirmEdit}
              className="h-8 px-3 text-sm rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
              disabled={
                !editNotebookName.trim() ||
                (editNotebookName.trim() === editingNotebook?.name &&
                  (editNotebookIcon ?? '') === (normalizeNotebookIconId(editingNotebook?.icon) ?? ''))
              }
            >
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
