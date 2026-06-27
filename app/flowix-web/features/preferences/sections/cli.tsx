'use client';

import { SectionHeader } from '@features/preferences/sections/primitives';
import { useI18n, type I18nKey } from '@features/i18n';

interface CliCommandItem {
  command: string;
  alias?: string;
  usage: string;
  descriptionKey: I18nKey;
}

const CLI_COMMANDS: CliCommandItem[] = [
  {
    command: 'notebooks',
    alias: 'nb',
    usage: 'flowix-cli notebooks',
    descriptionKey: 'preferences.cli.commands.notebooks',
  },
  {
    command: 'list',
    alias: 'ls',
    usage: 'flowix-cli list <notebook>',
    descriptionKey: 'preferences.cli.commands.list',
  },
  {
    command: 'show',
    alias: 's',
    usage: 'flowix-cli show <id>',
    descriptionKey: 'preferences.cli.commands.show',
  },
  {
    command: 'create',
    alias: 'new, c',
    usage: 'echo "# title" | flowix-cli create <notebook>',
    descriptionKey: 'preferences.cli.commands.create',
  },
  {
    command: 'delete',
    alias: 'rm',
    usage: 'flowix-cli delete <id>',
    descriptionKey: 'preferences.cli.commands.delete',
  },
  {
    command: 'edit',
    alias: 'e',
    usage: 'flowix-cli edit <id> --old <text> --new <text>',
    descriptionKey: 'preferences.cli.commands.edit',
  },
  {
    command: 'write',
    alias: 'w',
    usage: 'printf "# title\\nbody\\n" | flowix-cli write <id>',
    descriptionKey: 'preferences.cli.commands.write',
  },
  {
    command: 'search',
    alias: 'q',
    usage: 'flowix-cli search <query> --limit 20',
    descriptionKey: 'preferences.cli.commands.search',
  },
  {
    command: 'completion',
    usage: 'flowix-cli completion <bash|zsh|fish>',
    descriptionKey: 'preferences.cli.commands.completion',
  },
];

export function CliSection() {
  const { t } = useI18n();

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader title={t('preferences.cli.title')} />
      <div className="space-y-2">
        <div className="rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <div className="text-xs font-medium text-[var(--muted-foreground)]">
            {t('preferences.cli.binary')}
          </div>
          <code className="mt-1 block text-sm text-[var(--foreground)]">
            flowix-cli
          </code>
        </div>

        <div className="divide-y divide-[var(--divider)]">
          {CLI_COMMANDS.map((item) => (
            <div key={item.command} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-sm font-medium text-[var(--foreground)]">
                      {item.command}
                    </code>
                    {item.alias && (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {t('preferences.cli.alias')}: {item.alias}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {t(item.descriptionKey)}
                  </p>
                </div>
              </div>
              <code className="mt-2 block overflow-x-auto rounded-md bg-[var(--muted)] px-2.5 py-2 text-xs text-[var(--foreground)]">
                {item.usage}
              </code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
