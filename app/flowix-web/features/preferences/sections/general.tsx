'use client';

import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@shared/ui/select';
import { Textarea } from '@shared/ui/textarea';
import { Button } from '@shared/ui/button';
import { Tooltip } from '@shared/ui/tooltip';
import { useComposingValue } from '@shared/hooks/use-composing-value';
import { product, type ProductInfo } from '@platform/tauri/client';
import { toast } from '@/lib/toast';
import { Field, FieldRow, SectionHeader, FIELD_INPUT_CLASS } from '@features/preferences/sections/primitives';
import { LANGUAGE_OPTIONS, useI18n, type AppLanguage } from '@features/i18n';

interface GeneralSectionProps {
  settings: {
    customInstruction: string;
    selectedTags: string[];
    responseLength: string;
    preferredLanguage: string;
  };
  language: AppLanguage;
  updateSettings: (updates: {
    personalize?: Partial<{
      customInstruction: string;
      selectedTags: string[];
      responseLength: string;
      preferredLanguage: string;
    }>;
    language?: AppLanguage;
  }) => Promise<void>;
}

export function GeneralSection({ settings, language, updateSettings }: GeneralSectionProps) {
  const { t } = useI18n();
  const customInstruction = useComposingValue(
    settings.customInstruction,
    (next) => updateSettings({ personalize: { customInstruction: next } }),
  );
  const [productInfo, setProductInfo] = useState<ProductInfo | null>(null);
  const currentLanguageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ?? language;
  const responseLengthLabelByValue: Record<string, string> = {
    concise: t('preferences.general.responseLength.concise'),
    standard: t('preferences.general.responseLength.standard'),
    detailed: t('preferences.general.responseLength.detailed'),
  };
  const preferredLanguageLabelByValue: Record<string, string> = {
    'Simplified Chinese': t('language.zhCN'),
    English: t('language.enUS'),
  };
  const currentResponseLengthLabel =
    responseLengthLabelByValue[settings.responseLength] ?? settings.responseLength;
  const currentPreferredLanguageLabel =
    preferredLanguageLabelByValue[settings.preferredLanguage] ?? settings.preferredLanguage;

  useEffect(() => {
    product.getInfo()
      .then(setProductInfo)
      .catch(() => setProductInfo(null));
  }, []);

  const handleOpenLogDir = async () => {
    try {
      await product.openLogDir();
    } catch {
      toast.error(t('preferences.general.runtimeLogs.openFailed'));
    }
  };

  return (
    <div className="space-y-6 pb-16">
      <SectionHeader title={t('preferences.general.title')} />

      <FieldRow
        title={t('preferences.general.language.title')}
        description={t('preferences.general.language.description')}
      >
        <Select
          value={language}
          onValueChange={(value) => updateSettings({ language: value as AppLanguage })}
        >
          <SelectTrigger className="w-40">
            <span>{currentLanguageLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldRow>

      <SectionHeader title={t('preferences.general.personalization')} />

      <Field
        title={t('preferences.general.customInstructions.title')}
        description={t('preferences.general.customInstructions.description')}
      >
        <Textarea
          value={customInstruction.value}
          onChange={customInstruction.onChange}
          onCompositionStart={customInstruction.onCompositionStart}
          onCompositionEnd={customInstruction.onCompositionEnd}
          placeholder={t('preferences.general.customInstructions.placeholder')}
          className={FIELD_INPUT_CLASS}
        />
      </Field>

      <FieldRow
        title={t('preferences.general.responseLength.title')}
        description={t('preferences.general.responseLength.description')}
      >
        <Select
          value={settings.responseLength}
          onValueChange={(value) => updateSettings({ personalize: { responseLength: value } })}
        >
          <SelectTrigger className="w-32">
            <span>{currentResponseLengthLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="concise">{t('preferences.general.responseLength.concise')}</SelectItem>
            <SelectItem value="standard">{t('preferences.general.responseLength.standard')}</SelectItem>
            <SelectItem value="detailed">{t('preferences.general.responseLength.detailed')}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      <FieldRow
        title={t('preferences.general.preferredLanguage.title')}
        description={t('preferences.general.preferredLanguage.description')}
      >
        <Select
          value={settings.preferredLanguage}
          onValueChange={(value) => updateSettings({ personalize: { preferredLanguage: value } })}
        >
          <SelectTrigger className="w-40">
            <span>{currentPreferredLanguageLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Simplified Chinese">{t('language.zhCN')}</SelectItem>
            <SelectItem value="English">{t('language.enUS')}</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>

      <SectionHeader title={t('preferences.general.about')} />

      <FieldRow title={t('preferences.general.currentVersion')}>
        <span
          className="max-w-[420px] truncate text-right text-sm text-[var(--muted-foreground)]"
          title={productInfo
            ? `${productInfo.productName} ${productInfo.version} / ${productInfo.os} ${productInfo.arch}`
            : t('preferences.general.loading')}
        >
          {productInfo
            ? `${productInfo.productName} ${productInfo.version} / ${productInfo.os} ${productInfo.arch}`
            : t('preferences.general.loading')}
        </span>
      </FieldRow>

      {import.meta.env.DEV && (
        <FieldRow
          title={t('preferences.general.runtimeLogs.title')}
          description={productInfo?.logDir ?? t('preferences.general.runtimeLogs.description')}
        >
          <Tooltip content={t('preferences.general.runtimeLogs.openFolder')}>
            <Button
              variant="outline"
              className="px-3"
              onClick={handleOpenLogDir}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              {t('preferences.general.runtimeLogs.open')}
            </Button>
          </Tooltip>
        </FieldRow>
      )}
    </div>
  );
}
