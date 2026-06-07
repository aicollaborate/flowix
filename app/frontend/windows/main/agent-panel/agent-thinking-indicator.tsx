// 流式响应等待态: 跳动的圆点 + 文字上的扫光高亮。Tailwind 不生成 keyframes,
// 故 @keyframes agentThinkingDot / agentThinkingShine 留在 index.css。
const DOT_CLASS =
	"w-2 h-2 rounded-full bg-primary animate-[agentThinkingDot_1.15s_ease-in-out_infinite]";
const TEXT_CLASS =
	"relative overflow-hidden text-[0.78rem] font-medium leading-none text-[var(--muted-foreground)] " +
	// 扫光高亮 ::after: 从左侧 -45% 滑到 115%, 灰色 -> 白色半透明 -> 灰色
	"after:content-[''] after:absolute after:-top-[20%] after:-bottom-[20%] after:left-[-45%] " +
	"after:w-[42%] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent)] " +
	"after:skew-x-[-18deg] after:animate-[agentThinkingShine_1.8s_ease-in-out_infinite]";

export function AgentThinkingIndicator() {
	return (
		<div className="px-6 py-2">
			<div className="inline-flex items-center gap-2">
				<span aria-hidden="true" className={DOT_CLASS} />
				<span className={TEXT_CLASS}>思考中</span>
			</div>
		</div>
	);
}
