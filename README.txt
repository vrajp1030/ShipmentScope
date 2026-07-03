ShipmentScope — Real Inbox Sync Setup
====================================
(formerly PokéOrders)

QUICK START (2 minutes):
1. Make sure Node.js is installed (nodejs.org)
2. Double-click "Start PokéOrders.command" — it does everything automatically
3. Your browser opens to http://localhost:3876
4. Create an account (Sign up) — this is real: your own email/password
   login, even for using it just on your own Mac. It's what makes it
   safe to eventually let anyone else use this without seeing your data.
5. Go to the Sync tab → configure iCloud or Gmail → click Scan

FOR iCLOUD:
- Email: your @icloud.com or @me.com address
- Password: App-specific password (NOT your Apple ID password)
  → Get one at: appleid.apple.com → Sign-In & Security → App-Specific Passwords
- Server: imap.mail.me.com  Port: 993

FOR GMAIL:
- Email: your @gmail.com address  
- Password: App-specific password (NOT your Gmail password)
  → Get one at: myaccount.google.com → Security → 2-Step Verification → App passwords
- Server: imap.gmail.com  Port: 993
  (Also enable IMAP: Gmail Settings → See all settings → Forwarding and POP/IMAP)

MAKE IT A MAC APP:
  npm install electron --save-dev
  npx electron-packager . PokéOrders --platform=darwin --arch=arm64 --out=dist
  Drag PokéOrders.app from dist/ to your Applications folder

HOW THE SCAN WORKS:
- Scans the last 30 days of your inbox
- Detects order confirmations, shipping alerts, and cancellations
- Recognizes order emails from any store (reads the store name from the sender)
- Extracts: order numbers, tracking numbers, prices, dates
- You review and import — nothing is auto-added without your approval

PRIVACY:
- Everything runs 100% locally on your Mac (unless you deploy it
  elsewhere yourself)
- No data leaves your computer
- Your account password is hashed (scrypt), never stored in plain text
- Your connected email accounts' passwords are encrypted at rest
  (AES-256-GCM) in the local data/ folder
- Every account's orders and connected email accounts are fully
  isolated from every other account on the same install

DEPLOYING SOMEWHERE PUBLIC (not just localhost):
- Set an ENCRYPTION_KEY environment variable to a long random string
  before first run — this is the key that protects everyone's stored
  email passwords. Without it, a key is auto-generated and saved next
  to the app (fine for local use, less ideal if the whole folder could
  ever leak).
- Optionally set SITE_PASSWORD for an extra outer lock (a single shared
  password prompt before anyone even reaches the login screen) — handy
  for keeping a beta deployment fully private while testing.
- Optionally set ADMIN_PASSWORD to turn on a developer stats page at
  /admin (disabled/404 unless you set this) — shows real aggregate
  numbers (total accounts, orders tracked, order value, connected
  email accounts, activity) across everyone using this install. Never
  shows any individual user's personal data.
- The data/ folder holds every account's users.json, orders, and
  encrypted IMAP credentials. Back it up; losing it loses everyone's
  data (and the encryption key, if you didn't set ENCRYPTION_KEY
  yourself, since it's stored inside that same folder).

PRODUCT ROADMAP — honest breakdown
===================================
A full "compete with 17TRACK/AfterShip" feature list has been discussed
(universal carrier tracking, SMS/push notifications, user accounts with
multi-device sync, AI delay prediction, store platform integrations, an
admin panel, 2FA, a mobile app, a browser extension, etc). None of that
was silently built, because doing it for real — not faking it — needs
one of three things from you first. Here's the honest split:

1) Buildable right now, no new accounts needed (ask any time):
   - Delivery-history views, shipping-cost breakdowns, carrier
     comparison from your own past orders, calendar reminders for
     expected deliveries, a "share this order" read-only link,
     CSV/JSON import-export (already done), more Insights widgets.

2) Needs YOU to sign up for an external service (usually free tier
   available, sometimes paid at higher volume):
   - Real-time carrier tracking (actual UPS/FedEx/DHL scan events,
     map view) → a tracking API such as 17track.net or EasyPost.
   - SMS alerts → Twilio (has a small per-message cost).
   - Store integrations (Shopify, WooCommerce, Etsy, eBay, Amazon
     orders) → each needs an app registered with that platform.
   Tell the assistant which one you want first and it'll set up the
   integration once you have the account/API key.

3) Requires turning this from "a local app on your Mac" into a hosted,
   public multi-user web service — this part is now DONE at the code
   level (real accounts, login, per-user data isolation, encrypted
   credentials, rate limiting, self-service account deletion — see
   CHANGELOG.md, 2026-07-01). What's still needed before opening it to
   real strangers:
   - Actual 24/7 hosting (a server that's always on, not your Mac)
   - Privacy Policy + Terms of Service in place (see below)
   - Push notifications, a mobile app, a browser extension — still not
     built, and not required just to have multiple people log in
   - A full admin panel (user management, error logs, support tickets)
     — a lightweight developer STATS view exists now (/admin), but
     there's still no way to manage individual users from it
   - Two-factor auth — worth adding before any public launch, not yet
     built (a real CAPTCHA needs an external service like hCaptcha;
     a basic honeypot + rate limiting are in place as a first layer)
   - Email verification on signup, and a "forgot password" flow — both
     need an outbound email-sending capability (e.g. Postmark/SendGrid),
     which this app doesn't have yet
