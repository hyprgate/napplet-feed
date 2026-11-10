import { verifyEvent } from 'nostr-tools';
import { createIntentRequest, type IntentRequest, type NostrEvent } from '@hyprgate/types';
import { KIND_NIP5D_NAMED, KIND_NIP5D_ROOT, KIND_NIP5D_SNAPSHOT } from './nip-constants.js';
import { nip5dBlossomServers, parseNip5dPresentationMedia, type Nip5dPresentationMedia } from './nip5d-presentation-media.js';
import type { Nip5dIconDeclaration } from './verified-nip5d-icon.js';
import { isSha256Hex } from './verified-blossom-blob.js';

/**
 * A NIP-5D app manifest that a note references (`nostr:naddr` for kind 35129,
 * `nostr:nevent` for 15129/5129), reduced to what an inline app card shows and
 * what NAP-INTENT needs to open it.
 */
export interface NappletEmbed {
  event: NostrEvent;
  kind: typeof KIND_NIP5D_NAMED | typeof KIND_NIP5D_ROOT | typeof KIND_NIP5D_SNAPSHOT;
  pubkey: string;
  /** `35129:<pubkey>:<d>` of the named app this manifest is or belongs to; null for root apps. */
  namedAddress: string | null;
  name: string;
  summary: string;
  required: string[];
  optional: string[];
  media: Nip5dPresentationMedia;
  icon: Nip5dIconDeclaration | null;
  /** Exact `z` + `i` contracts; a manifest without one cannot be an intent target. */
  contracts: NappletEmbedContract[];
}

export interface NappletEmbedContract {
  archetype: string;
  action: string;
  convention: string;
}

const NAPPLET_KINDS = new Set<number>([KIND_NIP5D_NAMED, KIND_NIP5D_ROOT, KIND_NIP5D_SNAPSHOT]);
const ICON_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function isNappletManifestKind(kind: number): boolean {
  return NAPPLET_KINDS.has(kind);
}

function tagValues(event: NostrEvent, name: string): string[] {
  return [...new Set(event.tags
    .filter((tag) => tag[0] === name && typeof tag[1] === 'string')
    .map((tag) => tag[1]!.trim())
    .filter(Boolean))];
}

function firstTag(event: NostrEvent, name: string): string | undefined {
  return tagValues(event, name)[0];
}

function titleFromIdentifier(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (letter) => letter.toUpperCase()) : '';
}

function summaryFrom(description: string): string {
  const line = description.split(/\n+/).map((part) => part.trim()).find(Boolean) ?? '';
  const sentence = line.match(/^(.{0,140}?[.!?])(\s|$)/)?.[1] ?? line;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

/** A snapshot names its parent with exactly one `a` tag; only a named parent can be hinted. */
function namedAddressFor(event: NostrEvent): string | null {
  if (event.kind === KIND_NIP5D_NAMED) {
    const d = event.tags.find((tag) => tag[0] === 'd')?.[1];
    return d ? `${KIND_NIP5D_NAMED}:${event.pubkey}:${d}` : null;
  }
  if (event.kind !== KIND_NIP5D_SNAPSHOT) return null;
  const parents = event.tags.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string');
  if (parents.length !== 1) return null;
  const [kind, pubkey, ...rest] = parents[0]![1]!.split(':');
  const d = rest.join(':');
  return kind === String(KIND_NIP5D_NAMED) && pubkey === event.pubkey && d ? parents[0]![1]! : null;
}

/**
 * Pair `i` conventions with advertised `z` roles exactly as NAP-INTENT
 * requires: an `i` without its role, or a role without an `i`, is no contract.
 */
export function nappletEmbedContracts(event: NostrEvent): NappletEmbedContract[] {
  const roles = new Set(tagValues(event, 'z'));
  const contracts = new Map<string, NappletEmbedContract>();
  for (const tag of event.tags) {
    if (tag[0] !== 'i' || typeof tag[1] !== 'string') continue;
    const match = /^napplet:([^/]+)\/([^/?#]+)$/.exec(tag[1]);
    if (!match || !roles.has(match[1]!)) continue;
    const request = createIntentRequest({ archetype: match[1]!, convention: tag[1] });
    if (request) contracts.set(request.convention, { archetype: request.archetype, action: request.action, convention: request.convention });
  }
  return [...contracts.values()];
}

/** Prefer an `open` contract so the card opens the app rather than triggering another action. */
export function nappletEmbedOpenContract(embed: Pick<NappletEmbed, 'contracts'>): NappletEmbedContract | null {
  return embed.contracts.find((contract) => contract.action === 'open') ?? embed.contracts[0] ?? null;
}

export function parseNappletEmbed(event: NostrEvent): NappletEmbed | null {
  if (!isNappletManifestKind(event.kind)) return null;
  const hashes = event.tags.filter((tag) => tag[0] === 'x');
  if (hashes.length !== 1 || !isSha256Hex(hashes[0]![1])) return null;
  const namedAddress = namedAddressFor(event);
  const identifier = namedAddress?.split(':').slice(2).join(':') ?? '';
  const iconTag = event.tags.find((tag) => tag[0] === 'icon');
  const servers = nip5dBlossomServers(event);
  const icon = iconTag?.length === 3 && isSha256Hex(iconTag[1]) && ICON_TYPES.has(iconTag[2]!) && servers.length > 0
    ? { hash: iconTag[1]!, mimeType: iconTag[2] as Nip5dIconDeclaration['mimeType'], servers }
    : null;
  return {
    event,
    kind: event.kind as NappletEmbed['kind'],
    pubkey: event.pubkey,
    namedAddress,
    name: firstTag(event, 'title') ?? firstTag(event, 'name') ?? (titleFromIdentifier(identifier) || 'Untitled app'),
    summary: summaryFrom(event.content.trim()),
    required: tagValues(event, 'R'),
    optional: tagValues(event, 'O').filter((domain) => !tagValues(event, 'R').includes(domain)),
    media: parseNip5dPresentationMedia(event),
    icon,
    contracts: nappletEmbedContracts(event),
  };
}

/**
 * Parse only a correctly signed manifest. nostr-tools caches verification on a
 * symbol that object spread copies, so verify a clean copy of the signed fields.
 */
export function parseVerifiedNappletEmbed(event: NostrEvent): NappletEmbed | null {
  const { id, pubkey, created_at, kind, tags, content, sig } = event;
  try {
    if (!verifyEvent({ id, pubkey, created_at, kind, tags, content, sig })) return null;
  } catch {
    return null;
  }
  return parseNappletEmbed({ id, pubkey, created_at, kind, tags, content, sig });
}

/**
 * Build the open request for an embedded app: its own advertised convention
 * plus a NAP-INTENT `handlerHint` naming it. The shell decides which handler
 * runs (the user's default still wins) and whether to offer installation.
 */
export function createNappletEmbedIntentRequest(
  embed: NappletEmbed,
  relays: readonly string[] = [],
): IntentRequest | null {
  const contract = nappletEmbedOpenContract(embed);
  if (!contract) return null;
  const hintRelays = [...new Set(relays.filter((relay) => /^wss?:\/\//.test(relay)))];
  return createIntentRequest({
    archetype: contract.archetype,
    convention: contract.convention,
    ...(embed.namedAddress
      ? { handlerHint: { address: embed.namedAddress, ...(hintRelays.length > 0 ? { relays: hintRelays } : {}) } }
      : {}),
    behavior: { focus: true },
  });
}
