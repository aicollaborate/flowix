'use client';

import { useState, useEffect, type ReactNode } from 'react';
import {
	Folder,
	User,
	Sparkles,
	Keyboard,
	Link2,
	X,
	Camera,
	Loader2,
	History,
	Bot,
	Type,
	Palette,
	Check,
	MonitorSmartphone,
} from 'lucide-react';
import { useChatStore } from '../lib/store/chat-store';
import { useUserSettings } from '../hooks/useUserSettings';
import type { AgentConfig } from '../lib/tauri/client';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem } from './ui/select';
import {
	FONT_FAMILY_OPTIONS,
	FONT_SIZE_MIN,
	FONT_SIZE_MAX,
	FONT_SIZE_STEP,
	LINE_HEIGHT_MIN,
	LINE_HEIGHT_MAX,
	LINE_HEIGHT_STEP,
	DEFAULT_USER_SETTINGS,
	THEME_OPTIONS,
	type ThemeId,
} from '../constants';

/* ---------------------------------------------------------------------------
 * Shared form primitives
 * Single source of truth for title / subtitle / control styles used by every
 * Preferences tab so the popup looks uniform.
 * ------------------------------------------------------------------------- */

const FIELD_TITLE_CLASS = 'text-sm font-medium text-[var(--foreground)]';
const FIELD_DESC_CLASS = 'text-xs text-[var(--muted-foreground)]';
const FIELD_INPUT_CLASS =
	'bg-[var(--card)] border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]';

/** Top-of-tab header. Use once per tab to introduce the section. */
function SectionHeader({
	title,
	description,
	className,
}: {
	title: string;
	description?: string;
	className?: string;
}) {
	return (
		<div className={cn('space-y-1', className)}>
			<h3 className={FIELD_TITLE_CLASS}>{title}</h3>
			{description && <p className={FIELD_DESC_CLASS}>{description}</p>}
		</div>
	);
}

/** Vertical field: title + optional description stacked above a control. */
function Field({
	title,
	description,
	hint,
	children,
	className,
}: {
	title: string;
	description?: string;
	hint?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('space-y-1.5', className)}>
			<div className="space-y-0.5">
				<label className={FIELD_TITLE_CLASS}>{title}</label>
				{description && <p className={FIELD_DESC_CLASS}>{description}</p>}
			</div>
			{children}
			{hint && <p className={FIELD_DESC_CLASS}>{hint}</p>}
		</div>
	);
}

/** Horizontal field: title + description on the left, control on the right. */
function FieldRow({
	title,
	description,
	children,
	className,
}: {
	title: string;
	description?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn('flex items-start justify-between gap-4', className)}>
			<div className="space-y-0.5 min-w-0">
				<label className={FIELD_TITLE_CLASS}>{title}</label>
				{description && <p className={FIELD_DESC_CLASS}>{description}</p>}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

export type SettingsTab = 'account' | 'personalize' | 'format' | 'theme' | 'shortcuts' | 'connections' | 'history' | 'agent';

interface TabItem {
	id: SettingsTab;
	label: string;
	icon: React.ReactNode;
}

const TABS: TabItem[] = [
	{ id: 'account', label: 'Account', icon: <User className="w-4 h-4" /> },
	{ id: 'personalize', label: 'Personalization', icon: <Sparkles className="w-4 h-4" /> },
	{ id: 'format', label: 'Format', icon: <Type className="w-4 h-4" /> },
	{ id: 'theme', label: 'Theme', icon: <Palette className="w-4 h-4" /> },
	{ id: 'agent', label: 'Agent', icon: <Bot className="w-4 h-4" /> },
	{ id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="w-4 h-4" /> },
	{ id: 'connections', label: 'Connections', icon: <Link2 className="w-4 h-4" /> },
	{ id: 'history', label: 'History', icon: <History className="w-4 h-4" /> },
];

interface MenuBoardProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function MenuBoard({ open, onOpenChange }: MenuBoardProps) {
	const [activeTab, setActiveTab] = useState<SettingsTab>('account');
	const { settings, updateSettings } = useUserSettings();

	if (!open) return null;

	// Render content based on active tab
	const renderContent = () => {
		switch (activeTab) {
			case 'account':
				return <MenuBoardAccount />;
			case 'personalize':
				return <MenuBoardPersonalize settings={settings} updateSettings={updateSettings} />;
			case 'format':
				return <MenuBoardFormat settings={settings} updateSettings={updateSettings} />;
			case 'theme':
				return <MenuBoardTheme settings={settings} updateSettings={updateSettings} />;
			case 'agent':
				return <MenuBoardAgent />;
			case 'shortcuts':
				return <MenuBoardShortcut />;
			case 'connections':
				return <MenuBoardConnection />;
			case 'history':
				return <MenuBoardHistory />;
			default:
				return null;
		}
	};

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center">
			{/* Overlay */}
			{/* (蒙层已移除) */}

			{/* Dialog */}
			<div className="relative w-full h-full bg-[var(--background)] border border-[var(--border)] shadow-2xl flex justify-center">
				<div className="w-full max-w-[800px] flex overflow-hidden">
					{/* Close button */}
					<Button
						variant="ghost"
						size="icon"
						onClick={() => onOpenChange(false)}
						className="absolute top-2 right-3 z-10"
					>
						<X className="w-5 h-5" />
					</Button>

					{/* Left sidebar */}
					<div className="w-56 border-r border-[var(--border)] p-4 bg-white shrink-0 flex flex-col">
					<div className="text-sm text-[var(--muted-foreground)] mb-3 pl-3 pt-[50px] pb-[20px] font-light">
						Settings
					</div>
					{TABS.map((tab) => (
						<Button
							key={tab.id}
							variant={activeTab === tab.id ? 'secondary' : 'ghost'}
							size="sm"
							className={cn(
								'w-full justify-start gap-3 mb-2 rounded-lg',
								activeTab === tab.id && 'text-[var(--primary)]'
							)}
							onClick={() => setActiveTab(tab.id)}
						>
							{tab.icon}
							<span className="text-sm">{tab.label}</span>
						</Button>
					))}
				</div>

				{/* Right content */}
				<div className="flex-1 flex justify-center pt-[36px] pb-3 px-12">
					<div className="w-full max-w-[800px]">{renderContent()}</div>
				</div>
				</div>
			</div>
		</div>
	);
}

// Account Tab
export function MenuBoardAccount() {
	const { settings, updateSettings } = useUserSettings();
	const [isEditingName, setIsEditingName] = useState(false);
	const [name, setName] = useState(settings.userName);
	const [isUploading] = useState(false);

	// Update local name when settings load
	useEffect(() => {
		setName(settings.userName);
	}, [settings.userName]);

	return (
		<div className="space-y-6">
			<SectionHeader
				title="Profile"
				description="Manage your account identity and contact info"
			/>

			<div className="flex items-center gap-4">
				<div className="relative">
					<div className="w-20 h-20 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
						<span className="text-2xl font-medium text-[var(--primary)]">
							{settings.userName.charAt(0).toUpperCase()}
						</span>
					</div>
					<Button
						variant="ghost"
						size="icon"
						className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 hover:opacity-100"
					>
						{isUploading ? (
							<Loader2 className="w-6 h-6 text-white animate-spin" />
						) : (
							<Camera className="w-6 h-6 text-white" />
						)}
					</Button>
				</div>

				<div className="flex-1 min-w-0">
					{isEditingName ? (
						<Input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onBlur={() => {
								setIsEditingName(false);
								if (name !== settings.userName) {
									updateSettings({ userName: name });
								}
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									setIsEditingName(false);
									if (name !== settings.userName) {
										updateSettings({ userName: name });
									}
								}
							}}
							autoFocus
							className={cn('text-lg font-medium h-9', FIELD_INPUT_CLASS)}
						/>
					) : (
						<div
							onClick={() => setIsEditingName(true)}
							className="text-lg font-medium text-[var(--foreground)] cursor-pointer hover:text-[var(--primary)] transition-colors inline-flex items-center gap-2"
						>
							{settings.userName}
							<span className={FIELD_DESC_CLASS}>(click to edit)</span>
						</div>
					)}
					<p className={cn(FIELD_DESC_CLASS, 'mt-1')}>Click nickname to edit</p>
				</div>
			</div>

			<Field title="Email" description="Used for account notifications">
				<div className={cn(
					'flex items-center gap-3 p-3 rounded-lg border',
					FIELD_INPUT_CLASS
				)}>
					<div className="flex-1 min-w-0 truncate text-sm text-[var(--foreground)]">
						{settings.userEmail || (
							<span className="text-[var(--muted-foreground)]">Not set</span>
						)}
					</div>
				</div>
			</Field>
		</div>
	);
}

// Personalize Tab
interface MenuBoardPersonalizeProps {
	settings: {
		customInstruction: string;
		selectedTags: string[];
		responseLength: string;
		preferredLanguage: string;
	};
	updateSettings: (updates: Partial<{
		customInstruction: string;
		selectedTags: string[];
		responseLength: string;
		preferredLanguage: string;
	}>) => Promise<void>;
}

export function MenuBoardPersonalize({ settings, updateSettings }: MenuBoardPersonalizeProps) {
	return (
		<div className="space-y-6">
			{/* Custom Instructions */}
			<Field
				title="Custom Instructions"
				description="Tell AI about your role and use cases to get more relevant responses"
			>
				<Textarea
					value={settings.customInstruction}
					onChange={(e) => updateSettings({ customInstruction: e.target.value })}
					placeholder="e.g., I'm a product manager focused on requirements analysis..."
					className={FIELD_INPUT_CLASS}
				/>
			</Field>

			{/* Response Length */}
			<FieldRow
				title="Response Length"
				description="Control AI response detail level"
			>
				<Select
					value={settings.responseLength}
					onValueChange={(value) => updateSettings({ responseLength: value })}
				>
					<SelectTrigger className="w-32" />
					<SelectContent>
						<SelectItem value="Concise">Concise</SelectItem>
						<SelectItem value="Standard">Standard</SelectItem>
						<SelectItem value="Detailed">Detailed</SelectItem>
					</SelectContent>
				</Select>
			</FieldRow>

			{/* Preferred Language */}
			<FieldRow
				title="Preferred Language"
				description="Language for AI responses"
			>
				<Select
					value={settings.preferredLanguage}
					onValueChange={(value) => updateSettings({ preferredLanguage: value })}
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

// Shortcuts Tab
const shortcutsList = [
	{ keys: ['⌘', 'K'], label: 'Quick Search' },
	{ keys: ['⌘', 'N'], label: 'New Document' },
	{ keys: ['⌘', 'Shift', 'N'], label: 'New Folder' },
	{ keys: ['⌘', '/'], label: 'View Shortcuts' },
	{ keys: ['⌘', 'S'], label: 'Save Document' },
	{ keys: ['⌘', 'B'], label: 'Toggle Sidebar' },
];

export function MenuBoardShortcut() {
	return (
		<div className="space-y-4">
			<SectionHeader
				title="Keyboard Shortcuts"
				description="All the keybindings available across the app"
			/>
			<div className="space-y-2">
				{shortcutsList.map((shortcut, index) => (
					<div
						key={index}
						className="flex items-center justify-between p-3 rounded-lg bg-[var(--card)] hover:bg-[var(--muted)] transition-colors"
					>
						<span className="text-sm text-[var(--foreground)]">{shortcut.label}</span>
						<div className="flex items-center gap-1">
							{shortcut.keys.map((key, i) => (
								<kbd
									key={i}
									className="px-2 py-1 text-xs font-mono bg-[var(--muted)] text-[var(--muted-foreground)] rounded border border-[var(--border)]"
								>
									{key}
								</kbd>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// Connections Tab
const connectionsList = [
	{ name: 'Notion', description: 'Knowledge Management', color: '#000000' },
	{ name: 'Cursor', description: 'AI Code Editor', color: '#3B82F6' },
	{ name: 'Slack', description: 'Team Communication', color: '#4A154B' },
	{ name: 'X', description: 'Social Platform', color: '#1DA1F2' },
	{ name: 'Reddit', description: 'Community Forum', color: '#FF4500' },
	{ name: 'Obsidian', description: 'Bidirectional Notes', color: '#7C3AED' },
];

export function MenuBoardConnection() {
	return (
		<div className="space-y-4">
			<SectionHeader
				title="Connect Products"
				description="Link external services to import and sync data"
			/>
			<div className="grid grid-cols-3 gap-3">
				{connectionsList.map((item, index) => (
					<div
						key={index}
						className="flex flex-col items-center gap-2 p-3 rounded-xl bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] transition-colors cursor-pointer group"
					>
						<Folder className="w-6 h-6 transition-colors" style={{ color: item.color }} />
						<div className="text-sm font-medium text-[var(--foreground)] text-center">
							{item.name}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

// Agent Tab
export function MenuBoardAgent() {
	const { savedAgentConfig, initAgent } = useChatStore();
	const [isSaving, setIsSaving] = useState(false);
	const [localConfig, setLocalConfig] = useState<AgentConfig | null>(null);

	// Sync local config when store loads
	useEffect(() => {
		if (savedAgentConfig) {
			setLocalConfig({ ...savedAgentConfig });
		} else {
			setLocalConfig({
				name: 'My Agent',
				api_url: 'https://api.minimaxi.com/v1',
				api_key: '',
				model: 'MiniMax-M3',
				system_prompt: '',
			});
		}
	}, [savedAgentConfig]);

	const handleSave = async () => {
		if (!localConfig) return;
		setIsSaving(true);
		try {
			await initAgent(localConfig);
		} finally {
			setIsSaving(false);
		}
	};

	if (!localConfig) {
		return <div className="text-sm text-[var(--muted-foreground)]">Loading...</div>;
	}

	return (
		<div className="space-y-6">
			<SectionHeader
				title="Agent Configuration"
				description="Configure your AI agent settings for chat functionality"
			/>

			<div className="space-y-4">
				<Field
					title="Model"
					description="The language model powering the agent"
					hint="Supported: GPT-4o, GPT-4o-mini, Claude 3.5 Sonnet, etc."
				>
					<Input
						value={localConfig.model}
						onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
						placeholder="e.g., gpt-4o-mini, claude-3-sonnet"
						className={FIELD_INPUT_CLASS}
					/>
				</Field>

				<Field title="API URL" description="Endpoint of the model provider">
					<Input
						value={localConfig.api_url}
						onChange={(e) => setLocalConfig({ ...localConfig, api_url: e.target.value })}
						placeholder="https://api.openai.com/v1"
						className={FIELD_INPUT_CLASS}
					/>
				</Field>

				<Field title="API Key" description="Stored locally, never sent to a third party">
					<Input
						type="password"
						value={localConfig.api_key}
						onChange={(e) => setLocalConfig({ ...localConfig, api_key: e.target.value })}
						placeholder="sk-..."
						className={FIELD_INPUT_CLASS}
					/>
				</Field>
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={isSaving} size="sm">
					{isSaving ? 'Saving...' : 'Save'}
				</Button>
			</div>
		</div>
	);
}

// History Tab
export function MenuBoardHistory() {
	return (
		<div className="space-y-4">
			<SectionHeader
				title="History"
				description="Recent actions and conversation history"
			/>
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<History className="w-12 h-12 text-[var(--muted-foreground)] mb-4" />
				<p className="text-sm text-[var(--muted-foreground)]">No history yet</p>
			</div>
		</div>
	);
}

// Format Tab ----------------------------------------------------------------

interface MenuBoardFormatProps {
	settings: {
		fontFamily: string;
		fontSize: number;
		lineHeight: number;
	};
	updateSettings: (updates: Partial<{
		fontFamily: string;
		fontSize: number;
		lineHeight: number;
	}>) => Promise<void>;
}

/**
 * Native range slider styled to match the rest of the Preferences UI.
 * Bound to a numeric setting; updates fire on every change for live preview.
 */
function SliderRow({
	value,
	min,
	max,
	step,
	onChange,
	formatValue,
}: {
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (v: number) => void;
	formatValue?: (v: number) => string;
}) {
	const display = formatValue ? formatValue(value) : String(value);
	return (
		<div className="flex items-center gap-3">
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="flex-1 h-1.5 rounded-full bg-[var(--muted)] appearance-none cursor-pointer accent-[var(--primary)]"
			/>
			<span className="w-12 text-right text-sm tabular-nums text-[var(--muted-foreground)]">
				{display}
			</span>
		</div>
	);
}

export function MenuBoardFormat({ settings, updateSettings }: MenuBoardFormatProps) {
	// Find the label for the currently active font; fall back to its raw stack
	// so a previously-saved unknown font still surfaces in the trigger.
	const currentFont = FONT_FAMILY_OPTIONS.find((f) => f.value === settings.fontFamily);
	const fontLabel = currentFont?.label ?? settings.fontFamily;
	return (
		<div className="space-y-6 pb-16">
			{/* Live preview — label sits as a chip at the top-left inside
			    the frame. The font styles are scoped to an inner wrapper so
			    the chip itself doesn't resize with the preview controls. */}
			<div className="relative rounded-lg border border-[var(--border)] bg-[var(--memo-detail-bg)]">
				<span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium leading-none bg-[var(--muted)] text-[var(--muted-foreground)] rounded select-none">
					预览
				</span>
				<div
					className="p-4 pt-7 text-[var(--foreground)]"
					style={{
						fontFamily: settings.fontFamily,
						fontSize: `${settings.fontSize}px`,
						lineHeight: settings.lineHeight,
					}}
				>
					<p className="m-0">
						The quick brown fox jumps over the lazy dog.
					</p>
					<p className="m-0 mt-2">
						敏捷的棕色狐狸跨越了那只懒惰的狗。
					</p>
				</div>
			</div>

			{/* Font Family */}
			<Field
				title="字体 Font"
				description="选择应用整体使用的字体"
			>
				<Select
					value={settings.fontFamily}
					onValueChange={(value) => updateSettings({ fontFamily: value })}
				>
					<SelectTrigger className="w-full justify-between">
						<span style={{ fontFamily: settings.fontFamily }}>{fontLabel}</span>
					</SelectTrigger>
					<SelectContent align="start" className="w-full min-w-[260px]">
						{FONT_FAMILY_OPTIONS.map((font) => (
							<SelectItem key={font.value} value={font.value}>
								<span style={{ fontFamily: font.value }}>{font.label}</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>

			{/* Font Size */}
			<Field
				title="字号"
				description="拖动调节正文字号 (px)"
			>
				<SliderRow
					value={settings.fontSize}
					min={FONT_SIZE_MIN}
					max={FONT_SIZE_MAX}
					step={FONT_SIZE_STEP}
					onChange={(v) => updateSettings({ fontSize: v })}
					formatValue={(v) => `${v}px`}
				/>
			</Field>

			{/* Line Height */}
			<Field
				title="行间距"
				description="拖动调节正文行高 (倍数)"
			>
				<SliderRow
					value={settings.lineHeight}
					min={LINE_HEIGHT_MIN}
					max={LINE_HEIGHT_MAX}
					step={LINE_HEIGHT_STEP}
					onChange={(v) => updateSettings({ lineHeight: v })}
					formatValue={(v) => v.toFixed(2)}
				/>
			</Field>

			{/* Reset */}
			<div className="flex justify-start">
				<Button
					variant="outline"
					size="sm"
					className="rounded-full px-4"
					onClick={() =>
						updateSettings({
							fontFamily: DEFAULT_USER_SETTINGS.fontFamily,
							fontSize: DEFAULT_USER_SETTINGS.fontSize,
							lineHeight: DEFAULT_USER_SETTINGS.lineHeight,
						})
					}
				>
					恢复默认
				</Button>
			</div>
		</div>
	);
}

// Theme Tab -----------------------------------------------------------------

interface MenuBoardThemeProps {
	settings: { theme: ThemeId };
	updateSettings: (updates: Partial<{ theme: ThemeId }>) => Promise<void>;
}

/**
 * 主题预览卡片。点击即应用; 当前激活卡片有强边框 + 右上角对勾。
 * 预览区根据主题画一个迷你窗口 (标题栏 + 内容区 + 主色按钮),
 * 让用户在不切换的情况下也能直观感受主题氛围。
 */
function ThemeCard({
	option,
	active,
	onSelect,
}: {
	option: typeof THEME_OPTIONS[number];
	active: boolean;
	onSelect: () => void;
}) {
	const { preview, id, label, description } = option;

	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				'group relative w-full rounded-xl border bg-[var(--card)] p-3 text-left transition-all',
				'hover:border-[var(--primary)]/60 hover:shadow-sm',
				active
					? 'border-[var(--primary)] ring-2 ring-[var(--primary)]/30'
					: 'border-[var(--border)]'
			)}
		>
			{/* Selected check */}
			{active && (
				<span className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
					<Check className="h-3 w-3" />
				</span>
			)}

			{/* Preview mock window */}
			<div
				className="relative h-24 w-full overflow-hidden rounded-lg border"
				style={{
					background: preview.background,
					borderColor: preview.accent,
				}}
			>
				{id === 'system' ? (
					// 「跟随系统」用左浅右深的对角分割图直观示意
					<>
						<div
							className="absolute inset-0"
							style={{
								background:
									'linear-gradient(135deg, #ffffff 0%, #ffffff 50%, #0e1014 50%, #0e1014 100%)',
							}}
						/>
						<MonitorSmartphone className="absolute top-1/2 left-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-[#7aa2ff]" />
					</>
				) : (
					<>
						{/* 标题栏 */}
						<div
							className="h-4 w-full border-b"
							style={{ background: preview.surface, borderColor: preview.accent }}
						/>
						{/* 文本行 */}
						<div className="space-y-1.5 px-2 pt-2">
							<div
								className="h-1.5 w-3/4 rounded-full"
								style={{ background: preview.accent }}
							/>
							<div
								className="h-1.5 w-1/2 rounded-full"
								style={{ background: preview.accent }}
							/>
						</div>
						{/* 主色按钮 */}
						<div
							className="absolute bottom-2 left-2 h-3 w-8 rounded-md"
							style={{ background: preview.primary }}
						/>
					</>
				)}
			</div>

			<div className="mt-2 space-y-0.5">
				<div className="text-sm font-medium text-[var(--foreground)]">{label}</div>
				<div className="text-xs text-[var(--muted-foreground)] line-clamp-1">
					{description}
				</div>
			</div>
		</button>
	);
}

export function MenuBoardTheme({ settings, updateSettings }: MenuBoardThemeProps) {
	const active = settings.theme ?? 'system';

	return (
		<div className="space-y-6 pb-16">
			<SectionHeader
				title="Theme"
				description="选择应用的整体配色; 「跟随系统」会随设备外观自动切换"
			/>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{THEME_OPTIONS.map((opt) => (
					<ThemeCard
						key={opt.id}
						option={opt}
						active={active === opt.id}
						onSelect={() => updateSettings({ theme: opt.id })}
					/>
				))}
			</div>

			<div className="flex justify-start">
				<Button
					variant="outline"
					size="sm"
					className="rounded-full px-4"
					onClick={() => updateSettings({ theme: DEFAULT_USER_SETTINGS.theme })}
				>
					恢复默认
				</Button>
			</div>
		</div>
	);
}