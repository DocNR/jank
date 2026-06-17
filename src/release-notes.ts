// Ordered NEWEST-FIRST. Each announce-worthy release prepends an entry here and
// bumps package.json version to match. Optional + fail-silent: no entry for the
// running version => no "What's new" dialog. `link` (if set) MUST be PUBLIC.

export type ReleaseNote = {
  /** Must match the package.json / APP_VERSION value shipped with this entry. */
  version: string
  /** ISO date, e.g. '2026-05-29'. */
  date: string
  /** User-facing bullet points. */
  highlights: string[]
  /** Optional public URL. */
  link?: string
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '26.15.1',
    date: '2026-06-16',
    highlights: [
      'Replying is no longer interrupted by a busy feed. When new notes arrive while you are writing a reply, the compose box stays open instead of occasionally closing on you; the new notes wait in the "show new notes" pill until you are done.',
      'Fixed the "Show more" button on long notes showing up with hard-to-read, low-contrast text in light mode.'
    ]
  },
  {
    version: '26.15.0',
    date: '2026-06-16',
    highlights: [
      'Mobile got a big usability pass. Tapping a note or profile now opens it as a screen that slides in and can be swiped back, instead of piling up columns. Columns run edge-to-edge, and a new overview — the grid button in the bottom bar — shows all your open columns at a glance so you can jump between or close them (also available on desktop).',
      'The mobile bottom bar is clearer, with separate buttons for the column overview, adding a column, and composing a note. The active deck and deck switcher now appear in the top bar on mobile too.',
      'A batch of iOS fixes: the layout no longer crops oddly, focusing a text field no longer leaves the page stuck zoomed in, columns sit flush under the toolbar, and a stray browser sign-in popup triggered by some relays and profiles is gone.'
    ]
  },
  {
    version: '26.14.2',
    date: '2026-06-15',
    highlights: [
      'Deleting a deck now sticks across your devices. A deck you remove on one device no longer reappears on another after it syncs, and the brief Undo still brings it back if you change your mind.'
    ]
  },
  {
    version: '26.14.1',
    date: '2026-06-14',
    highlights: [
      'The Muted list now spells out whether each muted user is Public or Private, with a globe or lock label and a tooltip explaining what it means, instead of an unlabeled icon. Switching a mute between public and private is now instant, and tells you if it could not be saved instead of silently doing nothing.'
    ]
  },
  {
    version: '26.14.0',
    date: '2026-06-14',
    highlights: [
      "Zap counts are now verified. Each zap receipt is checked against the sender's lightning provider before it counts, so forged zaps can no longer inflate the totals on notes or in your notifications.",
      'Remote signing is clearer. When a post or action is waiting on your remote signer to approve it (a bunker, Amber, and similar), a quiet "waiting for approval" hint now appears, and the request times out instead of hanging if your signer never responds.'
    ]
  },
  {
    version: '26.13.1',
    date: '2026-06-14',
    highlights: [
      'Opening a muted thread now lets you read the whole conversation. Click "Reveal muted thread" and the note and all of its replies appear together, instead of showing only the one note. The thread stays muted in your feeds and notifications.'
    ]
  },
  {
    version: '26.13.0',
    date: '2026-06-13',
    highlights: [
      'A new "Muted" column puts everything you have muted in one place. See and manage muted users, muted threads, and muted words together, with tabs to filter by type. Add it from the column picker, or open it from your profile menu.'
    ]
  },
  {
    version: '26.12.2',
    date: '2026-06-13',
    highlights: [
      'You can now mute an entire thread. Choose "Mute thread" from any note\'s menu and the whole conversation, including every reply, disappears from your feeds and notifications. Muted threads stay muted across your devices, and you can unmute them from Settings.'
    ]
  },
  {
    version: '26.12.1',
    date: '2026-06-13',
    highlights: [
      "Your Home columns now remember whether you're viewing Notes or Notes and replies. Switch to Notes and replies and it stays that way after a reload, instead of resetting to Notes every time.",
      'Each Home column keeps its own setting. Save your deck to carry the choice to your other devices.'
    ]
  },
  {
    version: '26.11.0',
    date: '2026-06-13',
    highlights: [
      'The note menu\'s "Republish to..." option no longer opens empty. It now always lists Optimal relays, so you can republish any note even before you have set up favorite relays.',
      'Republishing to Optimal relays now shows exactly which relays it reached, right in the confirmation popup.',
      'A new "Configure relay sets" shortcut in the Republish menu lets you create and manage named relay sets to republish to.'
    ]
  },
  {
    version: '26.10.0',
    date: '2026-06-12',
    highlights: [
      'Spectr is now jank. Same app, same decks, just a new name and a new home.',
      'jank now lives at jank.army. Old bookmarks to the previous address redirect here automatically.',
      'jank is now open source. The code is public on GitHub for anyone to read, fork, or contribute to.'
    ]
  },
  {
    version: '26.9.0',
    date: '2026-06-11',
    highlights: [
      "Spectr now understands CLINK Lightning offers. A noffer1... payment code in a note renders as a payable card instead of a wall of text: see the price (or enter an amount), hit Pay, and Spectr fetches a fresh invoice from the offer's service over Nostr and hands it to your wallet. No web servers involved, end to end.",
      'When the service confirms your payment landed, the card flips to Paid, even if you paid by scanning the QR with a phone wallet.',
      'Offer requests are sent with a throwaway key, so paying an offer never links your Nostr identity to the payment.'
    ],
    link: 'https://github.com/shocknet/CLINK'
  },
  {
    version: '26.8.5',
    date: '2026-06-11',
    highlights: [
      'Uploaded media now lands where your cursor is. Picking an image, video, or GIF from the compose toolbar inserts the link at the caret (with an uploading placeholder while it transfers), instead of always appending it to the bottom of the post. You can now write text, drop in an image, and keep writing below it.',
      'Media links inserted mid-sentence get their own line automatically, so they always render as media instead of fusing with the surrounding words.'
    ]
  },
  {
    version: '26.8.4',
    date: '2026-06-10',
    highlights: [
      'Feeds no longer silently miss notes. What counts as "new" is now tracked by note identity instead of timestamps, so notes that arrive late or out of order (slow relays, posts written offline and published later) show up instead of being dropped.',
      'The "Show new notes" button now counts exactly what clicking it reveals. Reposts of notes already on screen update the existing note instead of inflating the count.',
      'A note dated in the future can no longer freeze a feed until its timestamp passes. Far-future notes stay hidden until their time becomes plausible.',
      'Columns keep their relay subscriptions alive while scrolled out of view, so scrolling back to a column is instant and nothing is missed in between.'
    ]
  },
  {
    version: '26.8.3',
    date: '2026-06-10',
    highlights: [
      'The Favorites column works now. Adding one from the column picker used to show "Unknown column type" — the column type was never wired into the deck renderer. Star a user from a note\'s ⋯ menu or their profile, then add a Favorites column to follow just your starred people.'
    ]
  },
  {
    version: '26.8.2',
    date: '2026-06-05',
    highlights: [
      'Shortened npubs now reveal more of the leading characters, so vanity prefixes like npub1clave stay readable at a glance instead of being cut off.'
    ]
  },
  {
    version: '26.8.1',
    date: '2026-06-05',
    highlights: [
      'Feeds now refresh after your computer wakes from sleep. Previously, leaving jank open overnight could leave a feed frozen on an old note, and the refresh button could not recover it. jank now reconnects to relays when the tab becomes visible again or the network comes back.'
    ]
  },
  {
    version: '26.8.0',
    date: '2026-06-04',
    highlights: [
      'Deck sync uses the newer NIP-44 v3 encryption scheme. Remote signers that support v3 can show the specific event kind and scope on the approval prompt instead of requesting blanket encryption access.',
      'Existing decks keep syncing without any action on your part. jank detects the encryption version on each remote workspace and falls back to v2 automatically when the signer does not support v3.'
    ]
  },
  {
    version: '26.7.0',
    date: '2026-06-02',
    highlights: [
      'Private messages have arrived. Add a new Messages column to send and receive encrypted direct messages right alongside your other columns. Pick someone, start a conversation, and your whole DM inbox lives in one place.',
      'Your DMs are properly private. Messages use the modern encrypted scheme (NIP-17), which hides not just what you say but who you are talking to and when. The first time you open Messages, jank helps you set up the relays that receive your DMs so people can reach you.'
    ]
  },
  {
    version: '26.6.0',
    date: '2026-06-01',
    highlights: [
      "Profiles got roomier. Open anyone's profile and you'll find new tabs: Media (a photo and video gallery where each tile links back to the original post), Articles, the Zaps they've received, the Reactions they've made, and their relays.",
      "The old 'Notes and replies' tab is now a focused 'Replies' tab, so your Notes and Replies no longer overlap."
    ]
  },
  {
    version: '26.5.10',
    date: '2026-05-30',
    highlights: [
      'New posts show up at the top of your home feed on their own again. When you were sitting at the top, fresh notes were arriving but rendering just out of view, so the feed looked frozen. They pop in properly now. Thanks BFGreen for flagging it.'
    ]
  },
  {
    version: '26.5.9',
    date: '2026-05-30',
    highlights: [
      'Notification filters are honest again. Replies to you, including comments posted from other Nostr apps, now land under the Replies chip instead of hiding in Mentions. Thanks BFGreen for the rainy-morning ramble that surfaced this.',
      'Your browser tab keeps the proper jank mark. The unread-notification badge no longer stomps on the light/dark favicon.'
    ]
  },
  {
    version: '26.5.8',
    date: '2026-05-29',
    highlights: [
      'Profile feed posts no longer flash blank as you scroll. We claimed this was fixed in 26.5.6, but the actual cause was a deeper React timing race that quietly defeated every previous patch. It is genuinely fixed now.'
    ]
  },
  {
    version: '26.5.7',
    date: '2026-05-29',
    highlights: [
      'The deck now sits flush against the left edge by default. The mysterious gap that was driving certain testers (you know who you are, BFGreen) up the wall is gone.',
      'Miss the breathing room? Settings, Appearance, Deck alignment, flip it to Indented. Your OCD is safe with us either way.'
    ]
  },
  {
    version: '26.5.6',
    date: '2026-05-29',
    highlights: [
      'Fixed a blank gap that could hide posts in Profile feeds while scrolling.',
      'Profile banners now display at a consistent size.'
    ]
  },
  {
    version: '26.5.5',
    date: '2026-05-29',
    highlights: [
      'Clicking a profile, hashtag, or relay link inside a column now opens it reliably.'
    ]
  },
  {
    version: '26.5.4',
    date: '2026-05-29',
    highlights: ['jank now tells you when a new version is available and shows what changed.']
  }
]
