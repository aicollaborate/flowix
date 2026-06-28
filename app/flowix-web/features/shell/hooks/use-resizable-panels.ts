import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

type UseResizablePanelsOptions = {
  agentColWidth: number;
  agentPanelVisible: boolean;
  documentPanelMinWidth: number;
  memoListVisible: boolean;
  noteNavigationWidth: number;
  setAgentColWidth: (width: number) => void;
  setMemoListVisible: (visible: boolean) => void;
};

const MEMO_LIST_DEFAULT_WIDTH = 320;
const MEMO_LIST_MIN_WIDTH = 255;
const MEMO_LIST_MAX_WIDTH = 500;
const AGENT_PANEL_MIN_WIDTH = 200;
const AGENT_PANEL_MAX_WIDTH = 600;
const PANEL_DIVIDER_WIDTH = 1;

export function useResizablePanels({
  agentColWidth,
  agentPanelVisible,
  documentPanelMinWidth,
  memoListVisible,
  noteNavigationWidth,
  setAgentColWidth,
  setMemoListVisible,
}: UseResizablePanelsOptions) {
  const [memoColWidth, setMemoColWidth] = useState(MEMO_LIST_DEFAULT_WIDTH);
  const [agentPanelDraftWidth, setAgentPanelDraftWidth] = useState(agentColWidth);
  const [isDraggingListDivider, setIsDraggingListDivider] = useState(false);
  const [isDraggingAgentDivider, setIsDraggingAgentDivider] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(() => window.innerWidth);

  const listDividerStartRef = useRef({ x: 0, width: 0 });
  const agentDividerStartRef = useRef({ x: 0, width: agentColWidth });
  const agentPanelDraftWidthRef = useRef(agentColWidth);
  const prevAgentPanelVisibleRef = useRef(agentPanelVisible);

  const isMemoListHidden = !memoListVisible;
  const memoListWidth = isMemoListHidden ? 0 : memoColWidth;
  const agentPanelWidth = agentPanelVisible ? agentPanelDraftWidth : 0;

  const visibleDividerWidth =
    (noteNavigationWidth > 0 ? PANEL_DIVIDER_WIDTH : 0) +
    (!isMemoListHidden ? PANEL_DIVIDER_WIDTH : 0) +
    (agentPanelVisible ? PANEL_DIVIDER_WIDTH : 0);
  const sidePanelsAvailableWidth = Math.max(
    0,
    layoutWidth - noteNavigationWidth - documentPanelMinWidth - visibleDividerWidth,
  );

  const getMemoListMaxWidth = useCallback((nextAgentPanelWidth = agentPanelWidth) => (
    Math.min(
      MEMO_LIST_MAX_WIDTH,
      Math.max(MEMO_LIST_MIN_WIDTH, sidePanelsAvailableWidth - nextAgentPanelWidth),
    )
  ), [agentPanelWidth, sidePanelsAvailableWidth]);

  const getAgentPanelMaxWidth = useCallback((nextMemoListWidth = memoListWidth) => (
    Math.min(
      AGENT_PANEL_MAX_WIDTH,
      Math.max(AGENT_PANEL_MIN_WIDTH, sidePanelsAvailableWidth - nextMemoListWidth),
    )
  ), [memoListWidth, sidePanelsAvailableWidth]);

  const clampMemoListWidth = useCallback((width: number) => (
    Math.min(getMemoListMaxWidth(), Math.max(MEMO_LIST_MIN_WIDTH, width))
  ), [getMemoListMaxWidth]);

  const clampAgentPanelWidth = useCallback((width: number) => (
    Math.min(getAgentPanelMaxWidth(), Math.max(AGENT_PANEL_MIN_WIDTH, width))
  ), [getAgentPanelMaxWidth]);

  useEffect(() => {
    const handleResize = () => setLayoutWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isDraggingAgentDivider) return;
    const nextWidth = clampAgentPanelWidth(agentColWidth);
    setAgentPanelDraftWidth(nextWidth);
    agentPanelDraftWidthRef.current = nextWidth;
  }, [agentColWidth, clampAgentPanelWidth, isDraggingAgentDivider]);

  useEffect(() => {
    setMemoColWidth((width) => clampMemoListWidth(width));
  }, [clampMemoListWidth]);

  useEffect(() => {
    if (isDraggingAgentDivider) return;
    setAgentPanelDraftWidth((width) => {
      const nextWidth = clampAgentPanelWidth(width);
      agentPanelDraftWidthRef.current = nextWidth;
      return nextWidth;
    });
  }, [clampAgentPanelWidth, isDraggingAgentDivider]);

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
        setMemoColWidth(clampMemoListWidth(nextWidth));
      }

      if (isDraggingAgentDivider) {
        const diff = agentDividerStartRef.current.x - event.clientX;
        const nextWidth = agentDividerStartRef.current.width + diff;
        const clampedWidth = clampAgentPanelWidth(nextWidth);
        agentPanelDraftWidthRef.current = clampedWidth;
        setAgentPanelDraftWidth(clampedWidth);
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
  }, [clampAgentPanelWidth, clampMemoListWidth, isDraggingListDivider, isDraggingAgentDivider, setAgentColWidth]);

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
