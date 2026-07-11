export const FEED_RESOURCE_LOOKAHEAD = 5;
export const FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS = 80;
export const FEED_RESOURCE_VISIBILITY_MAX_WAIT_MS = 240;

type FeedEventId = { id: string };

interface FeedResourceVisibilityAction {
  update(nextEventId: string): void;
  destroy(): void;
}

export interface FeedResourceVisibilityTracker {
  track(node: Element, eventId: string): FeedResourceVisibilityAction;
  refresh(): void;
  destroy(): void;
}

export function selectResourceLoadIds(
  events: FeedEventId[],
  visibleIds: Iterable<string>,
  loadedIds: Iterable<string>,
  lookahead = FEED_RESOURCE_LOOKAHEAD,
): string[] {
  const visible = new Set(visibleIds);
  const selected = new Set(loadedIds);
  let lastVisibleIndex = -1;

  for (let index = 0; index < events.length; index++) {
    const eventId = events[index]!.id;
    if (!visible.has(eventId)) continue;
    selected.add(eventId);
    lastVisibleIndex = index;
  }

  const lookaheadCount = Math.max(0, lookahead);
  if (lastVisibleIndex >= 0 && lookaheadCount > 0) {
    const end = Math.min(events.length, lastVisibleIndex + lookaheadCount + 1);
    for (let index = lastVisibleIndex + 1; index < end; index++) {
      selected.add(events[index]!.id);
    }
  }

  const orderedIds: string[] = [];
  for (const event of events) {
    if (selected.has(event.id)) orderedIds.push(event.id);
  }
  return orderedIds;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function createFeedResourceVisibilityTracker(
  getRoot: () => Element | undefined,
  getEvents: () => FeedEventId[],
  onChange: (ids: string[]) => void,
): FeedResourceVisibilityTracker {
  const nodeEventIds = new Map<Element, string>();
  const visibleIds = new Set<string>();
  const loadedIds = new Set<string>();
  let emittedIds: string[] = [];
  let observer: IntersectionObserver | null = null;
  const observedNodes = new Set<Element>();
  let connectQueued = false;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let reconcileWindowStartedAt: number | null = null;
  let destroyed = false;

  function clearReconcileTimer(): void {
    if (reconcileTimer === null) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }

  function reconcile(): void {
    reconcileTimer = null;
    reconcileWindowStartedAt = null;
    if (destroyed) return;
    if (typeof IntersectionObserver === 'undefined') scanFallbackVisibility();
    const nextIds = selectResourceLoadIds(getEvents(), visibleIds, loadedIds);

    loadedIds.clear();
    for (const id of nextIds) loadedIds.add(id);

    if (sameIds(nextIds, emittedIds)) return;
    emittedIds = nextIds;
    onChange([...nextIds]);
  }

  function scheduleReconcile(): void {
    if (destroyed) return;
    clearReconcileTimer();

    // First visible window should start loading immediately. Later scroll
    // changes use a trailing debounce so rapid intersections cause one O(n)
    // timeline selection instead of repeated Svelte updates.
    if (emittedIds.length === 0 && visibleIds.size > 0) {
      reconcile();
      return;
    }

    reconcileWindowStartedAt ??= Date.now();
    const elapsed = Date.now() - reconcileWindowStartedAt;
    const maxWaitRemaining = Math.max(0, FEED_RESOURCE_VISIBILITY_MAX_WAIT_MS - elapsed);
    reconcileTimer = setTimeout(
      reconcile,
      Math.min(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS, maxWaitRemaining),
    );
  }

  function scanFallbackVisibility(): boolean {
    const root = getRoot();
    if (!root) return false;
    const rootRect = root.getBoundingClientRect();
    let changed = false;

    for (const [node, eventId] of nodeEventIds) {
      const rect = node.getBoundingClientRect();
      const isVisible = rect.bottom > rootRect.top
        && rect.top < rootRect.bottom
        && rect.right > rootRect.left
        && rect.left < rootRect.right;
      if (isVisible) {
        if (visibleIds.has(eventId)) continue;
        visibleIds.add(eventId);
        changed = true;
      } else if (visibleIds.delete(eventId)) {
        changed = true;
      }
    }
    return changed;
  }

  function connectNodes(): void {
    connectQueued = false;
    if (destroyed || nodeEventIds.size === 0) return;

    if (typeof IntersectionObserver === 'undefined') {
      if (scanFallbackVisibility()) scheduleReconcile();
      return;
    }

    const root = getRoot();
    if (!root) return;

    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          if (destroyed) return;
          let changed = false;
          for (const entry of entries) {
            const eventId = nodeEventIds.get(entry.target);
            if (!eventId) continue;
            if (entry.isIntersecting) {
              if (visibleIds.has(eventId)) continue;
              visibleIds.add(eventId);
              changed = true;
            } else if (visibleIds.delete(eventId)) {
              changed = true;
            }
          }
          if (changed) scheduleReconcile();
        },
        {
          root,
          rootMargin: '0px',
          threshold: 0.01,
        },
      );
    }

    for (const node of nodeEventIds.keys()) {
      if (observedNodes.has(node)) continue;
      observedNodes.add(node);
      observer.observe(node);
    }
  }

  function queueConnect(): void {
    if (destroyed || connectQueued || nodeEventIds.size === 0) return;
    connectQueued = true;
    queueMicrotask(connectNodes);
  }

  function track(node: Element, eventId: string): FeedResourceVisibilityAction {
    if (destroyed) {
      return {
        update(): void { /* no-op */ },
        destroy(): void { /* no-op */ },
      };
    }

    let currentEventId = eventId;
    nodeEventIds.set(node, currentEventId);
    if (observer) {
      observedNodes.add(node);
      observer.observe(node);
    } else {
      queueConnect();
    }

    return {
      update(nextEventId: string): void {
        if (nextEventId === currentEventId) return;
        const wasVisible = visibleIds.delete(currentEventId);
        currentEventId = nextEventId;
        nodeEventIds.set(node, currentEventId);
        if (wasVisible) visibleIds.add(currentEventId);
        scheduleReconcile();
      },
      destroy(): void {
        if (destroyed) return;
        if (observedNodes.delete(node)) observer?.unobserve(node);
        nodeEventIds.delete(node);
        const wasVisible = visibleIds.delete(currentEventId);

        if (nodeEventIds.size === 0) {
          clearReconcileTimer();
          reconcileWindowStartedAt = null;
          observer?.disconnect();
          observer = null;
          observedNodes.clear();
          return;
        }
        if (wasVisible) scheduleReconcile();
      },
    };
  }

  return {
    track,
    refresh(): void {
      if (destroyed) return;
      if (nodeEventIds.size === 0) {
        clearReconcileTimer();
        reconcileWindowStartedAt = null;
        if (emittedIds.length > 0) reconcile();
        return;
      }
      if (typeof IntersectionObserver !== 'undefined' && !observer) queueConnect();
      scheduleReconcile();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      clearReconcileTimer();
      reconcileWindowStartedAt = null;
      observer?.disconnect();
      observer = null;
      observedNodes.clear();
      nodeEventIds.clear();
      visibleIds.clear();
      loadedIds.clear();
      emittedIds = [];
      connectQueued = false;
    },
  };
}
