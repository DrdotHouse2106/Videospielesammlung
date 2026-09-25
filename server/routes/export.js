import { Router } from 'express';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, beschriftung,
} from '../../shared/konstanten.js';
import { pruefeArtikel, ValidierungsFehler } from '../services/validierung.js';

const CSV_SPALTEN = [
  ['id', 'ID'],
  ['typ', 'Artikeltyp', (w) => beschriftung(ARTIKELTYPEN, w)],
  ['titel', 'Titel'],
  ['plattform', 'Plattform'],
  ['region', 'Region', (w) => beschriftung(REGIONEN, w)],
  ['zustand', 'Zustand', (w) => beschriftung(ZUSTAENDE, w)],
  ['vollstaendigkeit', 'Vollständigkeit', (w) => beschriftung(VOLLSTAENDIGKEITEN, w)],
  ['farbe', 'Farbe'],
  ['edition', 'Edition/Variante'],
  ['modellnummer', 'Modellnummer'],
  ['seriennummer', 'Seriennummer'],
  ['barcode', 'Barcode'],
  ['anzahl', 'Anzahl'],
  ['kaufpreis', 'Kaufpreis (EUR)', (w) => (w == null ? '' : w.toFixed(2).replace('.', ','))],
  ['kaufdatum', 'Kaufdatum', (w) => (w ? w.split('-').reverse().join('.') : '')],
  ['notizen', 'Eigene Notizen'],
  ['erstellt_am', 'Erfasst am'],
];

function csvFeld(wert) {
  const text = wert == null ? '' : String(wert);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportRouter({ db }) {
  const router = Router();
  const datumHeute = () => new Date().toISOString().slice(0, 10);

  router.get('/export.json', (_req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel ORDER BY id').all();
    const eigeneKatalogeintraege = db.prepare("SELECT * FROM katalog WHERE quelle = 'eigen' ORDER BY id").all();
    res.attachment(`videospielesammlung-${datumHeute()}.json`);
    res.json({ format: 'videospielesammlung', version: 1, exportiert_am: new Date().toISOString(), artikel, eigeneKatalogeintraege });
  });

  // CSV im deutschen Excel-Format: Semikolon als Trenner, Dezimalkomma, UTF-8 mit BOM.
  router.get('/export.csv', (_req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel ORDER BY titel COLLATE NOCASE').all();
    const zeilen = [
      CSV_SPALTEN.map(([, kopf]) => csvFeld(kopf)).join(';'),
      ...artikel.map((a) => CSV_SPALTEN.map(([feld, , format]) => csvFeld(format ? format(a[feld]) : a[feld])).join(';')),
    ];
    res.attachment(`videospielesammlung-${datumHeute()}.csv`);
    res.type('text/csv; charset=utf-8').send(`﻿${zeilen.join('\r\n')}\r\n`);
  });

  // Import einer zuvor exportierten JSON-Datei. Artikel werden ergänzt, nicht ersetzt.
  router.post('/import', (req, res) => {
    const daten = req.body;
    const liste = Array.isArray(daten) ? daten : daten?.artikel;
    if (!Array.isArray(liste)) return res.status(400).json({ fehler: 'Unbekanntes Dateiformat. Bitte eine Export-Datei dieser App verwenden.' });

    const katalogIds = new Map();
    const katalogEinfuegen = db.prepare(`
      INSERT INTO katalog (quelle, externe_id, typ, titel, plattformen, erscheinungsjahr, hersteller, cover_url, beschreibung)
      VALUES ('eigen', @externe_id, @typ, @titel, @plattformen, @erscheinungsjahr, @hersteller, @cover_url, @beschreibung)
      ON CONFLICT (quelle, externe_id) DO UPDATE SET titel = excluded.titel
      RETURNING id`);
    const katalogVorhanden = db.prepare('SELECT id FROM katalog WHERE id = ?');
    const felder = ['typ', 'titel', 'plattform', 'katalog_id', 'barcode', 'cover_url', 'zustand', 'vollstaendigkeit', 'region',
      'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl'];
    const einfuegen = db.prepare(`INSERT INTO artikel (${felder.join(', ')}) VALUES (${felder.map((f) => `@${f}`).join(', ')})`);

    const fehlerhaft = [];
    let importiert = 0;
    db.transaction(() => {
      for (const eintrag of daten?.eigeneKatalogeintraege ?? []) {
        if (!eintrag?.titel || !eintrag?.externe_id) continue;
        const { id } = katalogEinfuegen.get({
          externe_id: String(eintrag.externe_id), typ: eintrag.typ ?? 'spiel', titel: String(eintrag.titel),
          plattformen: typeof eintrag.plattformen === 'string' ? eintrag.plattformen : JSON.stringify(eintrag.plattformen ?? []),
          erscheinungsjahr: eintrag.erscheinungsjahr ?? null, hersteller: eintrag.hersteller ?? null,
          cover_url: eintrag.cover_url ?? null, beschreibung: eintrag.beschreibung ?? null,
        });
        katalogIds.set(eintrag.id, id);
      }
      liste.forEach((roh, index) => {
        try {
          const artikel = pruefeArtikel({ ...roh, katalog_id: null });
          const alteKatalogId = roh?.katalog_id;
          artikel.katalog_id = katalogIds.get(alteKatalogId) ?? (katalogVorhanden.get(alteKatalogId ?? -1)?.id ?? null);
          einfuegen.run(artikel);
          importiert++;
        } catch (fehler) {
          if (!(fehler instanceof ValidierungsFehler)) throw fehler;
          fehlerhaft.push({ zeile: index + 1, titel: roh?.titel ?? null, fehler: fehler.fehler });
        }
      });
    })();
    res.json({ importiert, fehlerhaft });
  });

  return router;
}
