import { Router } from 'express';

export function benachrichtigungenRouter({ benachrichtigungen, erfolge, push, schnaeppchen }) {
  const router = Router();

  // ── Web-Push (aufs Handy) ────────────────────────────────────
  router.get('/push/schluessel', (_req, res) => res.json({ schluessel: push.oeffentlicherSchluessel() }));
  router.get('/push/geraete', (req, res) => res.json(push.geraete(req.benutzer.id).map(({ endpoint, ...g }) => ({ ...g, endpunkt_ende: endpoint.slice(-12) }))));
  router.post('/push', (req, res) => {
    try {
      push.abonniere(req.benutzer.id, req.body?.abo, req.body?.geraet);
    } catch (e) {
      return res.status(400).json({ fehler: e.message });
    }
    res.status(201).json({ ok: true });
  });
  router.delete('/push', (req, res) => res.json({ entfernt: push.kuendige(req.benutzer.id, req.body?.endpoint) }));
  router.post('/push/test', async (req, res) => {
    const n = await push.sende(req.benutzer.id, { titel: 'Push funktioniert 🎮', text: 'So sehen Benachrichtigungen von ZockDB auf diesem Gerät aus.', link: '#/benachrichtigungen' });
    res.json({ gesendet: n });
  });

  // ── Schnäppchen-Alarm ────────────────────────────────────────
  router.get('/schnaeppchen', (req, res) => res.json(schnaeppchen.einstellungen(req.benutzer.id)));
  router.put('/schnaeppchen', (req, res) => res.json(schnaeppchen.speichere(req.benutzer.id, req.body ?? {})));

  // Erfolge und Sammlungsziele des angemeldeten Benutzers
  router.get('/erfolge', (req, res) => res.json(erfolge.liste(req.benutzer.id)));

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
