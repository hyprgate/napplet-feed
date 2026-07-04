import type { NostrEvent } from '@hyprgate/types';

const relayHintsByEvent = new WeakMap<object, string[]>();

export function normalizeRelayHints(relays: readonly string[] | undefined | null): string[] {
  if (!relays) return [];
  const normalized: string[] = [];
  for (const relay of relays) {
    const trimmed = relay.trim();
    if (trimmed.length === 0 || normalized.includes(trimmed)) continue;
    normalized.push(trimmed);
  }
  return normalized;
}

export function rememberEventRelayHints(event: NostrEvent, relays: readonly string[] | undefined | null): void {
  const hints = normalizeRelayHints(relays);
  if (hints.length > 0) relayHintsByEvent.set(event, hints);
}

export function relayHintsForEvent(event: NostrEvent): string[] {
  return relayHintsByEvent.get(event) ?? [];
}
