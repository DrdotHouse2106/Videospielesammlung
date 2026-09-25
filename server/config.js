import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ladeAffiliateKonfiguration } from './services/affiliate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJEKT_WURZEL = path.resolve(__dirname, '..');

// .env-Datei laden, falls vorhanden (Node >= 20.12 bringt das von Haus aus mit).
// Bereits gesetzte Umgebungsvariablen (z. B. aus Docker) haben Vorrang.
const envDatei = path.join(PROJEKT_WURZEL, '.env');
if (fs.existsSync(envDatei) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envDatei);
}

function zahl(wert, standard) {
  const n = Number.parseInt(wert ?? '', 10);
  return Number.isFinite(n) ? n : standard;
}

function jaNein(wert, standard) {
  if (wert === undefined || wert === '') return standard;
  return ['1', 'true', 'ja', 'yes', 'on'].includes(String(wert).trim().toLowerCase());
}

function pfad(wert, standard) {
  const p = wert && wert.trim() ? wert.trim() : standard;
  return path.isAbsolute(p) ? p : path.join(PROJEKT_WURZEL, p);
}

export function ladeKonfiguration(env = process.env) {
  return {
    port: zahl(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    datenbankPfad: pfad(env.DATABASE_PATH, 'data/sammlung.db'),
    uploadVerzeichnis: pfad(env.UPLOAD_DIR, 'data/uploads'),
    maxUploadMb: zahl(env.MAX_UPLOAD_MB, 8),
    maxMedienMb: zahl(env.MEDIA_MAX_MB, 200),
    medienTeilenErlaubt: jaNein(env.MEDIA_SHARING, true),
    // Katalogseiten (Spiele, Varianten, Preisverlauf, Kauflinks) auch ohne Anmeldung zeigen
    oeffentlicherKatalog: jaNein(env.PUBLIC_CATALOG, true),
    // Links zu externen Cover-/Handbuch-Seiten: optional nur bestimmte Domains erlauben (kommagetrennt)
    linkDomains: (env.LINK_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean),
    cacheTtlStunden: zahl(env.CACHE_TTL_HOURS, 24 * 7),
    igdb: {
      clientId: (env.TWITCH_CLIENT_ID || '').trim(),
      clientSecret: (env.TWITCH_CLIENT_SECRET || '').trim(),
    },
    barcode: {
      // Kommagetrennte Liste der Online-Dienste für die EAN-/UPC-Suche.
      anbieter: (env.BARCODE_PROVIDERS ?? 'opengtindb,upcitemdb')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      openGtinDbQueryId: (env.OPENGTINDB_QUERYID || '').trim(),
    },
    konten: {
      // Geheimer Schlüssel zum Verschlüsseln der 2FA-Geheimnisse. Ohne Angabe wird
      // automatisch einer erzeugt und neben der Datenbank gespeichert.
      appGeheimnis: (env.APP_SECRET || '').trim(),
      registrierungOffen: jaNein(env.REGISTRATION_OPEN, true),
      zweiFaktorPflicht: jaNein(env.REQUIRE_2FA, false),
      sitzungTage: zahl(env.SESSION_DAYS, 30),
      registrierungenProStunde: zahl(env.REGISTRATIONS_PER_HOUR, 5),
      cookieSicher: (env.COOKIE_SECURE || 'auto').trim().toLowerCase(),
    },
    ebay: {
      // Kostenloser Zugang: https://developer.ebay.com → Application Keys (Production)
      clientId: (env.EBAY_CLIENT_ID || '').trim(),
      clientSecret: (env.EBAY_CLIENT_SECRET || '').trim(),
      marktplatz: (env.EBAY_MARKETPLACE || 'EBAY_DE').trim(),
      standort: (env.EBAY_ITEM_LOCATION || 'DE').trim(),
      kategorien: (env.EBAY_CATEGORY_IDS || '').trim(),
    },
    // Automatischer Preisimport alle X Stunden (0 = aus) und max. Einträge pro Durchlauf
    preisimportStunden: zahl(env.PRICE_IMPORT_HOURS, 24),
    preisimportMax: zahl(env.PRICE_IMPORT_MAX, 150),
    preise: {
      priceChartingToken: (env.PRICECHARTING_TOKEN || '').trim(),
      usdEurKurs: Number.parseFloat(env.USD_EUR_RATE || '') || null,
      cacheStunden: zahl(env.PRICE_CACHE_HOURS, 72),
    },
    // KI-Vorprüfung von Einreichungen – Anbieter frei wählbar
    ki: {
      anbieter: (env.AI_PROVIDER || 'aus').trim().toLowerCase(), // anthropic, gemini, openai, aus
      apiKey: (env.AI_API_KEY || '').trim(),
      modell: (env.AI_MODEL || '').trim(),
      basisUrl: (env.AI_BASE_URL || '').trim(), // nur für OpenAI-kompatible Anbieter (z. B. Mistral, Ollama)
      automatischFreigeben: jaNein(env.AI_AUTO_APPROVE, true),
      automatischAblehnen: jaNein(env.AI_AUTO_REJECT, true),
      mindestKonfidenz: Math.min(1, Math.max(0.5, Number.parseFloat(env.AI_MIN_CONFIDENCE || '') || 0.85)),
    },
    vertrauteProxies: env.TRUST_PROXY || '',
    affiliate: ladeAffiliateKonfiguration(env),
  };
}
