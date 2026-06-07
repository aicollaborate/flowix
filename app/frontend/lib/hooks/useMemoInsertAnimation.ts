'use client';

import { useCallback, useRef } from 'react';
import gsap from 'gsap';

const FLIP_DURATION = 0.3;
const ENTRANCE_DURATION = 0.3;
const FLIP_EASE = 'power3.out';
const ENTRANCE_EASE = 'power2.out';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PendingInsert {
  newId: string;
  snapshot: Map<string, number>;
}

/**
 * Manages the FLIP-style "slide-in from left" animation for a newly inserted memo card.
 *
 * Driven declaratively by the consumer:
 *   1. After the IPC that creates the new memo returns, but BEFORE the store update
 *      that re-renders the list, call `prepareForInsert(newId)` synchronously. This
 *      captures the current top-positions of every existing card into a pending ref.
 *   2. Trigger the store update that adds the new memo to the list.
 *   3. Wire a `useLayoutEffect` (depending on the list) that calls `onListRendered()`.
 *      By the time it runs, React has committed the new DOM but the browser has not
 *      yet painted — exactly the window FLIP needs to invert and play.
 *
 * Why a `useLayoutEffect`-driven hook (not `await requestAnimationFrame`)?
 *   - `useLayoutEffect` fires synchronously after commit, before the next paint. This
 *     is precisely when FLIP's Invert step must run, and the framework guarantees it.
 *   - The previous implementation used `await nextPaint()` (two rAFs) between reading
 *     new positions and applying the start transform, which let the browser paint one
 *     frame of the final layout — the "flash" the user reported.
 *
 * Existing cards slide to their new positions; the new card slides in from the left.
 * Respects `prefers-reduced-motion`.
 */
export function useMemoInsertAnimation() {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingRef = useRef<PendingInsert | null>(null);

  const registerCard = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  /**
   * Capture the current top-positions of every card EXCEPT the new one. Call this
   * synchronously after the new memo id is known and before the store update that
   * adds the new memo to the list. The snapshot is stored in a ref and consumed by
   * the next `onListRendered()` call.
   */
  const prepareForInsert = useCallback((newId: string) => {
    const snapshot = new Map<string, number>();
    cardRefs.current.forEach((el, id) => {
      if (id === newId) return;
      snapshot.set(id, el.getBoundingClientRect().top);
    });
    pendingRef.current = { newId, snapshot };
  }, []);

  /**
   * Consume the pending insert snapshot (if any) and run the FLIP animation. Call this
   * from a `useLayoutEffect` that depends on the list contents. By the time this runs,
   * the DOM has been committed to its final layout (with the new memo in place) but the
   * browser has not painted yet — so applying `gsap.fromTo` here sets the inverted
   * starting transform on the same frame the browser will first paint.
   */
  const onListRendered = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (prefersReducedMotion()) return;

    // FLIP: existing cards slide to their new positions
    cardRefs.current.forEach((el, id) => {
      const oldTop = pending.snapshot.get(id);
      if (oldTop == null) return;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      gsap.killTweensOf(el);
      gsap.fromTo(el, { y: dy }, { y: 0, duration: FLIP_DURATION, ease: FLIP_EASE });
    });

    // Entrance: new card slides in from the left
    const newEl = cardRefs.current.get(pending.newId);
    if (!newEl) return;

    newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    gsap.killTweensOf(newEl);
    gsap.fromTo(
      newEl,
      { x: -newEl.offsetWidth },
      { x: 0, duration: ENTRANCE_DURATION, ease: ENTRANCE_EASE }
    );
  }, []);

  return { listContainerRef, registerCard, prepareForInsert, onListRendered };
}
