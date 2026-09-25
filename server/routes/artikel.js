import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { pruefeArtikel, ValidierungsFehler } from '../services/validierung.js';

const SORTIERUNGEN = {
  neueste: 'a.erstellt_am DESC, a.id DESC',
  titel: 'a.titel COLLATE NOCASE ASC',
  plattform: 'a.plattform COLLATE NOCASE ASC, a.titel COLLATE NOCASE ASC',
  preis: 'a.kaufpreis IS NULL, a.kaufpreis DESC',
  kaufdatum: 'a.kaufdatum IS NULL, a.kaufdatum DESC',
  marktwert: 'a.marktwert IS NULL, a.marktwert DESC',
};

const ERLAUBTE_BILDTYPEN = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const FELDER = [
  'typ', 'titel', 'plattform', 'katalog_id', 'barcode', 'cover_url', 'zustand', 'vollstaendigkeit', 'region',
  'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl', 'marktwert',
];

export function artikelZuObjekt(zeile) {
  if (!zeile) return null;
  return {
    ...zeile,
    bild_url: zeile.bild_datei ? `/api/dateien/${zeile.bild_datei}` : zeile.cover_url || zeile.katalog_cover_url || null,
  };
}

export function artikelRouter({ db, katalog, konfiguration, dateien }) {
  const router = Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: dateien.verzeichnis,
      filename: (_req, datei, cb) => cb(null, `${crypto.randomUUID()}${ERLAUBTE_BILDTYPEN[datei.mimetype]}`),
    }),
    limits: { fileSize: konfiguration.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, datei, cb) => cb(null, Boolean(ERLAUBTE_BILDTYPEN[datei.mimetype])),
  });

  const basisAbfrage = `
    SELECT a.*, k.cover_url AS katalog_cover_url, k.erscheinungsjahr, k.quelle AS katalog_quelle
    FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id`;
  const perId = db.prepare(`${basisAbfrage} WHERE a.id = ? AND a.benutzer_id = ?`);
  const einfuegen = db.prepare(
    `INSERT INTO artikel (benutzer_id, ${FELDER.join(', ')}) VALUES (@benutzer_id, ${FELDER.map((f) => `@${f}`).join(', ')}) RETURNING id`,
  );
  const loeschen = db.prepare('DELETE FROM artikel WHERE id = ?');
  const bildEntfernen = (datei) => dateien.loesche(datei);

  function holeOder404(req, res) {
    const artikel = perId.get(Number(req.params.id), req.benutzer.id);
    if (!artikel) res.status(404).json({ fehler: 'Artikel nicht gefunden.' });
    return artikel;
  }

  // Katalogeinträge sind gemeinsam genutzt – existieren müssen sie trotzdem.
  function pruefeKatalog(katalogId) {
    if (katalogId && !katalog.holeEintrag(katalogId)) {
      throw new ValidierungsFehler({ katalog_id: 'Der verknüpfte Katalogeintrag existiert nicht.' });
    }
  }

  router.get('/', (req, res) => {
    const bedingungen = ['a.benutzer_id = @benutzer_id'];
    const parameter = { benutzer_id: req.benutzer.id };
    const { typ, q, plattform, region, zustand, vollstaendigkeit } = req.query;
    for (const [feld, wert] of Object.entries({ typ, plattform, region, zustand, vollstaendigkeit })) {
      if (typeof wert === 'string' && wert) {
        bedingungen.push(`a.${feld} = @${feld}`);
        parameter[feld] = wert;
      }
    }
    if (typeof q === 'string' && q.trim()) {
      parameter.q = `%${q.trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
      bedingungen.push(`(${['titel', 'plattform', 'edition', 'farbe', 'modellnummer', 'seriennummer', 'notizen', 'barcode']
        .map((f) => `a.${f} LIKE @q ESCAPE '\\'`).join(' OR ')})`);
    }
    const sortierung = SORTIERUNGEN[req.query.sortierung] ?? SORTIERUNGEN.neueste;
    const where = `WHERE ${bedingungen.join(' AND ')}`;
    const zeilen = db.prepare(`${basisAbfrage} ${where} ORDER BY ${sortierung}`).all(parameter);
    res.json(zeilen.map(artikelZuObjekt));
  });

  router.get('/plattformen', (req, res) => {
    const zeilen = db.prepare(
      `SELECT plattform, COUNT(*) AS anzahl FROM artikel WHERE plattform IS NOT NULL AND benutzer_id = ?
       GROUP BY plattform ORDER BY plattform COLLATE NOCASE`,
    ).all(req.benutzer.id);
    res.json(zeilen);
  });

  router.get('/:id', (req, res) => {
    const artikel = holeOder404(req, res);
    if (artikel) res.json(artikelZuObjekt(artikel));
  });

  router.post('/', (req, res) => {
    const daten = pruefeArtikel(req.body);
    pruefeKatalog(daten.katalog_id);
    const id = db.transaction(() => {
      const { id: neueId } = einfuegen.get({ ...daten, benutzer_id: req.benutzer.id });
      if (daten.barcode && daten.katalog_id) katalog.verknuepfeBarcode(daten.barcode, daten.katalog_id);
      return neueId;
    })();
    res.status(201).json(artikelZuObjekt(perId.get(id, req.benutzer.id)));
  });

  router.put('/:id', (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) return;
    const daten = pruefeArtikel(req.body, true);
    if (daten.katalog_id) pruefeKatalog(daten.katalog_id);
    const felder = Object.keys(daten);
    if (felder.length) {
      db.transaction(() => {
        db.prepare(
          `UPDATE artikel SET ${felder.map((f) => `${f} = @${f}`).join(', ')}, aktualisiert_am = datetime('now') WHERE id = @id`,
        ).run({ ...daten, id: vorhanden.id });
        const barcode = daten.barcode ?? vorhanden.barcode;
        const katalogId = daten.katalog_id ?? vorhanden.katalog_id;
        if (barcode && katalogId) katalog.verknuepfeBarcode(barcode, katalogId);
      })();
    }
    res.json(artikelZuObjekt(perId.get(vorhanden.id, req.benutzer.id)));
  });

  router.delete('/:id', (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) return;
    loeschen.run(vorhanden.id);
    bildEntfernen(vorhanden.bild_datei);
    res.status(204).end();
  });

  router.post('/:id/bild', upload.single('bild'), (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) {
      if (req.file) bildEntfernen(req.file.filename);
      return;
    }
    if (!req.file) {
      return res.status(400).json({ fehler: 'Bitte ein Bild im Format JPG, PNG, WebP oder GIF hochladen.' });
    }
    db.prepare("UPDATE artikel SET bild_datei = ?, aktualisiert_am = datetime('now') WHERE id = ?")
      .run(req.file.filename, vorhanden.id);
    bildEntfernen(vorhanden.bild_datei);
    res.json(artikelZuObjekt(perId.get(vorhanden.id, req.benutzer.id)));
  });

  router.delete('/:id/bild', (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) return;
    db.prepare("UPDATE artikel SET bild_datei = NULL, aktualisiert_am = datetime('now') WHERE id = ?").run(vorhanden.id);
    bildEntfernen(vorhanden.bild_datei);
    res.json(artikelZuObjekt(perId.get(vorhanden.id, req.benutzer.id)));
  });

  return router;
}
