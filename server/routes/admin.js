import { Router } from 'express';
import { KontoFehler } from '../services/konten.js';

export function adminRouter({ db, konten, dateien }) {
  const router = Router();
  const anzahlAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'admin' AND gesperrt = 0").get().n;
  const ziel = (req) => {
    const b = konten.holeBenutzer(Number(req.params.id));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    return b;
  };

  router.get('/benutzer', (_req, res) => {
    res.json(db.prepare(`
      SELECT b.id, b.benutzername, b.anzeigename, b.rolle, b.gesperrt, b.totp_aktiv, b.sammlung_oeffentlich,
             b.erstellt_am, b.letzte_anmeldung, COUNT(a.id) AS eintraege
      FROM benutzer b LEFT JOIN artikel a ON a.benutzer_id = b.id
      GROUP BY b.id ORDER BY b.erstellt_am`).all());
  });

  router.put('/benutzer/:id', (req, res) => {
    const b = ziel(req);
    const { rolle, gesperrt } = req.body ?? {};
    const verliertAdmin = b.rolle === 'admin' && !b.gesperrt && ((rolle && rolle !== 'admin') || gesperrt);
    if (verliertAdmin && anzahlAdmins() <= 1) throw new KontoFehler('Es muss mindestens ein aktiver Administrator bleiben.', 409);
    if (rolle !== undefined) {
      if (!['admin', 'nutzer'].includes(rolle)) throw new KontoFehler('Ungültige Rolle.');
      db.prepare('UPDATE benutzer SET rolle = ? WHERE id = ?').run(rolle, b.id);
    }
    if (gesperrt !== undefined) {
      db.prepare('UPDATE benutzer SET gesperrt = ? WHERE id = ?').run(gesperrt ? 1 : 0, b.id);
      if (gesperrt) konten.beendeAlleSitzungen(b.id);
    }
    res.json({ ok: true });
  });

  router.post('/benutzer/:id/2fa-zuruecksetzen', (req, res) => {
    const b = ziel(req);
    konten.deaktiviereTotp(b.id);
    konten.beendeAlleSitzungen(b.id);
    res.json({ ok: true });
  });

  router.post('/benutzer/:id/passwort', async (req, res) => {
    const b = ziel(req);
    await konten.aenderePasswort(b.id, req.body?.neuesPasswort);
    konten.beendeAlleSitzungen(b.id);
    res.json({ ok: true });
  });

  router.delete('/benutzer/:id', (req, res) => {
    const b = ziel(req);
    if (b.id === req.benutzer.id) throw new KontoFehler('Das eigene Konto bitte unter „Konto“ löschen.', 409);
    if (b.rolle === 'admin' && anzahlAdmins() <= 1) throw new KontoFehler('Der letzte Administrator kann nicht gelöscht werden.', 409);
    dateien.loescheBenutzerdaten(b.id);
    res.status(204).end();
  });

  return router;
}
