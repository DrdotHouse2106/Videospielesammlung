// Import von Sammlungen aus CSV-Dateien – z. B. aus CLZ Games, Tabellen (Excel/LibreOffice) oder dem eigenen CSV-Export.
// Die Spalten werden anhand ihrer Überschriften automatisch zugeordnet und lassen sich in der Oberfläche anpassen.

/** Liest CSV nach RFC 4180 (Anführungszeichen, Zeilenumbrüche in Feldern). Trennzeichen wird erkannt. */
export function leseCsv(text) {
  const roh = String(text ?? '').replace(/^﻿/, '');
  const ersteZeile = roh.split(/\r?\n/, 1)[0] ?? '';
  const trennzeichen = [';', ',', '\t'].map((t) => [t, ersteZeile.split(t).length]).sort((a, b) => b[1] - a[1])[0][0];
  const zeilen = [];
  let zeile = [];
  let feld = '';
  let inAnfuehrung = false;
  for (let i = 0; i < roh.length; i++) {
    const z = roh[i];
    if (inAnfuehrung) {
      if (z === '"' && roh[i + 1] === '"') { feld += '"'; i++; } else if (z === '"') inAnfuehrung = false;
      else feld += z;
    } else if (z === '"' && feld === '') inAnfuehrung = true;
    else if (z === trennzeichen) { zeile.push(feld); feld = ''; } else if (z === '\n' || z === '\r') {
      if (z === '\r' && roh[i + 1] === '\n') i++;
      zeile.push(feld);
      if (zeile.some((f) => f.trim() !== '')) zeilen.push(zeile);
      zeile = [];
      feld = '';
    } else feld += z;
  }
  zeile.push(feld);
  if (zeile.some((f) => f.trim() !== '')) zeilen.push(zeile);
  return { trennzeichen, kopf: (zeilen.shift() ?? []).map((k) => k.trim()), zeilen };
}

/** Zielfelder mit bekannten Spaltennamen (deutsch, englisch, CLZ Games, eigener Export). */
export const IMPORT_FELDER = [
  { feld: 'titel', titel: 'Titel', pflicht: true, namen: ['titel', 'title', 'name', 'spiel', 'game', 'bezeichnung', 'artikel'] },
  { feld: 'plattform', titel: 'Plattform', namen: ['plattform', 'platform', 'system', 'konsole', 'console'] },
  { feld: 'typ', titel: 'Artikeltyp', namen: ['artikeltyp', 'typ', 'type', 'kategorie', 'category', 'item type'] },
  { feld: 'region', titel: 'Region', namen: ['region', 'land', 'country'] },
  { feld: 'zustand', titel: 'Zustand', namen: ['zustand', 'condition', 'grade'] },
  { feld: 'vollstaendigkeit', titel: 'Vollständigkeit', namen: ['vollständigkeit', 'vollstaendigkeit', 'completeness', 'complete', 'box', 'status'] },
  { feld: 'edition', titel: 'Edition/Variante', namen: ['edition/variante', 'edition', 'variante', 'variant', 'version'] },
  { feld: 'farbe', titel: 'Farbe', namen: ['farbe', 'color', 'colour'] },
  { feld: 'modellnummer', titel: 'Modellnummer', namen: ['modellnummer', 'model', 'model number', 'modell'] },
  { feld: 'seriennummer', titel: 'Seriennummer', namen: ['seriennummer', 'serial', 'serial number'] },
  { feld: 'barcode', titel: 'Barcode (EAN/UPC)', namen: ['barcode', 'ean', 'upc', 'gtin'] },
  { feld: 'anzahl', titel: 'Anzahl', namen: ['anzahl', 'quantity', 'qty', 'menge', 'copies'] },
  { feld: 'kaufpreis', titel: 'Kaufpreis', namen: ['kaufpreis (eur)', 'kaufpreis', 'purchase price', 'price paid', 'preis', 'price'] },
  { feld: 'kaufdatum', titel: 'Kaufdatum', namen: ['kaufdatum', 'purchase date', 'date purchased', 'gekauft am'] },
  { feld: 'marktwert', titel: 'Marktwert', namen: ['marktwert (eur)', 'marktwert', 'current value', 'value', 'wert'] },
  { feld: 'notizen', titel: 'Notizen', namen: ['eigene notizen', 'notizen', 'notes', 'note', 'comments', 'kommentar', 'bemerkung'] },
];

const norm = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Ordnet Überschriften automatisch den Feldern zu: { feld: spaltenIndex }. */
export function erkenneZuordnung(kopf) {
  const zuordnung = {};
  const vergeben = new Set();
  for (const f of IMPORT_FELDER) {
    for (const name of f.namen) {
      const index = kopf.findIndex((k, i) => !vergeben.has(i) && norm(k) === name);
      if (index >= 0) { zuordnung[f.feld] = index; vergeben.add(index); break; }
    }
  }
  // Zweiter Durchgang: Überschrift enthält den Namen (z. B. „Purchase Price (USD)“)
  for (const f of IMPORT_FELDER) {
    if (zuordnung[f.feld] !== undefined) continue;
    const index = kopf.findIndex((k, i) => !vergeben.has(i) && f.namen.some((n) => n.length > 3 && norm(k).includes(n)));
    if (index >= 0) { zuordnung[f.feld] = index; vergeben.add(index); }
  }
  return zuordnung;
}

// ── Werte übersetzen ─────────────────────────────────────────────
const enthaelt = (text, ...muster) => muster.some((m) => text.includes(m));

function typVon(wert, standard) {
  const t = norm(wert);
  if (!t) return standard;
  if (enthaelt(t, 'zubeh', 'access', 'controller', 'peripher')) return 'zubehoer';
  if (enthaelt(t, 'konsole', 'console', 'hardware', 'system')) return 'konsole';
  if (enthaelt(t, 'spiel', 'game', 'software')) return 'spiel';
  return standard;
}

function regionVon(wert) {
  const t = norm(wert);
  if (!t) return null;
  const w = new Set(t.split(/[^a-z0-9äöü]+/).filter(Boolean));
  const hat = (...namen) => namen.some((n) => w.has(n));
  if (enthaelt(t, 'ntsc-j', 'ntsc j') || hat('jp', 'jpn', 'japan', 'j')) return 'ntsc_j';
  if (enthaelt(t, 'ntsc', 'north america', 'nordamerika') || hat('us', 'usa', 'na', 'canada', 'kanada')) return 'ntsc_u';
  if (enthaelt(t, 'pal-de', 'pal de') || hat('de', 'usk', 'deutschland', 'germany', 'deutsch', 'german', 'österreich', 'austria')) return 'pal_de';
  if (hat('pal', 'eu', 'europe', 'europa', 'uk', 'au', 'australia', 'australien')) return 'pal_eu';
  return null;
}

function vollstaendigkeitVon(wert) {
  const t = norm(wert);
  if (!t) return null;
  if (enthaelt(t, 'ohne anl', 'no manual', 'missing manual', 'fehlt anleitung', 'o. anl')) return 'fehlt_anleitung';
  if (enthaelt(t, 'nur ovp', 'box only', 'only box')) return 'nur_ovp';
  if (enthaelt(t, 'loose', 'lose', 'cart only', 'disc only', 'nur modul', 'nur disc', 'nur gerät', 'nur geraet')) return 'nur_geraet';
  if (enthaelt(t, 'cib', 'complete', 'komplett', 'new', 'neu', 'sealed')) return 'cib';
  return null;
}

function zustandVon(wert, vollstaendigkeitRoh) {
  const t = norm(wert);
  const v = norm(vollstaendigkeitRoh);
  if (enthaelt(t, 'sealed', 'versiegelt', 'neu/ovp', 'new') || enthaelt(v, 'sealed', 'new', 'neu')) return 'neu_ovp';
  if (!t) return null;
  if (enthaelt(t, 'near mint', 'wie neu', 'like new', 'mint')) return 'wie_neu';
  if (enthaelt(t, 'very good', 'sehr gut', 'excellent')) return 'sehr_gut';
  if (enthaelt(t, 'good', 'gut')) return 'gut';
  if (enthaelt(t, 'fair', 'acceptable', 'akzeptabel', 'used')) return 'akzeptabel';
  if (enthaelt(t, 'poor', 'defekt', 'broken', 'defective')) return 'defekt';
  return null;
}

/** „01.05.2023“, „2023-05-01“, „2023/05/01“ → „2023-05-01“; andere Formate werden ignoriert. */
function datumVon(wert) {
  const t = String(wert ?? '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function betragVon(wert) {
  const t = String(wert ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return null;
  // „1,234.56“ (englisch) → „1234.56“; „1.234,56“ (deutsch) bleibt für leseEuro
  if (/,\d{3}\./.test(t) || (/\.\d{1,2}$/.test(t) && t.includes(','))) return t.replace(/,/g, '');
  return t;
}

/** Wandelt eine CSV-Zeile anhand der Zuordnung in Artikeldaten um (noch ohne Prüfung). */
export function zeileZuArtikel(zeile, zuordnung, { standardTyp = 'spiel' } = {}) {
  const w = (feld) => (zuordnung[feld] === undefined || zuordnung[feld] === null ? '' : String(zeile[zuordnung[feld]] ?? '').trim());
  const anzahl = Number.parseInt(w('anzahl'), 10);
  return {
    titel: w('titel'),
    plattform: w('plattform') || null,
    typ: typVon(w('typ'), standardTyp),
    region: regionVon(w('region')),
    zustand: zustandVon(w('zustand'), w('vollstaendigkeit')),
    vollstaendigkeit: vollstaendigkeitVon(w('vollstaendigkeit')),
    edition: w('edition') || null,
    farbe: w('farbe') || null,
    modellnummer: w('modellnummer') || null,
    seriennummer: w('seriennummer') || null,
    barcode: w('barcode').replace(/\D/g, '') || null,
    anzahl: Number.isInteger(anzahl) && anzahl > 0 ? Math.min(anzahl, 9999) : 1,
    kaufpreis: betragVon(w('kaufpreis')),
    kaufdatum: datumVon(w('kaufdatum')),
    marktwert: betragVon(w('marktwert')),
    notizen: w('notizen') || null,
  };
}
