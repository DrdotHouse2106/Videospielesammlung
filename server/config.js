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

/** Preis in Euro aus „19,90“ oder „19.90“ (ungültig = null). */
function preis(wert) {
  const n = Number(String(wert ?? '').trim().replace(/\s*€$/, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Händler-Pakete aus „500=9,90;1000=14,90;5000=29,90“ → [{ angebote, preis }], aufsteigend. */
export function lesePakete(wert) {
  return String(wert ?? '').split(/[;|]/).map((teil) => {
    const [anzahl, betrag] = teil.split('=');
    const angebote = Number.parseInt(String(anzahl ?? '').replace(/\D/g, ''), 10);
    return { angebote, preis: preis(betrag) };
  }).filter((p) => Number.isInteger(p.angebote) && p.angebote > 0 && p.preis !== null)
    .sort((a, b) => a.angebote - b.angebote);
}

/** Basis-URL der Seite (für Canonical-Links und Sitemap), ohne abschließenden Schrägstrich. */
function basisUrl(wert) {
  const roh = String(wert ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(roh) ? roh : '';
}

export function ladeKonfiguration(env = process.env) {
  const konfiguration = {
    port: zahl(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    datenbankPfad: pfad(env.DATABASE_PATH, 'data/sammlung.db'),
    uploadVerzeichnis: pfad(env.UPLOAD_DIR, 'data/uploads'),
    maxUploadMb: zahl(env.MAX_UPLOAD_MB, 8),
    maxMedienMb: zahl(env.MEDIA_MAX_MB, 200),
    medienTeilenErlaubt: jaNein(env.MEDIA_SHARING, true),
    // Speicherplatz je Benutzer für eigene Fotos und Scans in MB (0 = unbegrenzt)
    speicherKontingentMb: Math.max(0, zahl(env.STORAGE_QUOTA_MB, 1024)),
    // Katalogseiten (Spiele, Varianten, Preisverlauf, Kauflinks) auch ohne Anmeldung zeigen
    oeffentlicherKatalog: jaNein(env.PUBLIC_CATALOG, true),
    // Links zu externen Cover-/Handbuch-Seiten: optional nur bestimmte Domains erlauben (kommagetrennt)
    // Öffentliche Adresse, z. B. https://sammlung.example.de – für Suchmaschinen (Canonical, Sitemap)
    oeffentlicheUrl: basisUrl(env.PUBLIC_URL),
    linkDomains: (env.LINK_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean),
    cacheTtlStunden: zahl(env.CACHE_TTL_HOURS, 24 * 7),
    // Automatische Datenbank-Sicherung: die letzten X Tage täglich, die letzten Y Monate monatlich
    sicherung: {
      aktiv: jaNein(env.BACKUP_ENABLED, true),
      tage: Math.max(1, zahl(env.BACKUP_DAYS, 7)),
      monate: Math.max(0, zahl(env.BACKUP_MONTHS, 12)),
      verzeichnis: env.BACKUP_DIR ? pfad(env.BACKUP_DIR, '') : '',
      // Externe, verschlüsselte Sicherung bei einem frei wählbaren Anbieter
      extern: {
        ziel: ['s3', 'webdav', 'sftp'].includes(env.BACKUP_REMOTE) ? env.BACKUP_REMOTE : 'aus',
        url: (env.BACKUP_REMOTE_URL || '').trim(),
        bucket: (env.BACKUP_REMOTE_BUCKET || '').trim(),
        region: (env.BACKUP_REMOTE_REGION || '').trim() || 'us-east-1',
        benutzer: (env.BACKUP_REMOTE_USER || '').trim(),
        geheimnis: env.BACKUP_REMOTE_SECRET || '',
        pfad: (env.BACKUP_REMOTE_PATH || '').trim() || 'zockdb',
        passwort: env.BACKUP_REMOTE_PASSWORD || '',
        hostschluessel: (env.BACKUP_REMOTE_HOSTKEY || '').trim(),
        tage: Math.max(1, zahl(env.BACKUP_REMOTE_DAYS, 14)),
        monate: Math.max(0, zahl(env.BACKUP_REMOTE_MONTHS, 0)),
        uploads: jaNein(env.BACKUP_REMOTE_UPLOADS, true),
      },
    },
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
    // E-Mail-Versand (Passwort vergessen, Bestätigung der E-Mail-Adresse, Benachrichtigungen)
    mail: {
      host: (env.SMTP_HOST || '').trim(),
      port: zahl(env.SMTP_PORT, 587),
      sicher: (env.SMTP_SECURE || 'auto').trim().toLowerCase(), // auto (465 = TLS), true, false (STARTTLS)
      benutzer: (env.SMTP_USER || '').trim(),
      passwort: env.SMTP_PASSWORD || '',
      absender: (env.SMTP_FROM || '').trim(), // z. B. "ZockDB <noreply@zockdb.de>"
    },
    // Spam-Schutz für Registrierung und „Passwort vergessen“: altcha, recaptcha oder aus
    captcha: {
      anbieter: (env.CAPTCHA_PROVIDER || 'altcha').trim().toLowerCase(),
      recaptchaSiteKey: (env.RECAPTCHA_SITE_KEY || '').trim(),
      recaptchaSecret: (env.RECAPTCHA_SECRET || '').trim(),
      mindestScore: Math.min(0.9, Math.max(0.1, Number.parseFloat(env.RECAPTCHA_MIN_SCORE || '') || 0.5)),
    },
    // Muss bei der Registrierung eine E-Mail-Adresse angegeben werden?
    emailPflicht: jaNein(env.REQUIRE_EMAIL, false),
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
    // Tauschbörse (Suche/Biete) – ohne Zahlungsabwicklung
    boerse: {
      aktiv: jaNein(env.MARKET_ENABLED, true),
      laufzeitTage: Math.min(365, Math.max(1, zahl(env.MARKET_OFFER_DAYS, 90))),
      // Kostenlos: so viele aktive Angebote je Benutzer (auch per CSV-Upload)
      maxAngebote: Math.max(1, zahl(env.MARKET_MAX_OFFERS, 50)),
      // Kostenpflichtige Händler-Pakete (Anzahl aktiver Angebote = Monatspreis in Euro)
      pakete: lesePakete(env.MARKET_PACKAGES ?? '500=9,90;1000=14,90;5000=29,90'),
      // Zusatzpaket „API-Anbindung“ (Shop/ERP) – Monatspreis in Euro
      apiPreis: preis(env.MARKET_API_PRICE ?? '19,90') ?? 19.9,
      // Kostenloser Testzugang, den verifizierte Händler einmal selbst starten können (0 = nur durch Administratoren)
      testTage: Math.min(365, Math.max(0, zahl(env.MARKET_TRIAL_DAYS, 0))),
      // Neue Konten dürfen erst nach X Tagen Nachrichten schreiben – mit bestätigter E-Mail-Adresse sofort
      mindestKontoalterTage: Math.max(0, zahl(env.MARKET_MIN_ACCOUNT_DAYS, 3)),
      // Kontakt für Pakete und individuelle Anbindungen (E-Mail oder https-Adresse) und Zusatzhinweis (z. B. „zzgl. MwSt.“)
      proKontakt: (env.MARKET_PRO_CONTACT || '').trim(),
      proInfo: (env.MARKET_PRO_INFO || '').trim(),
    },
    // Automatische Zahlungsabwicklung für Händler-Pakete (Stripe: Karte/SEPA, PayPal mit Zahlungsgebühr)
    zahlung: {
      steuersatz: Math.min(100, Math.max(0, preis(env.PAYMENT_VAT_RATE ?? '19') ?? 19)), // Prozent; 0 z. B. bei Kleinunternehmern
      stripeSchluessel: (env.PAYMENT_STRIPE_SECRET_KEY || '').trim(),
      stripeWebhookGeheimnis: (env.PAYMENT_STRIPE_WEBHOOK_SECRET || '').trim(),
      paypalClientId: (env.PAYMENT_PAYPAL_CLIENT_ID || '').trim(),
      paypalGeheimnis: (env.PAYMENT_PAYPAL_SECRET || '').trim(),
      paypalWebhookId: (env.PAYMENT_PAYPAL_WEBHOOK_ID || '').trim(),
      paypalSandbox: (env.PAYMENT_PAYPAL_MODE || 'live').trim().toLowerCase() === 'sandbox',
      paypalGebuehr: preis(env.PAYMENT_PAYPAL_FEE ?? '1,00') ?? 1, // netto je Monat
      // Zahlung per Rechnung: ERPNext verschickt die Rechnung, Zahlungseingang wird in ERPNext gebucht
      rechnung: jaNein(env.PAYMENT_INVOICE_ENABLED, true),
      zahlungszielTage: Math.min(60, Math.max(1, zahl(env.PAYMENT_INVOICE_DAYS, 7))),
    },
    // Rechnungen in ERPNext (REST-API mit API-Schlüssel eines Benutzers mit Rechten für Kunden, Rechnungen und Zahlungen)
    erpnext: {
      url: basisUrl(env.ERPNEXT_URL),
      schluessel: (env.ERPNEXT_API_KEY || '').trim(),
      geheimnis: (env.ERPNEXT_API_SECRET || '').trim(),
      firma: (env.ERPNEXT_COMPANY || '').trim(),
      artikel: (env.ERPNEXT_ITEM_CODE || 'ZOCKDB-ABO').trim(),
      steuervorlage: (env.ERPNEXT_TAX_TEMPLATE || '').trim(),
      kontoStripe: (env.ERPNEXT_ACCOUNT_STRIPE || '').trim(),
      kontoPaypal: (env.ERPNEXT_ACCOUNT_PAYPAL || '').trim(),
      druckformat: (env.ERPNEXT_PRINT_FORMAT || 'Standard').trim(),
    },
    vertrauteProxies: env.TRUST_PROXY || '',
    affiliate: ladeAffiliateKonfiguration(env),
  };
  // Quelle merken: Einstellungen aus der Weboberfläche werden darüber gelegt (siehe services/einstellungen.js)
  Object.defineProperty(konfiguration, 'quellEnv', { value: env, enumerable: false, writable: true });
  return konfiguration;
}

/** Überträgt eine neu geladene Konfiguration in das bestehende Objekt, damit alle Verweise aktuell bleiben. */
export function uebernehmeKonfiguration(ziel, neu) {
  for (const [schluessel, wert] of Object.entries(neu)) {
    const istObjekt = (w) => w && typeof w === 'object' && !Array.isArray(w);
    if (istObjekt(wert) && istObjekt(ziel[schluessel])) Object.assign(ziel[schluessel], wert);
    else ziel[schluessel] = wert;
  }
  return ziel;
}
