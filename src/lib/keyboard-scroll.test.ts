import { describe, it, expect, vi } from 'vitest';
import {
  computeScrollTop,
  isContainerScrollKey,
  makeScrollKeydownHandler,
  attachScrollKeyListener,
  PAGE_SCROLL_FRACTION,
} from './keyboard-scroll';

const metrics = { scrollTop: 1000, clientHeight: 800, scrollHeight: 5000 };
const page = 800 * PAGE_SCROLL_FRACTION;

describe('computeScrollTop', () => {
  it('PageDown advances by ~0.9 viewport, clamped to max', () => {
    expect(computeScrollTop('PageDown', metrics)).toBe(1000 + page);
    // near the bottom it clamps to scrollHeight - clientHeight
    expect(computeScrollTop('PageDown', { scrollTop: 4900, clientHeight: 800, scrollHeight: 5000 }))
      .toBe(4200);
  });

  it('PageUp retreats by ~0.9 viewport, clamped to 0', () => {
    expect(computeScrollTop('PageUp', metrics)).toBe(1000 - page);
    expect(computeScrollTop('PageUp', { scrollTop: 100, clientHeight: 800, scrollHeight: 5000 }))
      .toBe(0);
  });

  it('Home goes to 0 and End to the bottom', () => {
    expect(computeScrollTop('Home', metrics)).toBe(0);
    expect(computeScrollTop('End', metrics)).toBe(4200);
  });

  it('returns null for non-scroll keys', () => {
    expect(computeScrollTop('ArrowDown', metrics)).toBeNull();
    expect(computeScrollTop('a', metrics)).toBeNull();
  });
});

function keyEvent(key: string, opts: Partial<KeyboardEvent> = {}, target?: EventTarget): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  if (target) Object.defineProperty(ev, 'target', { value: target });
  return ev;
}

describe('isContainerScrollKey', () => {
  it('accepts bare Page/Home/End keys', () => {
    for (const key of ['PageUp', 'PageDown', 'Home', 'End']) {
      expect(isContainerScrollKey(keyEvent(key)), key).toBe(true);
    }
  });

  it('allows Shift but rejects Ctrl/Alt/Meta chords', () => {
    expect(isContainerScrollKey(keyEvent('PageDown', { shiftKey: true }))).toBe(true);
    expect(isContainerScrollKey(keyEvent('PageDown', { ctrlKey: true }))).toBe(false);
    expect(isContainerScrollKey(keyEvent('PageDown', { altKey: true }))).toBe(false);
    expect(isContainerScrollKey(keyEvent('PageDown', { metaKey: true }))).toBe(false);
  });

  it('rejects when target is a text input / editable (do not hijack typing)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isContainerScrollKey(keyEvent('PageDown', {}, input))).toBe(false);

    const ta = document.createElement('textarea');
    expect(isContainerScrollKey(keyEvent('PageDown', {}, ta))).toBe(false);

    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isContainerScrollKey(keyEvent('PageDown', {}, editable))).toBe(false);
  });

  it('rejects non-scroll keys', () => {
    expect(isContainerScrollKey(keyEvent('ArrowDown'))).toBe(false);
  });
});

describe('makeScrollKeydownHandler', () => {
  function fakeScroller(): HTMLElement {
    const el = document.createElement('div');
    Object.defineProperties(el, {
      scrollTop: { value: 1000, writable: true },
      clientHeight: { value: 800, configurable: true },
      scrollHeight: { value: 5000, configurable: true },
    });
    (el as unknown as { scrollTo: typeof el.scrollTo }).scrollTo = vi.fn((opts) => {
      if (typeof opts === 'object' && opts && 'top' in opts) {
        (el as unknown as { scrollTop: number }).scrollTop = opts.top as number;
      }
    });
    return el;
  }

  it('scrolls and preventsDefault on a handled key', () => {
    const el = fakeScroller();
    const handler = makeScrollKeydownHandler(() => el);
    const ev = keyEvent('PageDown');
    const prevent = vi.spyOn(ev, 'preventDefault');

    handler(ev);

    expect(prevent).toHaveBeenCalledOnce();
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 1000 + page, behavior: 'auto' });
  });

  it('does nothing when the scroller is not yet mounted', () => {
    const handler = makeScrollKeydownHandler(() => undefined);
    const ev = keyEvent('PageDown');
    const prevent = vi.spyOn(ev, 'preventDefault');
    handler(ev);
    expect(prevent).not.toHaveBeenCalled();
  });

  it('ignores keys typed into an input (no scroll, no preventDefault)', () => {
    const el = fakeScroller();
    const input = document.createElement('input');
    input.type = 'text';
    const handler = makeScrollKeydownHandler(() => el);
    const ev = keyEvent('PageDown', {}, input);
    const prevent = vi.spyOn(ev, 'preventDefault');
    handler(ev);
    expect(prevent).not.toHaveBeenCalled();
    expect(el.scrollTo).not.toHaveBeenCalled();
  });
});

describe('attachScrollKeyListener', () => {
  it('listens at document level so body-focused Page keys still scroll, and detaches on teardown', () => {
    const el = document.createElement('div');
    Object.defineProperties(el, {
      scrollTop: { value: 0, writable: true },
      clientHeight: { value: 600, configurable: true },
      scrollHeight: { value: 3000, configurable: true },
    });
    const scrollTo = vi.fn();
    (el as unknown as { scrollTo: typeof el.scrollTo }).scrollTo = scrollTo as never;

    const teardown = attachScrollKeyListener(() => el, document);

    // activeElement is <body> — event dispatched on body bubbles to document.
    document.body.dispatchEvent(keyEvent('PageDown'));
    expect(scrollTo).toHaveBeenCalledOnce();

    teardown();
    document.body.dispatchEvent(keyEvent('PageDown'));
    expect(scrollTo).toHaveBeenCalledOnce(); // no further calls after detach
  });
});
