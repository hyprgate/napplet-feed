# Publishing Feed

Use the repository's [NIP-5D publishing runbook](../../docs/napplet-publishing.md).
The app's title is `Feed` and its named identifier is `feed`.

The old nsite/kind-37348 instructions in this file are retired. Publish the
single-file artifact, NIP-5D manifest, and application listing through
`scripts/deploy-napplet.mjs` with the production Keychain reference. Local
development continues to use its disposable key and ephemeral servers.
