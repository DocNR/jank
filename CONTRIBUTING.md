# Contributing to jank

Thanks for your interest in jank. This is a Vite + React + TypeScript single-page Nostr client.

## Getting started

```bash
npm install
npm run dev      # development server
npm run build    # production build
npm run lint
npm run format
```

## Type-checking gotcha

`npx tsc --noEmit` is a **no-op** in this repo (solution-style `tsconfig.json`) — it exits 0 without actually type-checking. The real type check is:

```bash
npm run build    # full TS pipeline; this is what CI runs
# or, faster for incremental work:
npx tsc -b
```

Always run `npm run build` before opening a PR. Trusting `tsc --noEmit` has shipped broken builds before.

## Internationalization

Locale files live in `src/i18n/locales/`. **New translation keys must be appended to the END of each locale file** — never inserted in the middle, never modify or remove existing keys. At the trial stage you can skip translations and fill them in after a feature is confirmed.

## Adding a column type

jank's surfaces are columns. Adding a column type touches several files (types, body component, dispatchers, the picker registry, the deck migrator, i18n). See the "Adding a new column type" section of [`CLAUDE.md`](CLAUDE.md) for the full checklist.

## Architecture

[`CLAUDE.md`](CLAUDE.md) is the architecture overview: provider tree, services taxonomy, the per-account signer registry, routing model, and column types.

## License

By contributing, you agree your contributions are licensed under the MIT License.
