# 🎮 Videospielesammlung (Video Game Collection)

**Your self-hosted, mobile-first retro & video game collection manager.**

> 🇩🇪 The primary documentation is in German: [README.md](README.md). The app's user interface is German only.

Videospielesammlung is an open-source Progressive Web App for managing **games, consoles/hardware and accessories**,
tailored to collectors in German-speaking countries (PAL/USK regions, CIB status, special colours, editions and
model revisions).

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
- Admin panel: lock users, roles, reset 2FA, close registration

**Stack:** Node.js 22 · Express 5 · SQLite (better-sqlite3) · sharp · React 19 · Vite · Tailwind CSS 4

## Quick start (Docker)

```bash
git clone https://github.com/DrdotHouse2106/Videospielesammlung.git
cd Videospielesammlung
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>. The first account you register becomes administrator.
Data is stored in the `sammlung-daten` Docker volume – back up the whole directory including `geheimnis.key`.

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

[MIT](LICENSE). Game data and cover art provided by [IGDB.com](https://www.igdb.com).
