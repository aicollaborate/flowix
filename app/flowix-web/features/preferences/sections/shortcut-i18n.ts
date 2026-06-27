import type { ActionDefinition } from '@features/shortcuts';
import type { I18nKey } from '@features/i18n';

type Translate = (key: I18nKey) => string;

const GROUP_KEY_BY_NAME: Record<string, I18nKey> = {
  编辑: 'preferences.shortcuts.group.editor',
  导航: 'preferences.shortcuts.group.navigation',
  视图: 'preferences.shortcuts.group.view',
  系统: 'preferences.shortcuts.group.system',
  Memo: 'preferences.shortcuts.group.memo',
};

const ACTION_KEY_BY_ID: Record<string, { title: I18nKey; description: I18nKey }> = {
  'editor.find': {
    title: 'preferences.shortcuts.action.editor.find.title',
    description: 'preferences.shortcuts.action.editor.find.description',
  },
  'editor.undo': {
    title: 'preferences.shortcuts.action.editor.undo.title',
    description: 'preferences.shortcuts.action.editor.undo.description',
  },
  'editor.redo': {
    title: 'preferences.shortcuts.action.editor.redo.title',
    description: 'preferences.shortcuts.action.editor.redo.description',
  },
  'editor.setHeading1': {
    title: 'preferences.shortcuts.action.editor.setHeading1.title',
    description: 'preferences.shortcuts.action.editor.setHeading1.description',
  },
  'editor.setHeading2': {
    title: 'preferences.shortcuts.action.editor.setHeading2.title',
    description: 'preferences.shortcuts.action.editor.setHeading2.description',
  },
  'editor.setHeading3': {
    title: 'preferences.shortcuts.action.editor.setHeading3.title',
    description: 'preferences.shortcuts.action.editor.setHeading3.description',
  },
  'editor.setHeading4': {
    title: 'preferences.shortcuts.action.editor.setHeading4.title',
    description: 'preferences.shortcuts.action.editor.setHeading4.description',
  },
  'editor.setParagraph': {
    title: 'preferences.shortcuts.action.editor.setParagraph.title',
    description: 'preferences.shortcuts.action.editor.setParagraph.description',
  },
  'editor.toggleBulletList': {
    title: 'preferences.shortcuts.action.editor.toggleBulletList.title',
    description: 'preferences.shortcuts.action.editor.toggleBulletList.description',
  },
  'editor.toggleOrderedList': {
    title: 'preferences.shortcuts.action.editor.toggleOrderedList.title',
    description: 'preferences.shortcuts.action.editor.toggleOrderedList.description',
  },
  'editor.toggleTaskList': {
    title: 'preferences.shortcuts.action.editor.toggleTaskList.title',
    description: 'preferences.shortcuts.action.editor.toggleTaskList.description',
  },
  'palette.search': {
    title: 'preferences.shortcuts.action.palette.search.title',
    description: 'preferences.shortcuts.action.palette.search.description',
  },
  'menu.open': {
    title: 'preferences.shortcuts.action.menu.open.title',
    description: 'preferences.shortcuts.action.menu.open.description',
  },
  'history.back': {
    title: 'preferences.shortcuts.action.history.back.title',
    description: 'preferences.shortcuts.action.history.back.description',
  },
  'history.forward': {
    title: 'preferences.shortcuts.action.history.forward.title',
    description: 'preferences.shortcuts.action.history.forward.description',
  },
  'memo.create': {
    title: 'preferences.shortcuts.action.memo.create.title',
    description: 'preferences.shortcuts.action.memo.create.description',
  },
  'notebook.create': {
    title: 'preferences.shortcuts.action.notebook.create.title',
    description: 'preferences.shortcuts.action.notebook.create.description',
  },
  'notebook.switcher.toggle': {
    title: 'preferences.shortcuts.action.notebook.switcher.toggle.title',
    description: 'preferences.shortcuts.action.notebook.switcher.toggle.description',
  },
  'theme.toggle': {
    title: 'preferences.shortcuts.action.theme.toggle.title',
    description: 'preferences.shortcuts.action.theme.toggle.description',
  },
  'panel.memoList.toggle': {
    title: 'preferences.shortcuts.action.panel.memoList.toggle.title',
    description: 'preferences.shortcuts.action.panel.memoList.toggle.description',
  },
  'panel.agent.toggle': {
    title: 'preferences.shortcuts.action.panel.agent.toggle.title',
    description: 'preferences.shortcuts.action.panel.agent.toggle.description',
  },
  'dialog.cancel': {
    title: 'preferences.shortcuts.action.dialog.cancel.title',
    description: 'preferences.shortcuts.action.dialog.cancel.description',
  },
  'dialog.confirm': {
    title: 'preferences.shortcuts.action.dialog.confirm.title',
    description: 'preferences.shortcuts.action.dialog.confirm.description',
  },
};

export function getShortcutGroupLabel(group: string, t: Translate): string {
  const key = GROUP_KEY_BY_NAME[group];
  return key ? t(key) : group;
}

export function getShortcutActionTitle(action: Pick<ActionDefinition, 'id' | 'title'>, t: Translate): string {
  const key = ACTION_KEY_BY_ID[action.id]?.title;
  return key ? t(key) : action.title;
}

export function getShortcutActionDescription(
  action: Pick<ActionDefinition, 'id' | 'description'>,
  t: Translate,
): string | undefined {
  const key = ACTION_KEY_BY_ID[action.id]?.description;
  return key ? t(key) : action.description;
}
