// napplets/feed/src/lib/feed-storage.ts
// The ONE place that decides instance (per-window) vs shared (cross-window)
// storage for the feed napplet (Phase 88, FEED-05).
//
// PER-WINDOW (instance) — payload, scroll, selected nfeed d-name. Routed through
// @napplet/sdk storageInstance*; the kehto runtime transparently folds an
// `@i/<windowId>:` prefix so two feed windows cannot read each other's state
// (threat T-88-07). This is what makes two intent-opened feeds independent and
// lets a window restore ITS OWN payload/scroll across reload.
//
// SHARED (cross-window) — viewMode, showReplies, detailedReactions. Routed through the plain
// storage* helpers: one value visible to every feed window (a global UI pref).
//
// Every reader tolerates missing/corrupt persisted data (returns null/default,
// never throws) and validates the persisted payload through the same
// validateFeedIntentPayload used for the untrusted intent wire (anti-drift,
// T-88-09): a tampered/garbage localStorage value can never reach a subscription.

import type { FeedIntentPayload } from '@hyprgate/types';
import { validateFeedIntentPayload } from '@hyprgate/utils';
import {
  storageInstanceGetItem,
  storageInstanceSetItem,
  storageGetItem,
  storageSetItem,
} from '@napplet/sdk';
import type { ViewMode } from './feed-store.js';

/** Storage keys, single source of truth (the test asserts against these). */
export const FEED_STORAGE_KEYS = {
  // instance (per-window)
  payload: 'feed:payload',
  scroll: 'feed:scroll',
  selected: 'feed:selected',
  // shared (cross-window)
  viewMode: 'feed:viewMode',
  showReplies: 'feed:showReplies',
  detailedReactions: 'feed:detailedReactions',
} as const;

const VIEW_MODES: readonly ViewMode[] = ['compact', 'cards', 'terminal'];

function isViewMode(x: unknown): x is ViewMode {
  return typeof x === 'string' && (VIEW_MODES as readonly string[]).includes(x);
}

// ── Instance (per-window) ───────────────────────────────────────────────────

/**
 * Restore this window's persisted feed payload, or null when absent/corrupt or
 * structurally invalid. The persisted value is re-validated (defence in depth):
 * a corrupt or tampered store value never drives a subscription.
 */
export async function getInstancePayload(): Promise<FeedIntentPayload | null> {
  const raw = await storageInstanceGetItem(FEED_STORAGE_KEYS.payload);
  if (raw == null) return null;
  try {
    return validateFeedIntentPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist this window's active feed payload (per-window). */
export async function setInstancePayload(payload: FeedIntentPayload): Promise<void> {
  await storageInstanceSetItem(FEED_STORAGE_KEYS.payload, JSON.stringify(payload));
}

/** Restore this window's scroll offset, or null when absent/corrupt. */
export async function getInstanceScroll(): Promise<number | null> {
  const raw = await storageInstanceGetItem(FEED_STORAGE_KEYS.scroll);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Persist this window's scroll offset (per-window). */
export async function setInstanceScroll(offset: number): Promise<void> {
  await storageInstanceSetItem(FEED_STORAGE_KEYS.scroll, String(offset));
}

/** Restore this window's selected nfeed d-name, or null when absent. */
export async function getInstanceSelected(): Promise<string | null> {
  return storageInstanceGetItem(FEED_STORAGE_KEYS.selected);
}

/** Persist this window's selected nfeed d-name (per-window). */
export async function setInstanceSelected(dName: string): Promise<void> {
  await storageInstanceSetItem(FEED_STORAGE_KEYS.selected, dName);
}

// ── Shared (cross-window) ───────────────────────────────────────────────────

/** Read the shared view mode, defaulting to 'compact' (absent or out-of-enum). */
export async function getViewMode(): Promise<ViewMode> {
  const raw = await storageGetItem(FEED_STORAGE_KEYS.viewMode);
  return isViewMode(raw) ? raw : 'compact';
}

/** Persist the shared view mode (every feed window). */
export async function setViewMode(mode: ViewMode): Promise<void> {
  await storageSetItem(FEED_STORAGE_KEYS.viewMode, mode);
}

/** Read the shared show-replies pref, defaulting to false (absent or corrupt). */
export async function getShowReplies(): Promise<boolean> {
  const raw = await storageGetItem(FEED_STORAGE_KEYS.showReplies);
  return raw === 'true';
}

/** Persist the shared show-replies pref (every feed window). */
export async function setShowReplies(showReplies: boolean): Promise<void> {
  await storageSetItem(FEED_STORAGE_KEYS.showReplies, showReplies ? 'true' : 'false');
}

/** Read the shared detailed-reactions pref, defaulting to false. */
export async function getDetailedReactions(): Promise<boolean> {
  const raw = await storageGetItem(FEED_STORAGE_KEYS.detailedReactions);
  return raw === 'true';
}

/** Persist the shared detailed-reactions pref (every feed window). */
export async function setDetailedReactions(detailedReactions: boolean): Promise<void> {
  await storageSetItem(FEED_STORAGE_KEYS.detailedReactions, detailedReactions ? 'true' : 'false');
}
