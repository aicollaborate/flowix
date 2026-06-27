import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type UseResizablePanelsOptions = {
  agentColWidth: number;
  agentPanelVisible: boolean;
  memoListVisible: boolean;
  setAgentColWidth: (width: number) => void;
  setMemoListVisible: (visible: boolean) => void;
};

export function useResizablePanels({
  agentColWidth,
  agentPanelVisible,
  memoListVisible,
  setAgentColWidth,
  setMemoListVisible,
}: UseResizablePanelsOptions) {
  const [memoColWidth, setMemoColWidth] = useState(320);
  const [agentPanelDraftWidth, setAgentPanelDraftWidth] = useState(agentColWidth);
  const [isDraggingListDivider, setIsDraggingListDivider] = useState(false);
  const [isDraggingAgentDivider, setIsDraggingAgentDivider] = useState(false);

  const listDividerStartRef = useRef({ x: 0, width: 0 });
  const agentDividerStartRef = useRef({ x: 0, width: agentColWidth });
  const agentPanelDraftWidthRef = useRef(agentColWidth);
  const prevAgentPanelVisibleRef = useRef(agentPanelVisible);

  const isMemoListHidden = !memoListVisible;
  const memoListWidth = isMemoListHidden ? 0 : memoColWidth;
  const agentPanelWidth = agentPanelVisible ? agentPanelDraftWidth : 0;

  useEffect(() => {
    if (isDraggingAgentDivider) return;
    setAgentPanelDraftWidth(agentColWidth);
    agentPanelDraftWidthRef.current = agentColWidth;
  }, [agentColWidth, isDraggingAgentDivider]);

  const handleListDividerMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setIsDraggingListDivider(true);
    listDividerStartRef.current = { x: event.clientX, width: memoColWidth };
  }, [memoColWidth]);

  const handleAgentDividerMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setIsDraggingAgentDivider(true);
    agentDividerStartRef.current = { x: event.clientX, width: agentPanelDraftWidth };
    agentPanelDraftWidthRef.current = agentPanelDraftWidth;
  }, [agentPanelDraftWidth]);

  useEffect(() => {
    if (!isDraggingListDivider && !isDraggingAgentDivider) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (isDraggingListDivider) {
        const diff = event.clientX - listDividerStartRef.current.x;
        const nextWidth = listDividerStartRef.current.width + diff;
        if (nextWidth >= 150 && nextWidth <= 500) {
          setMemoColWidth(nextWidth);
        }
      }

      if (isDraggingAgentDivider) {
        const diff = agentDividerStartRef.current.x - event.clientX;
        const nextWidth = agentDividerStartRef.current.width + diff;
        if (nextWidth >= 200 && nextWidth <= 600) {
          agentPanelDraftWidthRef.current = nextWidth;
          setAgentPanelDraftWidth(nextWidth);
        }
      }
    };

    const handleMouseUp = () => {
      if (isDraggingAgentDivider) {
        setAgentColWidth(agentPanelDraftWidthRef.current);
      }
      setIsDraggingListDivider(false);
      setIsDraggingAgentDivider(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingListDivider, isDraggingAgentDivider, setAgentColWidth]);

  useEffect(() => {
    if (
      agentPanelVisible &&
      !prevAgentPanelVisibleRef.current &&
      window.innerWidth < 1100 &&
      memoListVisible
    ) {
      setMemoListVisible(false);
    }
    prevAgentPanelVisibleRef.current = agentPanelVisible;
  }, [agentPanelVisible, memoListVisible, setMemoListVisible]);

  return {
    agentPanelDraftWidth,
    agentPanelWidth,
    handleAgentDividerMouseDown,
    handleListDividerMouseDown,
    isDraggingAgentDivider,
    isDraggingListDivider,
    isMemoListHidden,
    memoColWidth,
    memoListWidth,
  };
}
