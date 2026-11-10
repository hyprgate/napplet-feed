import { verifyEvent } from 'nostr-tools';
import { KIND_NIP5D_NAMED, KIND_NIP5D_ROOT } from './nip-constants.js';
import type { Nip5dMediaDeclaration } from './nip5d-presentation-media.js';
import { isSha256Hex } from './verified-blossom-blob.js';

/**
 * Napshot fallback previews (https://github.com/napplet/napshot).
 *
 * A Napshot instance captures a signed-out view of a NIP-5D napplet whose
 * manifest has no usable screenshot, mirrors the PNG to Blossom and publishes a
 * NIP-32 kind 1985 label in the `#screenshot` namespace that targets the exact
 * manifest event. Surfaces show that picture only when the app author supplied
 * none, only from explicitly trusted signers, only for the manifest revision
 * the label names, and only after the bytes match the label's hash, size and
 * dimensions.
 */

export const KIND_LABEL = 1985;
export const NAPSHOT_NAMESPACE = '#screenshot';
const MAX_MIRRORS = 4;
const MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
const MAX_DIMENSION = 8192;

export interface NapshotTrustConfig {
  /** Trusted labeler pubkeys in preference order. Empty disables Napshot lookups. */
  signers: string[];
  /** Relays the trusted instances publish labels to. */
  relays: string[];
}

/**
 * The napplet project's public Napshot instance. Its key was compared with the
 * instance's `/api/status` signer on 2026-11-01; `/api/status` itself is not a
 * trust anchor. Operators override both lists at build time with
 * `VITE_NAPSHOT_SIGNERS` / `VITE_NAPSHOT_RELAYS` (comma-separated); an empty
 * `VITE_NAPSHOT_SIGNERS` turns the fallback off.
 */
export const DEFAULT_NAPSHOT_TRUST: NapshotTrustConfig = {
  signers: ['94b92a261c88f6b14098e6ec15c93bed544380883745f9a030b27d4a5c554f81'],
  relays: ['wss://relay.napplet.soy/', 'wss://relay.primal.net/'],
};

/** Callers pass their bundler env (for example `import.meta.env`); utils stays bundler-neutral. */
export function napshotTrustConfig(env: Record<string, unknown> = {}): NapshotTrustConfig {
  const list = (value: unknown): string[] | null => typeof value === 'string'
    ? value.split(',').map((part) => part.trim()).filter(Boolean)
    : null;
  const signers = list(env.VITE_NAPSHOT_SIGNERS);
  const relays = list(env.VITE_NAPSHOT_RELAYS);
  return {
    signers: [...new Set((signers ?? DEFAULT_NAPSHOT_TRUST.signers).map((key) => key.toLowerCase()).filter((key) => isSha256Hex(key)))],
    relays: [...new Set((relays ?? DEFAULT_NAPSHOT_TRUST.relays).filter((url) => /^wss:\/\//.test(url)))],
  };
}

export interface NapshotSignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NapshotPreview {
  labelId: string;
  signer: string;
  createdAt: number;
  manifestId: string;
  media: Nip5dMediaDeclaration;
}

/** Napshot labels root and named manifests; snapshots are never captured. */
export function isNapshotManifestKind(kind: number): boolean {
  return kind === KIND_NIP5D_ROOT || kind === KIND_NIP5D_NAMED;
}

export function napshotLabelFilters(manifestIds: readonly string[], signers: readonly string[]) {
  if (signers.length === 0 || manifestIds.length === 0) return [];
  return [{ kinds: [KIND_LABEL], authors: [...signers], '#e': [...manifestIds], '#L': [NAPSHOT_NAMESPACE] }];
}

/** Cheap relay-ingest gate: kind, trusted signer and a valid id/signature. Binding is checked per manifest. */
export function isTrustedNapshotLabel(event: unknown, signers: readonly string[]): event is NapshotSignedEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as NapshotSignedEvent;
  if (candidate.kind !== KIND_LABEL || !signers.includes(candidate.pubkey)) return false;
  if (!Array.isArray(candidate.tags) || !candidate.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))) return false;
  // nostr-tools caches verification on a symbol that object spread copies, so a
  // modified copy of a verified event would pass; verify the signed fields only.
  const { id, pubkey, created_at, kind, tags, content, sig } = candidate;
  try { return verifyEvent({ id, pubkey, created_at, kind, tags, content, sig }); } catch { return false; }
}

/**
 * Validate one label against the exact manifest revision. Returns null for any
 * contradiction: wrong target, namespace, author binding, duplicate or
 * malformed screenshot fields, or no safe mirror.
 */
export function parseNapshotLabel(
  label: NapshotSignedEvent,
  manifest: NapshotSignedEvent,
  signers: readonly string[],
): NapshotPreview | null {
  if (!isTrustedNapshotLabel(label, signers)) return null;
  const tags = (name: string) => label.tags.filter((tag) => tag[0] === name);
  const identifier = manifest.kind === KIND_NIP5D_NAMED ? manifest.tags.find((tag) => tag[0] === 'd')?.[1] ?? '' : '';
  const address = `${manifest.kind}:${manifest.pubkey}:${identifier}`;

  const eTags = tags('e');
  const aTags = tags('a');
  const pTags = tags('p');
  if (eTags.length !== 1 || eTags[0]![1] !== manifest.id) return null;
  if (aTags.length !== 1 || aTags[0]![1] !== address) return null;
  if (pTags.length !== 1 || pTags[0]![1] !== manifest.pubkey) return null;
  if (!tags('L').some((tag) => tag[1] === NAPSHOT_NAMESPACE)) return null;

  const screenshotTags = tags('screenshot');
  if (screenshotTags.length !== 1) return null;
  const fields = new Map<string, string>();
  for (const field of screenshotTags[0]!.slice(1)) {
    const index = field.indexOf(' ');
    if (index <= 0) return null;
    const key = field.slice(0, index);
    if (fields.has(key)) return null;
    fields.set(key, field.slice(index + 1));
  }
  const hash = fields.get('x');
  if (!isSha256Hex(hash) || fields.get('m') !== 'image/png') return null;
  const dim = fields.get('dim')?.match(/^([1-9]\d{0,4})x([1-9]\d{0,4})$/);
  const size = Number(fields.get('size'));
  if (!dim || !/^[1-9]\d*$/.test(fields.get('size') ?? '') || size > MAX_SCREENSHOT_BYTES) return null;
  const width = Number(dim[1]);
  const height = Number(dim[2]);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;

  const namespaced = tags('l').filter((tag) => tag[2] === NAPSHOT_NAMESPACE);
  if (namespaced.length !== 1 || namespaced[0]![1] !== hash) return null;

  const servers = [...new Set(tags('server').map((tag) => tag[1] ?? '').filter(isSafeMirrorOrigin).map((url) => new URL(url).origin))]
    .slice(0, MAX_MIRRORS);
  if (servers.length === 0) return null;

  return {
    labelId: label.id,
    signer: label.pubkey,
    createdAt: label.created_at,
    manifestId: manifest.id,
    media: {
      kind: 'screenshot',
      hash,
      mimeType: 'image/png',
      width,
      height,
      size,
      servers,
      exactDeclaration: true,
    },
  };
}

/**
 * Deterministic choice among usable labels: configured signer preference, then
 * newest label, then lexicographically smallest id.
 */
export function selectNapshotPreview(
  manifest: NapshotSignedEvent,
  labels: readonly NapshotSignedEvent[],
  signers: readonly string[],
): NapshotPreview | null {
  const usable = labels
    .map((label) => parseNapshotLabel(label, manifest, signers))
    .filter((preview): preview is NapshotPreview => preview !== null);
  usable.sort((a, b) => signers.indexOf(a.signer) - signers.indexOf(b.signer)
    || b.createdAt - a.createdAt
    || (a.labelId < b.labelId ? -1 : a.labelId > b.labelId ? 1 : 0));
  return usable[0] ?? null;
}

/**
 * Mirrors named by a third-party label must be public HTTPS origins: no
 * credentials, paths, query, non-default ports, IP literals or local names.
 */
export function isSafeMirrorOrigin(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^[\d.]+$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|arpa|test|invalid)$/.test(host);
}
