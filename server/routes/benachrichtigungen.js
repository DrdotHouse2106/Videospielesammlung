import { Router } from 'express';

export function benachrichtigungenRouter({ benachrichtigungen }) {
  const router = Router();

  router.get('/benachrichtigungen', (req, res) => {
    res.json({ ungelesen: benachrichtigungen.ungelesen(req.benutzer.id), eintraege: benachrichtigungen.liste(req.benutzer.id) });
  });

  // Leichtgewichtig für die Glocke (wird regelmäßig abgefragt)
  router.get('/benachrichtigungen/anzahl', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ungelesen: benachrichtigungen.ungelesen(req.benutzer.id) });
  });

  router.post('/benachrichtigungen/gelesen', (req, res) => {
    const id = Number(req.body?.id) || null;
    benachrichtigungen.markiereGelesen(req.benutzer.id, id);
    res.json({ ungelesen: benachrichtigungen.ungelesen(req.benutzer.id) });
  });

  router.delete('/benachrichtigungen/:id', (req, res) => {
    benachrichtigungen.loesche(req.benutzer.id, Number(req.params.id));
    res.status(204).end();
  });

  return router;
}
