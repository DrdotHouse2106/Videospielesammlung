// CSV-Import (CLZ Games, Tabellen, eigener CSV-Export): erst analysieren, dann mit (angepasster) Spaltenzuordnung importieren.
import { Router } from 'express';
import { leseCsv, erkenneZuordnung, zeileZuArtikel, IMPORT_FELDER } from '../services/csvimport.js';
import { pruefeArtikel, ValidierungsFehler } from '../services/validierung.js';

const MAX_ZEILEN = 5000;

export function importCsvRouter({ db, plattformen, erfolge }) {
  const router = Router();
  const felder = ['benutzer_id', 'typ', 'titel', 'plattform', 'plattform_id', 'katalog_id', 'barcode', 'zustand', 'vollstaendigkeit', 'region',
    'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl', 'marktwert'];
  const einfuegen = db.prepare(`INSERT INTO artikel (${felder.join(', ')}) VALUES (${felder.map((f) => `@${f}`).join(', ')})`);
  // Abgleich mit dem öffentlichen Katalog: gleicher Titel, möglichst gleiche Plattform – nur bei eindeutigem Treffer
  const katalogTreffer = db.prepare(`SELECT k.id FROM katalog k
    WHERE k.status = 'freigegeben' AND k.titel = @titel COLLATE NOCASE AND k.typ = @typ
      AND (@plattform IS NULL OR EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = k.id AND kp.plattform_id = @plattform))
    LIMIT 2`);

  function lies(req) {
    const text = String(req.body?.text ?? '');
    if (!text.trim()) throw new ValidierungsFehler({ datei: 'Die Datei ist leer.' });
    const csv = leseCsv(text);
    if (!csv.kopf.length || !csv.zeilen.length) throw new ValidierungsFehler({ datei: 'Keine Datenzeilen gefunden. Die erste Zeile muss die Spaltenüberschriften enthalten.' });
    if (csv.zeilen.length > MAX_ZEILEN) throw new ValidierungsFehler({ datei: `Maximal ${MAX_ZEILEN.toLocaleString('de-DE')} Zeilen pro Import. Bitte die Datei aufteilen.` });
    return csv;
  }

  function vorbereiten(artikel) {
    const p = plattformen.zuordnen(artikel.plattform);
    return { ...artikel, plattform_id: p?.id ?? null, plattform: p?.name ?? artikel.plattform };
  }

  router.post('/import/csv/analyse', (req, res) => {
    const csv = lies(req);
    const zuordnung = erkenneZuordnung(csv.kopf);
    res.json({
      trennzeichen: csv.trennzeichen,
      kopf: csv.kopf,
      zeilen: csv.zeilen.length,
      felder: IMPORT_FELDER.map(({ feld, titel, pflicht }) => ({ feld, titel, pflicht: Boolean(pflicht) })),
      zuordnung,
      vorschau: csv.zeilen.slice(0, 8).map((z) => vorbereiten(zeileZuArtikel(z, zuordnung))),
    });
  });

  router.post('/import/csv', (req, res) => {
    const csv = lies(req);
    const zuordnung = {};
    for (const { feld } of IMPORT_FELDER) {
      const i = req.body?.zuordnung?.[feld];
      if (Number.isInteger(i) && i >= 0 && i < csv.kopf.length) zuordnung[feld] = i;
    }
    if (zuordnung.titel === undefined) throw new ValidierungsFehler({ zuordnung: 'Bitte die Spalte für den Titel auswählen.' });
    const standardTyp = ['spiel', 'konsole', 'zubehoer'].includes(req.body?.standardTyp) ? req.body.standardTyp : 'spiel';
    const abgleich = req.body?.katalogAbgleich !== false;

    let importiert = 0;
    let verknuepft = 0;
    const fehlerhaft = [];
    db.transaction(() => {
      csv.zeilen.forEach((zeile, index) => {
        try {
          const artikel = vorbereiten(pruefeArtikel(zeileZuArtikel(zeile, zuordnung, { standardTyp })));
          artikel.katalog_id = null;
          if (abgleich) {
            const treffer = katalogTreffer.all({ titel: artikel.titel, typ: artikel.typ, plattform: artikel.plattform_id });
            if (treffer.length === 1) { artikel.katalog_id = treffer[0].id; verknuepft++; }
          }
          einfuegen.run({ ...artikel, benutzer_id: req.benutzer.id });
          importiert++;
        } catch (fehler) {
          if (!(fehler instanceof ValidierungsFehler)) throw fehler;
          if (fehlerhaft.length < 200) fehlerhaft.push({ zeile: index + 2, titel: zeile[zuordnung.titel] ?? null, fehler: fehler.fehler });
        }
      });
    })();
    erfolge.pruefe(req.benutzer.id);
    res.json({ importiert, verknuepft, fehlerhaft, fehlerGesamt: csv.zeilen.length - importiert });
  });

  return router;
}
