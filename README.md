<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `feed` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Feed

[![CI](https://github.com/hyprgate/napplet-feed/actions/workflows/ci.yml/badge.svg)](https://github.com/hyprgate/napplet-feed/actions/workflows/ci.yml)

This app is tracked directly in the Hyprgate workspace at `napplets/feed`.
Standalone repositories are generated read-only mirrors; make changes and run
workspace checks in the existing Hyprgate checkout.

## Parent checkout

```bash
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-feed build
```

## Paja runtime

```bash
pnpm --filter @hyprgate/napp-feed paja
```

This starts Kehto Paja and the napplet's Vite dev server together, using
the port configured in `vite.config.ts`.

## Testing

Run these checks from a Hyprgate parent checkout so workspace dependencies resolve:

```bash
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-feed conformance
pnpm --filter @hyprgate/napp-feed test
pnpm --filter @hyprgate/napp-feed build
```

The `conformance` script builds the napplet and runs `@napplet/conformance-cli` against `dist/`. CI runs the same conformance, unit test, and build checks for every push and pull request.

Workspace dependencies resolve in the Hyprgate checkout. The mirror workflow
rewrites workspace dependency pins for standalone source distribution.

## Toolbar and states

The toolbar groups what the list shows (Replies, NSFW, Reaction details) apart
from how it's laid out, and each toggle shows when it's on. The list always says
why it's empty: no follows, a saved feed with no matches, or the NSFW filter
hiding everything it has loaded. See `src/lib/feed-empty-state.ts`.

Reaction counts can be sent from the keyboard (Enter/Space on a count) as well as
by press and hold. The reaction menu and the palette popover close on Escape or
an outside press, and Escape returns focus to the button that opened them.

## Reaction context

Kind-7 timeline reactions show the reacted event below the reaction in Compact,
Cards, and Terminal views. The shared preview resolves the last valid `e` target
through runtime-owned outbox routing, preserving relay, author, and kind hints.
A consistent `a` coordinate carries `naddr` navigation; if the exact revision is
unavailable, a single bounded address query can retrieve the current revision.
Ambiguous or contradictory address hints never replace the exact event target.

Addressable previews show available title/name and summary metadata. Long-form
kind-30023 articles also show expandable content; structured event bodies such
as application manifests are not dumped into the timeline. Missing targets and
failed lookups settle to a navigable fallback, and nested reactions/reposts share
the existing depth limit. Profile metadata and profile navigation use the shared
Feed hydration path in every view.

Focused coverage lives in `src/components/feed-reactions.test.ts` and
`src/lib/reaction-presentation.test.ts`; the parent repository's
`e2e/feed-reactions.spec.ts` supplies rendered browser proofs.

## App cards

A note that references a NIP-5D app manifest (`nostr:naddr` for a kind-35129
named app, `nostr:nevent` for a 15129 root app or 5129 snapshot) renders as an
app card. The card verifies the manifest signature and shows:

- the author's first `screenshot`, fetched by hash from the declared Blossom
  servers through NAP-RESOURCE and verified before display; if the author
  shipped none, a trusted [Napshot](https://github.com/napplet/napshot) capture
  labelled for that exact manifest revision, marked "Automated preview";
- the app name and the first sentence of its description;
- required (`R`) and optional (`O`) NAP domains with the App Store's copy.

**Open app** invokes the manifest's own `z`/`i` convention (an `open` action
when there is one) with a NAP-INTENT `handlerHint` naming the app's 35129
coordinate. The shell decides what runs: the user's default for that archetype
wins, an installed hinted app opens directly, and an uninstalled one gets an
install offer (Install and open / Install only / Not now) in the shell's dialog
slot. See `apps/shell/src/lib/kehto/intent-hint-install.ts`. A manifest without
a `z`/`i` contract can't be an intent target, so its card disables Open app
and says why next to the button.

Focused coverage: `src/components/feed-napplet-embed.test.ts`,
`packages/utils/src/napplet-embed.test.ts`,
`apps/shell/src/lib/kehto/intent-hint-install.test.ts`, and the browser proof
`e2e/feed-napplet-embeds.spec.ts`.

`@napplet/nap` gives up on `intent.invoke` after 30 s, which a reader can exceed
at the install offer; the card then shows a neutral "Still waiting on the
shell." Tracked as napplet/web#327 / #511.

## Intent delivery

The app receives `napplet:feed/open` through the host-injected
`intent.onDelivery` subscription and validates the contract and payload before
applying it. The binding buffers delivery until subscription; no app-specific
INC readiness topic is required. Existing persisted/default startup behavior remains the fallback when no valid intent arrives.

The shell target-controller migration is still in progress; see
[package migration status](../../docs/napplet-package-migration.md).
