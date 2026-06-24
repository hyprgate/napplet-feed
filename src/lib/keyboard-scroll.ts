/**
 * keyboard-scroll.ts — keyboard scrolling for the feed's nested scroll container.
 *
 * Issue #183: the feed app root is `overflow-hidden` and the only scroller is a
 * nested, non-focusable `<div>`. PageUp/PageDown scroll the document scrolling
 * element or the nearest scrollable ancestor of the focused element — but here the
 * document can't scroll and the scroller can't hold focus, so Page keys had nothing
 * to act on. We give the scroller `tabindex="-1"` and handle the keys explicitly so
 * scrolling works regardless of `document.activeElement`.
 *
 * This is NOT a NAP-KEYS regression: the `@napplet/shim` keys-shim forwards
 * PageUp/PageDown without `preventDefault` (no Page* binding exists in the shell
 * keymap), so the keys reach the iframe untouched — there was simply no target.
 */

/** Keys this handler acts on. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End']);

/**
 * Fraction of the viewport height a PageUp/PageDown press scrolls. Browsers
 * typically page by slightly less than a full viewport so a sliver of context
 * carries over; 0.9 mirrors that behavior.
 */
export const PAGE_SCROLL_FRACTION = 0.9;

/**
 * Compute the next scrollTop for a Page/Home/End key press, clamped to the
 * scrollable range. Pure — unit-testable without a DOM.
 *
 * @returns the target scrollTop, or `null` if the key is not a scroll key.
 */
export function computeScrollTop(
  key: string,
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
): number | null {
  const { scrollTop, clientHeight, scrollHeight } = metrics;
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const page = clientHeight * PAGE_SCROLL_FRACTION;

  let next: number;
  switch (key) {
    case 'PageDown': next = scrollTop + page; break;
    case 'PageUp':   next = scrollTop - page; break;
    case 'Home':     next = 0; break;
    case 'End':      next = maxScrollTop; break;
    default: return null;
  }
  return Math.min(maxScrollTop, Math.max(0, next));
}

/**
 * Returns true when this keydown is a scroll key that should be handled by the
 * container (and not bubble to default browser handling or the napplet shim).
 *
 * Guards:
 *  - Ignores presses that carry modifiers (Ctrl/Alt/Meta) so we don't hijack
 *    application/OS chords. (Shift is allowed — Shift+Page is still paging.)
 *  - Ignores presses originating from a text input / editable element inside the
 *    feed so typing (and the input's own caret navigation) is never hijacked.
 */
export function isContainerScrollKey(event: KeyboardEvent): boolean {
  if (!SCROLL_KEYS.has(event.key)) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  const target = event.target;
  if (target instanceof Element) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    // isContentEditable is not always implemented in jsdom — fall back to the
    // contentEditable IDL attribute so editable surfaces are reliably detected.
    if ((target as HTMLElement).isContentEditable) return false;
    const ce = (target as HTMLElement).contentEditable;
    if (ce === 'true' || ce === 'plaintext-only') return false;
  }
  return true;
}

/**
 * Build an `onkeydown` handler for the scroll container. On a handled key it
 * scrolls the element and calls `preventDefault` so nothing else acts on it.
 *
 * @param getScroller - lazy accessor for the scroll container (may be undefined
 *   before mount).
 */
export function makeScrollKeydownHandler(
  getScroller: () => HTMLElement | undefined | null,
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent): void => {
    if (!isContainerScrollKey(event)) return;
    const el = getScroller();
    if (!el) return;
    const next = computeScrollTop(event.key, {
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
    if (next === null) return;
    event.preventDefault();
    el.scrollTo({ top: next, behavior: 'auto' });
  };
}

/**
 * Attach a document-level keydown listener that scrolls the container.
 *
 * Why document-level and not the container's own `onkeydown`: when the napplet
 * iframe receives WM focus, `document.activeElement` is `<body>`, not the
 * scroller. A handler bound to the scroller only fires when focus is *inside* it,
 * so Page keys pressed with body focus would never reach it. Body keydowns bubble
 * up to `document`, so listening here makes Page/Home/End work regardless of
 * `activeElement` — while `isContainerScrollKey` still bows out when a text input
 * inside the feed is focused, preserving typing and caret navigation.
 *
 * @returns a teardown function (call from the Svelte `$effect` cleanup).
 */
export function attachScrollKeyListener(
  getScroller: () => HTMLElement | undefined | null,
  doc: Document = document,
): () => void {
  const handler = makeScrollKeydownHandler(getScroller);
  doc.addEventListener('keydown', handler);
  return () => doc.removeEventListener('keydown', handler);
}
