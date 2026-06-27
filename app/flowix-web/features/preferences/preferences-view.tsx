'use client';

import { useState, useEffect } from 'react';
import { FileText, Image, Keyboard, Link2, History, Infinity, SquareTerminal, Type, Palette, Settings, Video } from 'lucide-react';
import { useUserSettings } from '@features/preferences/hooks/use-user-settings';
import {
	GeneralSection,
	FormatSection,
	ThemeSection,
	TemplatesSection,
	AgentSection,
	ShortcutsSection,
	CliSection,
	ConnectionsSection,
	HistorySection,
	SectionHeader,
	type SettingsTab,
} from '@features/preferences/sections';
import { cn } from '@/lib/utils';
import { Button } from '@shared/ui/button';
import { WindowsTitlebarControls } from '@shared/window-titlebar-controls';
import { PreferencesTitlebarMac } from '@features/preferences/preferences-titlebar-mac';
import { PreferencesTitlebarWin } from '@features/preferences/preferences-titlebar-win';
import { useI18n, type I18nKey } from '@features/i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';

function isWindowsPlatform(): boolean {
	return /Windows/i.test(navigator.userAgent) || /Win/i.test(navigator.platform);
}

type PreferencesTabItem = { id: SettingsTab; labelKey: I18nKey; icon: React.ReactNode };

const TAB_GROUPS: { labelKey: I18nKey; tabs: PreferencesTabItem[] }[] = [
	{
		labelKey: 'preferences.groups.features',
		tabs: [
			{ id: 'general', labelKey: 'preferences.tabs.general', icon: <Settings className="w-4 h-4" /> },
			{ id: 'format', labelKey: 'preferences.tabs.format', icon: <Type className="w-4 h-4" /> },
			{ id: 'theme', labelKey: 'preferences.tabs.theme', icon: <Palette className="w-4 h-4" /> },
			{ id: 'templates', labelKey: 'preferences.tabs.templates', icon: <FileText className="w-4 h-4" /> },
			{ id: 'shortcuts', labelKey: 'preferences.tabs.shortcuts', icon: <Keyboard className="w-4 h-4" /> },
			{ id: 'history', labelKey: 'preferences.tabs.history', icon: <History className="w-4 h-4" /> },
		],
	},
	{
		labelKey: 'preferences.groups.ai',
		tabs: [
			{ id: 'agent', labelKey: 'preferences.tabs.agent', icon: <Infinity className="w-4 h-4" /> },
			{ id: 'cli', labelKey: 'preferences.tabs.cli', icon: <SquareTerminal className="w-4 h-4" /> },
			{ id: 'connections', labelKey: 'preferences.tabs.connections', icon: <Link2 className="w-4 h-4" /> },
			{ id: 'imageGeneration', labelKey: 'preferences.tabs.imageGeneration', icon: <Image className="w-4 h-4" /> },
			{ id: 'videoGeneration', labelKey: 'preferences.tabs.videoGeneration', icon: <Video className="w-4 h-4" /> },
		],
	},
];

const TABS = TAB_GROUPS.flatMap(group => group.tabs);

function PlaceholderSection({ title, emptyText }: { title: string; emptyText: string }) {
	return (
		<div className="space-y-6">
			<SectionHeader title={title} />
			<p className="text-sm text-[var(--muted-foreground)]">{emptyText}</p>
		</div>
	);
}

interface PreferencesViewProps {
	initialTab?: string;
}

export function PreferencesView({ initialTab }: PreferencesViewProps) {
	const { settings, updateSettings } = useUserSettings();
	const { t } = useI18n();
	const [activeTab, setActiveTab] = useState<SettingsTab>('general');
	const title = t('preferences.title');

	useEffect(() => {
		if (initialTab && TABS.some(t => t.id === initialTab)) {
			setActiveTab(initialTab as SettingsTab);
		}
	}, [initialTab]);

	useEffect(() => {
		document.title = title;
		void getCurrentWindow().setTitle(title).catch(() => {
			// Browser preview or unavailable Tauri window API.
		});
	}, [title]);

	return (
		<div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--background)]">
			<WindowsTitlebarControls />
			{isWindowsPlatform() ? <PreferencesTitlebarWin /> : <PreferencesTitlebarMac />}
			<div className="flex-1 flex min-h-0">
				{/* Left sidebar */}
				<div className="w-[204px] border-r border-solid border-[var(--divider)] bg-[var(--card)] shrink-0 px-2 pt-5 pb-2 flex flex-col gap-4">
					{TAB_GROUPS.map((group) => (
						<div key={group.labelKey} className="space-y-1">
							<div className="px-2 pb-1 text-xs font-medium text-[var(--muted-foreground)]">
								{t(group.labelKey)}
							</div>
							{group.tabs.map((tab) => (
								<Button
									key={tab.id}
									variant={activeTab === tab.id ? 'secondary' : 'ghost'}
									size="sm"
									className={cn(
										'w-full justify-start gap-1.5 py-4 rounded-lg',
										activeTab === tab.id && 'text-[var(--primary)]'
									)}
									onClick={() => setActiveTab(tab.id)}
								>
									{tab.icon}
									<span className="text-sm font-normal">{t(tab.labelKey)}</span>
								</Button>
							))}
						</div>
					))}
				</div>
				{/* Right content */}
				<div className="flex-1 flex flex-col min-w-0">
					<div className="flex-1 flex justify-center p-6 overflow-y-auto">
						<div className="w-full max-w-[500px]">
							{activeTab === 'general' && (
								<GeneralSection
									settings={settings.personalize}
									language={settings.language}
									updateSettings={updateSettings}
								/>
							)}
							{activeTab === 'format' && (
								<FormatSection
									settings={settings.format}
									updateSettings={updateSettings}
								/>
							)}
							{activeTab === 'theme' && (
								<ThemeSection
									settings={settings}
									updateSettings={updateSettings}
								/>
							)}
							{activeTab === 'templates' && <TemplatesSection />}
							{activeTab === 'agent' && <AgentSection />}
							{activeTab === 'shortcuts' && <ShortcutsSection />}
							{activeTab === 'cli' && <CliSection />}
							{activeTab === 'connections' && <ConnectionsSection />}
							{activeTab === 'imageGeneration' && (
								<PlaceholderSection
									title={t('preferences.imageGeneration.title')}
									emptyText={t('preferences.emptySettings')}
								/>
							)}
							{activeTab === 'videoGeneration' && (
								<PlaceholderSection
									title={t('preferences.videoGeneration.title')}
									emptyText={t('preferences.emptySettings')}
								/>
							)}
							{activeTab === 'history' && <HistorySection />}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
