<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `feed` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# napplet-feed

[![CI](https://github.com/hyprgate/napplet-feed/actions/workflows/ci.yml/badge.svg)](https://github.com/hyprgate/napplet-feed/actions/workflows/ci.yml)

Forkable source repository for the Hyprgate built-in napplet currently packaged as `@hyprgate/napp-feed`.

This repository was split from `hyprgate/gui` and is mounted back into the parent checkout as `napplets/feed`.
It still expects the parent workspace when built through Hyprgate because shared `@hyprgate/*` packages remain workspace dependencies.

## Parent checkout

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
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
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-feed conformance
pnpm --filter @hyprgate/napp-feed test
pnpm --filter @hyprgate/napp-feed build
```

The `conformance` script builds the napplet and runs `@napplet/conformance-cli` against `dist/`. CI runs the same conformance, unit test, and build checks for every push and pull request.

CI runs from the standalone napplet repository but checks out `hyprgate/gui` to resolve private `workspace:*` packages. Configure `HYPRGATE_GUI_CHECKOUT_TOKEN` with read access to `hyprgate/gui` before enabling GitHub Actions.
