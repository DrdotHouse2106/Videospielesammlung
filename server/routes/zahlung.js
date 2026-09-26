// Zahlungen: Buchen und Kündigen für Händler, Webhooks der Zahlungsanbieter, Übersicht für Administratoren.
import express, { Router } from 'express';
import { KontoFehler } from '../services/konten.js';
import { erstelleDrossel } from '../services/drossel.js';

/** Webhooks brauchen den unveränderten Text der Anfrage (Signaturprüfung) – daher vor express.json() einbinden. */
export function zahlungWebhookRouter({ zahlung }) {
  const router = Router();
  const roh = express.raw({ type: '*/*', limit: '1mb' });
  // Jede PayPal-Meldung wird über die PayPal-API geprüft – Begrenzung je IP gegen Missbrauch
  const drossel = erstelleDrossel({ maxVersuche: 300, fensterMs: 60 * 1000 });
  const begrenzt = (req, res) => {
    if (drossel.gesperrt(req.ip)) { res.status(429).json({ fehler: 'Zu viele Anfragen.' }); return true; }
    drossel.fehlschlag(req.ip);
    return false;
  };
  router.post('/api/zahlung/stripe/webhook', roh, async (req, res) => {
    if (begrenzt(req, res)) return;
    res.json(await zahlung.stripeWebhook(req.body.toString('utf8'), req.headers['stripe-signature']));
  });
  router.post('/api/zahlung/paypal/webhook', roh, async (req, res) => {
    if (begrenzt(req, res)) return;
    res.json(await zahlung.paypalWebhook(req.headers, req.body.toString('utf8')));
  });
  return router;
}

export function zahlungRouter({ db, zahlung, erpnext }) {
  const router = Router();
  router.get('/boerse/zahlung', (req, res) => res.json(zahlung.uebersicht(req.benutzer.id)));
  router.post('/boerse/zahlung/checkout', async (req, res) => res.json(await zahlung.checkout(req.benutzer, req.body ?? {})));
  router.post('/boerse/zahlung/paypal/bestaetigen', async (req, res) => res.json(await zahlung.paypalBestaetigen(req.benutzer, req.body?.subscription_id)));
  router.post('/boerse/zahlung/abos/:id/kuendigen', async (req, res) => res.json(await zahlung.kuendige(req.benutzer, req.params.id)));
  router.post('/boerse/zahlung/portal', async (req, res) => res.json(await zahlung.portal(req.benutzer)));

  // Rechnung als PDF (nur eigene)
  router.get('/boerse/zahlung/rechnung/:id.pdf', async (req, res) => {
    const z = db.prepare('SELECT erpnext_rechnung FROM zahlungen WHERE id = ? AND benutzer_id = ?').get(Number(req.params.id), req.benutzer.id);
    if (!z?.erpnext_rechnung) throw new KontoFehler('Rechnung nicht gefunden oder noch nicht erstellt.', 404);
    const pdf = await erpnext.pdf(z.erpnext_rechnung);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Rechnung-${z.erpnext_rechnung.replace(/[^\w.-]/g, '_')}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  });
  return router;
}

/** Administration: alle Zahlungen, Rechnungen erneut übertragen, ERPNext testen. */
export function zahlungAdminRouter({ db, erpnext }) {
  const router = Router();
  router.get('/zahlungen', (_req, res) => {
    res.json(db.prepare(`SELECT z.*, COALESCE(b.anzeigename, b.benutzername) AS haendler FROM zahlungen z
      LEFT JOIN benutzer b ON b.id = z.benutzer_id ORDER BY z.id DESC LIMIT 300`).all());
  });
  router.get('/abos', (_req, res) => {
    res.json(db.prepare(`SELECT a.*, COALESCE(b.anzeigename, b.benutzername) AS haendler FROM abos a
      LEFT JOIN benutzer b ON b.id = a.benutzer_id WHERE a.status != 'offen' ORDER BY a.id DESC LIMIT 300`).all());
  });
  router.post('/zahlungen/:id/erpnext', async (req, res) => {
    db.prepare('UPDATE zahlungen SET versuche = 0 WHERE id = ?').run(Number(req.params.id));
    const name = await erpnext.rechnungFuer(Number(req.params.id));
    const z = db.prepare('SELECT erpnext_rechnung, erpnext_fehler FROM zahlungen WHERE id = ?').get(Number(req.params.id));
    if (!name) return res.status(502).json({ fehler: z?.erpnext_fehler ?? 'ERPNext ist nicht eingerichtet.' });
    res.json(z);
  });
  router.post('/erpnext/test', async (_req, res) => {
    try { res.json(await erpnext.teste()); } catch (e) { res.status(502).json({ fehler: e.message }); }
  });
  return router;
}
