import { inc } from '@napplet/sdk';
import type { FeedIntentPayload } from '@hyprgate/types';
import { validateFeedIntentPayload } from '@hyprgate/utils';

export type IncEvent = Parameters<Parameters<typeof inc.on>[1]>[0];

export function feedPayloadFromIncEvent(event: IncEvent): FeedIntentPayload | null {
  return validateFeedIntentPayload(event.payload);
}
