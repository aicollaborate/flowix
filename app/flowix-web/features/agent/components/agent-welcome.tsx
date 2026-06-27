interface AgentWelcomeProps {
	onSelectPrompt?: (text: string) => void;
}

import { useI18n, type I18nKey } from "@features/i18n";

// 围绕"记忆写作"起步的几类常用条目: SOP / 规范 / 路书 / 待办 / 复盘 / 摘录。
const PROMPT_KEYS: I18nKey[] = [
	"agent.welcome.prompts.sop",
	"agent.welcome.prompts.designSystem",
	"agent.welcome.prompts.cityWalk",
	"agent.welcome.prompts.dailyTodo",
	"agent.welcome.prompts.retrospective",
	"agent.welcome.prompts.bookNotes",
];

// 卡片背景 / 边框 / 文字派生自主题 token (--muted-foreground / --primary), 3 套主题都可见。
const CARD_BASE =
	"inline-flex py-1 px-4 rounded-full cursor-pointer m-1 transition-all duration-150 ease " +
	"bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] " +
	"border border-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]";
const CARD_HOVER =
	"hover:bg-[color-mix(in_oklch,var(--muted-foreground)_18%,transparent)] " +
	"hover:border-[color-mix(in_oklch,var(--primary)_60%,transparent)] " +
	"hover:-translate-y-px";

export function AgentWelcome({ onSelectPrompt }: AgentWelcomeProps) {
	const { t } = useI18n();
	const handleClick = (text: string) => {
		onSelectPrompt?.(text);
	};

	// 父容器是 flex-1 的滚动区, 这里用 flex + h-full 把卡片在 Agent 面板
	// 内容区(标题栏与输入框之间)做上下居中, 避免顶部 10% padding 这种近似。
	return (
		<div className="flex items-center justify-center h-full w-full px-8 animate-[fadeIn_0.3s_ease-out]">
			<div className="flex flex-wrap justify-center gap-0 px-4 w-full">
				{PROMPT_KEYS.map((key) => {
					const text = t(key);
					return (
						<button
							key={key}
							type="button"
							className={`${CARD_BASE} ${CARD_HOVER}`}
							onClick={() => handleClick(text)}
						>
							<div className="text-sm font-normal leading-relaxed text-[color-mix(in_oklch,var(--agent-foreground)_80%,transparent)]">
								{text}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
