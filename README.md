# jank

**just another nostr klient** — a TweetDeck-style multi-column deck for Nostr.

Many independent feed columns side-by-side, each scoped to one of your paired accounts. Home, notifications, hashtags, profiles, search, bookmarks, articles, and more — plus three Relay columns each pointing at a different relay, the Nostr-native shape no TweetDeck clone could have.

🌐 **[jank.army](https://jank.army)**

## Status

Actively developed and live. jank is **web-only** (desktop primary, mobile PWA functional); the Electron build target from upstream Jumble was removed during the fork. Multi-account via NIP-46 / NIP-07 / nsec, per-account decks with NIP-78 cross-device sync, NIP-17 private DMs, and a growing set of column types.

See [`CLAUDE.md`](CLAUDE.md) for the technical architecture overview.

## Run Locally

```bash
# Clone this repository
git clone https://github.com/DocNR/jank.git

# Go into the repository
cd jank

# Install dependencies
npm install

# Run the app
npm run dev
```

To produce a production build (this is also the real type check — see CONTRIBUTING):

```bash
npm run build
```

## Community mode (optional)

To run jank with pre-configured relay sets and relays, set these environment variables in a `.env` file at the repo root:

- `VITE_COMMUNITY_RELAY_SETS`: Default relay sets. Multiple sets can be configured. If set, the first preset group is shown by default. Visitors cannot delete preset relay sets. Useful for communities hosting their own jank instance or setting default feeds for family members.

```
VITE_COMMUNITY_RELAY_SETS=[{"id": "example.com", "name": "The Example Feed", "relayUrls": ["wss://relay.example.com/", "wss://relay.example.org/"]}]
```

- `VITE_COMMUNITY_RELAYS`: Additional default relays, comma-separated. Added to preset relay sets and unremovable by visitors.

```
VITE_COMMUNITY_RELAYS="wss://relay.example.com/,wss://relay.example.org/"
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: `npm install`, `npm run dev`, and the real type check before any PR is `npm run build` (not `tsc --noEmit`).

## Credits

jank is forked from [Jumble](https://github.com/CodyTseng/jumble) at commit `ce639aa` by [Cody Tseng](https://jumble.social/users/npub1syjmjy0dp62dhccq3g97fr87tngvpvzey08llyt6ul58m2zqpzps9wf6wl). The fork retains the MIT license and preserves Cody's authorship credit in `package.json`.

To support the upstream project directly:

- **Lightning:** ⚡️ codytseng@getalby.com ⚡️
- **Geyser:** https://geyser.fund/project/jumble

## License

MIT
