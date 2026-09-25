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
  // Uploads
  { schluessel: 'STORAGE_QUOTA_MB', gruppe: 'Uploads & Speicher', titel: 'Speicherplatz je Benutzer (MB)', typ: 'zahl', min: 0, max: 10_000_000,
    hinweis: '0 = unbegrenzt. Freigegebene Scans zählen nicht mit.' },
  { schluessel: 'MAX_UPLOAD_MB', gruppe: 'Uploads & Speicher', titel: 'Maximale Größe von Artikelfotos (MB)', typ: 'zahl', min: 1, max: 100 },
  { schluessel: 'MEDIA_MAX_MB', gruppe: 'Uploads & Speicher', titel: 'Maximale Größe von Scans/PDFs (MB)', typ: 'zahl', min: 1, max: 2000 },
  { schluessel: 'MEDIA_SHARING', gruppe: 'Uploads & Speicher', titel: 'Scans dürfen geteilt werden', ...JA_NEIN,
    hinweis: 'Benutzer können eigene Scans zur Freigabe für alle einreichen.' },
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
