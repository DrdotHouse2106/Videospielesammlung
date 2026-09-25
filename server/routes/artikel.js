import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { pruefeArtikel, ValidierungsFehler } from '../services/validierung.js';

const SORTIERUNGEN = {
  neueste: 'a.erstellt_am DESC, a.id DESC',
  titel: 'a.titel COLLATE NOCASE ASC',
  plattform: 'p.hersteller, p.erscheinungsjahr, a.plattform COLLATE NOCASE ASC, a.titel COLLATE NOCASE ASC',
  preis: 'a.kaufpreis IS NULL, a.kaufpreis DESC',
  kaufdatum: 'a.kaufdatum IS NULL, a.kaufdatum DESC',
  marktwert: 'a.marktwert IS NULL, a.marktwert DESC',
};

const ERLAUBTE_BILDTYPEN = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const FELDER = [
  'typ', 'titel', 'plattform', 'katalog_id', 'barcode', 'cover_url', 'zustand', 'vollstaendigkeit', 'region',
  'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl', 'marktwert',
  'plattform_id', 'variante_id',
];

export function artikelZuObjekt(zeile) {
  if (!zeile) return null;
  return {
    ...zeile,
    bild_url: zeile.bild_datei ? `/api/dateien/${zeile.bild_datei}` : zeile.cover_url || zeile.katalog_cover_url || null,
  };
}

export function artikelRouter({ db, katalog, konfiguration, dateien, plattformen, ki, speicher }) {
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
    SELECT a.*, k.cover_url AS katalog_cover_url, k.erscheinungsjahr, k.quelle AS katalog_quelle, k.status AS katalog_status,
           p.kurz AS plattform_kurz, p.hersteller AS plattform_hersteller, v.bezeichnung AS variante_bezeichnung
    FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id LEFT JOIN plattformen p ON p.id = a.plattform_id
    LEFT JOIN katalog_varianten v ON v.id = a.variante_id`;
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

  // Katalogeintrag muss für den Benutzer sichtbar sein (freigegeben oder eigener).
  function pruefeKatalog(katalogId, req) {
    if (katalogId && !katalog.holeSichtbar(katalogId, req.benutzer)) {
      throw new ValidierungsFehler({ katalog_id: 'Der verknüpfte Katalogeintrag existiert nicht.' });
    }
  }

  // Plattform: feste Auswahl (plattform_id) oder Freitext, der den Stammdaten zugeordnet wird.
  function loesePlattform(daten) {
    if (daten.plattform_id) {
      const p = plattformen.hole(daten.plattform_id);
      if (!p) throw new ValidierungsFehler({ plattform_id: 'Unbekannte Plattform.' });
      daten.plattform = p.name;
    } else if (daten.plattform) {
      const p = plattformen.zuordnen(daten.plattform);
      if (p) Object.assign(daten, { plattform_id: p.id, plattform: p.name });
      else daten.plattform_id = null;
    } else if ('plattform_id' in daten || 'plattform' in daten) {
      Object.assign(daten, { plattform_id: null, plattform: null });
    }
  }

  // Variante muss zum Katalogeintrag gehören und sichtbar sein.
  function pruefeVariante(varianteId, katalogId, req) {
    if (!varianteId) return;
    const v = db.prepare('SELECT * FROM katalog_varianten WHERE id = ?').get(varianteId);
    const sichtbar = v && (v.status === 'freigegeben' || v.erstellt_von === req.benutzer.id);
    if (!sichtbar || v.katalog_id !== katalogId) throw new ValidierungsFehler({ variante_id: 'Diese Variante passt nicht zum Katalogeintrag.' });
  }

  router.get('/', (req, res) => {
    const bedingungen = ['a.benutzer_id = @benutzer_id'];
    const parameter = { benutzer_id: req.benutzer.id };
    const { typ, q, plattform, region, zustand, vollstaendigkeit } = req.query;
    const plattformId = Number(req.query.plattform_id);
    if (Number.isInteger(plattformId) && plattformId > 0) {
      bedingungen.push('a.plattform_id = @plattform_id');
      parameter.plattform_id = plattformId;
    }
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

  // Plattformen in der eigenen Sammlung (für Filter-Chips)
  router.get('/plattformen', (req, res) => {
    const zeilen = db.prepare(`
      SELECT a.plattform_id AS id, COALESCE(p.name, a.plattform) AS plattform, p.kurz, p.hersteller, COUNT(*) AS anzahl
      FROM artikel a LEFT JOIN plattformen p ON p.id = a.plattform_id
      WHERE a.benutzer_id = ? AND (a.plattform IS NOT NULL OR a.plattform_id IS NOT NULL)
      GROUP BY COALESCE(a.plattform_id, a.plattform) ORDER BY p.hersteller, p.erscheinungsjahr, plattform COLLATE NOCASE`).all(req.benutzer.id);
    res.json(zeilen);
  });

  router.get('/:id', (req, res) => {
    const artikel = holeOder404(req, res);
    if (artikel) res.json(artikelZuObjekt(artikel));
  });

  router.post('/', (req, res) => {
    const daten = pruefeArtikel(req.body);
    pruefeKatalog(daten.katalog_id, req);
    loesePlattform(daten);
    pruefeVariante(daten.variante_id, daten.katalog_id, req);
    const id = db.transaction(() => {
      // Ohne Katalogeintrag: eigenen (privaten) anlegen – optional gleich zur Prüfung einreichen
      if (!daten.katalog_id) {
        daten.katalog_id = katalog.legeEigenenAn({
          typ: daten.typ, titel: daten.titel, plattformen: daten.plattform ? [daten.plattform] : [],
          cover_url: daten.cover_url?.startsWith('http') ? daten.cover_url : null,
        }, req.benutzer, { einreichen: Boolean(req.body?.katalog_einreichen), veroeffentlichen: Boolean(req.body?.katalog_veroeffentlichen) }).id;
      }
      const { id: neueId } = einfuegen.get({ ...daten, benutzer_id: req.benutzer.id });
      if (daten.barcode) katalog.verknuepfeBarcode(daten.barcode, daten.katalog_id, req.benutzer.id);
      return neueId;
    })();
    if (req.body?.katalog_einreichen) ki.anstossen();
    res.status(201).json(artikelZuObjekt(perId.get(id, req.benutzer.id)));
  });

  router.put('/:id', (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) return;
    const daten = pruefeArtikel(req.body, true);
    if (daten.katalog_id) pruefeKatalog(daten.katalog_id, req);
    loesePlattform(daten);
    if (daten.variante_id) pruefeVariante(daten.variante_id, daten.katalog_id ?? vorhanden.katalog_id, req);
    const felder = Object.keys(daten);
    if (felder.length) {
      db.transaction(() => {
        db.prepare(
          `UPDATE artikel SET ${felder.map((f) => `${f} = @${f}`).join(', ')}, aktualisiert_am = datetime('now') WHERE id = @id`,
        ).run({ ...daten, id: vorhanden.id });
        const barcode = daten.barcode ?? vorhanden.barcode;
        const katalogId = daten.katalog_id ?? vorhanden.katalog_id;
        if (barcode && katalogId) katalog.verknuepfeBarcode(barcode, katalogId, req.benutzer.id);
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
    try {
      // Das bisherige Foto wird ersetzt und zählt daher nicht mit
      speicher.pruefe(req.benutzer.id, req.file.size, { abzueglich: vorhanden.bild_datei ? vorhanden.bild_groesse ?? 0 : 0 });
    } catch (fehler) {
      bildEntfernen(req.file.filename);
      throw fehler;
    }
    db.prepare("UPDATE artikel SET bild_datei = ?, bild_groesse = ?, aktualisiert_am = datetime('now') WHERE id = ?")
      .run(req.file.filename, req.file.size, vorhanden.id);
    bildEntfernen(vorhanden.bild_datei);
    res.json(artikelZuObjekt(perId.get(vorhanden.id, req.benutzer.id)));
  });

  router.delete('/:id/bild', (req, res) => {
    const vorhanden = holeOder404(req, res);
    if (!vorhanden) return;
    db.prepare("UPDATE artikel SET bild_datei = NULL, bild_groesse = NULL, aktualisiert_am = datetime('now') WHERE id = ?").run(vorhanden.id);
    bildEntfernen(vorhanden.bild_datei);
    res.json(artikelZuObjekt(perId.get(vorhanden.id, req.benutzer.id)));
  });

  return router;
}
