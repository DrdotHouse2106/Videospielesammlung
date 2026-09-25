import { Router } from 'express';
import { istModerator } from '../../shared/konstanten.js';
import { katalogZeileZuObjekt, fuerBenutzer } from '../services/katalog.js';
import {
  pruefeKatalogEintrag, pruefeVariante, pruefePreismeldung, pruefeKommentar, ValidierungsFehler,
} from '../services/validierung.js';
import { normalisiereBarcode } from '../services/titel.js';

const nichtGefunden = (res, was = 'Katalogeintrag') => res.status(404).json({ fehler: `${was} nicht gefunden.` });

export function katalogRouter({ db, katalog, dateien, ki }) {
  const router = Router();

  // Eigene, noch nicht freigegebene Einträge darf der Ersteller ändern; Moderatoren alle Einträge.
  const darfAendern = (req, eintrag) => istModerator(req.benutzer)
    || (eintrag.quelle === 'eigen' && eintrag.erstellt_von === req.benutzer.id && eintrag.status !== 'freigegeben');

  function sichtbarOder404(req, res) {
    const eintrag = katalog.holeSichtbar(req.params.id, req.benutzer);
    if (!eintrag) nichtGefunden(res);
    return eintrag;
  }

  // Kombinierte Suche: lokaler Katalog (freigegeben + eigene) + IGDB.
  router.get('/suche', async (req, res) => {
    const typ = ['spiel', 'konsole', 'zubehoer'].includes(req.query.typ) ? req.query.typ : null;
    const ergebnis = await katalog.suche(String(req.query.q ?? ''), typ, req.benutzer);
    const f = (e) => fuerBenutzer(e, req.benutzer);
    res.json({ ...ergebnis, lokal: ergebnis.lokal.map(f), online: ergebnis.online.map(f) });
  });

  router.get('/barcode/:code', async (req, res) => {
    const code = normalisiereBarcode(req.params.code);
    if (!code) return res.status(400).json({ fehler: 'Ungültiger Barcode. Erwartet wird eine EAN-8, UPC-A, EAN-13 oder GTIN-14.' });
    const ergebnis = await katalog.sucheBarcode(code, req.benutzer);
    res.json({ ...ergebnis, treffer: ergebnis.treffer.map((e) => fuerBenutzer(e, req.benutzer)) });
  });

  // Eigene Einträge (privat, eingereicht, abgelehnt, freigegeben)
  router.get('/eigene', (req, res) => {
    const zeilen = db.prepare("SELECT * FROM katalog WHERE quelle = 'eigen' AND erstellt_von = ? ORDER BY titel COLLATE NOCASE").all(req.benutzer.id);
    res.json(zeilen.map(katalogZeileZuObjekt));
  });

  router.get('/:id', (req, res) => {
    const eintrag = sichtbarOder404(req, res);
    if (eintrag) res.json(fuerBenutzer(eintrag, req.benutzer));
  });

  router.post('/', (req, res) => {
    const daten = pruefeKatalogEintrag(req.body);
    const eintrag = katalog.legeEigenenAn(daten, req.benutzer, {
      einreichen: Boolean(req.body?.einreichen), veroeffentlichen: Boolean(req.body?.veroeffentlichen),
    });
    if (eintrag.status === 'eingereicht') ki.anstossen();
    res.status(201).json(eintrag);
  });

  router.put('/:id', (req, res) => {
    const vorhanden = sichtbarOder404(req, res);
    if (!vorhanden) return;
    if (!darfAendern(req, vorhanden)) return res.status(403).json({ fehler: 'Freigegebene Einträge kann nur das Moderationsteam ändern.' });
    const daten = pruefeKatalogEintrag({ ...vorhanden, ...req.body });
    res.json(katalog.aktualisiere(vorhanden.id, daten, { plattformenNeu: Array.isArray(req.body?.plattformen) }));
  });

  router.delete('/:id', (req, res) => {
    const vorhanden = sichtbarOder404(req, res);
    if (!vorhanden) return;
    if (!darfAendern(req, vorhanden) || vorhanden.quelle !== 'eigen') {
      return res.status(403).json({ fehler: 'Diesen Eintrag kann nur das Moderationsteam löschen.' });
    }
    const medien = db.prepare('SELECT datei, anzeige_datei, vorschau_datei FROM medien WHERE katalog_id = ?').all(vorhanden.id);
    db.prepare('DELETE FROM katalog WHERE id = ?').run(vorhanden.id);
    dateien.loesche(medien.flatMap((m) => [m.datei, m.anzeige_datei, m.vorschau_datei]));
    res.status(204).end();
  });

  // ── Einreichen zur Aufnahme in die globale Datenbank ─────────
  router.post('/:id/einreichen', (req, res) => {
    const e = katalog.holeEintrag(Number(req.params.id));
    if (!e || e.erstellt_von !== req.benutzer.id) return nichtGefunden(res);
    if (!['privat', 'abgelehnt'].includes(e.status)) return res.status(409).json({ fehler: 'Dieser Eintrag ist bereits eingereicht oder freigegeben.' });
    db.prepare(`UPDATE katalog SET status = 'eingereicht', eingereicht_am = datetime('now'), pruefung_notiz = NULL,
      automatisch_geprueft = 0, ki_hinweis = NULL WHERE id = ?`).run(e.id);
    ki.anstossen();
    res.json(katalog.holeEintrag(e.id));
  });

  // Nach einer automatischen (KI-)Entscheidung: Prüfung durch einen Menschen verlangen
  router.post('/:id/menschliche-pruefung', (req, res) => {
    const e = katalog.holeEintrag(Number(req.params.id));
    if (!e || e.erstellt_von !== req.benutzer.id) return nichtGefunden(res);
    if (!e.automatisch_geprueft || e.status !== 'abgelehnt') {
      return res.status(409).json({ fehler: 'Nur automatisch abgelehnte Einträge können zur menschlichen Prüfung gegeben werden.' });
    }
    db.prepare(`UPDATE katalog SET status = 'eingereicht', eingereicht_am = datetime('now'), menschliche_pruefung = 1,
      automatisch_geprueft = 0, ki_hinweis = ? WHERE id = ?`).run(`Einreicher widerspricht der KI-Ablehnung: ${e.pruefung_notiz ?? ''}`.slice(0, 1500), e.id);
    res.json(katalog.holeEintrag(e.id));
  });

  router.post('/:id/zurueckziehen', (req, res) => {
    const e = katalog.holeEintrag(Number(req.params.id));
    if (!e || e.erstellt_von !== req.benutzer.id) return nichtGefunden(res);
    if (e.status !== 'eingereicht') return res.status(409).json({ fehler: 'Nur eingereichte Einträge können zurückgezogen werden.' });
    db.prepare("UPDATE katalog SET status = 'privat' WHERE id = ?").run(e.id);
    res.json(katalog.holeEintrag(e.id));
  });

  // ── Varianten / Revisionen ──────────────────────────────────
  const variantenSichtbar = db.prepare(`
    SELECT v.*, (SELECT COUNT(*) FROM artikel a WHERE a.variante_id = v.id AND a.benutzer_id = @benutzer) AS meine
    FROM katalog_varianten v
    WHERE v.katalog_id = @katalog AND (v.status = 'freigegeben' OR v.erstellt_von = @benutzer OR @moderator = 1)
    ORDER BY v.erscheinungsjahr IS NULL, v.erscheinungsjahr, v.bezeichnung COLLATE NOCASE`);

  router.get('/:id/varianten', (req, res) => {
    const e = sichtbarOder404(req, res);
    if (!e) return;
    res.json(variantenSichtbar.all({ katalog: e.id, benutzer: req.benutzer.id, moderator: istModerator(req.benutzer) ? 1 : 0 })
      .map((v) => fuerBenutzer(v, req.benutzer)));
  });

  router.post('/:id/varianten', (req, res) => {
    const e = sichtbarOder404(req, res);
    if (!e) return;
    const daten = pruefeVariante(req.body);
    let status = 'privat';
    if (istModerator(req.benutzer) && req.body?.veroeffentlichen) status = 'freigegeben';
    else if (req.body?.einreichen) status = 'eingereicht';
    const v = db.prepare(`
      INSERT INTO katalog_varianten (katalog_id, bezeichnung, modellnummer, farbe, edition, region, erscheinungsjahr, beschreibung, status, erstellt_von, eingereicht_am)
      VALUES (@katalog_id, @bezeichnung, @modellnummer, @farbe, @edition, @region, @erscheinungsjahr, @beschreibung, @status, @erstellt_von,
              CASE WHEN @status = 'eingereicht' THEN datetime('now') END)
      RETURNING *`).get({ ...daten, katalog_id: e.id, status, erstellt_von: req.benutzer.id });
    if (status === 'eingereicht') ki.anstossen();
    res.status(201).json(v);
  });

  // ── Private Kommentare ──────────────────────────────────────
  router.get('/:id/kommentare', (req, res) => {
    const e = sichtbarOder404(req, res);
    if (!e) return;
    res.json(db.prepare('SELECT * FROM kommentare WHERE katalog_id = ? AND benutzer_id = ? ORDER BY erstellt_am DESC, id DESC')
      .all(e.id, req.benutzer.id));
  });

  router.post('/:id/kommentare', (req, res) => {
    const e = sichtbarOder404(req, res);
    if (!e) return;
    const text = pruefeKommentar(req.body);
    res.status(201).json(db.prepare('INSERT INTO kommentare (benutzer_id, katalog_id, text) VALUES (?, ?, ?) RETURNING *')
      .get(req.benutzer.id, e.id, text));
  });

  // ── Preis-Historie ──────────────────────────────────────────
  router.post('/:id/historie', (req, res) => {
    const e = sichtbarOder404(req, res);
    if (!e) return;
    if (e.status !== 'freigegeben') throw new ValidierungsFehler({ preis: 'Preise können nur für freigegebene Katalogeinträge gemeldet werden.' });
    const d = pruefePreismeldung(req.body);
    const zeile = db.prepare(`
      INSERT INTO preis_historie (katalog_id, herkunft, art, preis, datum, quelle, zustand, vollstaendigkeit, region, url, notiz, benutzer_id)
      VALUES (@katalog_id, 'meldung', @art, @preis, @datum, @quelle, @zustand, @vollstaendigkeit, @region, @url, @notiz, @benutzer_id)
      RETURNING *`).get({ ...d, katalog_id: e.id, benutzer_id: req.benutzer.id });
    res.status(201).json({ ...zeile, eigene: true });
  });

  return router;
}

/** Varianten, Kommentare und Preis-Meldungen einzeln bearbeiten/löschen. */
export function katalogUnterRouter({ db, ki }) {
  const router = Router();

  router.put('/varianten/:id', (req, res) => {
    const v = db.prepare('SELECT * FROM katalog_varianten WHERE id = ?').get(Number(req.params.id));
    const darf = v && (istModerator(req.benutzer) || (v.erstellt_von === req.benutzer.id && v.status !== 'freigegeben'));
    if (!darf) return nichtGefunden(res, 'Variante');
    const daten = pruefeVariante({ ...v, ...req.body });
    let status = v.status;
    const neuEingereicht = req.body?.einreichen && ['privat', 'abgelehnt'].includes(v.status);
    if (neuEingereicht) status = 'eingereicht';
    const ergebnis = db.prepare(`UPDATE katalog_varianten SET bezeichnung = @bezeichnung, modellnummer = @modellnummer, farbe = @farbe,
      edition = @edition, region = @region, erscheinungsjahr = @erscheinungsjahr, beschreibung = @beschreibung, status = @status,
      eingereicht_am = CASE WHEN @neu = 1 THEN datetime('now') ELSE eingereicht_am END,
      automatisch_geprueft = CASE WHEN @neu = 1 THEN 0 ELSE automatisch_geprueft END
      WHERE id = @id RETURNING *`).get({ ...daten, status, id: v.id, neu: neuEingereicht ? 1 : 0 });
    if (neuEingereicht) ki.anstossen();
    res.json(ergebnis);
  });

  router.post('/varianten/:id/menschliche-pruefung', (req, res) => {
    const v = db.prepare('SELECT * FROM katalog_varianten WHERE id = ? AND erstellt_von = ?').get(Number(req.params.id), req.benutzer.id);
    if (!v) return nichtGefunden(res, 'Variante');
    if (!v.automatisch_geprueft || v.status !== 'abgelehnt') {
      return res.status(409).json({ fehler: 'Nur automatisch abgelehnte Varianten können zur menschlichen Prüfung gegeben werden.' });
    }
    res.json(db.prepare(`UPDATE katalog_varianten SET status = 'eingereicht', eingereicht_am = datetime('now'), menschliche_pruefung = 1,
      automatisch_geprueft = 0, ki_hinweis = ? WHERE id = ? RETURNING *`).get(`Einreicher widerspricht der KI-Ablehnung: ${v.pruefung_notiz ?? ''}`.slice(0, 1500), v.id));
  });

  router.delete('/varianten/:id', (req, res) => {
    const v = db.prepare('SELECT * FROM katalog_varianten WHERE id = ?').get(Number(req.params.id));
    const darf = v && (istModerator(req.benutzer) || (v.erstellt_von === req.benutzer.id && v.status !== 'freigegeben'));
    if (!darf) return nichtGefunden(res, 'Variante');
    db.prepare('DELETE FROM katalog_varianten WHERE id = ?').run(v.id);
    res.status(204).end();
  });

  router.put('/kommentare/:id', (req, res) => {
    const text = pruefeKommentar(req.body);
    const k = db.prepare(`UPDATE kommentare SET text = ?, aktualisiert_am = datetime('now') WHERE id = ? AND benutzer_id = ? RETURNING *`)
      .get(text, Number(req.params.id), req.benutzer.id);
    if (!k) return nichtGefunden(res, 'Kommentar');
    res.json(k);
  });

  router.delete('/kommentare/:id', (req, res) => {
    const r = db.prepare('DELETE FROM kommentare WHERE id = ? AND benutzer_id = ?').run(Number(req.params.id), req.benutzer.id);
    if (!r.changes) return nichtGefunden(res, 'Kommentar');
    res.status(204).end();
  });

  router.delete('/historie/:id', (req, res) => {
    const h = db.prepare("SELECT * FROM preis_historie WHERE id = ? AND herkunft = 'meldung'").get(Number(req.params.id));
    if (!h || (h.benutzer_id !== req.benutzer.id && !istModerator(req.benutzer))) return nichtGefunden(res, 'Preis-Meldung');
    db.prepare('DELETE FROM preis_historie WHERE id = ?').run(h.id);
    res.status(204).end();
  });

  return router;
}
