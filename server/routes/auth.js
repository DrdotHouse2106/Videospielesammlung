import { Router } from 'express';
import {
  oeffentlichesProfil, KontoFehler, pruefeNeuesPasswort,
} from '../services/konten.js';
import { erstelleDrossel } from '../services/drossel.js';
import { setzeSitzungsCookie, loescheSitzungsCookie, erfordereAnmeldung } from '../middleware/auth.js';
import { ValidierungsFehler } from '../services/validierung.js';
import { normalisiereEmail } from '../services/kontomail.js';
import { zufallsToken } from '../services/sicherheit.js';

const ZU_VIELE = 'Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es dann erneut.';

export function authRouter({ db, konten, konfiguration, dateien, speicher, kontoMail, captcha, erfolge, boerse }) {
  const router = Router();
  const { cookieSicher } = konfiguration.konten;
  // Live-Werte (über Admin → Einstellungen änderbar)
  const registrierungOffen = () => konfiguration.konten.registrierungOffen;
  const zweiFaktorPflicht = () => konfiguration.konten.zweiFaktorPflicht;
  const drossel = erstelleDrossel({ maxVersuche: 10 });
  const mailDrossel = erstelleDrossel({ maxVersuche: 5, fensterMs: 60 * 60 * 1000 });
  const emailPflicht = () => Boolean(konfiguration.emailPflicht && kontoMail.bereit());
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
      registrierungOffen: registrierungOffen() || ersteinrichtung,
      ersteinrichtung,
      zweiFaktorPflicht: zweiFaktorPflicht(),
      oeffentlicherKatalog: konfiguration.oeffentlicherKatalog,
      emailAktiv: kontoMail.bereit(),
      emailPflicht: emailPflicht(),
      captcha: captcha.oeffentlich(),
      boerse: boerse.aktiv(),
    });
  });

  // ALTCHA-Aufgabe für Registrierung und „Passwort vergessen“
  router.get('/auth/captcha', (_req, res) => {
    if (captcha.anbieter !== 'altcha') return res.status(404).json({ fehler: 'Nicht aktiv.' });
    res.set('Cache-Control', 'no-store').json(captcha.aufgabe());
  });

  router.post('/auth/registrieren', async (req, res) => {
    if (!registrierungOffen() && !konten.istErsteinrichtung()) {
      return res.status(403).json({ fehler: 'Die Registrierung ist auf diesem Server geschlossen.' });
    }
    if (registrierDrossel.gesperrt(req.ip)) return res.status(429).json({ fehler: 'Zu viele Registrierungen. Bitte später erneut versuchen.' });
    // Das allererste Konto (Administrator) ohne Spam-Prüfung, damit eine Fehlkonfiguration nicht aussperrt
    if (!konten.istErsteinrichtung()) await captcha.pruefe(req.body?.captcha, { aktion: 'registrieren', ip: req.ip });
    // E-Mail vorab prüfen, damit bei einem Tippfehler kein halbes Konto entsteht
    const email = kontoMail.bereit() ? normalisiereEmail(req.body?.email) : null;
    if (emailPflicht() && !email) throw new ValidierungsFehler({ email: 'Bitte gib eine E-Mail-Adresse an.' });
    const benutzer = await konten.registriere(req.body ?? {});
    registrierDrossel.fehlschlag(req.ip); // zählt jede Registrierung
    if (email) {
      try {
        await kontoMail.anfordernBestaetigung(benutzer, email);
      } catch (e) {
        console.warn('[mail] Bestätigung nach Registrierung:', e.message);
      }
    }
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

  // Passwortbestätigung (2FA, E-Mail, Konto löschen …) – mit Begrenzung der Fehlversuche je Konto
  async function bestaetigePasswort(req) {
    const schluessel = `bestaetigen:${req.benutzer.id}`;
    if (drossel.gesperrt(schluessel)) throw new KontoFehler(ZU_VIELE, 429);
    const benutzer = await konten.pruefeZugangsdaten(req.benutzer.benutzername, req.body?.passwort);
    if (!benutzer) {
      drossel.fehlschlag(schluessel);
      throw new ValidierungsFehler({ passwort: 'Das Passwort ist falsch.' });
    }
    drossel.zuruecksetzen(schluessel);
  }

  router.get('/konto', angemeldet, (req, res) => {
    res.json({
      ...oeffentlichesProfil(req.benutzer),
      wiederherstellungscodesUebrig: konten.anzahlWiederherstellungscodes(req.benutzer),
      email: req.benutzer.email ?? null,
      ausstehendeEmail: kontoMail.ausstehendeEmail(req.benutzer.id),
      emailAktiv: kontoMail.bereit(),
      emailPflicht: emailPflicht(),
      benachrichtigung_email: Boolean(req.benutzer.benachrichtigung_email),
      freigabe: freigabeInfo(req.benutzer),
      speicher: speicher.info(req.benutzer.id),
    });
  });

  // ── E-Mail-Adresse & Passwort vergessen ─────────
  router.post('/konto/email', angemeldet, async (req, res) => {
    await bestaetigePasswort(req);
    if (mailDrossel.gesperrt(`email:${req.benutzer.id}`)) return res.status(429).json({ fehler: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    mailDrossel.fehlschlag(`email:${req.benutzer.id}`);
    await kontoMail.anfordernBestaetigung(req.benutzer, req.body?.email);
    res.json({ ok: true, ausstehendeEmail: kontoMail.ausstehendeEmail(req.benutzer.id) });
  });

  router.delete('/konto/email', angemeldet, async (req, res) => {
    await bestaetigePasswort(req);
    if (emailPflicht()) throw new KontoFehler('Auf diesem Server ist eine E-Mail-Adresse Pflicht. Du kannst sie ändern, aber nicht entfernen.', 409);
    kontoMail.entferneEmail(req.benutzer.id);
    res.json({ ok: true });
  });

  router.post('/auth/email-bestaetigen', (req, res) => {
    const b = kontoMail.bestaetige(req.body?.token);
    res.json({ ok: true, email: b.email });
  });

  router.post('/auth/passwort-vergessen', async (req, res) => {
    if (mailDrossel.gesperrt(req.ip)) return res.status(429).json({ fehler: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
    mailDrossel.fehlschlag(req.ip);
    await captcha.pruefe(req.body?.captcha, { aktion: 'passwort', ip: req.ip });
    await kontoMail.anfordernReset(req.body?.kennung);
    // Immer dieselbe Antwort – verrät nicht, ob das Konto existiert
    res.json({ ok: true, hinweis: 'Falls ein Konto mit bestätigter E-Mail-Adresse existiert, haben wir dir einen Link geschickt. Er ist 60 Minuten gültig.' });
  });

  router.post('/auth/passwort-zuruecksetzen', async (req, res) => {
    if (drossel.gesperrt(req.ip)) return res.status(429).json({ fehler: ZU_VIELE });
    try {
      await kontoMail.zuruecksetzen(req.body?.token, req.body?.neuesPasswort);
    } catch (e) {
      if (e instanceof KontoFehler) drossel.fehlschlag(req.ip);
      throw e;
    }
    res.json({ ok: true });
  });

  // ── Sammlung per geheimem Link teilen ─────────
  function freigabeInfo(b) {
    if (!b.freigabe_token) return { aktiv: false, wert_zeigen: Boolean(b.freigabe_wert) };
    const pfad = `/sammlung/${b.freigabe_token}`;
    return { aktiv: true, wert_zeigen: Boolean(b.freigabe_wert), pfad, url: konfiguration.oeffentlicheUrl ? `${konfiguration.oeffentlicheUrl}${pfad}` : null };
  }
  router.post('/konto/freigabe', angemeldet, (req, res) => {
    const b = konten.holeBenutzer(req.benutzer.id);
    const neu = req.body?.neu === true || !b.freigabe_token;
    db.prepare('UPDATE benutzer SET freigabe_token = ?, freigabe_wert = ? WHERE id = ?')
      .run(neu ? zufallsToken(18) : b.freigabe_token, req.body?.wert_zeigen === undefined ? b.freigabe_wert : (req.body.wert_zeigen ? 1 : 0), b.id);
    erfolge.pruefe(b.id);
    res.json(freigabeInfo(konten.holeBenutzer(b.id)));
  });
  router.delete('/konto/freigabe', angemeldet, (req, res) => {
    db.prepare('UPDATE benutzer SET freigabe_token = NULL WHERE id = ?').run(req.benutzer.id);
    res.json(freigabeInfo(konten.holeBenutzer(req.benutzer.id)));
  });

  router.get('/konto/speicher', angemeldet, (req, res) => {
    res.json(speicher.info(req.benutzer.id));
  });

  router.put('/konto', angemeldet, (req, res) => {
    const { anzeigename, sammlung_oeffentlich: oeffentlich, benachrichtigung_email: perEmail } = req.body ?? {};
    if (perEmail !== undefined) {
      db.prepare('UPDATE benutzer SET benachrichtigung_email = ? WHERE id = ?').run(perEmail ? 1 : 0, req.benutzer.id);
    }
    if (anzeigename !== undefined) {
      db.prepare('UPDATE benutzer SET anzeigename = ? WHERE id = ?').run(String(anzeigename).trim().slice(0, 60) || null, req.benutzer.id);
    }
    if (oeffentlich !== undefined) {
      db.prepare('UPDATE benutzer SET sammlung_oeffentlich = ? WHERE id = ?').run(oeffentlich ? 1 : 0, req.benutzer.id);
    }
    const b = konten.holeBenutzer(req.benutzer.id);
    res.json({ ...oeffentlichesProfil(b), benachrichtigung_email: Boolean(b.benachrichtigung_email) });
  });

  router.post('/konto/passwort', angemeldet, async (req, res) => {
    const benutzer = await konten.pruefeZugangsdaten(req.benutzer.benutzername, req.body?.altesPasswort);
    if (!benutzer) throw new ValidierungsFehler({ altesPasswort: 'Das bisherige Passwort ist falsch.' });
    pruefeNeuesPasswort(req.body?.neuesPasswort, 'neuesPasswort');
    await konten.aenderePasswort(req.benutzer.id, req.body.neuesPasswort);
    konten.beendeAndereSitzungen(req.benutzer.id, req.sitzungHash);
    await kontoMail.sicherheitshinweis(req.benutzer, 'Dein Passwort wurde geändert', 'Das Passwort deines Kontos wurde gerade in den Kontoeinstellungen geändert. Andere Geräte wurden abgemeldet.');
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
    erfolge.pruefe(req.benutzer.id);
    res.json({ wiederherstellungscodes: codes });
  });

  router.post('/konto/2fa/deaktivieren', angemeldet, async (req, res) => {
    if (zweiFaktorPflicht()) throw new KontoFehler('Auf diesem Server ist die Zwei-Faktor-Anmeldung Pflicht.', 403);
    await bestaetigePasswort(req);
    if (!konten.pruefeZweitenFaktor(req.benutzer, { code: req.body?.code })) {
      throw new ValidierungsFehler({ code: 'Der Code ist falsch oder abgelaufen.' });
    }
    konten.deaktiviereTotp(req.benutzer.id);
    await kontoMail.sicherheitshinweis(req.benutzer, 'Zwei-Faktor-Anmeldung deaktiviert', 'Die Zwei-Faktor-Anmeldung deines Kontos wurde gerade ausgeschaltet.');
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
