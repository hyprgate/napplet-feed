export interface FeedEmptyStateInput {
  /** Notes the feed holds, including ones hidden by the NSFW filter. */
  timelineCount: number;
  visibleCount: number;
  /** True when a saved feed, filter or tag drives this window. */
  hasPayload: boolean;
}

export interface FeedEmptyState {
  kind: 'hidden-nsfw' | 'no-matches' | 'no-follows';
  title: string;
  detail: string;
}

/** What to say when the list has nothing to show, or null when it does. */
export function feedEmptyState(input: FeedEmptyStateInput): FeedEmptyState | null {
  if (input.visibleCount > 0) return null;
  if (input.timelineCount > 0) {
    const notes = input.timelineCount === 1 ? 'The 1 note' : `All ${input.timelineCount} notes`;
    return {
      kind: 'hidden-nsfw',
      title: 'Hidden by your NSFW setting',
      detail: `${notes} loaded so far ${input.timelineCount === 1 ? 'is' : 'are'} tagged #nsfw.`,
    };
  }
  if (input.hasPayload) {
    return {
      kind: 'no-matches',
      title: 'Nothing matches this feed yet',
      detail: 'New notes appear here as they arrive. You can pick another feed from the bar above this window, or change this one in Feed Manager.',
    };
  }
  return {
    kind: 'no-follows',
    title: 'Nothing to read yet',
    detail: 'Notes from people you follow show up here. Follow a few people, for example with the Follow Packs app, and this fills up on its own.',
  };
}
