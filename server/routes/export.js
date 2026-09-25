import crypto from 'node:crypto';
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
  ['marktwert', 'Marktwert (EUR)', (w) => (w == null ? '' : w.toFixed(2).replace('.', ','))],
  ['notizen', 'Eigene Notizen'],
  ['erstellt_am', 'Erfasst am'],
];

function csvFeld(wert) {
  const text = wert == null ? '' : String(wert);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportRouter({ db, plattformen }) {
  const router = Router();
  const datumHeute = () => new Date().toISOString().slice(0, 10);

  router.get('/export.json', (req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel WHERE benutzer_id = ? ORDER BY id').all(req.benutzer.id)
      .map(({ benutzer_id: _b, bild_datei: _d, ...rest }) => rest);
    const eigeneKatalogeintraege = db.prepare(`SELECT * FROM katalog WHERE quelle = 'eigen'
      AND id IN (SELECT katalog_id FROM artikel WHERE benutzer_id = @b UNION SELECT id FROM katalog WHERE erstellt_von = @b)
      ORDER BY id`).all({ b: req.benutzer.id }).map(({ erstellt_von: _e, ...rest }) => rest);
    res.attachment(`videospielesammlung-${datumHeute()}.json`);
    res.json({ format: 'videospielesammlung', version: 1, exportiert_am: new Date().toISOString(), artikel, eigeneKatalogeintraege });
  });

  // CSV im deutschen Excel-Format: Semikolon als Trenner, Dezimalkomma, UTF-8 mit BOM.
  router.get('/export.csv', (req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel WHERE benutzer_id = ? ORDER BY titel COLLATE NOCASE').all(req.benutzer.id);
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
      INSERT INTO katalog (quelle, externe_id, typ, titel, plattformen, erscheinungsjahr, hersteller, cover_url, beschreibung, erstellt_von, status)
      VALUES ('eigen', @externe_id, @typ, @titel, @plattformen, @erscheinungsjahr, @hersteller, @cover_url, @beschreibung, @erstellt_von, 'privat')
      RETURNING id`);
    const eigenerMitExternerId = db.prepare("SELECT id, erstellt_von FROM katalog WHERE quelle = 'eigen' AND externe_id = ?");
    // Nur freigegebene oder eigene Katalogeinträge dürfen verknüpft werden
    const katalogVorhanden = db.prepare("SELECT id FROM katalog WHERE id = ? AND (status = 'freigegeben' OR erstellt_von = ?)");
    const felder = ['benutzer_id', 'typ', 'titel', 'plattform', 'katalog_id', 'barcode', 'cover_url', 'zustand', 'vollstaendigkeit', 'region',
      'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl', 'marktwert', 'plattform_id'];
    const einfuegen = db.prepare(`INSERT INTO artikel (${felder.join(', ')}) VALUES (${felder.map((f) => `@${f}`).join(', ')})`);

    const fehlerhaft = [];
    let importiert = 0;
    db.transaction(() => {
      for (const eintrag of daten?.eigeneKatalogeintraege ?? []) {
        if (!eintrag?.titel || !eintrag?.externe_id) continue;
        const vorhanden = eigenerMitExternerId.get(String(eintrag.externe_id));
        if (vorhanden?.erstellt_von === req.benutzer.id) {
          katalogIds.set(eintrag.id, vorhanden.id);
          continue;
        }
        const { id } = katalogEinfuegen.get({
          externe_id: vorhanden ? crypto.randomUUID() : String(eintrag.externe_id), typ: eintrag.typ ?? 'spiel', titel: String(eintrag.titel),
          plattformen: typeof eintrag.plattformen === 'string' ? eintrag.plattformen : JSON.stringify(eintrag.plattformen ?? []),
          erscheinungsjahr: eintrag.erscheinungsjahr ?? null, hersteller: eintrag.hersteller ?? null,
          cover_url: eintrag.cover_url ?? null, beschreibung: eintrag.beschreibung ?? null, erstellt_von: req.benutzer.id,
        });
        katalogIds.set(eintrag.id, id);
      }
      liste.forEach((roh, index) => {
        try {
          const artikel = pruefeArtikel({ ...roh, katalog_id: null });
          const alteKatalogId = roh?.katalog_id;
          artikel.katalog_id = katalogIds.get(alteKatalogId) ?? (katalogVorhanden.get(alteKatalogId ?? -1, req.benutzer.id)?.id ?? null);
          if (artikel.cover_url?.startsWith('/')) artikel.cover_url = null; // Fotos werden nicht mit exportiert
          const plattform = plattformen.zuordnen(artikel.plattform);
          einfuegen.run({ ...artikel, benutzer_id: req.benutzer.id, plattform_id: plattform?.id ?? null, plattform: plattform?.name ?? artikel.plattform });
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
