import * as nip19 from 'nostr-tools/nip19';
import { KIND_REACTION, type NostrEvent } from '@hyprgate/types';
import { customEmojiForShortcodeContent, isCanonicalHexPubkey } from '@hyprgate/utils';
import { normalizeRelayHints } from './event-relay-hints';
import type { FeedEventReference } from './rendering-fallbacks';

export function reactionPresentation(event: Pick<NostrEvent, 'content' | 'tags'>) {
  if (event.content === '' || event.content === '+') return { label: 'Liked', value: '' };
  if (event.content === '-') return { label: 'Disliked', value: '' };
  const emoji = customEmojiForShortcodeContent(event.content, event.tags);
  return {
    label: 'Reacted with',
    value: event.content,
    ...(emoji?.imageUrl ? { emoji } : {}),
  };
}

export function reactionTarget(event: Pick<NostrEvent, 'kind' | 'tags'>): FeedEventReference | null {
  if (event.kind !== KIND_REACTION) return null;
  // NIP-25 puts the reaction target last; earlier e tags may describe ancestors.
  const target = event.tags.filter((tag) => tag[0] === 'e' && /^[0-9a-f]{64}$/i.test(tag[1] ?? '')).at(-1);
  if (!target) return null;
  const authors = [...new Set(event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]).filter(isCanonicalHexPubkey))];
  const author = isCanonicalHexPubkey(target[3]) ? target[3] : authors.length === 1 ? authors[0] : undefined;
  const kinds = [...new Set(event.tags
    .filter((tag) => tag[0] === 'k' && /^\d+$/.test(tag[1] ?? ''))
    .map((tag) => Number(tag[1]))
    .filter((kind) => Number.isInteger(kind) && kind >= 0 && kind <= 65535))];
  const addresses = [...new Set(event.tags.filter((tag) => tag[0] === 'a').map((tag) => tag[1]))];
  const address = addresses.length === 1 ? addresses[0]?.match(/^(3\d{4}):([0-9a-f]{64}):(.*)$/i) : null;
  const addressKind = address ? Number(address[1]) : undefined;
  const addressAuthor = address?.[2];
  const validAddress = address && (!author || author === addressAuthor)
    && (kinds.length === 0 || (kinds.length === 1 && kinds[0] === addressKind));
  const relays = normalizeRelayHints([
    target[2] ?? '',
    ...(validAddress ? event.tags.filter((tag) => tag[0] === 'a').map((tag) => tag[2] ?? '') : []),
  ]);
  let source: string | undefined;
  if (validAddress) {
    try {
      const encoded = nip19.naddrEncode({ kind: addressKind!, pubkey: addressAuthor!, identifier: address[3]!, relays });
      const decoded = nip19.decode(encoded);
      if (decoded.type === 'naddr' && decoded.data.identifier === address[3]) source = encoded;
    } catch {
      // Invalid NIP-19 hints must not hide the exact event reaction target.
    }
  }
  return {
    id: target[1]!,
    ...(source ? { source } : {}),
    ...(author ? { author } : {}),
    ...(kinds.length === 1 ? { kind: kinds[0] } : {}),
    relays,
  };
}
