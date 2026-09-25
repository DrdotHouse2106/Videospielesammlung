import { Router } from 'express';
import { katalogZeileZuObjekt } from '../services/katalog.js';
import { pruefeKatalogEintrag } from '../services/validierung.js';
import { normalisiereBarcode } from '../services/titel.js';

export function katalogRouter({ db, katalog }) {
  const router = Router();

  // Kombinierte Suche: lokaler Katalog (inkl. eigener Einträge) + IGDB.
  router.get('/suche', async (req, res) => {
    const typ = ['spiel', 'konsole', 'zubehoer'].includes(req.query.typ) ? req.query.typ : null;
    res.json(await katalog.suche(String(req.query.q ?? ''), typ));
  });

  router.get('/barcode/:code', async (req, res) => {
    const code = normalisiereBarcode(req.params.code);
    if (!code) return res.status(400).json({ fehler: 'Ungültiger Barcode. Erwartet wird eine EAN-8, UPC-A, EAN-13 oder GTIN-14.' });
    res.json(await katalog.sucheBarcode(code));
  });

  // Eigene Einträge auflisten (z. B. seltene Hardware, deutsche Exoten).
  router.get('/eigene', (_req, res) => {
    const zeilen = db.prepare("SELECT * FROM katalog WHERE quelle = 'eigen' ORDER BY titel COLLATE NOCASE").all();
    res.json(zeilen.map(katalogZeileZuObjekt));
  });

  router.get('/:id', (req, res) => {
    const eintrag = katalog.holeEintrag(Number(req.params.id));
    if (!eintrag) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    res.json(eintrag);
  });

  router.post('/', (req, res) => {
    const daten = pruefeKatalogEintrag(req.body);
    const eintrag = katalog.speichere({ ...daten, quelle: 'eigen', externe_id: crypto.randomUUID() });
    res.status(201).json(eintrag);
  });

  router.put('/:id', (req, res) => {
    const vorhanden = katalog.holeEintrag(Number(req.params.id));
    if (!vorhanden) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    if (vorhanden.quelle !== 'eigen') return res.status(403).json({ fehler: 'Nur eigene Katalogeinträge können bearbeitet werden.' });
    const daten = pruefeKatalogEintrag({ ...vorhanden, ...req.body });
    res.json(katalog.speichere({ ...daten, quelle: 'eigen', externe_id: vorhanden.externe_id }));
  });

  router.delete('/:id', (req, res) => {
    const vorhanden = katalog.holeEintrag(Number(req.params.id));
    if (!vorhanden) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    if (vorhanden.quelle !== 'eigen') return res.status(403).json({ fehler: 'Nur eigene Katalogeinträge können gelöscht werden.' });
    db.prepare('DELETE FROM katalog WHERE id = ?').run(vorhanden.id);
    res.status(204).end();
  });

  return router;
}
