/**
 * Human copy for NAP (Nostr Applet Protocol) domains. NIP-5D manifests declare
 * bare domain names in `R` (required) and `O` (optional) tags; the App Store
 * presents them like app permissions. Unknown domains fall back to their bare
 * name so new NAPs still render.
 */
export type NapDomainGroup = 'network' | 'identity' | 'data' | 'interface' | 'devices' | 'payments' | 'system';

export interface NapDomainInfo {
  domain: string;
  label: string;
  description: string;
  group: NapDomainGroup;
  /** Domains that let the app act on your behalf or reach outside the sandbox. */
  sensitive: boolean;
}

const KNOWN: Record<string, Omit<NapDomainInfo, 'domain'>> = {
  shell: { label: 'Shell environment', description: 'Learn which runtime features are available and when the app is ready.', group: 'system', sensitive: false },
  relay: { label: 'Relays', description: 'Read events from your relays and publish signed events through the runtime.', group: 'network', sensitive: true },
  outbox: { label: 'Outbox routing', description: 'Route queries and publishes to the relays other people actually use.', group: 'network', sensitive: true },
  identity: { label: 'Your identity', description: 'See your public key and follows. The app never sees your keys.', group: 'identity', sensitive: false },
  storage: { label: 'App storage', description: 'Keep private key-value data scoped to this app.', group: 'data', sensitive: false },
  config: { label: 'App settings', description: 'Offer settings you can edit from the shell.', group: 'data', sensitive: false },
  resource: { label: 'Fetch resources', description: 'Load web, Blossom and Nostr resources through the sandboxed fetcher.', group: 'network', sensitive: true },
  upload: { label: 'Uploads', description: 'Upload files and blobs through your configured media servers.', group: 'network', sensitive: true },
  inc: { label: 'Talk to other apps', description: 'Exchange messages with other installed apps.', group: 'system', sensitive: false },
  intent: { label: 'Open requests', description: 'Receive open and action requests from other apps and the shell.', group: 'system', sensitive: false },
  theme: { label: 'Theme', description: 'Match your current shell theme and respond to theme changes.', group: 'interface', sensitive: false },
  keys: { label: 'Keyboard shortcuts', description: 'Receive forwarded key presses and register shortcuts.', group: 'interface', sensitive: false },
  media: { label: 'Media playback', description: 'Control playback through the shell media player.', group: 'interface', sensitive: false },
  notify: { label: 'Notifications', description: 'Show notifications rendered by the shell.', group: 'interface', sensitive: false },
  display: { label: 'Pixel displays', description: 'Push frames to runtime-controlled displays.', group: 'devices', sensitive: false },
  link: { label: 'Open links', description: 'Ask the shell to open external links.', group: 'network', sensitive: true },
  common: { label: 'Profiles', description: 'Look up profiles and common Nostr data through the shared cache.', group: 'data', sensitive: false },
  lists: { label: 'Your lists', description: 'Read and update your Nostr lists.', group: 'data', sensitive: true },
  dm: { label: 'Direct messages', description: 'Send direct messages on your behalf.', group: 'identity', sensitive: true },
  cvm: { label: 'ContextVM tools', description: 'Call MCP tools over Nostr through the shell bridge.', group: 'network', sensitive: true },
  value: { label: 'Zaps and payments', description: 'Request value transfers and zaps that you confirm.', group: 'payments', sensitive: true },
  pow: { label: 'Proof of work', description: 'Mine proof-of-work for events before publishing.', group: 'system', sensitive: false },
  count: { label: 'Counts', description: 'Ask relays how many events match a filter.', group: 'network', sensitive: false },
  fs: { label: 'Files', description: 'Read and write files in a shell-managed folder.', group: 'data', sensitive: true },
  serial: { label: 'Serial devices', description: 'Talk to serial devices you approve.', group: 'devices', sensitive: true },
  ble: { label: 'Bluetooth', description: 'Connect to Bluetooth devices you approve.', group: 'devices', sensitive: true },
  webrtc: { label: 'Peer connections', description: 'Open WebRTC sessions mediated by the shell.', group: 'network', sensitive: true },
  gamepad: { label: 'Game controllers', description: 'Read connected game controllers.', group: 'devices', sensitive: false },
  llm: { label: 'Language models', description: 'Ask you to choose a model connection and send prompts you allow, one generation at a time.', group: 'network', sensitive: true },
  connect: { label: 'Direct network access', description: 'Reach the network directly, outside shell mediation.', group: 'network', sensitive: true },
  class: { label: 'App class', description: 'Declare a runtime class with its own policy.', group: 'system', sensitive: false },
};

export function napDomainInfo(domain: string): NapDomainInfo {
  const known = KNOWN[domain];
  if (known) return { domain, ...known };
  const label = domain.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { domain, label, description: `Uses the ${domain} protocol domain.`, group: 'system', sensitive: false };
}

export function napDomainInfos(domains: readonly string[]): NapDomainInfo[] {
  return [...new Set(domains)].map(napDomainInfo);
}

export const NAP_DOMAIN_GROUP_LABELS: Record<NapDomainGroup, string> = {
  network: 'Network',
  identity: 'Identity',
  data: 'Data',
  interface: 'Interface',
  devices: 'Devices',
  payments: 'Payments',
  system: 'System',
};
