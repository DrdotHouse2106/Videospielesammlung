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
- Optional HTTP Basic Auth

**Stack:** Node.js 22 · Express 5 · SQLite (better-sqlite3) · React 19 · Vite · Tailwind CSS 4

## Quick start (Docker)

```bash
git clone https://github.com/DrdotHouse2106/Videospielesammlung.git
cd Videospielesammlung
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3000>. Data is stored in the `sammlung-daten` Docker volume.

## Configuration

All settings live in `.env` (template: [`.env.example`](.env.example); `.env` is git-ignored).
The most important ones:

| Variable | Description |
| --- | --- |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | IGDB credentials from <https://dev.twitch.tv/console> |
| `BARCODE_PROVIDERS`, `OPENGTINDB_QUERYID` | Barcode → product name lookup (opengtindb.org, upcitemdb.com) |
| `AUTH_USER`, `AUTH_PASSWORD` | Enable Basic Auth (strongly recommended when exposed to the internet) |
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
