import { ALLE_WERTE } from '../../shared/konstanten.js';

export class ValidierungsFehler extends Error {
  constructor(fehler) {
    super('Die Eingaben sind unvollständig oder fehlerhaft.');
    this.fehler = fehler; // { feldname: 'Meldung' }
  }
}

const TEXTFELDER = {
  titel: 200,
  plattform: 100,
  barcode: 20,
  cover_url: 1000,
  farbe: 100,
  edition: 200,
  modellnummer: 100,
  seriennummer: 100,
  notizen: 5000,
};

const AUSWAHLFELDER = ['zustand', 'vollstaendigkeit', 'region'];

function leerZuNull(wert) {
  if (wert === undefined || wert === null) return null;
  const s = String(wert).trim();
  return s === '' ? null : s;
}

/** Liest Beträge in deutscher oder englischer Schreibweise: "1.299,90", "49,99", "49.99". */
export function leseEuro(roh) {
  if (typeof roh === 'number') return Number.isFinite(roh) && roh >= 0 && roh <= 1_000_000 ? Math.round(roh * 100) / 100 : null;
  const text = String(roh).replace(/[€\s]/g, '');
  const zahl = Number(/,/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text);
  if (!Number.isFinite(zahl) || zahl < 0 || zahl > 1_000_000) return null;
  return Math.round(zahl * 100) / 100;
}

/**
 * Prüft und normalisiert einen Sammlungsartikel.
 * @param {object} eingabe  Rohdaten aus dem Request
 * @param {boolean} teilweise  true bei PATCH-artigen Aktualisierungen
 */
export function pruefeArtikel(eingabe, teilweise = false) {
  const fehler = {};
  const daten = {};
  const hat = (feld) => Object.hasOwn(eingabe ?? {}, feld);
  eingabe ??= {};

  if (!teilweise || hat('typ')) {
    if (!ALLE_WERTE.typ.includes(eingabe.typ)) fehler.typ = 'Bitte einen Artikeltyp wählen (Spiel, Konsole oder Zubehör).';
    else daten.typ = eingabe.typ;
  }

  for (const [feld, maxLaenge] of Object.entries(TEXTFELDER)) {
    if (teilweise && !hat(feld)) continue;
    const wert = leerZuNull(eingabe[feld]);
    if (wert && wert.length > maxLaenge) fehler[feld] = `Maximal ${maxLaenge} Zeichen erlaubt.`;
    daten[feld] = wert;
  }
  if ((!teilweise || hat('titel')) && !daten.titel) fehler.titel = 'Bitte einen Titel bzw. eine Bezeichnung angeben.';

  if (daten.cover_url && !/^(https?:\/\/|\/uploads\/)/i.test(daten.cover_url)) {
    fehler.cover_url = 'Die Bildadresse muss mit http:// oder https:// beginnen.';
  }

  if (daten.barcode) {
    daten.barcode = daten.barcode.replace(/\D/g, '');
    if (![8, 12, 13, 14].includes(daten.barcode.length)) fehler.barcode = 'Ungültiger Barcode (EAN-8, UPC-A, EAN-13 oder GTIN-14).';
  }

  for (const feld of AUSWAHLFELDER) {
    if (teilweise && !hat(feld)) continue;
    const wert = leerZuNull(eingabe[feld]);
    if (wert && !ALLE_WERTE[feld].includes(wert)) fehler[feld] = 'Ungültige Auswahl.';
    daten[feld] = wert;
  }

  for (const feld of ['kaufpreis', 'marktwert']) {
    if (teilweise && !hat(feld)) continue;
    const roh = leerZuNull(eingabe[feld]);
    if (roh === null) daten[feld] = null;
    else {
      const zahl = leseEuro(roh);
      if (zahl === null) fehler[feld] = 'Bitte einen gültigen Betrag angeben (z. B. 49,99).';
      else daten[feld] = zahl;
    }
  }

  if (!teilweise || hat('kaufdatum')) {
    const datum = leerZuNull(eingabe.kaufdatum);
    if (datum && (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum)))) {
      fehler.kaufdatum = 'Bitte ein gültiges Datum angeben.';
    }
    daten.kaufdatum = datum;
  }

  if (!teilweise || hat('anzahl')) {
    const anzahl = eingabe.anzahl === undefined || eingabe.anzahl === '' || eingabe.anzahl === null ? 1 : Number(eingabe.anzahl);
    if (!Number.isInteger(anzahl) || anzahl < 1 || anzahl > 9999) fehler.anzahl = 'Die Anzahl muss eine ganze Zahl ab 1 sein.';
    else daten.anzahl = anzahl;
  }

  if (!teilweise || hat('katalog_id')) {
    const id = eingabe.katalog_id === '' || eingabe.katalog_id == null ? null : Number(eingabe.katalog_id);
    if (id !== null && !Number.isInteger(id)) fehler.katalog_id = 'Ungültiger Katalogeintrag.';
    else daten.katalog_id = id;
  }

  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return daten;
}

/** Prüft einen eigenen Katalogeintrag (z. B. seltene Hardware). */
export function pruefeKatalogEintrag(eingabe = {}) {
  const fehler = {};
  const titel = leerZuNull(eingabe.titel);
  if (!titel) fehler.titel = 'Bitte eine Bezeichnung angeben.';
  else if (titel.length > 200) fehler.titel = 'Maximal 200 Zeichen erlaubt.';
  if (!ALLE_WERTE.typ.includes(eingabe.typ)) fehler.typ = 'Bitte einen Artikeltyp wählen.';
  let jahr = leerZuNull(eingabe.erscheinungsjahr);
  if (jahr !== null) {
    jahr = Number(jahr);
    if (!Number.isInteger(jahr) || jahr < 1950 || jahr > 2100) fehler.erscheinungsjahr = 'Ungültiges Jahr.';
  }
  const plattformen = Array.isArray(eingabe.plattformen)
    ? eingabe.plattformen.map(leerZuNull).filter(Boolean).slice(0, 20)
    : [leerZuNull(eingabe.plattformen)].filter(Boolean);
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return {
    typ: eingabe.typ,
    titel,
    plattformen,
    erscheinungsjahr: jahr,
    hersteller: leerZuNull(eingabe.hersteller)?.slice(0, 200) ?? null,
    cover_url: /^https?:\/\//i.test(eingabe.cover_url ?? '') ? String(eingabe.cover_url).trim().slice(0, 1000) : null,
    beschreibung: leerZuNull(eingabe.beschreibung)?.slice(0, 5000) ?? null,
  };
}
