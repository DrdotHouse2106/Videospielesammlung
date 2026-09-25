import { Router } from 'express';
import multer from 'multer';
import { MEDIENARTEN, istModerator } from '../../shared/konstanten.js';
import { MEDIEN_TYPEN, verarbeiteMedium, neuerDateiname } from '../services/medien.js';
import { ValidierungsFehler } from '../services/validierung.js';

const ARTEN = MEDIENARTEN.map((a) => a.value);

export function medienZuObjekt(m, benutzer) {
  const url = (datei) => (datei ? `/api/dateien/${datei}` : null);
  return {
    id: m.id,
    katalog_id: m.katalog_id,
    art: m.art,
    titel: m.titel,
    sichtbarkeit: m.sichtbarkeit,
    mime: m.mime,
    groesse: m.groesse,
    breite: m.breite,
    hoehe: m.hoehe,
    dpi: m.dpi,
    seiten: m.seiten,
    originalname: m.originalname,
    erstellt_am: m.erstellt_am,
    hochgeladen_von: m.hochgeladen_von ?? null,
    geprueft_am: m.geprueft_am ?? null,
    pruefung_notiz: m.benutzer_id === benutzer.id || istModerator(benutzer) ? m.pruefung_notiz ?? null : null,
    eigenes: m.benutzer_id === benutzer.id,
    darf_bearbeiten: m.benutzer_id === benutzer.id || istModerator(benutzer),
    url: url(m.anzeige_datei ?? m.datei),
    original_url: url(m.datei),
    vorschau_url: url(m.vorschau_datei),
  };
}

function pruefeMetadaten(eingabe, { teilweise = false, teilenErlaubt, moderator = false, bisher = null }) {
  const fehler = {};
  const daten = {};
  const hat = (f) => Object.hasOwn(eingabe, f);
  if (!teilweise || hat('art')) {
    if (!ARTEN.includes(eingabe.art)) fehler.art = 'Bitte die Art des Scans wählen.';
    else daten.art = eingabe.art;
  }
  if (!teilweise || hat('sichtbarkeit')) {
    // Nutzer: privat oder zur Freigabe einreichen · Moderatoren dürfen direkt freigeben
    let s = eingabe.sichtbarkeit || 'privat';
    if (s === 'geteilt') s = 'eingereicht';
    const erlaubt = moderator ? ['privat', 'eingereicht', 'freigegeben'] : ['privat', 'eingereicht'];
    if (bisher === 'freigegeben' && s === 'eingereicht') s = 'freigegeben'; // bleibt freigegeben
    else if (!erlaubt.includes(s)) fehler.sichtbarkeit = 'Ungültige Auswahl.';
    if (s !== 'privat' && !teilenErlaubt) fehler.sichtbarkeit = 'Das Teilen von Scans ist auf diesem Server deaktiviert.';
    if (!fehler.sichtbarkeit) daten.sichtbarkeit = s;
  }
  if (hat('titel')) daten.titel = String(eingabe.titel ?? '').trim().slice(0, 200) || null;
  if (hat('dpi')) {
    const roh = String(eingabe.dpi ?? '').trim();
    if (!roh) daten.dpi = null;
    else {
      const dpi = Number(roh);
      if (!Number.isFinite(dpi) || dpi < 50 || dpi > 4800) fehler.dpi = 'Bitte eine Auflösung zwischen 50 und 4800 dpi angeben.';
      else daten.dpi = Math.round(dpi);
    }
  }
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return daten;
}

export function medienRouter({ db, konfiguration, dateien, katalog }) {
  const router = Router();
  const teilenErlaubt = konfiguration.medienTeilenErlaubt;
  const upload = multer({
    storage: multer.diskStorage({
      destination: dateien.verzeichnis,
      filename: (_req, datei, cb) => cb(null, neuerDateiname(datei.mimetype)),
    }),
    limits: { fileSize: konfiguration.maxMedienMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, datei, cb) => cb(null, Boolean(MEDIEN_TYPEN[datei.mimetype])),
  });

  const sichtbareMedien = db.prepare(`
    SELECT m.*, COALESCE(b.anzeigename, b.benutzername) AS hochgeladen_von
    FROM medien m LEFT JOIN benutzer b ON b.id = m.benutzer_id
    WHERE m.katalog_id = @katalog
      AND (m.benutzer_id = @benutzer OR m.sichtbarkeit = 'freigegeben' OR (@moderator = 1 AND m.sichtbarkeit = 'eingereicht'))
    ORDER BY CASE m.art WHEN 'cover_vorne' THEN 0 WHEN 'cover_hinten' THEN 1 WHEN 'cover_komplett' THEN 2
             WHEN 'handbuch' THEN 3 WHEN 'label' THEN 4 ELSE 5 END, m.erstellt_am`);
  const perId = db.prepare(`
    SELECT m.*, COALESCE(b.anzeigename, b.benutzername) AS hochgeladen_von
    FROM medien m LEFT JOIN benutzer b ON b.id = m.benutzer_id WHERE m.id = ?`);
  const eigenerArtikel = db.prepare('SELECT * FROM artikel WHERE id = ? AND benutzer_id = ?');

  function sichtbar(req, id) {
    const m = perId.get(Number(id));
    const darf = m && (m.benutzer_id === req.benutzer.id || m.sichtbarkeit === 'freigegeben'
      || (istModerator(req.benutzer) && m.sichtbarkeit === 'eingereicht'));
    return darf ? m : null;
  }

  router.get('/katalog/:id/medien', (req, res) => {
    if (!katalog.holeSichtbar(req.params.id, req.benutzer)) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    res.json(sichtbareMedien.all({ katalog: Number(req.params.id), benutzer: req.benutzer.id, moderator: istModerator(req.benutzer) ? 1 : 0 })
      .map((m) => medienZuObjekt(m, req.benutzer)));
  });

  router.post('/artikel/:id/medien', upload.single('datei'), async (req, res) => {
    const artikel = eigenerArtikel.get(Number(req.params.id), req.benutzer.id);
    if (!artikel || !req.file) {
      if (req.file) dateien.loesche(req.file.filename);
      return artikel
        ? res.status(400).json({ fehler: 'Bitte eine Datei im Format JPG, PNG, WebP, TIFF oder PDF hochladen.' })
        : res.status(404).json({ fehler: 'Artikel nicht gefunden.' });
    }
    let verarbeitet;
    try {
      const meta = pruefeMetadaten(req.body ?? {}, { teilenErlaubt, moderator: istModerator(req.benutzer) });
      verarbeitet = await verarbeiteMedium({ verzeichnis: dateien.verzeichnis, datei: req.file.filename, mime: req.file.mimetype });
      const katalogId = katalog.stelleSicherFuerArtikel(artikel, req.benutzer);
      const { id } = db.prepare(`
        INSERT INTO medien (katalog_id, benutzer_id, art, titel, sichtbarkeit, datei, anzeige_datei, vorschau_datei,
                            originalname, mime, groesse, breite, hoehe, dpi, seiten)
        VALUES (@katalog_id, @benutzer_id, @art, @titel, @sichtbarkeit, @datei, @anzeige_datei, @vorschau_datei,
                @originalname, @mime, @groesse, @breite, @hoehe, @dpi, @seiten) RETURNING id`).get({
        ...verarbeitet,
        ...meta,
        titel: meta.titel ?? null,
        dpi: meta.dpi ?? verarbeitet.dpi,
        katalog_id: katalogId,
        benutzer_id: req.benutzer.id,
        originalname: Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 200),
      });
      res.status(201).json(medienZuObjekt(perId.get(id), req.benutzer));
    } catch (fehler) {
      dateien.loesche(req.file.filename, verarbeitet?.anzeige_datei, verarbeitet?.vorschau_datei);
      if (fehler instanceof ValidierungsFehler) throw fehler;
      console.warn('[medien] Verarbeitung fehlgeschlagen:', fehler.message);
      res.status(400).json({ fehler: 'Die Datei konnte nicht verarbeitet werden. Ist sie beschädigt oder zu groß?' });
    }
  });

  router.get('/medien/:id', (req, res) => {
    const m = sichtbar(req, req.params.id);
    if (!m) return res.status(404).json({ fehler: 'Scan nicht gefunden.' });
    res.json(medienZuObjekt(m, req.benutzer));
  });

  router.put('/medien/:id', (req, res) => {
    const m = perId.get(Number(req.params.id));
    if (!m || (m.benutzer_id !== req.benutzer.id && !istModerator(req.benutzer))) {
      return res.status(404).json({ fehler: 'Scan nicht gefunden.' });
    }
    const daten = pruefeMetadaten(req.body ?? {}, {
      teilweise: true, teilenErlaubt, moderator: istModerator(req.benutzer), bisher: m.sichtbarkeit,
    });
    const felder = Object.keys(daten);
    if (felder.length) db.prepare(`UPDATE medien SET ${felder.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`).run({ ...daten, id: m.id });
    res.json(medienZuObjekt(perId.get(m.id), req.benutzer));
  });

  router.delete('/medien/:id', (req, res) => {
    const m = perId.get(Number(req.params.id));
    if (!m || (m.benutzer_id !== req.benutzer.id && !istModerator(req.benutzer))) {
      return res.status(404).json({ fehler: 'Scan nicht gefunden.' });
    }
    db.prepare('DELETE FROM medien WHERE id = ?').run(m.id);
    dateien.loesche(m.datei, m.anzeige_datei, m.vorschau_datei);
    res.status(204).end();
  });

  // Auslieferung aller hochgeladenen Dateien mit Berechtigungsprüfung.
  router.get('/dateien/:datei', (req, res) => {
    const zugriff = dateien.zugriff(req.benutzer, req.params.datei);
    if (!zugriff) return res.status(404).json({ fehler: 'Datei nicht gefunden.' });
    res.set('Cache-Control', 'private, max-age=2592000, immutable');
    if (req.query.download && zugriff.medium) {
      const endung = MEDIEN_TYPEN[zugriff.medium.mime] ?? '';
      const name = zugriff.medium.originalname || `scan${endung}`;
      return res.download(zugriff.pfad, name);
    }
    res.sendFile(zugriff.pfad, (fehler) => {
      if (fehler && !res.headersSent) res.status(404).json({ fehler: 'Datei nicht gefunden.' });
    });
  });

  return router;
}
