// Tauschbörse (Suche/Biete): Angebote, Wunschliste, Treffer, Tauschvorschläge, Nachrichten, Bewertungen
// und gewerbliche Anbieter.
//
// Grundsatz: ZockDB bringt Sammler zusammen, wickelt aber keine Zahlungen ab. Kauf, Bezahlung und
// Versand vereinbaren die Beteiligten selbst.
//
// Datenschutz: Angezeigt werden nur Anzeigename, grober PLZ-Bereich (zwei Ziffern) und – bei gewerblichen
// Anbietern – die gesetzlich vorgeschriebene Anbieterkennzeichnung. E-Mail-Adressen bleiben verborgen.
import {
  ALLE_WERTE, ANGEBOTSARTEN, ZUSTAENDE, HAENDLER_FELDER, istModerator,
} from '../../shared/konstanten.js';
import { leseEuro, ValidierungsFehler } from './validierung.js';
import { KontoFehler } from './konten.js';
import { erstelleDrossel } from './drossel.js';

const ARTEN = ANGEBOTSARTEN.map((a) => a.value);
const EIGENE_STATUS = ['aktiv', 'reserviert', 'verkauft', 'beendet'];
const SICHTBARE_STATUS = "('aktiv', 'reserviert')";
const ZUSTAND_RANG = Object.fromEntries(ZUSTAENDE.map((z, i) => [z.value, i])); // 0 = bester Zustand
const SEITENGROESSE = 30;
const TAG_MS = 24 * 60 * 60 * 1000;

const leer = (w) => w === undefined || w === null || String(w).trim() === '';
const text = (w, max) => (leer(w) ? null : String(w).trim().slice(0, max));
const name = (z, praefix = '') => z[`${praefix}anzeigename`] || z[`${praefix}benutzername`];

/** „40“ aus „40213“, „40xxx“ oder „40“ – mehr wird nie gespeichert. */
export function plzBereich(wert) {
  const m = String(wert ?? '').trim().match(/^(\d{2})/);
  return m ? m[1] : null;
}

/** Prüft die Angaben eines Angebots. Bei `teilweise` werden nur vorhandene Felder geprüft. */
export function pruefeAngebot(eingabe = {}, { teilweise = false } = {}) {
  const fehler = {};
  const d = {};
  const hat = (f) => !teilweise || Object.hasOwn(eingabe, f);

  if (hat('art')) {
    d.art = eingabe.art ?? 'verkauf';
    if (!ARTEN.includes(d.art)) fehler.art = 'Bitte Verkauf, Tausch oder beides wählen.';
  }
  if (hat('preis')) {
    d.preis = leer(eingabe.preis) ? null : leseEuro(eingabe.preis);
    if (!leer(eingabe.preis) && d.preis === null) fehler.preis = 'Bitte einen gültigen Preis angeben, z. B. 24,90.';
  }
  for (const feld of ['zustand', 'vollstaendigkeit', 'region']) {
    if (!hat(feld)) continue;
    d[feld] = leer(eingabe[feld]) ? null : String(eingabe[feld]);
    if (d[feld] && !ALLE_WERTE[feld].includes(d[feld])) fehler[feld] = 'Ungültige Auswahl.';
  }
  if (hat('beschreibung')) d.beschreibung = text(eingabe.beschreibung, 3000);
  if (hat('anzahl')) {
    const n = leer(eingabe.anzahl) ? 1 : Number(eingabe.anzahl);
    if (!Number.isInteger(n) || n < 1 || n > 9999) fehler.anzahl = 'Bitte eine Anzahl zwischen 1 und 9999 angeben.';
    d.anzahl = n;
  }
  for (const feld of ['versand', 'abholung', 'verhandelbar']) {
    if (!hat(feld)) continue;
    const w = eingabe[feld];
    d[feld] = w === undefined ? Number(feld === 'versand') : Number(w === true || w === 1 || w === '1' || w === 'true');
  }
  if (hat('versand') && hat('abholung') && !d.versand && !d.abholung) fehler.versand = 'Bitte Versand und/oder Abholung anbieten.';
  if (hat('plz_bereich')) {
    d.plz_bereich = plzBereich(eingabe.plz_bereich);
    if (!leer(eingabe.plz_bereich) && !d.plz_bereich) fehler.plz_bereich = 'Bitte die ersten zwei Ziffern der Postleitzahl angeben.';
  }
  if (hat('sku')) d.sku = text(eingabe.sku, 100);
  for (const feld of ['plattform_id', 'variante_id', 'artikel_id']) {
    if (!hat(feld)) continue;
    d[feld] = leer(eingabe[feld]) ? null : Number(eingabe[feld]);
    if (d[feld] !== null && !Number.isInteger(d[feld])) fehler[feld] = 'Ungültige Angabe.';
  }
  if (d.art === 'tausch') d.preis = null;
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return d;
}

/** Prüft einen Wunschlisteneintrag. */
export function pruefeWunsch(eingabe = {}) {
  const fehler = {};
  const d = {
    plattform_id: leer(eingabe.plattform_id) ? null : Number(eingabe.plattform_id),
    region: leer(eingabe.region) ? null : String(eingabe.region),
    min_zustand: leer(eingabe.min_zustand) ? null : String(eingabe.min_zustand),
    nur_cib: eingabe.nur_cib === true || eingabe.nur_cib === 1 || eingabe.nur_cib === 'true' ? 1 : 0,
    max_preis: leer(eingabe.max_preis) ? null : leseEuro(eingabe.max_preis),
    notiz: text(eingabe.notiz, 500),
  };
  if (d.plattform_id !== null && !Number.isInteger(d.plattform_id)) fehler.plattform_id = 'Ungültige Plattform.';
  if (d.region && !ALLE_WERTE.region.includes(d.region)) fehler.region = 'Ungültige Region.';
  if (d.min_zustand && !ALLE_WERTE.zustand.includes(d.min_zustand)) fehler.min_zustand = 'Ungültiger Zustand.';
  if (!leer(eingabe.max_preis) && d.max_preis === null) fehler.max_preis = 'Bitte einen gültigen Höchstpreis angeben.';
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return d;
}

/** Prüft die Anbieterkennzeichnung gewerblicher Anbieter. */
export function pruefeHaendlerDaten(eingabe = {}) {
  const fehler = {};
  const d = {};
  for (const { feld, pflicht, mehrzeilig } of HAENDLER_FELDER) {
    d[feld] = text(eingabe[feld], mehrzeilig ? 5000 : 300);
    if (pflicht && !d[feld]) fehler[feld] = 'Pflichtangabe für gewerbliche Anbieter.';
  }
  if (d.email && !/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(d.email)) fehler.email = 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (d.shop_url && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(d.shop_url)) fehler.shop_url = 'Bitte eine vollständige Adresse mit https:// angeben.';
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return d;
}

const heute = () => new Date().toISOString().slice(0, 10);

/** Gebuchtes Händler-Paket (Anzahl Angebote) gültig? Nur verifizierte Händler, bis einschließlich Ablaufdatum. */
export function paketAktiv(b) {
  return Boolean(b?.haendler_status === 'verifiziert' && b.haendler_paket > 0 && b.haendler_paket_bis && b.haendler_paket_bis >= heute());
}

/** Zusatzpaket API-Anbindung (Shop/ERP) gültig? */
export function apiAktiv(b) {
  return Boolean(b?.haendler_status === 'verifiziert' && b.haendler_api_bis && b.haendler_api_bis >= heute());
}

const datumText = (iso) => iso.split('-').reverse().join('.');
const euroText = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

/** Passt ein Angebot zu einem Wunsch? (Katalogeintrag wird vorher verglichen.) */
export function passtZuWunsch(wunsch, angebot) {
  if (wunsch.plattform_id && angebot.plattform_id && wunsch.plattform_id !== angebot.plattform_id) return false;
  if (wunsch.region && angebot.region !== wunsch.region) return false;
  if (wunsch.nur_cib && angebot.vollstaendigkeit !== 'cib') return false;
  if (wunsch.min_zustand) {
    if (!angebot.zustand || ZUSTAND_RANG[angebot.zustand] > ZUSTAND_RANG[wunsch.min_zustand]) return false;
  }
  // Höchstpreis nur bei reinen Verkaufsangeboten mit Preis – Tausch und „Preis auf Anfrage“ passen immer
  if (wunsch.max_preis !== null && wunsch.max_preis !== undefined && angebot.art === 'verkauf' && angebot.preis !== null && angebot.preis > wunsch.max_preis) return false;
  return true;
}

export function erstelleBoersenDienst(db, { konfiguration, benachrichtigungen, katalog }) {
  const k = () => konfiguration.boerse;
  const nachrichtenDrossel = erstelleDrossel({ maxVersuche: 60, fensterMs: 60 * 60 * 1000 });
  const neueAnfragenDrossel = erstelleDrossel({ maxVersuche: 20, fensterMs: TAG_MS });

  // ── Gemeinsame Abfrageteile ───────────────────────────────────
  // Anbieter-Infos und Katalogdaten zu einem Angebot (Alias a)
  const ANGEBOT_SPALTEN = `a.*, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, p.name AS plattform, p.kurz AS plattform_kurz,
    v.bezeichnung AS variante, b.benutzername, b.anzeigename, b.haendler_status, b.haendler_daten,
    (SELECT COUNT(*) FROM wunschliste w WHERE w.katalog_id = a.katalog_id AND w.benutzer_id != a.benutzer_id) AS gesucht_von,
    (SELECT f.vorschau FROM angebot_fotos f WHERE f.angebot_id = a.id ORDER BY f.reihenfolge, f.id LIMIT 1) AS foto_vorschau,
    (SELECT COUNT(*) FROM angebot_fotos f WHERE f.angebot_id = a.id) AS fotos_anzahl`;
  const ANGEBOT_JOIN = `FROM angebote a JOIN katalog k ON k.id = a.katalog_id JOIN benutzer b ON b.id = a.benutzer_id
    LEFT JOIN plattformen p ON p.id = a.plattform_id LEFT JOIN katalog_varianten v ON v.id = a.variante_id`;
  // Keine Angebote von Benutzern, die man blockiert hat oder von denen man blockiert wurde
  const NICHT_BLOCKIERT = `NOT EXISTS (SELECT 1 FROM blockierungen x WHERE (x.benutzer_id = @ich AND x.blockiert_id = a.benutzer_id)
    OR (x.benutzer_id = a.benutzer_id AND x.blockiert_id = @ich))`;

  const q = {
    benutzer: db.prepare('SELECT id, benutzername, anzeigename, email, rolle, gesperrt, erstellt_am, haendler_status, haendler_daten, haendler_paket, haendler_paket_bis, haendler_api_bis, haendler_test_bis, haendler_test_genutzt_am, boerse_plz FROM benutzer WHERE id = ?'),
    angebot: db.prepare(`SELECT ${ANGEBOT_SPALTEN} ${ANGEBOT_JOIN} WHERE a.id = ?`),
    angebotRoh: db.prepare('SELECT * FROM angebote WHERE id = ?'),
    anzahlAktiv: db.prepare(`SELECT COUNT(*) AS n FROM angebote WHERE benutzer_id = ? AND status IN ${SICHTBARE_STATUS}`),
    einfuegen: db.prepare(`INSERT INTO angebote (benutzer_id, katalog_id, artikel_id, plattform_id, variante_id, art, preis, verhandelbar,
        zustand, vollstaendigkeit, region, beschreibung, anzahl, versand, abholung, plz_bereich, sku, laeuft_ab)
      VALUES (@benutzer_id, @katalog_id, @artikel_id, @plattform_id, @variante_id, @art, @preis, @verhandelbar,
        @zustand, @vollstaendigkeit, @region, @beschreibung, @anzahl, @versand, @abholung, @plz_bereich, @sku, @laeuft_ab) RETURNING id`),
    artikel: db.prepare('SELECT * FROM artikel WHERE id = ? AND benutzer_id = ?'),
    katalogPlattformen: db.prepare('SELECT plattform_id FROM katalog_plattformen WHERE katalog_id = ?'),
    variante: db.prepare("SELECT id FROM katalog_varianten WHERE id = ? AND katalog_id = ? AND status = 'freigegeben'"),
    wunsch: db.prepare('SELECT * FROM wunschliste WHERE benutzer_id = ? AND katalog_id = ?'),
    wuenscheFuerKatalog: db.prepare('SELECT * FROM wunschliste WHERE katalog_id = ? AND benutzer_id != ?'),
    trefferMerken: db.prepare('INSERT OR IGNORE INTO boerse_treffer (wunsch_id, angebot_id) VALUES (?, ?)'),
    blockiert: db.prepare('SELECT 1 FROM blockierungen WHERE (benutzer_id = @a AND blockiert_id = @b) OR (benutzer_id = @b AND blockiert_id = @a)'),
    unterhaltung: db.prepare('SELECT * FROM unterhaltungen WHERE id = ?'),
    unterhaltungZuAngebot: db.prepare('SELECT * FROM unterhaltungen WHERE angebot_id = ? AND anfragender_id = ?'),
    letzteNachricht: db.prepare('SELECT MAX(id) AS id FROM nachrichten WHERE unterhaltung_id = ?'),
  };

  const jetztPlus = (tage) => new Date(Date.now() + tage * TAG_MS).toISOString().replace('T', ' ').slice(0, 19);
  // Kostenlos gilt das Grundlimit – mit gebuchtem Paket dessen Anzahl (mindestens aber das Grundlimit)
  const limitFuer = (b) => (paketAktiv(b) ? Math.max(b.haendler_paket, k().maxAngebote) : k().maxAngebote);

  function sicherAktiv() {
    if (!k().aktiv) throw new KontoFehler('Die Tauschbörse ist auf diesem Server abgeschaltet.', 404, 'boerse_aus');
  }

  function haendlerDaten(zeile) {
    if (!zeile?.haendler_status || !zeile.haendler_daten) return null;
    try { return JSON.parse(zeile.haendler_daten); } catch { return null; }
  }

  // ── Bewertungen ───────────────────────────────────────────────
  const bewertungSumme = db.prepare(`SELECT SUM(wert = 1) AS positiv, SUM(wert = 0) AS neutral, SUM(wert = -1) AS negativ, COUNT(*) AS gesamt
    FROM bewertungen WHERE fuer_id = ?`);
  function bewertungFuer(benutzerId) {
    const s = bewertungSumme.get(benutzerId);
    return { positiv: s.positiv ?? 0, neutral: s.neutral ?? 0, negativ: s.negativ ?? 0, gesamt: s.gesamt ?? 0 };
  }

  /** Öffentliche Angaben zum Anbieter eines Angebots. */
  function anbieterInfo(zeile, { mitKennzeichnung = false } = {}) {
    const gewerblich = Boolean(zeile.haendler_status);
    return {
      id: zeile.benutzer_id ?? zeile.id,
      name: name(zeile),
      gewerblich,
      verifiziert: zeile.haendler_status === 'verifiziert',
      bewertung: bewertungFuer(zeile.benutzer_id ?? zeile.id),
      ...(gewerblich && mitKennzeichnung ? { kennzeichnung: haendlerDaten(zeile) } : {}),
    };
  }

  function angebotZuObjekt(zeile, ich) {
    if (!zeile) return null;
    const {
      benutzername: _n, anzeigename: _a, haendler_status: _h, haendler_daten: _d, sku, artikel_id: artikelId, foto_vorschau: foto, ...rest
    } = zeile;
    const eigenes = Boolean(ich && zeile.benutzer_id === ich.id);
    return {
      ...rest,
      foto: foto ? `/api/dateien/${foto}` : null,
      verhandelbar: Boolean(zeile.verhandelbar),
      versand: Boolean(zeile.versand),
      abholung: Boolean(zeile.abholung),
      eigenes,
      ...(eigenes ? { sku, artikel_id: artikelId } : {}),
      anbieter: anbieterInfo(zeile),
    };
  }

  // ── Treffer: Wunschliste ↔ Angebote ───────────────────────────
  /**
   * Prüft neue oder geänderte Angebote gegen alle Wunschlisten und informiert die Sammler –
   * je Durchlauf höchstens eine Benachrichtigung pro Sammler (wichtig beim Massen-Upload).
   */
  function benachrichtigeTreffer(angebotIds) {
    const jeSammler = new Map();
    const jeAnbieter = new Map();
    for (const id of angebotIds) {
      const a = q.angebotRoh.get(id);
      if (!a || a.status !== 'aktiv') continue;
      for (const w of q.wuenscheFuerKatalog.all(a.katalog_id, a.benutzer_id)) {
        if (q.blockiert.get({ a: w.benutzer_id, b: a.benutzer_id })) continue;
        if (!passtZuWunsch(w, a)) continue;
        if (q.trefferMerken.run(w.id, a.id).changes === 0) continue; // schon gemeldet
        const liste = jeSammler.get(w.benutzer_id) ?? [];
        liste.push(a);
        jeSammler.set(w.benutzer_id, liste);
        jeAnbieter.set(a.benutzer_id, (jeAnbieter.get(a.benutzer_id) ?? 0) + 1);
      }
    }
    for (const [sammler, angebote] of jeSammler) {
      const titel = db.prepare('SELECT titel FROM katalog WHERE id = ?').get(angebote[0].katalog_id)?.titel ?? 'Ein gesuchtes Spiel';
      benachrichtigungen.sende(sammler, {
        art: 'boerse',
        titel: angebote.length === 1 ? `Treffer auf deiner Wunschliste: ${titel}` : `${angebote.length} neue Treffer auf deiner Wunschliste`,
        text: angebote.length === 1
          ? `Jemand bietet „${titel}“ an${angebote[0].preis !== null ? ` – ${angebote[0].preis.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}.`
          : 'In der Tauschbörse gibt es neue Angebote, die zu deiner Wunschliste passen.',
        link: angebote.length === 1 ? `#/boerse/angebot/${angebote[0].id}` : '#/boerse/meine?tab=treffer',
      });
    }
    return { sammler: jeSammler.size, treffer: [...jeAnbieter.values()].reduce((s, n) => s + n, 0) };
  }

  // ── Angebote ──────────────────────────────────────────────────
  function freigegebenerKatalog(katalogId) {
    const eintrag = katalog.holeEintrag(Number(katalogId));
    if (!eintrag || eintrag.status !== 'freigegeben') {
      throw new ValidierungsFehler({ katalog_id: 'Angebote sind nur für freigegebene Einträge des Katalogs möglich.' });
    }
    return eintrag;
  }

  function pruefePlattformUndVariante(daten, katalogId) {
    if (daten.plattform_id) {
      const erlaubt = q.katalogPlattformen.all(katalogId).map((z) => z.plattform_id);
      if (erlaubt.length && !erlaubt.includes(daten.plattform_id)) throw new ValidierungsFehler({ plattform_id: 'Diese Plattform passt nicht zum Spiel.' });
    }
    if (daten.variante_id && !q.variante.get(daten.variante_id, katalogId)) throw new ValidierungsFehler({ variante_id: 'Unbekannte Variante.' });
  }

  function pruefeLimit(benutzer, zusaetzlich = 1) {
    const aktiv = q.anzahlAktiv.get(benutzer.id).n;
    const limit = limitFuer(benutzer);
    if (aktiv + zusaetzlich > limit) {
      const tipp = benutzer.haendler_status && k().pakete.some((p) => p.angebote > limit) ? ' Mehr Angebote gibt es mit einem Händler-Paket.' : '';
      throw new KontoFehler(`Du kannst höchstens ${limit.toLocaleString('de-DE')} aktive Angebote haben (derzeit ${aktiv}). Beende zuerst ältere Angebote.${tipp}`, 409, 'limit');
    }
  }

  /** Legt ein Angebot an – optional aus einem Exemplar der eigenen Sammlung. */
  function legeAn(benutzerRoh, eingabe = {}, { ohneTreffer = false } = {}) {
    sicherAktiv();
    const benutzer = q.benutzer.get(benutzerRoh.id);
    const daten = pruefeAngebot(eingabe);
    let katalogId = Number(eingabe.katalog_id);
    if (daten.artikel_id) {
      const artikel = q.artikel.get(daten.artikel_id, benutzer.id);
      if (!artikel) throw new ValidierungsFehler({ artikel_id: 'Dieses Exemplar gehört nicht zu deiner Sammlung.' });
      if (!artikel.katalog_id) throw new ValidierungsFehler({ artikel_id: 'Das Exemplar ist mit keinem Katalogeintrag verknüpft.' });
      katalogId = artikel.katalog_id;
      // Angaben aus dem Exemplar übernehmen, wenn nichts anderes angegeben ist
      for (const feld of ['zustand', 'vollstaendigkeit', 'region', 'plattform_id', 'variante_id']) {
        if (!Object.hasOwn(eingabe, feld) || leer(eingabe[feld])) daten[feld] = artikel[feld] ?? null;
      }
    }
    freigegebenerKatalog(katalogId);
    // Gibt es das Spiel nur für eine Plattform, wird sie automatisch gesetzt
    if (!daten.plattform_id) {
      const moegliche = q.katalogPlattformen.all(katalogId);
      if (moegliche.length === 1) daten.plattform_id = moegliche[0].plattform_id;
    }
    pruefePlattformUndVariante(daten, katalogId);
    pruefeLimit(benutzer);
    const { id } = q.einfuegen.get({
      benutzer_id: benutzer.id, katalog_id: katalogId, artikel_id: null, plattform_id: null, variante_id: null,
      art: 'verkauf', preis: null, verhandelbar: 0, zustand: null, vollstaendigkeit: null, region: null, beschreibung: null,
      anzahl: 1, versand: 1, abholung: 0, sku: null,
      ...daten,
      plz_bereich: daten.plz_bereich ?? plzBereich(benutzer.boerse_plz),
      laeuft_ab: jetztPlus(k().laufzeitTage),
    });
    if (!ohneTreffer) benachrichtigeTreffer([id]);
    return hole(id, benutzer);
  }

  function eigenesOder404(benutzer, id) {
    const a = q.angebotRoh.get(Number(id));
    if (!a || (a.benutzer_id !== benutzer.id && !istModerator(benutzer))) throw new KontoFehler('Angebot nicht gefunden.', 404);
    return a;
  }

  /** Ändert ein eigenes Angebot. `status` und `verlaengern` steuern die Laufzeit. */
  function aendere(benutzerRoh, id, eingabe = {}) {
    sicherAktiv();
    const benutzer = q.benutzer.get(benutzerRoh.id);
    const a = eigenesOder404(benutzer, id);
    if (a.benutzer_id !== benutzer.id) throw new KontoFehler('Nur der Anbieter kann das Angebot ändern.', 403);
    if (a.status === 'entfernt') throw new KontoFehler('Das Angebot wurde vom Moderationsteam entfernt und kann nicht mehr geändert werden.', 409);
    const daten = pruefeAngebot(eingabe, { teilweise: true });
    delete daten.artikel_id;
    pruefePlattformUndVariante({ ...a, ...daten }, a.katalog_id);
    const neu = { ...a, ...daten };
    if (neu.art === 'tausch') neu.preis = null;
    if (!neu.versand && !neu.abholung) throw new ValidierungsFehler({ versand: 'Bitte Versand und/oder Abholung anbieten.' });

    let status = a.status;
    let laeuftAb = a.laeuft_ab;
    if (eingabe.status !== undefined) {
      if (!EIGENE_STATUS.includes(eingabe.status)) throw new ValidierungsFehler({ status: 'Ungültiger Status.' });
      status = eingabe.status;
    }
    const wirdSichtbar = ['aktiv', 'reserviert'].includes(status) && !['aktiv', 'reserviert'].includes(a.status);
    if (wirdSichtbar) pruefeLimit(benutzer);
    if (wirdSichtbar || eingabe.verlaengern) laeuftAb = jetztPlus(k().laufzeitTage);
    db.prepare(`UPDATE angebote SET art = @art, preis = @preis, verhandelbar = @verhandelbar, zustand = @zustand,
        vollstaendigkeit = @vollstaendigkeit, region = @region, beschreibung = @beschreibung, anzahl = @anzahl, versand = @versand,
        abholung = @abholung, plz_bereich = @plz_bereich, sku = @sku, plattform_id = @plattform_id, variante_id = @variante_id,
        status = @status, laeuft_ab = @laeuft_ab, aktualisiert_am = datetime('now') WHERE id = @id`)
      .run({ ...neu, status, laeuft_ab: laeuftAb });
    // Bei günstigerem Preis oder Reaktivierung können neue Treffer entstehen
    if (status === 'aktiv') benachrichtigeTreffer([a.id]);
    return hole(a.id, benutzer);
  }

  function loesche(benutzer, id) {
    const a = eigenesOder404(benutzer, id);
    if (a.benutzer_id !== benutzer.id) throw new KontoFehler('Nur der Anbieter kann das Angebot löschen.', 403);
    db.prepare('DELETE FROM angebote WHERE id = ?').run(a.id);
  }

  /** Einzelnes Angebot inkl. Anbieterkennzeichnung (gewerblich) und eigener Anfrage. */
  function hole(id, benutzer) {
    const zeile = q.angebot.get(Number(id));
    if (!zeile) return null;
    const eigenes = Boolean(benutzer && zeile.benutzer_id === benutzer.id);
    if (!eigenes && !istModerator(benutzer)) {
      if (!['aktiv', 'reserviert'].includes(zeile.status)) return null;
      if (q.benutzer.get(zeile.benutzer_id)?.gesperrt) return null;
      if (benutzer && q.blockiert.get({ a: benutzer.id, b: zeile.benutzer_id })) return null;
    }
    const objekt = angebotZuObjekt(zeile, benutzer);
    objekt.fotos = db.prepare('SELECT id, datei, vorschau FROM angebot_fotos WHERE angebot_id = ? ORDER BY reihenfolge, id').all(zeile.id)
      .map((f) => ({ id: f.id, url: `/api/dateien/${f.datei}`, vorschau: `/api/dateien/${f.vorschau}` }));
    objekt.anbieter = {
      ...anbieterInfo(zeile, { mitKennzeichnung: true }),
      aktive_angebote: q.anzahlAktiv.get(zeile.benutzer_id).n,
      mitglied_seit: q.benutzer.get(zeile.benutzer_id)?.erstellt_am ?? null,
    };
    if (benutzer && !eigenes) objekt.meine_anfrage = q.unterhaltungZuAngebot.get(zeile.id, benutzer.id)?.id ?? null;
    if (eigenes) {
      objekt.anfragen = db.prepare('SELECT COUNT(*) AS n FROM unterhaltungen WHERE angebot_id = ?').get(zeile.id).n;
    }
    return objekt;
  }

  /** Durchsuchbare Liste aktiver Angebote. */
  function liste(filter = {}, benutzer = null) {
    sicherAktiv();
    const bed = [`a.status IN ${SICHTBARE_STATUS}`, "k.status = 'freigegeben'", 'b.gesperrt = 0'];
    const p = { ich: benutzer?.id ?? -1 };
    if (benutzer) bed.push(NICHT_BLOCKIERT);
    if (filter.q) {
      bed.push("k.titel LIKE @muster ESCAPE '\\'");
      p.muster = `%${String(filter.q).trim().slice(0, 100).replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    }
    if (filter.katalog_id) { bed.push('a.katalog_id = @katalog'); p.katalog = Number(filter.katalog_id); }
    if (filter.anbieter_id) { bed.push('a.benutzer_id = @anbieter'); p.anbieter = Number(filter.anbieter_id); }
    if (filter.plattform_id) { bed.push('a.plattform_id = @plattform'); p.plattform = Number(filter.plattform_id); }
    if (ALLE_WERTE.typ.includes(filter.typ)) { bed.push('k.typ = @typ'); p.typ = filter.typ; }
    if (filter.art === 'verkauf') bed.push("a.art IN ('verkauf', 'beides')");
    if (filter.art === 'tausch') bed.push("a.art IN ('tausch', 'beides')");
    if (ALLE_WERTE.region.includes(filter.region)) { bed.push('a.region = @region'); p.region = filter.region; }
    if (ALLE_WERTE.zustand.includes(filter.zustand)) {
      const erlaubt = ZUSTAENDE.slice(0, ZUSTAND_RANG[filter.zustand] + 1).map((z) => `'${z.value}'`).join(', ');
      bed.push(`a.zustand IN (${erlaubt})`);
    }
    if (filter.cib === '1' || filter.cib === true) bed.push("a.vollstaendigkeit = 'cib'");
    if (filter.mit_foto === '1') bed.push('EXISTS (SELECT 1 FROM angebot_fotos f WHERE f.angebot_id = a.id)');
    const maxPreis = leer(filter.max_preis) ? null : leseEuro(filter.max_preis);
    if (maxPreis !== null) { bed.push('a.preis IS NOT NULL AND a.preis <= @maxPreis'); p.maxPreis = maxPreis; }
    if (filter.versand === '1') bed.push('a.versand = 1');
    if (plzBereich(filter.plz)) { bed.push('a.abholung = 1 AND a.plz_bereich = @plz'); p.plz = plzBereich(filter.plz); }
    if (filter.anbieter === 'privat') bed.push('b.haendler_status IS NULL');
    if (filter.anbieter === 'gewerblich') bed.push('b.haendler_status IS NOT NULL');

    const sortierung = {
      neu: 'a.erstellt_am DESC, a.id DESC',
      preis_auf: 'a.preis IS NULL, a.preis ASC, a.id DESC',
      preis_ab: 'a.preis IS NULL, a.preis DESC, a.id DESC',
      titel: 'k.titel COLLATE NOCASE, a.preis IS NULL, a.preis',
    }[filter.sortierung] ?? 'a.erstellt_am DESC, a.id DESC';
    const seite = Math.max(1, Math.min(1000, Number.parseInt(filter.seite, 10) || 1));
    const where = bed.join(' AND ');
    const gesamt = db.prepare(`SELECT COUNT(*) AS n ${ANGEBOT_JOIN} WHERE ${where}`).get(p).n;
    const zeilen = db.prepare(`SELECT ${ANGEBOT_SPALTEN} ${ANGEBOT_JOIN} WHERE ${where} ORDER BY ${sortierung}
      LIMIT ${SEITENGROESSE} OFFSET ${(seite - 1) * SEITENGROESSE}`).all(p);
    return {
      gesamt, seite, seiten: Math.max(1, Math.ceil(gesamt / SEITENGROESSE)),
      eintraege: zeilen.map((z) => angebotZuObjekt(z, benutzer)),
    };
  }

  /** Alle eigenen Angebote (auch beendete) mit Anzahl der Anfragen. */
  function meine(benutzerId) {
    return db.prepare(`SELECT ${ANGEBOT_SPALTEN}, (SELECT COUNT(*) FROM unterhaltungen u WHERE u.angebot_id = a.id) AS anfragen
      ${ANGEBOT_JOIN} WHERE a.benutzer_id = ? ORDER BY (a.status IN ${SICHTBARE_STATUS}) DESC, a.aktualisiert_am DESC LIMIT 5000`)
      .all(benutzerId).map((z) => ({ ...angebotZuObjekt(z, { id: benutzerId }), anfragen: z.anfragen }));
  }

  // ── Wunschliste ───────────────────────────────────────────────
  function passendeAngebote(wunsch, ich) {
    return db.prepare(`SELECT ${ANGEBOT_SPALTEN} ${ANGEBOT_JOIN}
      WHERE a.katalog_id = @katalog AND a.status = 'aktiv' AND a.benutzer_id != @ich AND b.gesperrt = 0 AND ${NICHT_BLOCKIERT}
      ORDER BY a.preis IS NULL, a.preis`).all({ katalog: wunsch.katalog_id, ich })
      .filter((a) => passtZuWunsch(wunsch, a));
  }

  function wuensche(benutzerId) {
    return db.prepare(`SELECT w.*, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, p.name AS plattform,
        (SELECT COUNT(*) FROM angebote a WHERE a.katalog_id = w.katalog_id AND a.status = 'aktiv' AND a.benutzer_id != w.benutzer_id) AS angebote
      FROM wunschliste w JOIN katalog k ON k.id = w.katalog_id LEFT JOIN plattformen p ON p.id = w.plattform_id
      WHERE w.benutzer_id = ? ORDER BY w.erstellt_am DESC`).all(benutzerId)
      .map((w) => {
        const treffer = w.angebote ? passendeAngebote(w, benutzerId) : [];
        return { ...w, nur_cib: Boolean(w.nur_cib), treffer: treffer.length, guenstigster: treffer.find((a) => a.preis !== null)?.preis ?? null };
      });
  }

  function setzeWunsch(benutzer, katalogId, eingabe = {}) {
    sicherAktiv();
    freigegebenerKatalog(katalogId);
    const d = pruefeWunsch(eingabe);
    if (d.plattform_id) pruefePlattformUndVariante({ plattform_id: d.plattform_id }, Number(katalogId));
    const anzahl = db.prepare('SELECT COUNT(*) AS n FROM wunschliste WHERE benutzer_id = ?').get(benutzer.id).n;
    if (!q.wunsch.get(benutzer.id, Number(katalogId)) && anzahl >= 2000) throw new KontoFehler('Deine Wunschliste ist voll (höchstens 2.000 Einträge).', 409);
    db.prepare(`INSERT INTO wunschliste (benutzer_id, katalog_id, plattform_id, region, min_zustand, nur_cib, max_preis, notiz)
      VALUES (@b, @k, @plattform_id, @region, @min_zustand, @nur_cib, @max_preis, @notiz)
      ON CONFLICT (benutzer_id, katalog_id) DO UPDATE SET plattform_id = excluded.plattform_id, region = excluded.region,
        min_zustand = excluded.min_zustand, nur_cib = excluded.nur_cib, max_preis = excluded.max_preis, notiz = excluded.notiz`)
      .run({ ...d, b: benutzer.id, k: Number(katalogId) });
    const w = q.wunsch.get(benutzer.id, Number(katalogId));
    // Bereits vorhandene Angebote gelten als bekannt – der Sammler sieht sie sofort in der Liste
    for (const a of passendeAngebote(w, benutzer.id)) q.trefferMerken.run(w.id, a.id);
    return { ...w, nur_cib: Boolean(w.nur_cib), treffer: passendeAngebote(w, benutzer.id).length };
  }

  const entferneWunsch = (benutzerId, katalogId) => db.prepare('DELETE FROM wunschliste WHERE benutzer_id = ? AND katalog_id = ?').run(benutzerId, Number(katalogId));

  /** Alle Angebote, die zur eigenen Wunschliste passen. */
  function treffer(benutzer) {
    const ergebnis = [];
    for (const w of db.prepare('SELECT * FROM wunschliste WHERE benutzer_id = ?').all(benutzer.id)) {
      for (const a of passendeAngebote(w, benutzer.id)) ergebnis.push(angebotZuObjekt(a, benutzer));
    }
    return ergebnis.sort((x, y) => (y.erstellt_am > x.erstellt_am ? 1 : -1));
  }

  /**
   * Tauschvorschläge: Andere Sammler, die etwas anbieten, das ich suche, und gleichzeitig etwas suchen,
   * das ich zum Tausch anbiete („perfekter Tausch“).
   */
  function tauschvorschlaege(benutzer) {
    const ich = benutzer.id;
    // Was andere zum Tausch anbieten und ich suche
    const bekommen = db.prepare(`SELECT ${ANGEBOT_SPALTEN}, w.id AS wunsch_id ${ANGEBOT_JOIN}
      JOIN wunschliste w ON w.katalog_id = a.katalog_id AND w.benutzer_id = @ich
      WHERE a.status = 'aktiv' AND a.art IN ('tausch', 'beides') AND a.benutzer_id != @ich AND b.gesperrt = 0 AND ${NICHT_BLOCKIERT}`)
      .all({ ich }).filter((a) => passtZuWunsch(db.prepare('SELECT * FROM wunschliste WHERE id = ?').get(a.wunsch_id), a));
    if (!bekommen.length) return [];
    const partnerIds = [...new Set(bekommen.map((a) => a.benutzer_id))];
    // Was ich zum Tausch anbiete und diese Partner suchen
    const meineTauschangebote = db.prepare(`SELECT ${ANGEBOT_SPALTEN} ${ANGEBOT_JOIN}
      WHERE a.benutzer_id = ? AND a.status = 'aktiv' AND a.art IN ('tausch', 'beides')`).all(ich);
    const vorschlaege = [];
    for (const partner of partnerIds) {
      const gibst = meineTauschangebote.filter((a) => {
        const w = q.wunsch.get(partner, a.katalog_id);
        return w && passtZuWunsch(w, a);
      });
      if (!gibst.length) continue;
      const bekommst = bekommen.filter((a) => a.benutzer_id === partner);
      vorschlaege.push({
        partner: anbieterInfo(bekommst[0]),
        du_bekommst: bekommst.map((a) => angebotZuObjekt(a, benutzer)),
        du_gibst: gibst.map((a) => angebotZuObjekt(a, benutzer)),
      });
    }
    return vorschlaege.sort((x, y) => (y.du_bekommst.length + y.du_gibst.length) - (x.du_bekommst.length + x.du_gibst.length));
  }

  /**
   * Nachfrage: meistgesuchte Spiele (anonym). Verifizierte Händler und das Moderationsteam sehen
   * die vollständige Auswertung mit Preisbereitschaft und Einträgen ohne Angebot.
   */
  function nachfrage(benutzerRoh, filter = {}) {
    const benutzer = q.benutzer.get(benutzerRoh.id);
    const voll = paketAktiv(benutzer) || istModerator(benutzer);
    const bed = ["k.status = 'freigegeben'"];
    const p = {};
    if (filter.plattform_id) {
      bed.push('(w.plattform_id = @plattform OR (w.plattform_id IS NULL AND EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = k.id AND kp.plattform_id = @plattform)))');
      p.plattform = Number(filter.plattform_id);
    }
    if (ALLE_WERTE.typ.includes(filter.typ)) { bed.push('k.typ = @typ'); p.typ = filter.typ; }
    const zeilen = db.prepare(`SELECT k.id AS katalog_id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr,
        COUNT(DISTINCT w.benutzer_id) AS suchende,
        ROUND(AVG(w.max_preis), 2) AS max_preis_schnitt, MAX(w.max_preis) AS max_preis_hoechst, SUM(w.nur_cib) AS nur_cib,
        (SELECT COUNT(*) FROM angebote a WHERE a.katalog_id = k.id AND a.status = 'aktiv') AS angebote,
        (SELECT MIN(a.preis) FROM angebote a WHERE a.katalog_id = k.id AND a.status = 'aktiv') AS ab_preis
      FROM wunschliste w JOIN katalog k ON k.id = w.katalog_id WHERE ${bed.join(' AND ')}
      GROUP BY k.id ${filter.ohne_angebot === '1' && voll ? 'HAVING angebote = 0' : ''}
      ORDER BY suchende DESC, k.titel COLLATE NOCASE LIMIT ${voll ? 500 : 30}`).all(p);
    return {
      voll,
      eintraege: zeilen.map((z) => (voll ? { ...z, nur_cib: z.nur_cib ?? 0 } : {
        katalog_id: z.katalog_id, titel: z.titel, typ: z.typ, cover_url: z.cover_url, erscheinungsjahr: z.erscheinungsjahr,
        suchende: z.suchende, angebote: z.angebote, ab_preis: z.ab_preis,
      })),
    };
  }

  /** Kurzüberblick für die Seite eines Spiels. */
  function zusammenfassung(katalogId, benutzer = null) {
    if (!k().aktiv) return null;
    const s = db.prepare(`SELECT COUNT(*) AS angebote, MIN(a.preis) AS ab_preis FROM angebote a JOIN benutzer b ON b.id = a.benutzer_id
      WHERE a.katalog_id = ? AND a.status = 'aktiv' AND b.gesperrt = 0`).get(katalogId);
    const gesucht = db.prepare('SELECT COUNT(*) AS n FROM wunschliste WHERE katalog_id = ?').get(katalogId).n;
    const ergebnis = { angebote: s.angebote, ab_preis: s.ab_preis, gesucht };
    if (benutzer) {
      const w = q.wunsch.get(benutzer.id, katalogId);
      ergebnis.mein_wunsch = w ? { ...w, nur_cib: Boolean(w.nur_cib) } : null;
      ergebnis.meine_angebote = db.prepare(`SELECT id, status, preis, art FROM angebote WHERE katalog_id = ? AND benutzer_id = ?
        AND status IN ${SICHTBARE_STATUS}`).all(katalogId, benutzer.id);
      ergebnis.gesucht = gesucht - (w ? 1 : 0);
    }
    return ergebnis;
  }

  /** Abgelaufene Angebote beenden und den Anbieter informieren. */
  function raeumeAuf() {
    const jetzt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const abgelaufen = db.prepare(`UPDATE angebote SET status = 'abgelaufen', aktualisiert_am = datetime('now')
      WHERE status IN ${SICHTBARE_STATUS} AND laeuft_ab < ? RETURNING benutzer_id`).all(jetzt);
    const jeBenutzer = new Map();
    for (const { benutzer_id: b } of abgelaufen) jeBenutzer.set(b, (jeBenutzer.get(b) ?? 0) + 1);
    for (const [b, n] of jeBenutzer) {
      benachrichtigungen.sende(b, {
        art: 'boerse', titel: n === 1 ? 'Ein Angebot ist abgelaufen' : `${n} Angebote sind abgelaufen`,
        text: 'Du kannst abgelaufene Angebote unter „Meine Börse“ mit einem Klick verlängern.', link: '#/boerse/meine',
      });
    }
    kuerzeNachPaketende();
    erinnereTestende();
    return abgelaufen.length;
  }

  // ── Blockieren ────────────────────────────────────────────────
  function blockiere(benutzer, zielId) {
    const ziel = q.benutzer.get(Number(zielId));
    if (!ziel || ziel.id === benutzer.id) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    db.prepare('INSERT OR IGNORE INTO blockierungen (benutzer_id, blockiert_id) VALUES (?, ?)').run(benutzer.id, ziel.id);
  }
  const entblocke = (benutzer, zielId) => db.prepare('DELETE FROM blockierungen WHERE benutzer_id = ? AND blockiert_id = ?').run(benutzer.id, Number(zielId));
  const blockierte = (benutzerId) => db.prepare(`SELECT b.id, COALESCE(b.anzeigename, b.benutzername) AS name, x.erstellt_am
    FROM blockierungen x JOIN benutzer b ON b.id = x.blockiert_id WHERE x.benutzer_id = ? ORDER BY x.erstellt_am DESC`).all(benutzerId);

  // ── Nachrichten ───────────────────────────────────────────────
  function darfSchreiben(benutzerRoh) {
    const b = q.benutzer.get(benutzerRoh.id);
    if (istModerator(b) || b.email) return;
    const alterTage = (Date.now() - Date.parse(`${b.erstellt_am.replace(' ', 'T')}Z`)) / TAG_MS;
    const mindestens = k().mindestKontoalterTage;
    if (alterTage < mindestens) {
      throw new KontoFehler(`Zum Schutz vor Spam können neue Konten erst nach ${mindestens} Tagen Nachrichten schreiben – `
        + 'mit einer bestätigten E-Mail-Adresse (unter „Konto“) sofort.', 403, 'zu_neu');
    }
  }

  function pruefeText(roh) {
    const t = String(roh ?? '').trim();
    if (!t) throw new ValidierungsFehler({ text: 'Bitte eine Nachricht eingeben.' });
    if (t.length > 2000) throw new ValidierungsFehler({ text: 'Die Nachricht ist zu lang (höchstens 2.000 Zeichen).' });
    return t;
  }

  function beteiligt(u, benutzerId) {
    return u && (u.anfragender_id === benutzerId || u.anbieter_id === benutzerId);
  }

  function schreibe(u, absender, textWert) {
    if (nachrichtenDrossel.gesperrt(`n:${absender.id}`)) throw new KontoFehler('Zu viele Nachrichten in kurzer Zeit. Bitte später erneut versuchen.', 429);
    nachrichtenDrossel.fehlschlag(`n:${absender.id}`);
    const empfaenger = u.anfragender_id === absender.id ? u.anbieter_id : u.anfragender_id;
    if (!empfaenger) throw new KontoFehler('Der andere Benutzer hat sein Konto gelöscht.', 409);
    if (q.blockiert.get({ a: absender.id, b: empfaenger })) throw new KontoFehler('Nachrichten an diesen Benutzer sind nicht möglich.', 403, 'blockiert');
    const empfaengerIstAnfragender = empfaenger === u.anfragender_id;
    const gelesenSpalte = empfaengerIstAnfragender ? 'gelesen_anfragender' : 'gelesen_anbieter';
    // Nur benachrichtigen, wenn der Empfänger bisher alles gelesen hatte – sonst gäbe es eine Flut
    const vorher = q.letzteNachricht.get(u.id).id ?? 0;
    const hatteAllesGelesen = u[gelesenSpalte] >= vorher;
    const { id } = db.prepare('INSERT INTO nachrichten (unterhaltung_id, absender_id, text) VALUES (?, ?, ?) RETURNING id').get(u.id, absender.id, textWert);
    const eigeneSpalte = empfaengerIstAnfragender ? 'gelesen_anbieter' : 'gelesen_anfragender';
    db.prepare(`UPDATE unterhaltungen SET letzte_nachricht_am = datetime('now'), ${eigeneSpalte} = ? WHERE id = ?`).run(id, u.id);
    if (hatteAllesGelesen) {
      const absenderName = name(q.benutzer.get(absender.id));
      benachrichtigungen.sende(empfaenger, {
        art: 'nachricht', titel: `Neue Nachricht von ${absenderName}`, text: `${u.titel}: ${textWert.slice(0, 140)}`, link: `#/nachrichten/${u.id}`,
      });
    }
    return id;
  }

  /** Erste Nachricht zu einem Angebot (oder weitere, falls es die Unterhaltung schon gibt). */
  function frageAn(benutzer, angebotId, textRoh) {
    sicherAktiv();
    darfSchreiben(benutzer);
    const textWert = pruefeText(textRoh);
    const a = q.angebot.get(Number(angebotId));
    if (!a || !['aktiv', 'reserviert'].includes(a.status)) throw new KontoFehler('Angebot nicht gefunden.', 404);
    if (a.benutzer_id === benutzer.id) throw new KontoFehler('Das ist dein eigenes Angebot.', 400);
    let u = q.unterhaltungZuAngebot.get(a.id, benutzer.id);
    if (!u) {
      if (neueAnfragenDrossel.gesperrt(`a:${benutzer.id}`)) throw new KontoFehler('Du hast heute schon sehr viele Anbieter angeschrieben. Bitte morgen weitermachen.', 429);
      if (q.blockiert.get({ a: benutzer.id, b: a.benutzer_id })) throw new KontoFehler('Nachrichten an diesen Benutzer sind nicht möglich.', 403, 'blockiert');
      neueAnfragenDrossel.fehlschlag(`a:${benutzer.id}`);
      const titel = `${a.titel}${a.plattform_kurz ? ` (${a.plattform_kurz})` : ''}`;
      u = db.prepare('INSERT INTO unterhaltungen (angebot_id, titel, anfragender_id, anbieter_id) VALUES (?, ?, ?, ?) RETURNING *')
        .get(a.id, titel.slice(0, 200), benutzer.id, a.benutzer_id);
    }
    schreibe(u, benutzer, textWert);
    return u.id;
  }

  function antworte(benutzer, unterhaltungId, textRoh) {
    sicherAktiv();
    darfSchreiben(benutzer);
    const textWert = pruefeText(textRoh);
    const u = q.unterhaltung.get(Number(unterhaltungId));
    if (!beteiligt(u, benutzer.id)) throw new KontoFehler('Unterhaltung nicht gefunden.', 404);
    schreibe(u, benutzer, textWert);
  }

  function unterhaltungen(benutzerId) {
    return db.prepare(`SELECT u.*, a.status AS angebot_status, a.preis AS angebot_preis, k.cover_url,
        CASE WHEN u.anfragender_id = @ich THEN u.anbieter_id ELSE u.anfragender_id END AS partner_id,
        (SELECT COALESCE(anzeigename, benutzername) FROM benutzer WHERE id = CASE WHEN u.anfragender_id = @ich THEN u.anbieter_id ELSE u.anfragender_id END) AS partner,
        (SELECT text FROM nachrichten n WHERE n.unterhaltung_id = u.id ORDER BY n.id DESC LIMIT 1) AS letzte_nachricht,
        (SELECT COUNT(*) FROM nachrichten n WHERE n.unterhaltung_id = u.id AND n.absender_id IS NOT @ich
          AND n.id > CASE WHEN u.anfragender_id = @ich THEN u.gelesen_anfragender ELSE u.gelesen_anbieter END) AS ungelesen
      FROM unterhaltungen u LEFT JOIN angebote a ON a.id = u.angebot_id LEFT JOIN katalog k ON k.id = a.katalog_id
      WHERE u.anfragender_id = @ich OR u.anbieter_id = @ich ORDER BY u.letzte_nachricht_am DESC, u.id DESC LIMIT 500`)
      .all({ ich: benutzerId })
      .map(({ gelesen_anfragender: _a, gelesen_anbieter: _b, ...u }) => ({ ...u, rolle: u.anfragender_id === benutzerId ? 'anfragender' : 'anbieter' }));
  }

  function ungeleseneNachrichten(benutzerId) {
    return db.prepare(`SELECT COUNT(*) AS n FROM nachrichten n JOIN unterhaltungen u ON u.id = n.unterhaltung_id
      WHERE (u.anfragender_id = @ich OR u.anbieter_id = @ich) AND n.absender_id IS NOT @ich
        AND n.id > CASE WHEN u.anfragender_id = @ich THEN u.gelesen_anfragender ELSE u.gelesen_anbieter END`).get({ ich: benutzerId }).n;
  }

  /** Eine Unterhaltung lesen (markiert sie als gelesen). */
  function unterhaltung(benutzer, id) {
    const u = q.unterhaltung.get(Number(id));
    if (!beteiligt(u, benutzer.id)) throw new KontoFehler('Unterhaltung nicht gefunden.', 404);
    const nachrichtenListe = db.prepare('SELECT id, absender_id, text, erstellt_am FROM nachrichten WHERE unterhaltung_id = ? ORDER BY id').all(u.id)
      .map((n) => ({ ...n, eigene: n.absender_id === benutzer.id }));
    const letzte = nachrichtenListe.at(-1)?.id ?? 0;
    const ichAnfragender = u.anfragender_id === benutzer.id;
    db.prepare(`UPDATE unterhaltungen SET ${ichAnfragender ? 'gelesen_anfragender' : 'gelesen_anbieter'} = ? WHERE id = ?`).run(letzte, u.id);
    const partnerId = ichAnfragender ? u.anbieter_id : u.anfragender_id;
    const partner = partnerId ? q.benutzer.get(partnerId) : null;
    const beideGeschrieben = nachrichtenListe.some((n) => n.eigene) && nachrichtenListe.some((n) => !n.eigene && n.absender_id);
    const bewertung = db.prepare('SELECT wert, text, erstellt_am FROM bewertungen WHERE unterhaltung_id = ? AND von_id = ?').get(u.id, benutzer.id) ?? null;
    return {
      id: u.id,
      titel: u.titel,
      rolle: ichAnfragender ? 'anfragender' : 'anbieter',
      angebot: u.angebot_id ? hole(u.angebot_id, benutzer) : null,
      partner: partner ? { ...anbieterInfo({ ...partner, benutzer_id: partner.id }), blockiert: Boolean(db.prepare('SELECT 1 FROM blockierungen WHERE benutzer_id = ? AND blockiert_id = ?').get(benutzer.id, partner.id)) } : null,
      nachrichten: nachrichtenListe,
      // Bewerten ist erst möglich, wenn beide Seiten geschrieben haben (echter Kontakt)
      darf_bewerten: Boolean(partner && beideGeschrieben),
      meine_bewertung: bewertung,
    };
  }

  // ── Bewertungen ───────────────────────────────────────────────
  function bewerte(benutzer, unterhaltungId, eingabe = {}) {
    const daten = unterhaltung(benutzer, unterhaltungId);
    if (!daten.darf_bewerten) throw new KontoFehler('Bewerten ist erst möglich, wenn ihr beide in der Unterhaltung geschrieben habt.', 409);
    const wert = Number(eingabe.wert);
    if (![1, 0, -1].includes(wert)) throw new ValidierungsFehler({ wert: 'Bitte positiv, neutral oder negativ wählen.' });
    const kommentar = text(eingabe.text, 500);
    if (wert < 1 && !kommentar) throw new ValidierungsFehler({ text: 'Bitte begründe eine neutrale oder negative Bewertung kurz.' });
    const neu = !daten.meine_bewertung;
    db.prepare(`INSERT INTO bewertungen (unterhaltung_id, von_id, fuer_id, wert, text) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (unterhaltung_id, von_id) DO UPDATE SET wert = excluded.wert, text = excluded.text, erstellt_am = datetime('now')`)
      .run(daten.id, benutzer.id, daten.partner.id, wert, kommentar);
    if (neu) {
      benachrichtigungen.sende(daten.partner.id, {
        art: 'boerse', titel: 'Du hast eine neue Bewertung erhalten', text: `Zu „${daten.titel}“`, link: `#/boerse/anbieter/${daten.partner.id}`,
      });
    }
    return bewertungFuer(daten.partner.id);
  }

  function bewertungenListe(benutzerId) {
    return db.prepare(`SELECT r.id, r.wert, r.text, r.erstellt_am, COALESCE(b.anzeigename, b.benutzername) AS von, u.titel
      FROM bewertungen r LEFT JOIN benutzer b ON b.id = r.von_id LEFT JOIN unterhaltungen u ON u.id = r.unterhaltung_id
      WHERE r.fuer_id = ? ORDER BY r.erstellt_am DESC LIMIT 100`).all(benutzerId);
  }

  /** Öffentliches Profil eines Anbieters in der Börse. */
  function anbieterProfil(id, benutzer) {
    const b = q.benutzer.get(Number(id));
    if (!b || b.gesperrt) return null;
    if (benutzer && benutzer.id !== b.id && q.blockiert.get({ a: benutzer.id, b: b.id })) return null;
    return {
      ...anbieterInfo({ ...b, benutzer_id: b.id }, { mitKennzeichnung: true }),
      mitglied_seit: b.erstellt_am,
      aktive_angebote: q.anzahlAktiv.get(b.id).n,
      bewertungen: bewertungenListe(b.id),
      eigenes: Boolean(benutzer && benutzer.id === b.id),
      blockiert: Boolean(benutzer && db.prepare('SELECT 1 FROM blockierungen WHERE benutzer_id = ? AND blockiert_id = ?').get(benutzer.id, b.id)),
    };
  }

  // ── Gewerbliche Anbieter ──────────────────────────────────────
  function haendlerProfil(benutzerId) {
    const b = q.benutzer.get(benutzerId);
    return {
      status: b.haendler_status,
      daten: haendlerDaten(b),
      plz: b.boerse_plz,
      limit: limitFuer(b),
      aktive_angebote: q.anzahlAktiv.get(b.id).n,
      kostenlos: k().maxAngebote,
      paket: paketAktiv(b) ? b.haendler_paket : null,
      paket_bis: b.haendler_paket_bis,
      paket_gebucht: b.haendler_paket,
      api: apiAktiv(b),
      api_bis: b.haendler_api_bis,
      pakete: k().pakete,
      api_preis: k().apiPreis,
      kontakt: k().proKontakt || null,
      preis_hinweis: k().proInfo || null,
      test_bis: b.haendler_test_bis && b.haendler_test_bis >= heute() ? b.haendler_test_bis : null,
      test_genutzt_am: b.haendler_test_genutzt_am,
      // Selbststart möglich: eingeschaltet, verifiziert, noch nie getestet und nichts gebucht
      test_moeglich: Boolean(k().testTage > 0 && k().pakete.length && b.haendler_status === 'verifiziert' && !b.haendler_test_genutzt_am
        && !paketAktiv(b) && !apiAktiv(b)),
      test_tage: k().testTage,
    };
  }

  /**
   * Kostenloser Testzugang: Paket (Standard: größtes Paket) und API-Anbindung für `tage` Tage.
   * Durch Administratoren jederzeit, durch Händler selbst nur einmal und nur wenn eingeschaltet.
   */
  function starteTest(benutzerId, { tage, angebote = null, durchAdmin = false } = {}) {
    const b = q.benutzer.get(Number(benutzerId));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    if (b.haendler_status !== 'verifiziert') throw new KontoFehler('Testzugänge gibt es nur für verifizierte Händler.', 409);
    if (!durchAdmin) {
      if (!haendlerProfil(b.id).test_moeglich) throw new KontoFehler('Ein kostenloser Test ist für dein Konto nicht (mehr) verfügbar.', 409);
      tage = k().testTage;
      angebote = null;
    }
    const n = Number(tage);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new ValidierungsFehler({ tage: 'Bitte 1 bis 365 Tage angeben.' });
    const groesstes = Math.max(0, ...k().pakete.map((p) => p.angebote));
    const anzahl = angebote === null || angebote === undefined || angebote === '' ? groesstes : Number(angebote);
    if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 1_000_000) throw new ValidierungsFehler({ angebote: 'Ungültige Anzahl Angebote.' });
    const bis = new Date(Date.now() + n * TAG_MS).toISOString().slice(0, 10);
    db.prepare(`UPDATE benutzer SET haendler_paket = ?, haendler_paket_bis = ?, haendler_api_bis = ?, haendler_test_bis = ?,
      haendler_test_genutzt_am = ?, haendler_test_erinnert = 0 WHERE id = ?`).run(anzahl || null, bis, bis, bis, heute(), b.id);
    benachrichtigungen.sende(b.id, {
      art: 'boerse', titel: `Dein kostenloser Testzugang läuft bis ${datumText(bis)}`,
      text: `Du kannst bis zu ${anzahl.toLocaleString('de-DE')} Angebote einstellen, die volle Nachfrage-Auswertung nutzen und deinen Shop per API anbinden.`,
      link: '#/boerse/haendler',
    });
    return haendlerProfil(b.id);
  }

  /** Drei Tage vor Ende eines Testzugangs einmal erinnern. */
  function erinnereTestende() {
    const grenze = new Date(Date.now() + 3 * TAG_MS).toISOString().slice(0, 10);
    const faellig = db.prepare(`SELECT id, haendler_test_bis FROM benutzer WHERE haendler_test_bis IS NOT NULL AND haendler_test_erinnert = 0
      AND haendler_test_bis >= ? AND haendler_test_bis <= ?`).all(heute(), grenze);
    for (const b of faellig) {
      db.prepare('UPDATE benutzer SET haendler_test_erinnert = 1 WHERE id = ?').run(b.id);
      benachrichtigungen.sende(b.id, {
        art: 'boerse', titel: `Dein Testzugang endet am ${datumText(b.haendler_test_bis)}`,
        text: 'Buche jetzt ein Paket, damit deine Angebote und die API-Anbindung aktiv bleiben.',
        link: '#/boerse/haendler',
      });
    }
    return faellig.length;
  }

  function pruefeDatum(bis) {
    if (bis !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(bis))) throw new ValidierungsFehler({ bis: 'Bitte ein Datum im Format JJJJ-MM-TT angeben.' });
  }

  function verifizierterHaendler(benutzerId, bis) {
    const b = q.benutzer.get(Number(benutzerId));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    pruefeDatum(bis);
    if (bis && b.haendler_status !== 'verifiziert') throw new KontoFehler('Pakete gibt es nur für verifizierte Händler.', 409);
    return b;
  }

  /** Admin: Händler-Paket (Anzahl Angebote) bis zu einem Datum freischalten; bis = null beendet es. Abrechnung außerhalb der App. */
  function setzePaket(benutzerId, { angebote, bis }) {
    const b = verifizierterHaendler(benutzerId, bis);
    const anzahl = bis ? Number(angebote) : null;
    // Eingestellte Pakete oder – oberhalb des größten Pakets – ein individuell vereinbartes Kontingent
    const groesstes = Math.max(0, ...k().pakete.map((p) => p.angebote));
    const individuell = Number.isInteger(anzahl) && anzahl > groesstes && anzahl <= 1_000_000;
    if (bis && !k().pakete.some((p) => p.angebote === anzahl) && !individuell) {
      throw new ValidierungsFehler({ angebote: `Bitte eines der eingestellten Pakete wählen oder individuell mehr als ${groesstes.toLocaleString('de-DE')} Angebote.` });
    }
    // Eine reguläre Buchung beendet den Teststatus
    db.prepare('UPDATE benutzer SET haendler_paket = ?, haendler_paket_bis = ?, haendler_test_bis = NULL WHERE id = ?').run(anzahl, bis, b.id);
    if (bis && bis >= heute()) {
      benachrichtigungen.sende(b.id, {
        art: 'boerse', titel: `Händler-Paket ${anzahl.toLocaleString('de-DE')} ist freigeschaltet`,
        text: `Gültig bis ${datumText(bis)}: bis zu ${anzahl.toLocaleString('de-DE')} aktive Angebote und die vollständige Nachfrage-Auswertung.`,
        link: '#/boerse/haendler',
      });
    }
  }

  /** Admin: Zusatzpaket API-Anbindung bis zu einem Datum freischalten (null = beenden). */
  function setzeApi(benutzerId, bis) {
    const b = verifizierterHaendler(benutzerId, bis);
    db.prepare('UPDATE benutzer SET haendler_api_bis = ?, haendler_test_bis = NULL WHERE id = ?').run(bis, b.id);
    if (bis && bis >= heute()) {
      benachrichtigungen.sende(b.id, {
        art: 'boerse', titel: 'API-Anbindung ist freigeschaltet',
        text: `Gültig bis ${datumText(bis)}: Richte im Händlerbereich die automatische Anbindung an deinen Shop oder dein ERP ein.`,
        link: '#/boerse/haendler',
      });
    }
  }

  /**
   * Nach Ablauf eines Pakets: Angebote über dem kostenlosen Limit beenden (die zuletzt geänderten bleiben aktiv)
   * und den Händler informieren. Beendete Angebote lassen sich nach erneuter Buchung wieder einstellen.
   */
  function kuerzeNachPaketende() {
    let beendet = 0;
    const kandidaten = db.prepare(`SELECT b.id FROM benutzer b WHERE (SELECT COUNT(*) FROM angebote a WHERE a.benutzer_id = b.id
      AND a.status IN ${SICHTBARE_STATUS}) > ?`).all(k().maxAngebote);
    for (const { id } of kandidaten) {
      const b = q.benutzer.get(id);
      const limit = limitFuer(b);
      const zuViel = db.prepare(`SELECT id FROM angebote WHERE benutzer_id = ? AND status IN ${SICHTBARE_STATUS}
        ORDER BY aktualisiert_am DESC, id DESC LIMIT -1 OFFSET ?`).all(id, limit);
      if (!zuViel.length) continue;
      db.transaction(() => {
        for (const a of zuViel) db.prepare("UPDATE angebote SET status = 'beendet', aktualisiert_am = datetime('now') WHERE id = ?").run(a.id);
      })();
      beendet += zuViel.length;
      benachrichtigungen.sende(id, {
        art: 'boerse', titel: `${zuViel.length} Angebote wurden beendet`,
        text: `Dein Händler-Paket ist abgelaufen. Ohne Paket sind ${limit.toLocaleString('de-DE')} aktive Angebote möglich – nach einer neuen Buchung kannst du die Angebote wieder einstellen.`,
        link: '#/boerse/haendler',
      });
    }
    return beendet;
  }

  /** Admin: Pro-Paket bis zu einem Datum freischalten (null = beenden). Abrechnung erfolgt außerhalb der App. */

  /** Als gewerblich kennzeichnen (mit Anbieterkennzeichnung) oder zurück auf privat. */
  function setzeHaendler(benutzer, eingabe) {
    const b = q.benutzer.get(benutzer.id);
    if (eingabe === null) {
      db.prepare('UPDATE benutzer SET haendler_status = NULL, haendler_daten = NULL WHERE id = ?').run(b.id);
    } else {
      const daten = pruefeHaendlerDaten(eingabe);
      const alt = haendlerDaten(b);
      // Änderungen an Name oder Anschrift heben eine Verifizierung auf – der Admin prüft neu
      const bleibtVerifiziert = b.haendler_status === 'verifiziert' && alt && alt.firma === daten.firma && alt.anschrift === daten.anschrift;
      db.prepare('UPDATE benutzer SET haendler_status = ?, haendler_daten = ? WHERE id = ?')
        .run(bleibtVerifiziert ? 'verifiziert' : 'angemeldet', JSON.stringify(daten), b.id);
    }
    return haendlerProfil(b.id);
  }

  function setzePlz(benutzer, plz) {
    const bereich = leer(plz) ? null : plzBereich(plz);
    if (!leer(plz) && !bereich) throw new ValidierungsFehler({ plz: 'Bitte die ersten zwei Ziffern der Postleitzahl angeben.' });
    db.prepare('UPDATE benutzer SET boerse_plz = ? WHERE id = ?').run(bereich, benutzer.id);
    return bereich;
  }

  /** Admin: gewerblichen Anbieter verifizieren (oder Verifizierung zurücknehmen). */
  function verifiziere(benutzerId, ja) {
    const b = q.benutzer.get(Number(benutzerId));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    if (!b.haendler_status) throw new KontoFehler('Dieser Benutzer ist nicht als gewerblicher Anbieter angemeldet.', 409);
    db.prepare('UPDATE benutzer SET haendler_status = ? WHERE id = ?').run(ja ? 'verifiziert' : 'angemeldet', b.id);
    if (ja) {
      benachrichtigungen.sende(b.id, {
        art: 'boerse', titel: 'Dein Händlerkonto wurde verifiziert',
        text: k().pakete.length
          ? `Du kannst jetzt ein Händler-Paket buchen – z. B. ${k().pakete.map((p) => `${p.angebote.toLocaleString('de-DE')} Angebote für ${euroText(p.preis)}`).join(', ')} im Monat.`
          : 'Deine Angebote werden jetzt als „verifizierter Händler“ gekennzeichnet.',
        link: '#/boerse/haendler',
      });
    }
  }

  return {
    aktiv: () => k().aktiv,
    limitFuer,
    legeAn, aendere, loesche, hole, liste, meine,
    wuensche, setzeWunsch, entferneWunsch, treffer, tauschvorschlaege, nachfrage, zusammenfassung,
    benachrichtigeTreffer, raeumeAuf, pruefeLimit, sicherAktiv,
    blockiere, entblocke, blockierte,
    frageAn, antworte, unterhaltungen, unterhaltung, ungeleseneNachrichten,
    bewerte, bewertungFuer, anbieterProfil,
    haendlerProfil, setzeHaendler, setzePlz, verifiziere, setzePaket, setzeApi, kuerzeNachPaketende, starteTest, erinnereTestende,
    apiAktiv: (id) => apiAktiv(q.benutzer.get(id)),
  };
}
