import type { AgentType, AgentTypeKey } from '@/types/agent';

// Agent 图标集中管理 ─────────────────────────────────────────
// 所有 agent 类型图标统一在此处 import, 后续要换图标只改这一个文件。
// 实际静态资源:
//   - flowix-agent.png        Flowix 类型图标(从桌面导入)
//   - codex.svg               Codex CLI 品牌图标(从桌面导入)
//   - icon-claude-code.svg    Claude Code 品牌图标(备用,未接入 Type)
import flowixAgent from '@/assets/flowix-agent.png';
import iconCodex from '@/assets/codex.svg';

export const DEFAULT_AGENT_TYPE_KEY: AgentTypeKey = 'flowix';

export const AGENT_TYPES: AgentType[] = [
  {
    key: 'flowix',
    icon: flowixAgent,
    name: 'Flowix',
    desc: 'Use Flowix workspace agent',
  },
  {
    key: 'codex',
    icon: iconCodex,
    name: 'Codex',
    desc: 'Use Codex coding agent',
  },
];

export function getAgentType(typeKey: string | null | undefined): AgentType {
  return AGENT_TYPES.find((t) => t.key === typeKey) ?? AGENT_TYPES[0];
}

export function normalizeAgentTypeKey(typeKey: string | null | undefined): AgentTypeKey {
  return getAgentType(typeKey).key;
}