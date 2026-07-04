// napplets/feed/src/lib/feed-storage.test.ts
// Unit tests for the feed-storage wrapper (Phase 88, FEED-05).
//
// The wrapper centralizes the instance-vs-shared storage decision:
//   - PER-WINDOW (instance) state: payload, scroll, selected nfeed d-name.
//     Routed through @napplet/sdk storageInstance* (the kehto runtime folds an
//     @i/<windowId>: prefix transparently → windows cannot read each other's
//     state, threat T-88-07).
//   - SHARED (cross-window) prefs: viewMode, showReplies. Routed through the
//     plain storage* helpers (one value for every feed window).
//
// vi.mock('@napplet/sdk') is hoisted; the factory installs spy-backed
// instance/shared stores so a single test can assert the correct routing AND
// that corrupt JSON is tolerated (returns null/default, never throws).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedIntentPayload } from '@hyprgate/types';

// ─── Mock @napplet/sdk storage helpers ──────────────────────────────────────
// Two independent backing maps prove instance vs shared writes never collide.

const instanceStore = new Map<string, string>();
const sharedStore = new Map<string, string>();

vi.mock('@napplet/sdk', () => ({
  storageInstanceGetItem: vi.fn(async (k: string) => instanceStore.get(k) ?? null),
  storageInstanceSetItem: vi.fn(async (k: string, v: string) => {
    instanceStore.set(k, v);
  }),
  storageInstanceRemoveItem: vi.fn(async (k: string) => {
    instanceStore.delete(k);
  }),
  storageInstanceKeys: vi.fn(async () => [...instanceStore.keys()]),
  storageGetItem: vi.fn(async (k: string) => sharedStore.get(k) ?? null),
  storageSetItem: vi.fn(async (k: string, v: string) => {
    sharedStore.set(k, v);
  }),
  storageRemoveItem: vi.fn(async (k: string) => {
    sharedStore.delete(k);
  }),
  storageKeys: vi.fn(async () => [...sharedStore.keys()]),
}));

import {
  getInstancePayload,
  setInstancePayload,
  getInstanceScroll,
  setInstanceScroll,
  getInstanceSelected,
  setInstanceSelected,
  getViewMode,
  setViewMode,
  getShowReplies,
  setShowReplies,
  getDetailedReactions,
  setDetailedReactions,
  FEED_STORAGE_KEYS,
} from './feed-storage';
import {
  storageInstanceGetItem,
  storageInstanceSetItem,
  storageGetItem,
  storageSetItem,
} from '@napplet/sdk';

const PAYLOAD: FeedIntentPayload = {
  filters: [{ kinds: [1], '#t': ['nostr'] }],
  origin: 'outbox',
  title: 'Nostr',
};

beforeEach(() => {
  instanceStore.clear();
  sharedStore.clear();
  vi.clearAllMocks();
});

describe('feed-storage — instance (per-window) scope', () => {
  it('round-trips the payload via storageInstance*', async () => {
    await setInstancePayload(PAYLOAD);
    // Written through the INSTANCE store, not the shared one.
    expect(storageInstanceSetItem).toHaveBeenCalledWith(FEED_STORAGE_KEYS.payload, expect.any(String));
    expect(sharedStore.size).toBe(0);

    const restored = await getInstancePayload();
    expect(storageInstanceGetItem).toHaveBeenCalledWith(FEED_STORAGE_KEYS.payload);
    expect(restored).toEqual(PAYLOAD);
  });

  it('round-trips scroll position via the instance store', async () => {
    await setInstanceScroll(420);
    expect(await getInstanceScroll()).toBe(420);
    // Did NOT leak into the shared store.
    expect(sharedStore.has(FEED_STORAGE_KEYS.scroll)).toBe(false);
  });

  it('round-trips the selected nfeed d-name via the instance store', async () => {
    await setInstanceSelected('morning-reads');
    expect(await getInstanceSelected()).toBe('morning-reads');
  });

  it('returns null for a missing instance payload', async () => {
    expect(await getInstancePayload()).toBeNull();
  });

  it('tolerates corrupt instance payload JSON (returns null, never throws)', async () => {
    instanceStore.set(FEED_STORAGE_KEYS.payload, '{not valid json');
    await expect(getInstancePayload()).resolves.toBeNull();
  });

  it('drops a structurally-invalid persisted payload (validateFeedIntentPayload)', async () => {
    // Valid JSON, but not a valid FeedIntentPayload (empty filters).
    instanceStore.set(FEED_STORAGE_KEYS.payload, JSON.stringify({ filters: [], origin: 'outbox' }));
    await expect(getInstancePayload()).resolves.toBeNull();
  });

  it('tolerates corrupt scroll JSON (returns null)', async () => {
    instanceStore.set(FEED_STORAGE_KEYS.scroll, 'NaN-ish');
    await expect(getInstanceScroll()).resolves.toBeNull();
  });
});

describe('feed-storage — shared (cross-window) scope', () => {
  it('round-trips viewMode via the SHARED store, not the instance one', async () => {
    await setViewMode('cards');
    expect(storageSetItem).toHaveBeenCalledWith(FEED_STORAGE_KEYS.viewMode, 'cards');
    expect(instanceStore.size).toBe(0);
    expect(await getViewMode()).toBe('cards');
    expect(storageGetItem).toHaveBeenCalledWith(FEED_STORAGE_KEYS.viewMode);
  });

  it('defaults viewMode to "compact" when unset', async () => {
    expect(await getViewMode()).toBe('compact');
  });

  it('ignores an out-of-enum persisted viewMode and returns the default', async () => {
    sharedStore.set(FEED_STORAGE_KEYS.viewMode, 'galaxy-brain');
    expect(await getViewMode()).toBe('compact');
  });

  it('round-trips showReplies via the SHARED store', async () => {
    await setShowReplies(true);
    expect(await getShowReplies()).toBe(true);
    expect(instanceStore.has(FEED_STORAGE_KEYS.showReplies)).toBe(false);
  });

  it('defaults showReplies to false when unset', async () => {
    expect(await getShowReplies()).toBe(false);
  });

  it('tolerates corrupt showReplies JSON (returns default false)', async () => {
    sharedStore.set(FEED_STORAGE_KEYS.showReplies, 'maybe');
    await expect(getShowReplies()).resolves.toBe(false);
  });

  it('round-trips detailedReactions via the SHARED store', async () => {
    await setDetailedReactions(true);
    expect(await getDetailedReactions()).toBe(true);
    expect(instanceStore.has(FEED_STORAGE_KEYS.detailedReactions)).toBe(false);
  });

  it('defaults detailedReactions to false when unset or corrupt', async () => {
    expect(await getDetailedReactions()).toBe(false);
    sharedStore.set(FEED_STORAGE_KEYS.detailedReactions, 'maybe');
    await expect(getDetailedReactions()).resolves.toBe(false);
  });
});

describe('feed-storage — scope isolation', () => {
  it('instance and shared keys never collide across the two stores', async () => {
    await setInstancePayload(PAYLOAD);
    await setInstanceScroll(10);
    await setInstanceSelected('feed-a');
    await setViewMode('terminal');
    await setShowReplies(true);
    await setDetailedReactions(true);

    // Every instance key landed in the instance store only.
    expect([...instanceStore.keys()].sort()).toEqual(
      [FEED_STORAGE_KEYS.payload, FEED_STORAGE_KEYS.scroll, FEED_STORAGE_KEYS.selected].sort(),
    );
    // Every shared key landed in the shared store only.
    expect([...sharedStore.keys()].sort()).toEqual(
      [FEED_STORAGE_KEYS.viewMode, FEED_STORAGE_KEYS.showReplies, FEED_STORAGE_KEYS.detailedReactions].sort(),
    );
  });
});
