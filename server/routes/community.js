import { Router } from 'express';
import { artikelZuObjekt } from './artikel.js';

// Private Angaben werden bei fremden Sammlungen nie ausgeliefert.
const PRIVATE_FELDER = ['kaufpreis', 'kaufdatum', 'seriennummer', 'notizen', 'barcode', 'marktwert'];

function oeffentlich(zeile) {
  const artikel = artikelZuObjekt(zeile);
  for (const feld of PRIVATE_FELDER) delete artikel[feld];
  return artikel;
}

export function communityRouter({ db }) {
  const router = Router();
  const sammler = db.prepare(`
    SELECT b.id, b.benutzername, COALESCE(b.anzeigename, b.benutzername) AS anzeigename, b.erstellt_am,
           COUNT(a.id) AS eintraege, COALESCE(SUM(a.anzahl), 0) AS stueck,
           SUM(a.typ = 'spiel') AS spiele, SUM(a.typ = 'konsole') AS konsolen, SUM(a.typ = 'zubehoer') AS zubehoer
    FROM benutzer b LEFT JOIN artikel a ON a.benutzer_id = b.id
    WHERE b.sammlung_oeffentlich = 1 AND b.gesperrt = 0
    GROUP BY b.id ORDER BY stueck DESC, b.benutzername COLLATE NOCASE`);
  const perName = db.prepare(`SELECT id, benutzername, COALESCE(anzeigename, benutzername) AS anzeigename
                              FROM benutzer WHERE benutzername = ? AND sammlung_oeffentlich = 1 AND gesperrt = 0`);
  const basis = `SELECT a.*, k.cover_url AS katalog_cover_url, k.erscheinungsjahr, k.quelle AS katalog_quelle
                 FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id`;

  router.get('/community', (_req, res) => res.json(sammler.all()));

  function sammlerOder404(req, res) {
    const b = perName.get(req.params.name);
    if (!b) res.status(404).json({ fehler: 'Diese Sammlung gibt es nicht oder sie ist nicht öffentlich.' });
    return b;
  }

  router.get('/community/:name', (req, res) => {
    const b = sammlerOder404(req, res);
    if (!b) return;
    const bedingungen = ['a.benutzer_id = @id'];
    const parameter = { id: b.id };
    if (['spiel', 'konsole', 'zubehoer'].includes(req.query.typ)) {
      bedingungen.push('a.typ = @typ');
      parameter.typ = req.query.typ;
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      bedingungen.push("(a.titel LIKE @q ESCAPE '\\' OR a.plattform LIKE @q ESCAPE '\\')");
      parameter.q = `%${req.query.q.trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    }
    const artikel = db.prepare(`${basis} WHERE ${bedingungen.join(' AND ')} ORDER BY a.titel COLLATE NOCASE`).all(parameter);
    res.json({ sammler: b, artikel: artikel.map(oeffentlich) });
  });

  router.get('/community/:name/artikel/:id', (req, res) => {
    const b = sammlerOder404(req, res);
    if (!b) return;
    const zeile = db.prepare(`${basis} WHERE a.id = ? AND a.benutzer_id = ?`).get(Number(req.params.id), b.id);
    if (!zeile) return res.status(404).json({ fehler: 'Artikel nicht gefunden.' });
    res.json({ sammler: b, artikel: oeffentlich(zeile) });
  });

  return router;
}
