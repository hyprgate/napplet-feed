import type { FeedIntentDispatchResult } from './feed-actions';

export type NappletOpenStatus =
  | { phase: 'idle' }
  | { phase: 'opening' }
  | { phase: 'opened' | 'declined' | 'pending' | 'failed'; message: string };

/**
 * Explain an open attempt in user terms. The shell owns installation and
 * handler choice, so the card only reports what the runtime answered.
 */
export function nappletOpenStatus(result: FeedIntentDispatchResult): NappletOpenStatus {
  if (result.accepted) return { phase: 'opened', message: 'Opened in the shell.' };
  const error = result.error ?? '';
  if (error === 'user cancelled') return { phase: 'declined', message: 'Not opened.' };
  if (error === 'no handler' || error === 'unsupported convention' || error === 'unsupported action') {
    return { phase: 'failed', message: 'No installed app can open this, and it was not installed.' };
  }
  // The SDK stops waiting after 30 s; the shell may still be showing its install prompt.
  if (/timed out/i.test(error)) return { phase: 'pending', message: 'Still waiting on the shell.' };
  return { phase: 'failed', message: 'The app could not be opened.' };
}
