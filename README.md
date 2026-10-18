<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `feed` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# napplet-feed

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

## Intent delivery

The app receives `napplet:feed/open` through the host-injected
`intent.onDelivery` subscription and validates the contract and payload before
applying it. The binding buffers delivery until subscription; no app-specific
INC readiness topic is required. Existing persisted/default startup behavior remains the fallback when no valid intent arrives.

The shell target-controller migration is still in progress; see
[package migration status](../../docs/napplet-package-migration.md).
