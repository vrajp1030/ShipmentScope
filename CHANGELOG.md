# Changelog

All notable changes to ShipmentScope are recorded here.

## 2026-07-01 (final round) — Abuse protection + self-service account deletion

### Added
- **Rate limiting** on login and signup (in-memory, per-IP and per-email):
  max 5 signups/hour per IP, max 15 login attempts/15min per IP, max 8
  login attempts/15min per specific email — stops both brute-force
  password guessing and mass fake-account spam. Verified: 9 wrong-password
  attempts against one account correctly allowed 8 and blocked the 9th.
- **Honeypot field** on the signup form — invisible to real people, but a
  hidden field simple bots auto-fill. Tripping it returns a fake success
  without creating anything. Verified: a bot-style request "succeeded"
  but created zero real accounts.
- **Self-service "Delete account"** (Settings → Account) — permanently
  erases your orders, connected email accounts, and login, after
  re-entering your password. Invalidates every session for that account
  immediately, not just the current tab. Verified end-to-end via the
  real UI: wrong password correctly refused (nothing deleted), correct
  password deletes both data files and the user record, and the
  account can no longer log in afterward.

### Changed
- Documented all three new environment variables together in
  README.txt: `SITE_PASSWORD` (whole-site lock), `ADMIN_PASSWORD`
  (developer stats), and now the rate-limit thresholds (not
  configurable via env var yet — hardcoded sane defaults).

## 2026-07-01 (later still) — Fixed a real cross-account data leak

### Fixed — SECURITY
Found and fixed a genuine bug in the just-shipped multi-user system: the
browser's local cache (`localStorage`) of orders and connected IMAP
accounts had no idea *which* logged-in account it belonged to. On a
shared or reused browser, logging into a **second** account would
silently upload the **first** account's cached orders — and would have
done the same for a connected email account and its password — into
the second account's real, permanent server-side storage.
Reproduced live, confirmed it wrote to the wrong account's file on
disk, then fixed with `guardLocalCacheOwnership()`: the cache is now
tagged with the email of whoever it belongs to, and if a different
account logs in on the same browser, the stale cache is wiped before
anything can read or upload it. Re-tested the exact scenario (a
different account's orders, and separately a stranger's cached email
account + password) — confirmed neither leaks into a new signup
anymore, and confirmed nothing lands in the new account's file on disk.

### Added
- Developer stats page at `/admin` (disabled unless you set an
  `ADMIN_PASSWORD` environment variable — separate from the per-user
  login system and from `SITE_PASSWORD`). Shows real aggregate numbers
  computed from actual stored data: total accounts, orders tracked,
  order value tracked, connected email accounts, active-in-7-days,
  new signups (7/30 days), and orders by status. No per-user personal
  data is shown — aggregates only.

### Changed
- The empty-state "Sync emails" / "Add order" buttons were two
  different heights, colors, and font sizes. Unified into a matched
  primary/secondary pair (`.empty-cta.primary` / `.empty-cta.secondary`)
  — same height, same icon size, both blue-toned (solid vs. outline).

## 2026-07-01 (later) — Real multi-user accounts (the big one)

### Added
- **Every visitor now gets their own account** — signup/login screen,
  password-protected (hashed with Node's built-in `scrypt`, never stored
  in plaintext), session cookie valid 30 days.
- **Full data isolation per user**: orders, connected IMAP/email
  accounts, and background sync are all scoped to the logged-in
  account. Verified directly (not assumed) — two test accounts created,
  confirmed neither can see the other's orders, connected email
  accounts, or incoming webhook/poll data.
- Connected IMAP accounts moved from browser localStorage to the
  server, encrypted at rest (AES-256-GCM). This also means your
  connected accounts now follow you if you log in from a different
  browser/device — they used to be stuck in one browser.
- Per-user webhook URLs (`/webhook/<your-token>`, shown in Settings →
  Sync) — needed so Shopify/etc. webhooks land in the right account
  once other people can have their own.
- Auto-poll now reads every user's accounts from disk each cycle
  instead of only whoever most recently synced in this server session —
  polling now also survives a server restart.
- The one-time "SITE_PASSWORD" whole-site Basic Auth gate from earlier
  today is still available as an optional *extra* outer layer (e.g. to
  keep a beta deployment fully private) — it now sits in front of the
  per-user login, not instead of it.

### Changed — READ THIS if you're used to opening the app with no login
**You now have to sign up once, even for your own local Mac use.**
The first account you create automatically inherits any orders you
already had, if there were any. This is a real, intentional change: it's
what makes it safe to eventually share a link with anyone else without
your inbox connection or order data showing up for them.

### Fixed
- A real cross-user data leak in the old single-user design: `/api/poll`
  used to return ONE shared buffer to whoever called it — in a
  multi-user world that would have meant any signed-in user could see
  another user's newly-synced orders. Fixed before it ever shipped to
  more than one person, by making the buffer per-user.
- The webhook route was initially placed after the "must be logged in"
  gate, which is backwards — external services like Shopify can't send
  a login cookie. Found via testing (not spotted by ​eye), moved before
  the gate, re-verified.

## 2026-07-01 — UI overhaul to match target design + engineering practices

### Added
- Header redesigned: logo moved to the left, a global search bar (with a
  ⌘K / Ctrl+K / `/` shortcut) now sits in the header center, and the
  right side has a blue "Add order" button, a notification bell with a
  live "recent activity" dropdown, and the settings gear.
- Dashboard (Orders tab) now has a two-column layout: the order list on
  the left, and a right-hand sidebar with an "Insights" preview (average
  delivery time, on-time delivery %, delay rate, total orders — all
  computed from real order history, not placeholders) and a "Recent
  activity" feed built from every order's status timeline.
- Sidebar "This period" widget now shows a combined total spend, a
  trend arrow/percentage vs. the previous 3-month period, and the
  per-month breakdown underneath.
- Empty states upgraded with two real call-to-action buttons ("Sync
  emails" / "Add order").
- `CHANGELOG.md` (this file) — tracks notable changes going forward.

### Changed
- Primary action buttons (Add order, Save & connect, Scan inbox, modal
  confirm buttons) switched from solid white to solid accent-blue,
  matching the reference design. Segmented "All" filter chips remain
  white/neutral (that distinction is intentional — blue = action, white
  = selection state).
- Removed the duplicate in-pane search box; the header search box now
  reuses the existing `#srch` element and filter logic (no new state,
  no regressions).

### Fixed
- None this round — regression suite (32 sync cases + email-ID dedup
  test) still green after every change; the app was smoke-tested with
  zero console errors across every tab, filter, sort, and modal.

### Not built (needs your input before it can be)
A large feature wishlist was requested alongside the UI work (universal
carrier tracking, SMS/push notifications, user accounts with multi-device
sync, AI delay prediction, Shopify/WooCommerce/Etsy/eBay integrations, an
admin panel, 2FA, a mobile app, a browser extension, etc.). None of this
was silently implemented, because doing so honestly requires things only
the user can provide — see the "Product roadmap" section of
`README.txt` (or ask the assistant) for the categorized breakdown of
what needs a paid API/account vs. a full backend rewrite vs. is
realistically buildable today.

---

## Earlier history (reconstructed, no prior changelog existed)
- Local Node/IMAP sync server + single-file HTML dashboard for tracking
  Pokémon order emails (PokéOrders).
- Fixed a real dedup bug where same-day, same-subject-template order
  emails from one store were being silently collapsed into a single
  order (now keyed by each email's own Message-ID).
- Store detection made sender-agnostic (works for any store, not just a
  fixed whitelist); shipping-relay senders (Narvar/Route) resolve to the
  real store via the email's display name.
- Orders persist to disk (`orders.json`) via the local server, in
  addition to browser localStorage, so they survive restarts and
  browser data clears.
- Rebranded PokéOrders → **ShipmentScope**, with a new logo, tagline,
  and a full "professional" visual pass (desaturated palette, Tabler
  icons instead of emoji, Inter font, brighter/more legible secondary
  text after an earlier contrast regression was caught and fixed).
- Added: Package Tracking tab, Order Detail view with a real status
  timeline + private notes, archiving, undo-delete, price-range
  filtering, keyboard shortcuts, desktop notifications, full JSON
  backup/restore, a customizable Insights widget dashboard (2 widgets by
  default, addable/removable), and multi-IMAP-account support (connect
  Gmail + iCloud + others simultaneously, each auto-polled).
