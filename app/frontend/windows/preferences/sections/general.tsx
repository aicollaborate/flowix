'use client';

import { useState } from 'react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '../../../components/ui/select';
import { Textarea } from '../../../components/ui/textarea';
import { useComposingValue } from '../../../lib/hooks/useComposingValue';
import { Field, FieldRow, SectionHeader, FIELD_INPUT_CLASS } from './primitives';

interface GeneralSectionProps {
  settings: {
    customInstruction: string;
    selectedTags: string[];
    responseLength: string;
    preferredLanguage: string;
  };
  updateSettings: (updates: {
    personalize?: Partial<{
      customInstruction: string;
      selectedTags: string[];
      responseLength: string;
      preferredLanguage: string;
    }>;
  }) => Promise<void>;
}

export function GeneralSection({ settings, updateSettings }: GeneralSectionProps) {
  // IME-safe: during Chinese/Japanese/Korean composition, the textarea is
  // temporarily uncontrolled (a local draft is shown) so the IME owns the
  // DOM. On compositionend, the final value is committed to the store once.
  const customInstruction = useComposingValue(
    settings.customInstruction,
    (next) => updateSettings({ personalize: { customInstruction: next } }),
  );

  // UI language is display-only for now (no i18n wiring); local state
  // keeps the select interactive without polluting the settings store.
  const [uiLanguage, setUiLanguage] = useState('简体中文');

  return (
    <div className="space-y-6 pb-16">
      {/* 通用 — language preference for the app UI itself */}
      <SectionHeader
        title="通用"
      />

      <FieldRow
        title="语言设置"
        description="选择应用界面显示语言"
      >
        <Select
          value={uiLanguage}
          onValueChange={setUiLanguage}
        >
          <SelectTrigger className="w-32" />
          <SelectContent>
            <SelectItem value="简体中文">简体中文</SelectItem>
            <SelectItem value="English">English</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      {/* 个性化 — formerly the standalone "个性化" tab, now a sub-section.
          Keeps the same primary header so the IA still reads as two
          logical groups inside the 通用 tab. */}
      <SectionHeader
        title="个性化"
      />

      {/* Custom Instructions */}
      <Field
        title="自定义指令"
        description="告诉 AI 你的角色与使用场景,会得到更贴切的回复"
      >
        <Textarea
          value={customInstruction.value}
          onChange={customInstruction.onChange}
          onCompositionStart={customInstruction.onCompositionStart}
          onCompositionEnd={customInstruction.onCompositionEnd}
          placeholder="例如:我是一名产品经理,主要负责需求分析..."
          className={FIELD_INPUT_CLASS}
        />
      </Field>

      {/* Response Length */}
      <FieldRow
        title="回复长度"
        description="控制 AI 回复的详细程度"
      >
        <Select
          value={settings.responseLength}
          onValueChange={(value) => updateSettings({ personalize: { responseLength: value } })}
        >
          <SelectTrigger className="w-32" />
          <SelectContent>
            <SelectItem value="简洁">简洁</SelectItem>
            <SelectItem value="标准">标准</SelectItem>
            <SelectItem value="详细">详细</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      {/* Preferred Language (for AI responses) */}
      <FieldRow
        title="偏好语言"
        description="AI 回复所使用的语言"
      >
        <Select
          value={settings.preferredLanguage}
          onValueChange={(value) => updateSettings({ personalize: { preferredLanguage: value } })}
        >
          <SelectTrigger className="w-32" />
          <SelectContent>
            <SelectItem value="简体中文">简体中文</SelectItem>
            <SelectItem value="English">English</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    </div>
  );
}
