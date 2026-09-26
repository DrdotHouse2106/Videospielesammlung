// Server-Einstellungen über die Weboberfläche (Admin → Einstellungen).
//
// Die .env bleibt die Grundeinstellung. Werte, die ein Administrator in der Oberfläche setzt,
// werden in der Datenbank gespeichert und haben Vorrang. Geheimnisse (API-Schlüssel) werden
// mit AES-256-GCM verschlüsselt abgelegt und nie wieder im Klartext ausgeliefert.
// Pfade, Port, Proxy- und Cookie-Einstellungen sowie APP_SECRET sind bewusst nur über die
// .env änderbar – eine Fehleinstellung dort könnte den Server aussperren oder unsicher machen.
import { ladeKonfiguration, uebernehmeKonfiguration } from '../config.js';
import { verschluessele, entschluessele } from './sicherheit.js';
import { ValidierungsFehler } from './validierung.js';

const JA_NEIN = { typ: 'jaNein' };

/** Alle über die Oberfläche änderbaren Einstellungen. `sicher` = nur mit Passwortbestätigung. */
export const EINSTELLUNGEN = [
  // Konten
  { schluessel: 'REGISTRATION_OPEN', gruppe: 'Konten & Sicherheit', titel: 'Registrierung offen', ...JA_NEIN, sicher: true,
    hinweis: 'Dürfen sich neue Benutzer selbst registrieren?' },
  { schluessel: 'REQUIRE_2FA', gruppe: 'Konten & Sicherheit', titel: 'Zwei-Faktor-Anmeldung für alle Pflicht', ...JA_NEIN, sicher: true,
    hinweis: 'Benutzer ohne 2FA müssen sie vor der Nutzung einrichten.' },
  { schluessel: 'CAPTCHA_PROVIDER', gruppe: 'Konten & Sicherheit', titel: 'Spam-Schutz bei Registrierung', typ: 'auswahl', sicher: true,
    optionen: [['altcha', 'ALTCHA (ohne Google, ohne Cookies)'], ['recaptcha', 'Google reCAPTCHA v3 (mit Einwilligung)'], ['aus', 'Aus']],
    hinweis: 'reCAPTCHA überträgt Daten an Google (USA) und wird erst nach Einwilligung geladen – Datenschutzerklärung anpassen.' },
  { schluessel: 'RECAPTCHA_SITE_KEY', gruppe: 'Konten & Sicherheit', titel: 'reCAPTCHA-Websiteschlüssel', typ: 'text' },
  { schluessel: 'RECAPTCHA_SECRET', gruppe: 'Konten & Sicherheit', titel: 'reCAPTCHA-Geheimschlüssel', typ: 'geheim', sicher: true },
  { schluessel: 'RECAPTCHA_MIN_SCORE', gruppe: 'Konten & Sicherheit', titel: 'reCAPTCHA-Mindestscore', typ: 'dezimal', min: 0.1, max: 0.9,
    hinweis: '0,1 (lässt fast alle durch) bis 0,9 (sehr streng). Standard 0,5.' },
  // Uploads
  { schluessel: 'STORAGE_QUOTA_MB', gruppe: 'Uploads & Speicher', titel: 'Speicherplatz je Benutzer (MB)', typ: 'zahl', min: 0, max: 10_000_000,
    hinweis: '0 = unbegrenzt. Freigegebene Scans zählen nicht mit.' },
  { schluessel: 'MAX_UPLOAD_MB', gruppe: 'Uploads & Speicher', titel: 'Maximale Größe von Artikelfotos (MB)', typ: 'zahl', min: 1, max: 100 },
  { schluessel: 'MEDIA_MAX_MB', gruppe: 'Uploads & Speicher', titel: 'Maximale Größe von Scans/PDFs (MB)', typ: 'zahl', min: 1, max: 2000 },
  { schluessel: 'MEDIA_SHARING', gruppe: 'Uploads & Speicher', titel: 'Scans dürfen geteilt werden', ...JA_NEIN,
    hinweis: 'Benutzer können eigene Scans zur Freigabe für alle einreichen.' },
  { schluessel: 'BACKUP_ENABLED', gruppe: 'Uploads & Speicher', titel: 'Automatische Datenbank-Sicherung', ...JA_NEIN,
    hinweis: 'Täglich eine Sicherung der Datenbank im Datenordner (Unterordner „sicherungen“).' },
  { schluessel: 'BACKUP_DAYS', gruppe: 'Uploads & Speicher', titel: 'Tägliche Sicherungen aufbewahren (Tage)', typ: 'zahl', min: 1, max: 90 },
  { schluessel: 'BACKUP_MONTHS', gruppe: 'Uploads & Speicher', titel: 'Monatliche Sicherungen aufbewahren (Monate)', typ: 'zahl', min: 0, max: 120,
    hinweis: '0 = keine monatlichen Sicherungen.' },
  // Öffentlicher Katalog
  { schluessel: 'PUBLIC_CATALOG', gruppe: 'Öffentlicher Katalog & Suchmaschinen', titel: 'Katalog ohne Anmeldung sichtbar', ...JA_NEIN,
    hinweis: 'Voraussetzung dafür, dass Suchmaschinen die Spieleseiten finden.' },
  { schluessel: 'PUBLIC_URL', gruppe: 'Öffentlicher Katalog & Suchmaschinen', titel: 'Öffentliche Adresse', typ: 'url', platzhalter: 'https://sammlung.example.de',
    hinweis: 'Für Canonical-Links und die Sitemap. Leer = Adresse der jeweiligen Anfrage.' },
  { schluessel: 'LINK_DOMAINS', gruppe: 'Öffentlicher Katalog & Suchmaschinen', titel: 'Erlaubte Domains für externe Links', typ: 'text',
    platzhalter: 'z. B. nintendo.de, archive.org', hinweis: 'Kommagetrennt. Leer = alle HTTPS-Seiten erlaubt.' },
  // KI
  { schluessel: 'AI_PROVIDER', gruppe: 'KI-Vorprüfung', titel: 'Anbieter', typ: 'auswahl', sicher: true,
    optionen: [['aus', 'Aus'], ['anthropic', 'Anthropic (Claude)'], ['gemini', 'Google Gemini'], ['openai', 'OpenAI-kompatibel (OpenAI, Mistral, Ollama …)']] },
  { schluessel: 'AI_MODEL', gruppe: 'KI-Vorprüfung', titel: 'Modell', typ: 'text', hinweis: 'Leer = Standardmodell des Anbieters (falls vorhanden).' },
  { schluessel: 'AI_BASE_URL', gruppe: 'KI-Vorprüfung', titel: 'Basis-URL (nur OpenAI-kompatibel)', typ: 'url', sicher: true,
    platzhalter: 'https://api.mistral.ai/v1' },
  { schluessel: 'AI_API_KEY', gruppe: 'KI-Vorprüfung', titel: 'API-Schlüssel', typ: 'geheim', sicher: true },
  { schluessel: 'AI_MIN_CONFIDENCE', gruppe: 'KI-Vorprüfung', titel: 'Mindest-Konfidenz für automatische Entscheidungen', typ: 'dezimal', min: 0.5, max: 1,
    hinweis: 'Zwischen 0,5 und 1. Unsichere Fälle gehen immer an das Moderationsteam.' },
  { schluessel: 'AI_AUTO_APPROVE', gruppe: 'KI-Vorprüfung', titel: 'Eindeutige Fälle automatisch freigeben', ...JA_NEIN },
  { schluessel: 'AI_AUTO_REJECT', gruppe: 'KI-Vorprüfung', titel: 'Eindeutige Fälle automatisch ablehnen', ...JA_NEIN },
  // Preise
  { schluessel: 'PRICE_IMPORT_HOURS', gruppe: 'Preise & Angebote', titel: 'Automatischer Preisimport alle … Stunden', typ: 'zahl', min: 0, max: 720,
    hinweis: '0 = aus.' },
  { schluessel: 'PRICE_IMPORT_MAX', gruppe: 'Preise & Angebote', titel: 'Einträge pro Importlauf', typ: 'zahl', min: 1, max: 5000 },
  { schluessel: 'EBAY_CLIENT_ID', gruppe: 'Preise & Angebote', titel: 'eBay Client-ID', typ: 'text' },
  { schluessel: 'EBAY_CLIENT_SECRET', gruppe: 'Preise & Angebote', titel: 'eBay Client-Secret', typ: 'geheim', sicher: true },
  { schluessel: 'EBAY_MARKETPLACE', gruppe: 'Preise & Angebote', titel: 'eBay-Marktplatz', typ: 'text', platzhalter: 'EBAY_DE' },
  { schluessel: 'PRICECHARTING_TOKEN', gruppe: 'Preise & Angebote', titel: 'PriceCharting-Token', typ: 'geheim', sicher: true },
  // E-Mail
  { schluessel: 'SMTP_HOST', gruppe: 'E-Mail (SMTP)', titel: 'SMTP-Server', typ: 'text', platzhalter: 'smtp.example.de',
    hinweis: 'Für „Passwort vergessen“, die Bestätigung der E-Mail-Adresse und Benachrichtigungen. Links in E-Mails brauchen die öffentliche Adresse (PUBLIC_URL).' },
  { schluessel: 'SMTP_PORT', gruppe: 'E-Mail (SMTP)', titel: 'Port', typ: 'zahl', min: 1, max: 65535, hinweis: '587 (STARTTLS) oder 465 (TLS).' },
  { schluessel: 'SMTP_SECURE', gruppe: 'E-Mail (SMTP)', titel: 'Verschlüsselung', typ: 'auswahl',
    optionen: [['auto', 'Automatisch (465 = TLS, sonst STARTTLS)'], ['true', 'TLS'], ['false', 'STARTTLS']] },
  { schluessel: 'SMTP_USER', gruppe: 'E-Mail (SMTP)', titel: 'Benutzername', typ: 'text' },
  { schluessel: 'SMTP_PASSWORD', gruppe: 'E-Mail (SMTP)', titel: 'Passwort', typ: 'geheim', sicher: true },
  { schluessel: 'SMTP_FROM', gruppe: 'E-Mail (SMTP)', titel: 'Absender', typ: 'text', platzhalter: 'ZockDB <noreply@zockdb.de>' },
  { schluessel: 'REQUIRE_EMAIL', gruppe: 'Konten & Sicherheit', titel: 'E-Mail-Adresse bei der Registrierung Pflicht', ...JA_NEIN,
    hinweis: 'Nur wirksam, wenn der E-Mail-Versand eingerichtet ist.' },
  // Tauschbörse
  { schluessel: 'MARKET_ENABLED', gruppe: 'Tauschbörse', titel: 'Tauschbörse (Suche/Biete) aktiv', ...JA_NEIN,
    hinweis: 'Angebote, Wunschlisten und Nachrichten zwischen Benutzern. Es werden keine Zahlungen abgewickelt.' },
  { schluessel: 'MARKET_OFFER_DAYS', gruppe: 'Tauschbörse', titel: 'Laufzeit eines Angebots (Tage)', typ: 'zahl', min: 1, max: 365 },
  { schluessel: 'MARKET_MAX_OFFERS', gruppe: 'Tauschbörse', titel: 'Kostenlose aktive Angebote je Benutzer', typ: 'zahl', min: 1, max: 100000,
    hinweis: 'Gilt für alle ohne gebuchtes Händler-Paket – auch beim CSV-Upload.' },
  { schluessel: 'MARKET_PACKAGES', gruppe: 'Tauschbörse', titel: 'Händler-Pakete (Angebote = Monatspreis in €)', typ: 'text',
    platzhalter: '500=9,90;1000=14,90;5000=29,90', hinweis: 'Mit Semikolon getrennt. Die Pakete schaltet ein Administrator in der Benutzerverwaltung frei.' },
  { schluessel: 'MARKET_TRIAL_DAYS', gruppe: 'Tauschbörse', titel: 'Testzugang zum Selbststarten (Tage)', typ: 'zahl', min: 0, max: 365,
    hinweis: '0 = aus. Sonst können verifizierte Händler einmalig selbst einen kostenlosen Test (größtes Paket + API-Anbindung) starten. Administratoren können Testzugänge immer vergeben.' },
  { schluessel: 'MARKET_API_PRICE', gruppe: 'Tauschbörse', titel: 'Zusatzpaket API-Anbindung (Monatspreis in €)', typ: 'text', platzhalter: '19,90' },
  { schluessel: 'MARKET_MIN_ACCOUNT_DAYS', gruppe: 'Tauschbörse', titel: 'Nachrichten erst ab Kontoalter (Tage)', typ: 'zahl', min: 0, max: 60,
    hinweis: 'Schutz vor Spam. Mit bestätigter E-Mail-Adresse sofort möglich.' },
  { schluessel: 'MARKET_PRO_CONTACT', gruppe: 'Tauschbörse', titel: 'Kontakt für Händler-Pakete und individuelle Anbindungen', typ: 'text',
    platzhalter: 'haendler@example.de oder https://example.de/haendler', hinweis: 'E-Mail-Adresse oder https-Adresse. Wird im Händlerbereich angezeigt.' },
  { schluessel: 'MARKET_PRO_INFO', gruppe: 'Tauschbörse', titel: 'Zusatzhinweis zu den Preisen', typ: 'text',
    platzhalter: 'z. B. zzgl. MwSt., monatlich kündbar' },
  // Zahlungen
  { schluessel: 'PAYMENT_VAT_RATE', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'Umsatzsteuersatz (%)', typ: 'dezimal', min: 0, max: 100,
    hinweis: 'Alle Paketpreise sind Nettopreise; berechnet wird brutto. 0 z. B. bei Kleinunternehmerregelung – bitte mit dem Steuerberater klären.' },
  { schluessel: 'PAYMENT_STRIPE_SECRET_KEY', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'Stripe: Geheimer Schlüssel', typ: 'geheim', sicher: true,
    hinweis: 'sk_live_… bzw. zum Testen sk_test_… (Stripe-Dashboard → Entwickler → API-Schlüssel).' },
  { schluessel: 'PAYMENT_STRIPE_WEBHOOK_SECRET', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'Stripe: Webhook-Signaturgeheimnis', typ: 'geheim', sicher: true,
    hinweis: 'whsec_… – Webhook-Adresse: PUBLIC_URL + /api/zahlung/stripe/webhook, Ereignisse: checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted.' },
  { schluessel: 'PAYMENT_PAYPAL_CLIENT_ID', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'PayPal: Client-ID', typ: 'text' },
  { schluessel: 'PAYMENT_PAYPAL_SECRET', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'PayPal: Geheimnis', typ: 'geheim', sicher: true },
  { schluessel: 'PAYMENT_PAYPAL_WEBHOOK_ID', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'PayPal: Webhook-ID', typ: 'text',
    hinweis: 'Webhook-Adresse: PUBLIC_URL + /api/zahlung/paypal/webhook, Ereignisse: BILLING.SUBSCRIPTION.ACTIVATED, .CANCELLED, .EXPIRED, .SUSPENDED und PAYMENT.SALE.COMPLETED.' },
  { schluessel: 'PAYMENT_PAYPAL_MODE', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'PayPal-Modus', typ: 'auswahl', sicher: true,
    optionen: [['live', 'Live'], ['sandbox', 'Sandbox (Test)']] },
  { schluessel: 'PAYMENT_INVOICE_ENABLED', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'Zahlung per Rechnung anbieten', ...JA_NEIN,
    hinweis: 'Braucht ERPNext: Die Rechnung wird dort angelegt und per E-Mail verschickt. Den Zahlungseingang buchst du in ERPNext – ZockDB erkennt ihn automatisch.' },
  { schluessel: 'PAYMENT_INVOICE_DAYS', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'Zahlungsziel bei Rechnung (Tage)', typ: 'zahl', min: 1, max: 60 },
  { schluessel: 'PAYMENT_PAYPAL_FEE', gruppe: 'Zahlungen (Stripe, PayPal)', titel: 'PayPal: Zahlungsgebühr je Monat (€, netto)', typ: 'text', platzhalter: '1,00' },
  // ERPNext
  { schluessel: 'ERPNEXT_URL', gruppe: 'Rechnungen (ERPNext)', titel: 'Adresse von ERPNext', typ: 'url', sicher: true, platzhalter: 'https://erp.example.de' },
  { schluessel: 'ERPNEXT_API_KEY', gruppe: 'Rechnungen (ERPNext)', titel: 'API-Schlüssel', typ: 'text',
    hinweis: 'In ERPNext beim Benutzer unter „API-Zugang“ erzeugen. Rechte: Kunde, Ausgangsrechnung, Zahlung (anlegen und buchen).' },
  { schluessel: 'ERPNEXT_API_SECRET', gruppe: 'Rechnungen (ERPNext)', titel: 'API-Geheimnis', typ: 'geheim', sicher: true },
  { schluessel: 'ERPNEXT_COMPANY', gruppe: 'Rechnungen (ERPNext)', titel: 'Firma (wie in ERPNext)', typ: 'text' },
  { schluessel: 'ERPNEXT_ITEM_CODE', gruppe: 'Rechnungen (ERPNext)', titel: 'Artikel-Code für die Abos', typ: 'text', platzhalter: 'ZOCKDB-ABO',
    hinweis: 'Dienstleistungsartikel ohne Lagerhaltung. Bezeichnung und Zeitraum werden je Rechnung eingetragen.' },
  { schluessel: 'ERPNEXT_TAX_TEMPLATE', gruppe: 'Rechnungen (ERPNext)', titel: 'Vorlage Umsatzsteuer', typ: 'text', platzhalter: 'Germany VAT 19% - ZDB',
    hinweis: 'Name der Vorlage „Verkaufssteuern und -abgaben“. Leer = ohne Steuerzeilen (z. B. Kleinunternehmer).' },
  { schluessel: 'ERPNEXT_ACCOUNT_STRIPE', gruppe: 'Rechnungen (ERPNext)', titel: 'Konto für Stripe-Zahlungen', typ: 'text', platzhalter: 'Stripe - ZDB',
    hinweis: 'Leer = Rechnung wird nur angelegt, nicht als bezahlt verbucht.' },
  { schluessel: 'ERPNEXT_PRINT_FORMAT', gruppe: 'Rechnungen (ERPNext)', titel: 'Druckformat für den E-Mail-Versand', typ: 'text', platzhalter: 'Standard',
    hinweis: 'Wird bei „Zahlung per Rechnung“ als PDF an die E-Mail gehängt – am besten mit Bankverbindung im Briefkopf/Fußtext.' },
  { schluessel: 'ERPNEXT_ACCOUNT_PAYPAL', gruppe: 'Rechnungen (ERPNext)', titel: 'Konto für PayPal-Zahlungen', typ: 'text', platzhalter: 'PayPal - ZDB' },
  // Affiliate
  { schluessel: 'AFFILIATE_LINKS', gruppe: 'Affiliate-Links („Hier kaufen“)', titel: 'Kauflinks anzeigen', ...JA_NEIN,
    hinweis: 'Nein = keine Amazon-/eBay-Suchlinks und keine eBay-Angebote mit Partner-ID.' },
  { schluessel: 'AFFILIATE_AMAZON_TAG', gruppe: 'Affiliate-Links („Hier kaufen“)', titel: 'Amazon-Tracking-ID', typ: 'text', platzhalter: 'deinname-21',
    hinweis: 'Aus dem Amazon-PartnerNet. Leer = Standard-ID aus dem Code, aber nur auf den dort freigegebenen Domains.' },
  { schluessel: 'AFFILIATE_EBAY_CAMPID', gruppe: 'Affiliate-Links („Hier kaufen“)', titel: 'eBay-Partner-Network-Kampagnen-ID', typ: 'text', platzhalter: '5338000000',
    hinweis: 'Leer = Standard-ID aus dem Code, aber nur auf den dort freigegebenen Domains.' },
  // Spieledaten
  { schluessel: 'TWITCH_CLIENT_ID', gruppe: 'Spieledaten (IGDB) & Barcodes', titel: 'Twitch Client-ID (IGDB)', typ: 'text' },
  { schluessel: 'TWITCH_CLIENT_SECRET', gruppe: 'Spieledaten (IGDB) & Barcodes', titel: 'Twitch Client-Secret (IGDB)', typ: 'geheim', sicher: true },
  { schluessel: 'BARCODE_PROVIDERS', gruppe: 'Spieledaten (IGDB) & Barcodes', titel: 'Barcode-Dienste', typ: 'text', platzhalter: 'opengtindb,upcitemdb',
    hinweis: 'Kommagetrennt, Reihenfolge = Abfragereihenfolge.' },
  { schluessel: 'OPENGTINDB_QUERYID', gruppe: 'Spieledaten (IGDB) & Barcodes', titel: 'OpenGTINDB-Query-ID', typ: 'geheim', sicher: true },
];

const PER_SCHLUESSEL = new Map(EINSTELLUNGEN.map((d) => [d.schluessel, d]));
const JA = ['1', 'true', 'ja', 'yes', 'on'];

/** Kürzt Geheimnisse für die Anzeige: ••••1234 */
export function maskiere(wert) {
  const text = String(wert ?? '');
  if (!text) return '';
  return text.length <= 8 ? '••••' : `••••${text.slice(-4)}`;
}

/** Prüft und normalisiert einen Wert; liefert den Text, wie er auch in der .env stünde. */
function normalisiere(definition, wert) {
  const text = String(wert ?? '').trim();
  switch (definition.typ) {
    case 'jaNein':
      return wert === true || JA.includes(text.toLowerCase()) ? 'true' : 'false';
    case 'zahl': {
      const n = Number(text);
      if (!text || !Number.isInteger(n) || n < definition.min || n > definition.max) {
        throw new Error(`Bitte eine ganze Zahl zwischen ${definition.min} und ${definition.max.toLocaleString('de-DE')} angeben.`);
      }
      return String(n);
    }
    case 'dezimal': {
      const n = Number(text.replace(',', '.'));
      if (!text || !Number.isFinite(n) || n < definition.min || n > definition.max) {
        throw new Error(`Bitte einen Wert zwischen ${String(definition.min).replace('.', ',')} und ${definition.max} angeben.`);
      }
      return String(n);
    }
    case 'auswahl':
      if (!definition.optionen.some(([w]) => w === text)) throw new Error('Ungültige Auswahl.');
      return text;
    case 'url':
      if (text && !/^https?:\/\/[^\s/]+[^\s]*$/i.test(text)) throw new Error('Bitte eine vollständige Adresse mit https:// angeben.');
      return text.replace(/\/+$/, '');
    default:
      if (text.length > 2000) throw new Error('Der Wert ist zu lang.');
      if (/[\r\n]/.test(text)) throw new Error('Zeilenumbrüche sind nicht erlaubt.');
      return text;
  }
}

export function erstelleEinstellungsDienst(db, { konfiguration, schluessel, nachAenderung = () => {} }) {
  const alleZeilen = db.prepare(`SELECT e.*, COALESCE(b.anzeigename, b.benutzername) AS geaendert_von_name
    FROM server_einstellungen e LEFT JOIN benutzer b ON b.id = e.geaendert_von`);
  const schreiben = db.prepare(`INSERT INTO server_einstellungen (schluessel, wert, verschluesselt, geaendert_von, geaendert_am)
    VALUES (@schluessel, @wert, @verschluesselt, @benutzer, datetime('now'))
    ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert, verschluesselt = excluded.verschluesselt,
      geaendert_von = excluded.geaendert_von, geaendert_am = excluded.geaendert_am`);
  const loeschen = db.prepare('DELETE FROM server_einstellungen WHERE schluessel = ?');
  const protokollieren = db.prepare(`INSERT INTO einstellungen_protokoll (schluessel, aktion, alt, neu, benutzer_id)
    VALUES (?, ?, ?, ?, ?)`);
  const quellEnv = () => konfiguration.quellEnv ?? process.env;

  /** Gespeicherte Werte (entschlüsselt) als { SCHLUESSEL: wert }. */
  function gespeicherteWerte() {
    const werte = {};
    for (const z of alleZeilen.all()) {
      if (!PER_SCHLUESSEL.has(z.schluessel)) continue;
      try {
        werte[z.schluessel] = z.verschluesselt ? entschluessele(z.wert, schluessel) : z.wert ?? '';
      } catch {
        console.warn(`[einstellungen] ${z.schluessel} konnte nicht entschlüsselt werden (APP_SECRET geändert?) – .env-Wert wird verwendet.`);
      }
    }
    return werte;
  }

  /** Lädt die Konfiguration aus .env + Datenbank neu und überträgt sie in das laufende Objekt. */
  function wendeAn() {
    const env = quellEnv();
    const neu = ladeKonfiguration({ ...env, ...gespeicherteWerte() });
    uebernehmeKonfiguration(konfiguration, neu);
    konfiguration.quellEnv = env;
    return konfiguration;
  }

  /** Alle Einstellungen für die Admin-Oberfläche – Geheimnisse nur maskiert. */
  function liste() {
    const env = quellEnv();
    const zeilen = new Map(alleZeilen.all().map((z) => [z.schluessel, z]));
    const werte = gespeicherteWerte();
    return EINSTELLUNGEN.map((d) => {
      const zeile = zeilen.get(d.schluessel);
      const envWert = env[d.schluessel] ?? '';
      const imWeb = zeile && Object.hasOwn(werte, d.schluessel);
      const aktuell = imWeb ? werte[d.schluessel] : envWert;
      const geheim = d.typ === 'geheim';
      return {
        ...d,
        herkunft: imWeb ? 'web' : envWert !== '' ? 'env' : 'standard',
        wert: geheim ? null : aktuell,
        gesetzt: aktuell !== '',
        maskiert: geheim ? maskiere(aktuell) : null,
        env_wert: geheim ? maskiere(envWert) : envWert,
        geaendert_am: imWeb ? zeile.geaendert_am : null,
        geaendert_von: imWeb ? zeile.geaendert_von_name : null,
      };
    });
  }

  /** Braucht diese Änderung eine Bestätigung mit Passwort (und 2FA)? */
  function brauchtBestaetigung({ werte = {}, zuruecksetzen = [], entfernen = [] }) {
    const betroffen = [...Object.keys(werte).filter((k) => !(PER_SCHLUESSEL.get(k)?.typ === 'geheim' && !String(werte[k] ?? '').trim())),
      ...zuruecksetzen, ...entfernen];
    return betroffen.some((k) => PER_SCHLUESSEL.get(k)?.sicher);
  }

  /**
   * Übernimmt Änderungen. `werte`: neue Werte (leere Geheimnisse = unverändert),
   * `zuruecksetzen`: zurück auf den .env-Wert, `entfernen`: Geheimnis leeren (auch wenn in .env gesetzt).
   */
  function setze({ werte = {}, zuruecksetzen = [], entfernen = [] }, benutzer) {
    const fehler = {};
    const env = quellEnv();
    const vorher = gespeicherteWerte();
    const aktuellerWert = (k) => (Object.hasOwn(vorher, k) ? vorher[k] : env[k] ?? '');
    const aenderungen = [];

    for (const [k, roh] of Object.entries(werte ?? {})) {
      const d = PER_SCHLUESSEL.get(k);
      if (!d) { fehler[k] = 'Diese Einstellung kann nur in der .env geändert werden.'; continue; }
      if (d.typ === 'geheim' && !String(roh ?? '').trim()) continue; // leer = unverändert
      try {
        const neu = normalisiere(d, roh);
        if (neu !== aktuellerWert(k)) aenderungen.push({ d, aktion: 'geaendert', neu });
      } catch (e) {
        fehler[k] = e.message;
      }
    }
    for (const k of zuruecksetzen ?? []) {
      const d = PER_SCHLUESSEL.get(k);
      if (!d) fehler[k] = 'Unbekannte Einstellung.';
      else if (Object.hasOwn(vorher, k)) aenderungen.push({ d, aktion: 'zurueckgesetzt' });
    }
    for (const k of entfernen ?? []) {
      const d = PER_SCHLUESSEL.get(k);
      if (!d) fehler[k] = 'Unbekannte Einstellung.';
      else aenderungen.push({ d, aktion: 'entfernt', neu: '' });
    }
    if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
    if (!aenderungen.length) return [];

    const anzeige = (d, w) => (w == null ? null : d.typ === 'geheim' ? maskiere(w) || '(leer)' : w || '(leer)');
    db.transaction(() => {
      for (const { d, aktion, neu } of aenderungen) {
        const alt = aktuellerWert(d.schluessel);
        if (aktion === 'zurueckgesetzt') {
          loeschen.run(d.schluessel);
          protokollieren.run(d.schluessel, aktion, anzeige(d, alt), anzeige(d, env[d.schluessel] ?? ''), benutzer?.id ?? null);
          continue;
        }
        const geheim = d.typ === 'geheim' && neu !== '';
        schreiben.run({ schluessel: d.schluessel, wert: geheim ? verschluessele(neu, schluessel) : neu, verschluesselt: geheim ? 1 : 0, benutzer: benutzer?.id ?? null });
        protokollieren.run(d.schluessel, aktion, anzeige(d, alt), anzeige(d, neu), benutzer?.id ?? null);
      }
    })();

    wendeAn();
    const geaendert = aenderungen.map((a) => a.d.schluessel);
    nachAenderung(geaendert);
    return geaendert;
  }

  function protokoll(limit = 100) {
    return db.prepare(`SELECT p.id, p.schluessel, p.aktion, p.alt, p.neu, p.erstellt_am, COALESCE(b.anzeigename, b.benutzername) AS benutzer
      FROM einstellungen_protokoll p LEFT JOIN benutzer b ON b.id = p.benutzer_id ORDER BY p.id DESC LIMIT ?`).all(limit)
      .map((z) => ({ ...z, titel: PER_SCHLUESSEL.get(z.schluessel)?.titel ?? z.schluessel }));
  }

  return { liste, setze, wendeAn, brauchtBestaetigung, protokoll };
}
