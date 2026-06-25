import type { NostrEvent } from '@hyprgate/types';
import { FEED_ENGAGEMENT_TARGET_LIMIT } from './feed-engagement';

export const FEED_ENGAGEMENT_ROOT_MARGIN = '800px 0px';

export function orderedVisibleTimelineIds(
  events: Pick<NostrEvent, 'id'>[],
  visibleIds: Iterable<string>,
  limit = FEED_ENGAGEMENT_TARGET_LIMIT,
): string[] {
  if (limit <= 0) return [];
  const visible = new Set(visibleIds);
  const selected: string[] = [];

  for (const event of events) {
    if (!visible.has(event.id)) continue;
    selected.push(event.id);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function createEngagementVisibilityTracker(
  getRoot: () => Element | undefined,
  getEvents: () => Pick<NostrEvent, 'id'>[],
  getOnChange: () => ((ids: string[]) => void) | undefined,
): (node: Element, eventId: string) => { update(nextEventId: string): void; destroy(): void } {
  const visibleIds = new Set<string>();
  let emitTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleEmit(): void {
    const onChange = getOnChange();
    if (!onChange) return;
    if (emitTimer !== null) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      getOnChange()?.(orderedVisibleTimelineIds(getEvents(), visibleIds));
    }, 80);
  }

  function setVisible(eventId: string, visible: boolean): void {
    if (visible) visibleIds.add(eventId);
    else visibleIds.delete(eventId);
    scheduleEmit();
  }

  return (node: Element, eventId: string) => {
    if (!getOnChange()) {
      return {
        update(): void { /* no-op */ },
        destroy(): void { /* no-op */ },
      };
    }

    let currentEventId = eventId;
    let observer: IntersectionObserver | null = null;

    function disconnect(): void {
      observer?.disconnect();
      observer = null;
    }

    function observe(): void {
      if (typeof IntersectionObserver === 'undefined') {
        setVisible(currentEventId, true);
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          setVisible(currentEventId, entries.some((entry) => entry.isIntersecting));
        },
        {
          root: getRoot() ?? null,
          rootMargin: FEED_ENGAGEMENT_ROOT_MARGIN,
          threshold: 0.01,
        },
      );
      observer.observe(node);
    }

    observe();

    return {
      update(nextEventId: string): void {
        if (nextEventId === currentEventId) return;
        setVisible(currentEventId, false);
        currentEventId = nextEventId;
        disconnect();
        observe();
      },
      destroy(): void {
        disconnect();
        setVisible(currentEventId, false);
      },
    };
  };
}
