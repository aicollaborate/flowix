interface AgentWelcomeProps {
	onSelectPrompt?: (text: string) => void;
}

const prompts = [
	"天气应用界面",
	"电商结账页",
	"考勤系统",
	"深色模式仪表盘",
	"响应式导航",
	"卡片布局"
];

// 卡片背景 / 边框 / 文字派生自主题 token (--muted-foreground / --primary), 3 套主题都可见。
const CARD_BASE =
	"inline-flex py-2 px-4 rounded-full cursor-pointer m-1 transition-all duration-150 ease " +
	"bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] " +
	"border border-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]";
const CARD_HOVER =
	"hover:bg-[color-mix(in_oklch,var(--muted-foreground)_18%,transparent)] " +
	"hover:border-[color-mix(in_oklch,var(--primary)_60%,transparent)] " +
	"hover:-translate-y-px";

export function AgentWelcome({ onSelectPrompt }: AgentWelcomeProps) {
	const handleClick = (text: string) => {
		onSelectPrompt?.(text);
	};

	return (
		<div className="flex flex-col items-center px-8 py-4 pt-[10%] h-full w-full animate-[fadeIn_0.3s_ease-out]">
			<div className="flex flex-wrap justify-center gap-0 px-4 w-full">
				{prompts.map((text, index) => (
					<button
						key={index}
						type="button"
						className={`${CARD_BASE} ${CARD_HOVER}`}
						onClick={() => handleClick(text)}
					>
						<div className="text-[0.95rem] font-normal leading-relaxed text-[color-mix(in_oklch,var(--foreground)_80%,transparent)]">
							{text}
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
