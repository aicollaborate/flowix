import { useCallback, useEffect, useMemo, useRef, type PointerEvent } from 'react';

export function useOverlayScrollbar() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
    maxScrollTop: number;
    thumbTravel: number;
  } | null>(null);

  const clearHideTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || dragRef.current) return;

    clearHideTimer();
    timerRef.current = window.setTimeout(() => {
      delete frame.dataset.scrolling;
      timerRef.current = null;
    }, 700);
  }, [clearHideTimer]);

  const syncOverlayScrollbar = useCallback((
    scroller: HTMLElement,
    options: { reveal?: boolean; schedule?: boolean } = {},
  ) => {
    const frame = frameRef.current;
    if (!frame) return;

    scrollerRef.current = scroller;

    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    const isScrollable = maxScrollTop > 1;

    frame.dataset.scrollable = String(isScrollable);
    if (!isScrollable) {
      frame.style.removeProperty('--overlay-scrollbar-thumb-height');
      frame.style.removeProperty('--overlay-scrollbar-thumb-top');
      return;
    }

    const thumbHeight = Math.max(
      24,
      Math.round((scroller.clientHeight / scroller.scrollHeight) * scroller.clientHeight),
    );
    const thumbTravel = Math.max(0, scroller.clientHeight - thumbHeight);
    const thumbTop = Math.round((scroller.scrollTop / maxScrollTop) * thumbTravel);

    frame.style.setProperty('--overlay-scrollbar-thumb-height', `${thumbHeight}px`);
    frame.style.setProperty('--overlay-scrollbar-thumb-top', `${thumbTop}px`);

    if (options.reveal !== false) {
      frame.dataset.scrolling = 'true';
    }

    if (options.schedule !== false) {
      scheduleHide();
    }
  }, [scheduleHide]);

  const updateOverlayScrollbar = useCallback((scroller: HTMLElement) => {
    syncOverlayScrollbar(scroller);
  }, [syncOverlayScrollbar]);

  const finishDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;

    dragRef.current = null;
    delete frameRef.current?.dataset.dragging;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    if (scrollerRef.current) {
      syncOverlayScrollbar(scrollerRef.current);
    }
  }, [syncOverlayScrollbar]);

  const overlayScrollbarThumbProps = useMemo(() => ({
    'aria-hidden': true,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      const frame = frameRef.current;
      const scroller = scrollerRef.current;
      if (!frame || !scroller || frame.dataset.scrollable !== 'true') return;

      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      const thumbHeight = Math.max(
        24,
        Math.round((scroller.clientHeight / scroller.scrollHeight) * scroller.clientHeight),
      );
      const thumbTravel = Math.max(1, scroller.clientHeight - thumbHeight);

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      clearHideTimer();

      frame.dataset.dragging = 'true';
      frame.dataset.scrolling = 'true';
      dragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: scroller.scrollTop,
        maxScrollTop,
        thumbTravel,
      };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const scroller = scrollerRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !scroller) return;

      event.preventDefault();
      const scrollDelta = ((event.clientY - drag.startY) / drag.thumbTravel) * drag.maxScrollTop;
      scroller.scrollTop = Math.max(
        0,
        Math.min(drag.startScrollTop + scrollDelta, drag.maxScrollTop),
      );
      syncOverlayScrollbar(scroller, { schedule: false });
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
  }), [clearHideTimer, finishDrag, syncOverlayScrollbar]);

  useEffect(() => {
    const handleWindowResize = () => {
      if (scrollerRef.current) {
        syncOverlayScrollbar(scrollerRef.current, { reveal: false, schedule: false });
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [syncOverlayScrollbar]);

  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, [clearHideTimer]);

  return {
    overlayScrollbarFrameRef: frameRef,
    overlayScrollbarThumbProps,
    updateOverlayScrollbar,
  };
}
