// Rechtliche Seiten (Impressum, Datenschutz, Nutzungsbedingungen, Sicherheit) –
// für alle ohne Anmeldung lesbar, von Administratoren bearbeitbar.
import { Router } from 'express';
import { ValidierungsFehler } from '../services/validierung.js';

export function seitenRouter({ db }) {
  const router = Router();
  router.get('/seiten', (_req, res) => {
    res.json(db.prepare("SELECT slug, titel, aktualisiert_am FROM seiten WHERE inhalt != '' ORDER BY rowid").all());
  });
  router.get('/seiten/:slug', (req, res) => {
    const seite = db.prepare('SELECT slug, titel, inhalt, aktualisiert_am FROM seiten WHERE slug = ?').get(req.params.slug);
    if (!seite) return res.status(404).json({ fehler: 'Seite nicht gefunden.' });
    res.json(seite);
  });
  return router;
}

export function seitenAdminRouter({ db }) {
  const router = Router();
  router.put('/seiten/:slug', (req, res) => {
    const titel = String(req.body?.titel ?? '').trim().slice(0, 100);
    const inhalt = String(req.body?.inhalt ?? '');
    if (!titel) throw new ValidierungsFehler({ titel: 'Bitte einen Titel angeben.' });
    if (inhalt.length > 100_000) throw new ValidierungsFehler({ inhalt: 'Der Text ist zu lang (max. 100.000 Zeichen).' });
    if (!/^[a-z0-9-]{2,40}$/.test(req.params.slug)) throw new ValidierungsFehler({ slug: 'Ungültige Seitenadresse.' });
    const seite = db.prepare(`INSERT INTO seiten (slug, titel, inhalt, aktualisiert_von) VALUES (@slug, @titel, @inhalt, @von)
      ON CONFLICT (slug) DO UPDATE SET titel = excluded.titel, inhalt = excluded.inhalt,
        aktualisiert_von = excluded.aktualisiert_von, aktualisiert_am = datetime('now')
      RETURNING slug, titel, inhalt, aktualisiert_am`).get({ slug: req.params.slug, titel, inhalt, von: req.benutzer.id });
    res.json(seite);
  });
  return router;
}
