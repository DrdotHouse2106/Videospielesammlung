// Automatische Shop-/ERP-Anbindungen für Händler mit Zusatzpaket „API-Anbindung“: Der Bestand wird regelmäßig aus dem System
// des Händlers gelesen und mit seinen Angeboten abgeglichen (wie beim CSV-Upload, per Artikelnummer).
//
// Unterstützt:
//  - shopware6: Shopware 6 Admin-API (Integration mit Zugangs-ID und Sicherheitsschlüssel, nur Leserechte nötig)
//  - csv_url:   CSV-Feed unter einer https-Adresse (z. B. Produktexport aus JTL, WooCommerce, Plentymarkets, Xentral)
// Weitere Systeme werden auf Anfrage individuell angebunden.
//
// Sicherheit:
//  - Zugangsdaten werden mit AES-256-GCM verschlüsselt gespeichert und nie wieder ausgeliefert.
//  - Nur https-Adressen; Ziele im lokalen Netz, Loopback und Cloud-Metadaten werden abgelehnt (Schutz vor SSRF),
//    Weiterleitungen werden nicht verfolgt, Antworten sind in Größe und Dauer begrenzt.
import dns from 'node:dns/promises';
import net from 'node:net';
import { verschluessele, entschluessele } from './sicherheit.js';
import { ValidierungsFehler } from './validierung.js';
import { KontoFehler } from './konten.js';
import { erkenneZuordnung, zustandVon, vollstaendigkeitVon, regionVon } from './csvimport.js';
import { HAENDLER_IMPORT_FELDER, zeileZuAngebot, MAX_ZEILEN } from './boersenimport.js';

export const ANBINDUNGSTYPEN = ['shopware6', 'csv_url'];
const MAX_BYTES = 25 * 1024 * 1024;
const ZEITLIMIT_MS = 30_000;

/** Liegt eine IP-Adresse in einem privaten, lokalen oder reservierten Bereich? */
export function istInterneAdresse(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const t = ip.toLowerCase();
    if (t === '::' || t === '::1') return true;
    const v4 = t.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return istInterneAdresse(v4[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(t);
  }
  return true;
}

function pruefeUrl(roh, feld = 'url') {
  let url;
  try { url = new URL(String(roh ?? '').trim()); } catch { throw new ValidierungsFehler({ [feld]: 'Bitte eine vollständige Adresse mit https:// angeben.' }); }
  if (url.protocol !== 'https:') throw new ValidierungsFehler({ [feld]: 'Aus Sicherheitsgründen sind nur https-Adressen erlaubt.' });
  if (url.username || url.password) throw new ValidierungsFehler({ [feld]: 'Bitte keine Zugangsdaten in der Adresse angeben.' });
  return url;
}

export function erstelleAnbindungsDienst(db, { schluessel, boerse, boersenImport, fetchFn = globalThis.fetch }) {
  let lookup = (host) => dns.lookup(host, { all: true });

  const q = {
    lesen: db.prepare('SELECT * FROM haendler_anbindungen WHERE benutzer_id = ?'),
    benutzer: db.prepare('SELECT * FROM benutzer WHERE id = ?'),
    faellige: db.prepare(`SELECT a.benutzer_id FROM haendler_anbindungen a WHERE a.aktiv = 1
      AND (a.letzter_lauf IS NULL OR datetime(a.letzter_lauf, '+' || a.intervall_stunden || ' hours') <= datetime('now'))`),
  };

  function sicherPro(benutzerId) {
    boerse.sicherAktiv();
    if (!boerse.apiAktiv(benutzerId)) {
      throw new KontoFehler('Automatische Anbindungen gibt es mit dem Zusatzpaket „API-Anbindung“. Bitte wende dich an den Betreiber.', 402, 'kein_api');
    }
  }

  /** Ruft eine Adresse sicher ab (nur öffentliche Ziele, keine Weiterleitungen, begrenzte Größe). */
  async function sichererAbruf(url, optionen = {}) {
    const adressen = await lookup(url.hostname).catch(() => []);
    if (!adressen.length) throw new KontoFehler(`Der Server ${url.hostname} wurde nicht gefunden.`, 400);
    if (adressen.some((a) => istInterneAdresse(a.address))) throw new KontoFehler('Adressen im lokalen oder internen Netz sind nicht erlaubt.', 400);
    let antwort;
    try {
      antwort = await fetchFn(url.href, { ...optionen, redirect: 'manual', signal: AbortSignal.timeout(ZEITLIMIT_MS) });
    } catch (e) {
      throw new KontoFehler(`Keine Verbindung zu ${url.hostname}: ${e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message}`, 502);
    }
    if (antwort.status >= 300 && antwort.status < 400) throw new KontoFehler('Die Adresse leitet weiter. Bitte die endgültige Adresse angeben.', 400);
    const laenge = Number(antwort.headers.get('content-length') || 0);
    if (laenge > MAX_BYTES) throw new KontoFehler('Die Antwort ist zu groß (höchstens 25 MB).', 413);
    const puffer = Buffer.from(await antwort.arrayBuffer());
    if (puffer.length > MAX_BYTES) throw new KontoFehler('Die Antwort ist zu groß (höchstens 25 MB).', 413);
    return { status: antwort.status, puffer };
  }

  const alsText = (puffer) => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(puffer); } catch { return new TextDecoder('windows-1252').decode(puffer); }
  };

  // ── Abruf je System ───────────────────────────────────────────
  async function ladeCsv(zugang) {
    const url = pruefeUrl(zugang.url);
    const { status, puffer } = await sichererAbruf(url, { headers: zugang.token ? { Authorization: `Bearer ${zugang.token}` } : {} });
    if (status !== 200) throw new KontoFehler(`Der Feed antwortet mit HTTP ${status}.`, 502);
    const csv = boersenImport.lies(alsText(puffer));
    const zuordnung = erkenneZuordnung(csv.kopf, HAENDLER_IMPORT_FELDER);
    boersenImport.zuordnungAus(zuordnung, csv.kopf);
    return csv.zeilen.map((z) => zeileZuAngebot(z, zuordnung));
  }

  async function ladeShopware(zugang) {
    const basis = pruefeUrl(zugang.url);
    const api = (pfad) => new URL(pfad, `${basis.origin}${basis.pathname.replace(/\/+$/, '')}/`);
    const tokenAntwort = await sichererAbruf(api('api/oauth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: zugang.client_id, client_secret: zugang.client_secret }),
    });
    if (tokenAntwort.status === 401 || tokenAntwort.status === 400) throw new KontoFehler('Shopware lehnt die Zugangsdaten ab. Bitte Zugangs-ID und Sicherheitsschlüssel prüfen.', 400);
    if (tokenAntwort.status !== 200) throw new KontoFehler(`Shopware antwortet mit HTTP ${tokenAntwort.status}.`, 502);
    const token = JSON.parse(tokenAntwort.puffer.toString('utf8')).access_token;

    const zeilen = [];
    for (let seite = 1; zeilen.length < MAX_ZEILEN; seite++) {
      const r = await sichererAbruf(api('api/search/product'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          page: seite, limit: 500,
          filter: [{ type: 'equals', field: 'active', value: true }],
          includes: { product: ['productNumber', 'ean', 'name', 'translated', 'stock', 'availableStock', 'price', 'customFields', 'description'] },
        }),
      });
      if (r.status !== 200) throw new KontoFehler(`Shopware antwortet beim Lesen der Produkte mit HTTP ${r.status}. Hat die Integration Leserechte für Produkte?`, 502);
      const daten = JSON.parse(r.puffer.toString('utf8')).data ?? [];
      for (const p of daten) {
        const felder = p.customFields ?? p.translated?.customFields ?? {};
        const preis = Array.isArray(p.price) && p.price.length ? p.price[0].gross : null;
        zeilen.push({
          sku: p.productNumber || null,
          katalog_id: Number.isInteger(Number(felder.zockdb_id)) && Number(felder.zockdb_id) > 0 ? Number(felder.zockdb_id) : null,
          barcode: String(p.ean ?? '').replace(/\D/g, '') || null,
          titel: p.translated?.name || p.name || null,
          plattform: felder.zockdb_plattform || null,
          preis: preis === null || preis === undefined ? null : String(preis),
          bestand: Math.max(0, Number(p.availableStock ?? p.stock ?? 0)),
          zustand: zustandVon(felder.zockdb_zustand, felder.zockdb_vollstaendigkeit),
          vollstaendigkeit: vollstaendigkeitVon(felder.zockdb_vollstaendigkeit),
          region: regionVon(felder.zockdb_region),
          art: 'verkauf',
          beschreibung: null,
        });
      }
      if (daten.length < 500) break;
    }
    return zeilen;
  }

  const LADER = { csv_url: ladeCsv, shopware6: ladeShopware };

  // ── Verwaltung ────────────────────────────────────────────────
  function zugangLesen(zeile) {
    try { return JSON.parse(entschluessele(zeile.zugang, schluessel)); } catch { return null; }
  }

  function info(benutzerId) {
    const z = q.lesen.get(benutzerId);
    if (!z) return null;
    const zugang = zugangLesen(z) ?? {};
    return {
      typ: z.typ,
      url: zugang.url ?? '',
      client_id: zugang.client_id ?? '',
      geheimnis_gesetzt: Boolean(zugang.client_secret || zugang.token),
      intervall_stunden: z.intervall_stunden,
      beende_fehlende: Boolean(z.beende_fehlende),
      aktiv: Boolean(z.aktiv),
      letzter_lauf: z.letzter_lauf,
      letztes_ergebnis: z.letztes_ergebnis ? JSON.parse(z.letztes_ergebnis) : null,
      letzter_fehler: z.letzter_fehler,
      entschluesselbar: Boolean(zugangLesen(z)),
    };
  }

  function speichere(benutzer, eingabe = {}) {
    sicherPro(benutzer.id);
    const typ = eingabe.typ;
    if (!ANBINDUNGSTYPEN.includes(typ)) throw new ValidierungsFehler({ typ: 'Bitte ein System wählen.' });
    const alt = q.lesen.get(benutzer.id);
    const bisher = alt && alt.typ === typ ? zugangLesen(alt) ?? {} : {};
    const url = pruefeUrl(eingabe.url).href;
    const zugang = { url };
    if (typ === 'shopware6') {
      zugang.client_id = String(eingabe.client_id ?? '').trim().slice(0, 200);
      zugang.client_secret = String(eingabe.client_secret ?? '').trim().slice(0, 500) || bisher.client_secret || '';
      if (!zugang.client_id) throw new ValidierungsFehler({ client_id: 'Bitte die Zugangs-ID der Integration angeben.' });
      if (!zugang.client_secret) throw new ValidierungsFehler({ client_secret: 'Bitte den Sicherheitsschlüssel angeben.' });
    } else {
      zugang.token = String(eingabe.token ?? '').trim().slice(0, 500) || bisher.token || '';
    }
    const intervall = Number(eingabe.intervall_stunden ?? 6);
    if (!Number.isInteger(intervall) || intervall < 1 || intervall > 168) throw new ValidierungsFehler({ intervall_stunden: 'Bitte 1 bis 168 Stunden angeben.' });
    db.prepare(`INSERT INTO haendler_anbindungen (benutzer_id, typ, zugang, intervall_stunden, beende_fehlende, aktiv, letzter_fehler, fehler_in_folge)
      VALUES (@b, @typ, @zugang, @intervall, @beende, @aktiv, NULL, 0)
      ON CONFLICT (benutzer_id) DO UPDATE SET typ = excluded.typ, zugang = excluded.zugang, intervall_stunden = excluded.intervall_stunden,
        beende_fehlende = excluded.beende_fehlende, aktiv = excluded.aktiv, letzter_fehler = NULL, fehler_in_folge = 0, letzter_lauf = NULL,
        geaendert_am = datetime('now')`)
      .run({
        b: benutzer.id, typ, zugang: verschluessele(JSON.stringify(zugang), schluessel), intervall,
        beende: eingabe.beende_fehlende ? 1 : 0, aktiv: eingabe.aktiv === false ? 0 : 1,
      });
    return info(benutzer.id);
  }

  const entferne = (benutzerId) => db.prepare('DELETE FROM haendler_anbindungen WHERE benutzer_id = ?').run(benutzerId);

  async function lade(benutzerId) {
    const z = q.lesen.get(benutzerId);
    if (!z) throw new KontoFehler('Es ist keine Anbindung eingerichtet.', 404);
    const zugang = zugangLesen(z);
    if (!zugang) throw new KontoFehler('Die Zugangsdaten können nicht entschlüsselt werden. Bitte neu eingeben.', 409);
    return { z, zeilen: await LADER[z.typ](zugang) };
  }

  /** Verbindung prüfen, ohne etwas zu ändern: liefert Anzahl und die ersten Artikel. */
  async function teste(benutzer) {
    sicherPro(benutzer.id);
    const { zeilen } = await lade(benutzer.id);
    return { artikel: zeilen.length, vorschau: zeilen.slice(0, 8) };
  }

  /** Abgleich ausführen und Ergebnis speichern. */
  async function synchronisiere(benutzerId) {
    sicherPro(benutzerId);
    const benutzer = q.benutzer.get(benutzerId);
    try {
      const { z, zeilen } = await lade(benutzerId);
      const ergebnis = boersenImport.verarbeite(benutzer, zeilen, { beendeFehlende: Boolean(z.beende_fehlende) });
      const kurz = { ...ergebnis, fehlerhaft: ergebnis.fehlerhaft.slice(0, 50) };
      db.prepare(`UPDATE haendler_anbindungen SET letzter_lauf = datetime('now'), letztes_ergebnis = ?, letzter_fehler = NULL, fehler_in_folge = 0
        WHERE benutzer_id = ?`).run(JSON.stringify(kurz), benutzerId);
      return kurz;
    } catch (e) {
      const meldung = e instanceof ValidierungsFehler ? Object.values(e.fehler).join(' ') : e.message;
      db.prepare(`UPDATE haendler_anbindungen SET letzter_lauf = datetime('now'), letzter_fehler = ?, fehler_in_folge = fehler_in_folge + 1,
        aktiv = CASE WHEN fehler_in_folge + 1 >= 5 THEN 0 ELSE aktiv END WHERE benutzer_id = ?`).run(String(meldung).slice(0, 500), benutzerId);
      throw e;
    }
  }

  /** Zeitgesteuert: alle fälligen Anbindungen (nur mit gültigem Zusatzpaket) nacheinander abgleichen. */
  async function lauf() {
    let erledigt = 0;
    for (const { benutzer_id: id } of q.faellige.all()) {
      if (!boerse.aktiv() || !boerse.apiAktiv(id)) continue;
      try { await synchronisiere(id); erledigt++; } catch (e) { console.warn(`[anbindung ${id}]`, e.message); }
    }
    return erledigt;
  }

  return {
    info, speichere, entferne, teste, synchronisiere, lauf,
    /** Nur für Tests: DNS-Auflösung ersetzen. */
    setzeLookup: (fn) => { lookup = fn; },
  };
}
