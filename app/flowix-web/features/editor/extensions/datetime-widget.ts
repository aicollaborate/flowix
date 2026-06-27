import { Extension, Editor } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { translate } from '@features/i18n';
import { useUserSettingsStore } from '@features/preferences/store/user-settings-store';

function formatChineseDateTime(date: Date): string {
  const language = useUserSettingsStore.getState().settings.language;
  // 英文用 Intl.DateTimeFormat 简写「June 24, 2025」样式 (long month + day + year, 无时间);
  // 中文保留完整数字格式带时分, 便于按时间排序对照。
  if (language === 'en-US') {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  }
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  return translate(language, 'editor.dateTime.fullFormat', {
    year,
    month,
    day,
    hour: hour.toString().padStart(2, '0'),
    minute: minute.toString().padStart(2, '0'),
  });
}

let currentUpdatedAt: Date | null = null;

export const DateTimeWidget = Extension.create({
  name: 'datetimeWidget',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('datetimeWidget'),
        props: {
          decorations(state) {
            if (!currentUpdatedAt) return DecorationSet.empty;

            const dateStr = formatChineseDateTime(currentUpdatedAt);
            const dom = document.createElement('div');
            dom.className = 'editor-datetime-widget';
            dom.textContent = dateStr;

            return DecorationSet.create(state.doc, [
              Decoration.widget(0, dom, { side: 1 }),
            ]);
          },
        },
      }),
    ];
  },
});

export function updateDateTimeWidget(editor: Editor, date: Date | null) {
  currentUpdatedAt = date;
  editor.view.dispatch(editor.state.tr.setMeta('datetimeWidgetUpdate', true));
}