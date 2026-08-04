import type { NostrEvent } from '@hyprgate/types';

export type FeedProfileHydrator = (events: NostrEvent[]) => void;

export const FEED_PROFILE_HYDRATION_CONTEXT = Symbol('feed-profile-hydration');
