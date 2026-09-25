import { Router } from 'express';

export function statistikRouter({ db }) {
  const router = Router();

  router.get('/', (_req, res) => {
    const gesamt = db.prepare(
      `SELECT COUNT(*) AS eintraege, COALESCE(SUM(anzahl), 0) AS stueck,
              COALESCE(SUM(kaufpreis * anzahl), 0) AS kaufwert
       FROM artikel`,
    ).get();
    const gruppiert = (feld) => db.prepare(
      `SELECT ${feld} AS wert, COALESCE(SUM(anzahl), 0) AS stueck, COALESCE(SUM(kaufpreis * anzahl), 0) AS kaufwert
       FROM artikel GROUP BY ${feld} ORDER BY stueck DESC`,
    ).all();
    const zuletzt = db.prepare(
      'SELECT id, titel, typ, plattform, erstellt_am FROM artikel ORDER BY erstellt_am DESC, id DESC LIMIT 5',
    ).all();
    res.json({
      gesamt,
      nachTyp: gruppiert('typ'),
      nachPlattform: gruppiert('plattform').slice(0, 15),
      nachRegion: gruppiert('region'),
      nachZustand: gruppiert('zustand'),
      nachVollstaendigkeit: gruppiert('vollstaendigkeit'),
      zuletzt,
    });
  });

  return router;
}
