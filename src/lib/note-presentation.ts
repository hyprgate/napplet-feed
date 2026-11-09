import type { NostrEvent } from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';
import {
  createNoteViewerOpenPayload,
  formatMillisatsAsSats,
  parseNoteViewerReply,
  type NoteViewerOpenPayload,
  type NoteViewerOpenTarget,
  type NoteViewerTargetReference,
} from "@hyprgate/utils";

export interface EngagementCounts {
  reactions: number;
  reactionGroups?: Array<{
    content: string;
    count: number;
  }>;
  comments: number;
  zaps: number;
  zapMillisats?: number;
}

export const DEFAULT_NOTE_TRUNCATE_CHARS = 420;
export const DEFAULT_NOTE_TRUNCATE_LINES = 8;

export function shouldTruncateContent(
  content: string,
  maxChars = DEFAULT_NOTE_TRUNCATE_CHARS,
  maxLines = DEFAULT_NOTE_TRUNCATE_LINES,
): boolean {
  return content.length > maxChars || content.split(/\r\n|\r|\n/).length > maxLines;
}

export function previewContent(
  content: string,
  maxChars = DEFAULT_NOTE_TRUNCATE_CHARS,
  maxLines = DEFAULT_NOTE_TRUNCATE_LINES,
): string {
  if (!shouldTruncateContent(content, maxChars, maxLines)) return content;

  const lines = content.split(/\r\n|\r|\n/);
  const lineBounded = lines.slice(0, maxLines).join('\n');
  const bounded = lineBounded.length > maxChars ? lineBounded.slice(0, maxChars) : lineBounded;
  return `${bounded.trimEnd()}...`;
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function terminalEngagementLabel(counts: EngagementCounts | undefined): string {
  const value = counts ?? { reactions: 0, comments: 0, zaps: 0, zapMillisats: 0 };
  const parts: string[] = [];
  if (value.reactionGroups && value.reactionGroups.length > 0) {
    parts.push(value.reactionGroups.map((group) => `${group.content} ${group.count}`).join(' '));
  } else if (value.reactions > 0) {
    parts.push(`${value.reactions} react`);
  }
  if (value.comments > 0) parts.push(`${value.comments} reply`);
  if (value.zaps > 0) parts.push(`${value.zaps} zap ${formatMillisatsAsSats(value.zapMillisats ?? 0)}`);
  return parts.join(' / ');
}

/** Terminal rows are plain text, so mentions need their label written in. */
export function labelTerminalMentions(content: string, profileLabel: (pubkey: string) => string): string {
  return content.replace(/nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)/g, (source, entity: string) => {
    try {
      const decoded = nip19.decode(entity);
      if (decoded.type === 'npub') return `@${profileLabel(decoded.data)}`;
      if (decoded.type === 'nprofile') return `@${profileLabel(decoded.data.pubkey)}`;
    } catch {
      // Malformed entities stay as written.
    }
    return source;
  });
}

const STANDALONE_IMAGE_LINE = /^\s*https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:[?#]\S*)?\s*$/i;

/**
 * Images render as blocks with their own margin, so the blank lines people leave
 * around an image URL only add a gap under the text. Other whitespace is untouched.
 */
export function tightenImageSpacing(content: string): string {
  const lines = content.split(/\r\n|\r|\n/);
  const kept = lines.filter((line, index) => {
    if (line.trim() !== '') return true;
    const isBlank = (value: string | undefined) => value !== undefined && value.trim() === '';
    let before = index - 1;
    while (isBlank(lines[before])) before -= 1;
    let after = index + 1;
    while (isBlank(lines[after])) after += 1;
    return !STANDALONE_IMAGE_LINE.test(lines[before] ?? '') && !STANDALONE_IMAGE_LINE.test(lines[after] ?? '');
  });
  return kept.join('\n').replace(/\s+$/, '');
}

export interface ReplyContextDisplay {
  kind: 'kind1' | 'nip22';
  label: string;
  parent: ReplyContextReferenceDisplay;
  root: ReplyContextReferenceDisplay | null;
}

export interface ReplyContextReferenceDisplay {
  label: string;
  title: string;
  reference: NoteViewerTargetReference;
  target: NoteViewerOpenTarget | null;
  relays: string[];
}

export function replyContextForEvent(event: Pick<NostrEvent, 'kind' | 'tags'>): ReplyContextDisplay | null {
  const reply = parseNoteViewerReply(event);
  if (!reply) return null;

  if (reply.type === 'kind1-reply') {
    const parent = eventReferenceDisplay(reply.parent);
    const root = eventReferenceDisplay(reply.root);
    return {
      kind: 'kind1',
      label: 'Reply',
      parent,
      root: referenceKey(root.reference) !== referenceKey(parent.reference) ? root : null,
    };
  }

  const parent = targetReferenceDisplay(reply.parent, reply.parentKind, reply.parentPubkey);
  const root = targetReferenceDisplay(reply.root, reply.rootKind, reply.rootPubkey);
  return {
    kind: 'nip22',
    label: 'Comment',
    parent,
    root: referenceKey(root.reference) !== referenceKey(parent.reference) ? root : null,
  };
}

/**
 * Who the reply answers: the author hint on the parent reference, else the only
 * `p` tag. Several `p` tags don't say which one wrote the parent, so no guess.
 */
export function replyTargetPubkey(
  event: Pick<NostrEvent, 'tags'>,
  context: ReplyContextDisplay,
): string | null {
  const hinted = context.parent.target?.pubkey;
  if (hinted) return hinted;
  const mentioned = new Set(event.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]));
  return mentioned.size === 1 ? [...mentioned][0] ?? null : null;
}

export function isReplyEvent(event: Pick<NostrEvent, 'kind' | 'tags'>): boolean {
  return replyContextForEvent(event) !== null;
}

export function createReplyReferenceOpenPayload(reference: ReplyContextReferenceDisplay): NoteViewerOpenPayload | null {
  if (!reference.target) return null;
  return createNoteViewerOpenPayload({
    target: reference.target,
    relays: reference.relays,
    behavior: { focus: true },
    source: { napplet: 'feed' },
  });
}

function eventReferenceDisplay(reference: Extract<NoteViewerTargetReference, { type: 'event' }>): ReplyContextReferenceDisplay {
  const relays = reference.relay ? [reference.relay] : [];
  const nip19 = eventNip19(reference);
  return {
    label: compactNip19(nip19),
    title: nip19,
    reference,
    target: {
      type: 'event',
      id: reference.id,
      ...(reference.kind !== undefined ? { kind: reference.kind } : {}),
      ...(reference.pubkey !== undefined ? { pubkey: reference.pubkey } : {}),
      nip19,
    },
    relays,
  };
}

function targetReferenceDisplay(reference: NoteViewerTargetReference, kind?: number, pubkey?: string): ReplyContextReferenceDisplay {
  if (reference.type === 'address') return addressReferenceDisplay(reference, kind, pubkey);
  return eventReferenceDisplay({
    ...reference,
    ...(reference.kind !== undefined ? {} : kind !== undefined ? { kind } : {}),
    ...(reference.pubkey !== undefined ? {} : pubkey !== undefined ? { pubkey } : {}),
  });
}

function addressReferenceDisplay(reference: Extract<NoteViewerTargetReference, { type: 'address' }>, kind?: number, pubkey?: string): ReplyContextReferenceDisplay {
  const decoded = parseAddressReference(reference.address, kind, pubkey);
  const relays = reference.relay ? [reference.relay] : [];
  if (!decoded) {
    return {
      label: reference.address,
      title: reference.address,
      reference,
      target: null,
      relays,
    };
  }

  const nip19 = addressNip19(reference, decoded);
  return {
    label: compactNip19(nip19),
    title: nip19,
    reference: {
      ...reference,
      kind: decoded.kind,
      pubkey: decoded.pubkey,
    },
    target: {
      type: 'address',
      kind: decoded.kind,
      pubkey: decoded.pubkey,
      identifier: decoded.identifier,
      nip19,
    },
    relays,
  };
}

function eventNip19(reference: Extract<NoteViewerTargetReference, { type: 'event' }>): string {
  try {
    if (reference.relay || reference.kind !== undefined || reference.pubkey) {
      return nip19.neventEncode({
        id: reference.id,
        ...(reference.relay ? { relays: [reference.relay] } : {}),
        ...(reference.pubkey ? { author: reference.pubkey } : {}),
        ...(reference.kind !== undefined ? { kind: reference.kind } : {}),
      });
    }
    return nip19.noteEncode(reference.id);
  } catch {
    return reference.id;
  }
}

function addressNip19(reference: Extract<NoteViewerTargetReference, { type: 'address' }>, decoded: AddressParts): string {
  try {
    return nip19.naddrEncode({
      kind: decoded.kind,
      pubkey: decoded.pubkey,
      identifier: decoded.identifier,
      ...(reference.relay ? { relays: [reference.relay] } : {}),
    });
  } catch {
    return reference.address;
  }
}

function compactNip19(value: string): string {
  return value.length > 28 ? `${value.slice(0, 18)}...${value.slice(-8)}` : value;
}

interface AddressParts {
  kind: number;
  pubkey: string;
  identifier: string;
}

function parseAddressReference(address: string, kind?: number, pubkey?: string): AddressParts | null {
  const [kindPart, pubkeyPart, ...identifierParts] = address.split(':');
  const parsedKind = kind ?? Number(kindPart);
  const parsedPubkey = pubkey ?? pubkeyPart;
  const identifier = identifierParts.join(':');
  if (!Number.isInteger(parsedKind) || !parsedPubkey || identifier.length === 0) return null;
  return {
    kind: parsedKind,
    pubkey: parsedPubkey,
    identifier,
  };
}

function referenceKey(reference: NoteViewerTargetReference): string {
  return reference.type === 'event'
    ? `event:${reference.id}`
    : `address:${reference.address}`;
}
