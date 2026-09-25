import { Router } from 'express';
import {
  oeffentlichesProfil, KontoFehler, pruefeNeuesPasswort,
} from '../services/konten.js';
import { erstelleDrossel } from '../services/drossel.js';
import { setzeSitzungsCookie, loescheSitzungsCookie, erfordereAnmeldung } from '../middleware/auth.js';
import { ValidierungsFehler } from '../services/validierung.js';

const ZU_VIELE = 'Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es dann erneut.';

export function authRouter({ db, konten, konfiguration, dateien, speicher }) {
  const router = Router();
  const { cookieSicher, registrierungOffen, zweiFaktorPflicht } = konfiguration.konten;
  const drossel = erstelleDrossel({ maxVersuche: 10 });
  const registrierDrossel = erstelleDrossel({ maxVersuche: konfiguration.konten.registrierungenProStunde, fensterMs: 60 * 60 * 1000 });
  const geraet = (req) => req.headers['user-agent'];

  function anmeldenUndAntworten(req, res, benutzer, status = 200) {
    setzeSitzungsCookie(req, res, konten.erstelleSitzung(benutzer.id, { geraet: geraet(req) }), cookieSicher);
    res.status(status).json({ angemeldet: true, benutzer: oeffentlichesProfil(konten.holeBenutzer(benutzer.id)) });
  }

  router.get('/auth/status', (req, res) => {
    const ersteinrichtung = konten.istErsteinrichtung();
    res.json({
      angemeldet: Boolean(req.benutzer),
      benutzer: oeffentlichesProfil(req.benutzer),
      registrierungOffen: registrierungOffen || ersteinrichtung,
      ersteinrichtung,
      zweiFaktorPflicht,
      oeffentlicherKatalog: konfiguration.oeffentlicherKatalog,
    });
  });

  router.post('/auth/registrieren', async (req, res) => {
    if (!registrierungOffen && !konten.istErsteinrichtung()) {
      return res.status(403).json({ fehler: 'Die Registrierung ist auf diesem Server geschlossen.' });
    }
    if (registrierDrossel.gesperrt(req.ip)) return res.status(429).json({ fehler: 'Zu viele Registrierungen. Bitte später erneut versuchen.' });
    const benutzer = await konten.registriere(req.body ?? {});
    registrierDrossel.fehlschlag(req.ip); // zählt jede Registrierung
    anmeldenUndAntworten(req, res, benutzer, 201);
  });

  router.post('/auth/anmelden', async (req, res) => {
    const { benutzername, passwort } = req.body ?? {};
    const schluessel = `${req.ip}|${String(benutzername ?? '').toLowerCase()}`;
    if (drossel.gesperrt(schluessel) || drossel.gesperrt(req.ip)) return res.status(429).json({ fehler: ZU_VIELE });
    const benutzer = await konten.pruefeZugangsdaten(benutzername, passwort);
    if (!benutzer) {
      drossel.fehlschlag(schluessel);
      return res.status(401).json({ fehler: 'Benutzername oder Passwort ist falsch.' });
    }
    if (benutzer.gesperrt) return res.status(403).json({ fehler: 'Dieses Konto ist gesperrt. Bitte wende dich an den Administrator.' });
    drossel.zuruecksetzen(schluessel);
    if (benutzer.totp_aktiv) {
      const { token } = konten.erstelleSitzung(benutzer.id, { stufe: '2fa', geraet: geraet(req) });
      return res.json({ angemeldet: false, zweiFaktor: true, token });
    }
    anmeldenUndAntworten(req, res, benutzer);
  });

  router.post('/auth/2fa', (req, res) => {
    const { token, code, wiederherstellungscode } = req.body ?? {};
    const ergebnis = konten.leseSitzung(token, '2fa');
    if (!ergebnis) return res.status(401).json({ fehler: 'Die Anmeldung ist abgelaufen. Bitte erneut mit Passwort anmelden.', code: 'abgelaufen' });
    const schluessel = `2fa|${ergebnis.benutzer.id}`;
    if (drossel.gesperrt(schluessel)) return res.status(429).json({ fehler: ZU_VIELE });
    if (!konten.pruefeZweitenFaktor(ergebnis.benutzer, { code, wiederherstellungscode })) {
      drossel.fehlschlag(schluessel);
      return res.status(401).json({ fehler: wiederherstellungscode ? 'Dieser Wiederherstellungscode ist ungültig oder wurde schon benutzt.' : 'Der Code ist falsch oder abgelaufen.' });
    }
    drossel.zuruecksetzen(schluessel);
    konten.beendeSitzung(token);
    anmeldenUndAntworten(req, res, ergebnis.benutzer);
  });

  router.post('/auth/abmelden', (req, res) => {
    konten.beendeSitzung(req.sitzungsToken);
    loescheSitzungsCookie(req, res, cookieSicher);
    res.json({ angemeldet: false });
  });

  // ── Eigenes Konto ────────────────────────────────────────
  // Ohne 2FA-Pflicht-Prüfung, damit man die 2FA hier überhaupt einrichten kann.
  const angemeldet = erfordereAnmeldung({ zweiFaktorPflicht: false });

  async function bestaetigePasswort(req) {
    const benutzer = await konten.pruefeZugangsdaten(req.benutzer.benutzername, req.body?.passwort);
    if (!benutzer) throw new ValidierungsFehler({ passwort: 'Das Passwort ist falsch.' });
  }

  router.get('/konto', angemeldet, (req, res) => {
    res.json({
      ...oeffentlichesProfil(req.benutzer),
      wiederherstellungscodesUebrig: konten.anzahlWiederherstellungscodes(req.benutzer),
      speicher: speicher.info(req.benutzer.id),
    });
  });

  router.get('/konto/speicher', angemeldet, (req, res) => {
    res.json(speicher.info(req.benutzer.id));
  });

  router.put('/konto', angemeldet, (req, res) => {
    const { anzeigename, sammlung_oeffentlich: oeffentlich } = req.body ?? {};
    if (anzeigename !== undefined) {
      db.prepare('UPDATE benutzer SET anzeigename = ? WHERE id = ?').run(String(anzeigename).trim().slice(0, 60) || null, req.benutzer.id);
    }
    if (oeffentlich !== undefined) {
      db.prepare('UPDATE benutzer SET sammlung_oeffentlich = ? WHERE id = ?').run(oeffentlich ? 1 : 0, req.benutzer.id);
    }
    res.json(oeffentlichesProfil(konten.holeBenutzer(req.benutzer.id)));
  });

  router.post('/konto/passwort', angemeldet, async (req, res) => {
    const benutzer = await konten.pruefeZugangsdaten(req.benutzer.benutzername, req.body?.altesPasswort);
    if (!benutzer) throw new ValidierungsFehler({ altesPasswort: 'Das bisherige Passwort ist falsch.' });
    pruefeNeuesPasswort(req.body?.neuesPasswort, 'neuesPasswort');
    await konten.aenderePasswort(req.benutzer.id, req.body.neuesPasswort);
    konten.beendeAndereSitzungen(req.benutzer.id, req.sitzungHash);
    res.json({ ok: true });
  });

  router.post('/konto/abmelden-ueberall', angemeldet, (req, res) => {
    konten.beendeAndereSitzungen(req.benutzer.id, req.sitzungHash);
    res.json({ ok: true });
  });

  router.post('/konto/2fa/einrichten', angemeldet, async (req, res) => {
    await bestaetigePasswort(req);
    res.json(await konten.starteTotpEinrichtung(req.benutzer));
  });

  router.post('/konto/2fa/bestaetigen', angemeldet, (req, res) => {
    const codes = konten.bestaetigeTotpEinrichtung(konten.holeBenutzer(req.benutzer.id), req.body?.code);
    konten.beendeAndereSitzungen(req.benutzer.id, req.sitzungHash);
    res.json({ wiederherstellungscodes: codes });
  });

  router.post('/konto/2fa/deaktivieren', angemeldet, async (req, res) => {
    if (zweiFaktorPflicht) throw new KontoFehler('Auf diesem Server ist die Zwei-Faktor-Anmeldung Pflicht.', 403);
    await bestaetigePasswort(req);
    if (!konten.pruefeZweitenFaktor(req.benutzer, { code: req.body?.code })) {
      throw new ValidierungsFehler({ code: 'Der Code ist falsch oder abgelaufen.' });
    }
    konten.deaktiviereTotp(req.benutzer.id);
    res.json({ ok: true });
  });

  router.post('/konto/2fa/wiederherstellungscodes', angemeldet, async (req, res) => {
    await bestaetigePasswort(req);
    if (!req.benutzer.totp_aktiv) throw new KontoFehler('Die Zwei-Faktor-Anmeldung ist nicht aktiv.');
    res.json({ wiederherstellungscodes: konten.neueWiederherstellungscodes(req.benutzer.id) });
  });

  router.delete('/konto', angemeldet, async (req, res) => {
    await bestaetigePasswort(req);
    if (req.benutzer.rolle === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'admin'").get().n;
      if (admins <= 1) throw new KontoFehler('Du bist der einzige Administrator. Ernenne zuerst einen weiteren Administrator.', 409);
    }
    dateien.loescheBenutzerdaten(req.benutzer.id);
    loescheSitzungsCookie(req, res, cookieSicher);
    res.status(204).end();
  });

  return router;
}
