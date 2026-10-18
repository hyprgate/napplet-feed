import { intent } from '@napplet/sdk';
import type { FeedIntentPayload } from '@hyprgate/types';
import { validateFeedIntentPayload } from '@hyprgate/utils';

export type IntentDelivery = Parameters<Parameters<typeof intent.onDelivery>[0]>[0];

export function feedPayloadFromIntentDelivery(event: IntentDelivery): FeedIntentPayload | null {
  if (event.archetype !== 'feed' || event.action !== 'open' || event.convention !== 'napplet:feed/open') return null;
  return validateFeedIntentPayload(event.payload);
}
