import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type MutableRefObject,
  type RefCallback,
  type UIEventHandler,
} from 'react';
import { cn } from '@/lib/utils';
import { useOverlayScrollbar } from '@shared/hooks';

export interface OverlayScrollbarHandle {
  update: () => void;
  getScroller: () => HTMLDivElement | null;
}

interface OverlayScrollbarProps {
  children: ReactNode;
  className?: string;
  scrollerClassName?: string;
  scrollerRef?: MutableRefObject<HTMLDivElement | null> | RefCallback<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
}

export const OverlayScrollbar = forwardRef<OverlayScrollbarHandle, OverlayScrollbarProps>(
  function OverlayScrollbar(
    {
      children,
      className,
      scrollerClassName,
      scrollerRef,
      onScroll,
    },
    ref,
  ) {
    const internalScrollerRef = useRef<HTMLDivElement | null>(null);
    const {
      overlayScrollbarFrameRef,
      overlayScrollbarThumbProps,
      updateOverlayScrollbar,
    } = useOverlayScrollbar();

    const setScrollerRef = useCallback((node: HTMLDivElement | null) => {
      internalScrollerRef.current = node;

      if (typeof scrollerRef === 'function') {
        scrollerRef(node);
      } else if (scrollerRef) {
        scrollerRef.current = node;
      }
    }, [scrollerRef]);

    const update = useCallback(() => {
      if (!internalScrollerRef.current) return;
      updateOverlayScrollbar(internalScrollerRef.current);
    }, [updateOverlayScrollbar]);

    useImperativeHandle(ref, () => ({
      update,
      getScroller: () => internalScrollerRef.current,
    }), [update]);

    useLayoutEffect(() => {
      update();
    });

    const handleScroll: UIEventHandler<HTMLDivElement> = useCallback((event) => {
      updateOverlayScrollbar(event.currentTarget);
      onScroll?.(event);
    }, [onScroll, updateOverlayScrollbar]);

    return (
      <div
        ref={overlayScrollbarFrameRef}
        className={cn('overlay-scrollbar-frame', className)}
      >
        <div
          ref={setScrollerRef}
          className={cn('overlay-scrollbar', scrollerClassName)}
          onScroll={handleScroll}
        >
          {children}
        </div>
        <div className="overlay-scrollbar-thumb" {...overlayScrollbarThumbProps} />
      </div>
    );
  },
);
