# 🎮 ZockDB

**Your game collection in one place – self-hosted, mobile-first retro & video game collection manager.**

> 🇩🇪 The primary documentation is in German: [README.md](README.md). The app's user interface is German only.

ZockDB (formerly “Videospielesammlung”) is a source-available Progressive Web App for managing **games, consoles/hardware and accessories**,
tailored to collectors in German-speaking countries (PAL/USK regions, CIB status, special colours, editions and
model revisions).

> 🔒 **Security is a top priority.** Found a vulnerability? Every report is appreciated – please report it privately via
> [GitHub Security Advisories](https://github.com/DrdotHouse2106/ZockDB/security/advisories/new). See [SECURITY.md](SECURITY.md).

## Features

- Games, consoles and accessories with variants: colour, edition, model number, serial number
- In-browser **barcode scanner** (EAN/UPC) via the device camera (`html5-qrcode`)
- **IGDB** search (via Twitch API) for games and platforms, cached locally in SQLite
- Custom catalogue entries for hardware, accessories and rare items; barcodes are learned on first use
- Own photos per item, filters, statistics, JSON/CSV export and JSON import
- Installable PWA with offline access to the last loaded data, light & dark mode
- User accounts with self-registration, scrypt password hashing and **two-factor authentication (TOTP)** with recovery codes
- **Collection value**: own estimates, optional PriceCharting market prices (converted to EUR), anonymous community values
- **Public collections** (visible to logged-in users; prices and serial numbers stay private)
- **Scans & documents per game**: high-resolution cover scans (incl. TIFF), PDF manuals – private or shared
- **Print covers at original size** (based on scan DPI) or fixed sizes, with crop marks
- Admin panel: lock users, roles (user/moderator/admin), reset 2FA, close registration
- **Moderated global catalogue**: only moderators/admins publish directly; users keep entries private or submit them for review; merge duplicates
- Fixed **platform taxonomy** (PS5, Switch, N64 …), **known variants/revisions** as a collecting checklist, multiple copies per item
- Private comments per item, **price history** (automatic market prices + user-reported offers/sales)
- **Admin dashboard**: users & roles, editable legal pages (imprint, privacy policy, terms), optional price import via the official eBay API
- Simple **public pages** (start page, search, game and platform pages) – switch off with `PUBLIC_CATALOG=false`
- **Settings in the web UI** (Admin → Settings): most `.env` values can be changed live; API keys are stored encrypted

- **Accounts & e-mail:** SMTP, confirmed e-mail addresses, password reset links, security notices, optional e-mail notifications
- **Spam protection** for sign-up and password reset: self-hosted ALTCHA (default, no cookies) or Google reCAPTCHA v3 (loaded only after consent)
- **Share your collection** via a secret link, also with people without an account
- **Notifications** (bell) for moderation decisions, reports and role changes; **achievements** and per-platform collection goals
- **CSV import** from CLZ Games, Excel/LibreOffice or the app's own export with automatic column mapping
- **Automatic database backups** (7 daily, 12 monthly)
- **Trading market (buy/sell/trade)** without payment processing: offers, wishlist with match notifications, trade suggestions,
  in-app messages, ratings, dealer profiles with CSV bulk upload and stock sync (`MARKET_ENABLED=false` switches it off); 50 free active offers, paid dealer
  packages (500/1,000/5,000 offers) and a paid API add-on for automatic Shopware 6 / CSV feed synchronisation (credentials stored encrypted);
  optional self-service booking via Stripe (card/SEPA) or PayPal (+ fee) with automatic invoices in ERPNext

**Stack:** Node.js 22 · Express 5 · SQLite (better-sqlite3) · sharp · React 19 · Vite · Tailwind CSS 4

## Quick start (Docker)

Save [`docker-compose.yml`](docker-compose.yml), adjust the `environment:` entries and run:

```bash
docker compose up -d
```

Open <http://localhost:3000>. The first account you register becomes administrator.
Data is stored in the `sammlung-daten` Docker volume – back up the whole directory including `geheimnis.key`.

### docker-compose.yml

You only need the file `docker-compose.yml` – no `git clone`, no build. It pulls the ready-made image
`ghcr.io/drdothouse2106/zockdb` (amd64 + arm64), and all settings are entries under `environment:`
(commented in German; empty `""` = default). Paste it as a stack into Portainer/Dockge or run `docker compose up -d`.
Update with `docker compose pull && docker compose up -d`. Data (SQLite database, uploads, `geheimnis.key`) lives in
the named volume `sammlung-daten` – `docker compose down -v` deletes it. Behind a reverse proxy bind to localhost only
(`"127.0.0.1:3000:3000"`) and set `TRUST_PROXY: "1"`. Clone the repository only if you want to change the code
(replace `image:` with `build: .`).

## Configuration

All settings live in `.env` (template: [`.env.example`](.env.example); `.env` is git-ignored).
The most important ones:

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | IGDB credentials from <https://dev.twitch.tv/console> |
| `BARCODE_PROVIDERS`, `OPENGTINDB_QUERYID` | Barcode → product name lookup (opengtindb.org, upcitemdb.com) |
| `REGISTRATION_OPEN`, `REQUIRE_2FA` | Open self-registration, enforce 2FA for all users |
| `APP_SECRET` | Key for encrypting 2FA secrets (auto-generated in `data/geheimnis.key` if empty) |
| `PRICECHARTING_TOKEN` | Optional market prices |
| `MEDIA_SHARING`, `MEDIA_MAX_MB` | Allow sharing scans, max. scan size |
| `STORAGE_QUOTA_MB` | Per-user storage for own photos and scans in MB (default 1024, `0` = unlimited; approved scans don't count, admins can override per user) |
| `PUBLIC_CATALOG`, `PUBLIC_URL` | Public pages without login (`false` = login required); public base URL for links in e-mails |
| `SMTP_*`, `CAPTCHA_PROVIDER` | E-mail (password reset, notifications) and spam protection (ALTCHA by default) |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy |

The camera (barcode scanner) only works over **HTTPS** or on `localhost` – use a reverse proxy such as Caddy.
See the German README for a full example.

## Development

```bash
npm install
npm run dev     # API on :3000, UI with hot reload on :5173
npm test
npm run build
```

Contributions are welcome – see [CONTRIBUTING.md](CONTRIBUTING.md) (German).

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) – free for personal, hobby and non-profit use; commercial use requires permission. Game data and cover art provided by [IGDB.com](https://www.igdb.com).
