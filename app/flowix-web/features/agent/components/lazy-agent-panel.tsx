import { lazy, Suspense } from 'react';
import type { ComponentProps } from 'react';

type AgentChatRootProps = ComponentProps<
  typeof import('@features/agent/components/agent-root').AgentChatRoot
>;

const LazyAgentChatRoot = lazy(() =>
  import('@features/agent/components/agent-root').then((module) => ({
    default: module.AgentChatRoot,
  }))
);

export function LazyAgentPanel(props: AgentChatRootProps) {
  return (
    <Suspense fallback={null}>
      <LazyAgentChatRoot {...props} />
    </Suspense>
  );
}
