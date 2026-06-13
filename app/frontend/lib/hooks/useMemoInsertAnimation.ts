'use client';

import { useCallback, useRef } from 'react';
import gsap from 'gsap';

const ENTRANCE_DURATION = 0.3;
const ENTRANCE_EASE = 'power2.out';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PendingInsert {
  newId: string;
  attempts: number;
}

/**
 * Lightweight create animation for a newly inserted memo card.
 *
 * The hook deliberately avoids smooth scrolling and whole-list FLIP animation. Those
 * made creation feel like a list refresh because scrolling, card movement, selection,
 * and editor loading all happened at once. This hook only ensures the new card is
 * visible, then animates that card's first paint.
 */
export function useMemoInsertAnimation() {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingRef = useRef<PendingInsert | null>(null);

  const registerCard = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const prepareForInsert = useCallback((newId: string) => {
    pendingRef.current = { newId, attempts: 0 };
  }, []);

  const onListRendered = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;

    const newEl = cardRefs.current.get(pending.newId);
    if (!newEl) {
      pending.attempts += 1;
      if (pending.attempts > 2) {
        pendingRef.current = null;
      }
      return;
    }

    pendingRef.current = null;

    const container = listContainerRef.current;
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const cardRect = newEl.getBoundingClientRect();
      const margin = 12;

      if (cardRect.top < containerRect.top + margin) {
        container.scrollTop -= containerRect.top + margin - cardRect.top;
      } else if (cardRect.bottom > containerRect.bottom - margin) {
        container.scrollTop += cardRect.bottom - (containerRect.bottom - margin);
      }
    }

    if (prefersReducedMotion()) return;

    gsap.killTweensOf(newEl);
    gsap.fromTo(
      newEl,
      { autoAlpha: 0, x: -36, scale: 0.985 },
      {
        autoAlpha: 1,
        x: 0,
        scale: 1,
        duration: ENTRANCE_DURATION,
        ease: ENTRANCE_EASE,
        clearProps: 'opacity,visibility,transform',
      }
    );
  }, []);

  return { listContainerRef, registerCard, prepareForInsert, onListRendered };
}
