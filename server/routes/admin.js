import { Router } from 'express';
import { KontoFehler } from '../services/konten.js';
import { erstelleDrossel } from '../services/drossel.js';

// Nur über die .env änderbar – zur Information in der Oberfläche
const NUR_ENV = ['APP_SECRET', 'DATABASE_PATH', 'UPLOAD_DIR', 'PORT', 'HOST', 'TRUST_PROXY', 'COOKIE_SECURE', 'SESSION_DAYS', 'REGISTRATIONS_PER_HOUR'];

export function adminRouter({ db, konten, dateien, speicher, sicherung, mail, benachrichtigungen, besucher, preisimport, igdb, ebay, preise, affiliate, ki, einstellungen, boerse, konfiguration }) {
  const router = Router();
  const bestaetigungsDrossel = erstelleDrossel({ maxVersuche: 5 });
  const anzahlAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM benutzer WHERE rolle = 'admin' AND gesperrt = 0").get().n;
  const ziel = (req) => {
    const b = konten.holeBenutzer(Number(req.params.id));
    if (!b) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    return b;
  };

  // Übersicht für das Admin-Dashboard
  router.get('/uebersicht', (_req, res) => {
    const zahl = (sql) => db.prepare(sql).get().n;
    res.json({
      benutzer: zahl('SELECT COUNT(*) AS n FROM benutzer'),
      moderatoren: zahl("SELECT COUNT(*) AS n FROM benutzer WHERE rolle IN ('moderator', 'admin')"),
      mitZweiFaktor: zahl('SELECT COUNT(*) AS n FROM benutzer WHERE totp_aktiv = 1'),
      gesperrt: zahl('SELECT COUNT(*) AS n FROM benutzer WHERE gesperrt = 1'),
      neueBenutzer7Tage: zahl("SELECT COUNT(*) AS n FROM benutzer WHERE erstellt_am >= datetime('now', '-7 days')"),
      artikel: zahl('SELECT COALESCE(SUM(anzahl), 0) AS n FROM artikel'),
      katalogFreigegeben: zahl("SELECT COUNT(*) AS n FROM katalog WHERE status = 'freigegeben'"),
      katalogPrivat: zahl("SELECT COUNT(*) AS n FROM katalog WHERE status IN ('privat', 'abgelehnt')"),
      offen: {
        katalog: zahl("SELECT COUNT(*) AS n FROM katalog WHERE status = 'eingereicht'"),
        varianten: zahl("SELECT COUNT(*) AS n FROM katalog_varianten WHERE status = 'eingereicht'"),
        medien: zahl("SELECT COUNT(*) AS n FROM medien WHERE sichtbarkeit = 'eingereicht'"),
        links: zahl("SELECT COUNT(*) AS n FROM externe_links WHERE status = 'eingereicht'"),
        meldungen: zahl("SELECT COUNT(*) AS n FROM inhalt_meldungen WHERE status = 'offen'"),
      },
      medienFreigegeben: zahl("SELECT COUNT(*) AS n FROM medien WHERE sichtbarkeit = 'freigegeben'"),
      speicher: {
        gesamt: zahl('SELECT COALESCE(SUM(groesse_gesamt), 0) AS n FROM medien')
          + zahl('SELECT COALESCE(SUM(bild_groesse), 0) AS n FROM artikel WHERE bild_datei IS NOT NULL'),
        gemeinschaft: zahl("SELECT COALESCE(SUM(groesse_gesamt), 0) AS n FROM medien WHERE sichtbarkeit = 'freigegeben'"),
        standardMb: speicher.standardMb,
      },
      preisdaten: zahl('SELECT COUNT(*) AS n FROM preis_historie'),
      dienste: {
        igdb: igdb.konfiguriert,
        ebay: ebay.konfiguriert,
        priceCharting: preise.aktiv,
        affiliate: affiliate.aktiv,
        registrierungOffen: konfiguration.konten.registrierungOffen,
        zweiFaktorPflicht: konfiguration.konten.zweiFaktorPflicht,
        oeffentlicherKatalog: konfiguration.oeffentlicherKatalog,
        medienTeilen: konfiguration.medienTeilenErlaubt,
      },
      preisimport: { ...preisimport.status(), intervallStunden: konfiguration.preisimportStunden },
      ki: {
        aktiv: ki.aktiv, anbieter: ki.anbieter, modell: ki.modell, ...ki.einstellungen,
        letzte7Tage: db.prepare(`SELECT ergebnis, COUNT(*) AS anzahl FROM ki_pruefungen WHERE erstellt_am >= datetime('now', '-7 days') GROUP BY ergebnis`).all(),
      },
    });
  });

  // Preisimport sofort starten (läuft im Hintergrund weiter)
  router.post('/preisimport', (_req, res) => {
    if (!preisimport.aktiv()) return res.status(400).json({ fehler: 'Keine Preisquelle eingerichtet (EBAY_CLIENT_ID/SECRET oder PRICECHARTING_TOKEN).' });
    preisimport.lauf({ max: konfiguration.preisimportMax }).catch((e) => console.warn('[preisimport]', e.message));
    res.status(202).json({ gestartet: true });
  });

  // Welche Partner-IDs gerade gelten und woher sie stammen
  const affiliateStatus = () => {
    const a = konfiguration.affiliate;
    return { aktiv: a.aktiv, amazon: a.amazonQuelle, ebay: a.ebayQuelle, domains: a.standardDomains, oeffentlicheUrl: konfiguration.oeffentlicheUrl };
  };

  // ── Server-Einstellungen (Vorrang vor der .env, wirken sofort) ─────────
  router.get('/einstellungen', (_req, res) => {
    res.json({ einstellungen: einstellungen.liste(), nurEnv: NUR_ENV, protokoll: einstellungen.protokoll(50), affiliate: affiliateStatus() });
  });

  router.put('/einstellungen', async (req, res) => {
    const { werte = {}, zuruecksetzen = [], entfernen = [], passwort, code } = req.body ?? {};
    const aenderung = {
      werte: werte && typeof werte === 'object' ? werte : {},
      zuruecksetzen: Array.isArray(zuruecksetzen) ? zuruecksetzen.map(String) : [],
      entfernen: Array.isArray(entfernen) ? entfernen.map(String) : [],
    };
    // Schlüssel und sicherheitsrelevante Werte nur mit Passwort (und 2FA-Code, falls aktiv)
    if (einstellungen.brauchtBestaetigung(aenderung)) {
      const drosselSchluessel = `einstellungen:${req.benutzer.id}`;
      if (bestaetigungsDrossel.gesperrt(drosselSchluessel)) {
        throw new KontoFehler('Zu viele Fehlversuche. Bitte warte 15 Minuten.', 429);
      }
      if (!passwort) throw new KontoFehler('Diese Änderung ist sicherheitsrelevant. Bitte bestätige sie mit deinem Passwort.', 403, 'bestaetigung_noetig');
      const b = await konten.pruefeZugangsdaten(req.benutzer.benutzername, passwort);
      const vollstaendig = konten.holeBenutzer(req.benutzer.id);
      const zweiterFaktorOk = !vollstaendig.totp_aktiv || (code && konten.pruefeZweitenFaktor(vollstaendig, { code: String(code) }));
      if (!b || !zweiterFaktorOk) {
        bestaetigungsDrossel.fehlschlag(drosselSchluessel);
        throw new KontoFehler(!b ? 'Das Passwort ist falsch.' : 'Der 2FA-Code ist falsch oder fehlt.', 403, 'bestaetigung_noetig');
      }
      bestaetigungsDrossel.zuruecksetzen(drosselSchluessel);
    }
    const geaendert = einstellungen.setze(aenderung, req.benutzer);
    res.json({ geaendert, einstellungen: einstellungen.liste(), protokoll: einstellungen.protokoll(50), affiliate: affiliateStatus() });
  });

  // Test-E-Mail an die eigene (oder angegebene) Adresse
  router.post('/test-mail', async (req, res) => {
    const an = String(req.body?.an ?? '').trim() || req.benutzer.email;
    if (!an) throw new KontoFehler('Bitte eine Empfängeradresse angeben oder unter „Konto“ eine E-Mail-Adresse hinterlegen.');
    if (!mail.aktiv) throw new KontoFehler('Der E-Mail-Versand ist nicht eingerichtet (SMTP-Server und Absender fehlen).');
    try {
      await mail.sende({ an, betreff: 'ZockDB: Test-E-Mail', text: 'Der E-Mail-Versand funktioniert. 🎮' });
    } catch (e) {
      throw new KontoFehler(`Versand fehlgeschlagen: ${e.message}`, 502);
    }
    res.json({ ok: true, an });
  });

  // Besucherstatistik (anonym, ohne Cookies)
  router.get('/besucher', (req, res) => res.json(besucher.auswertung(Number(req.query.tage) || 30)));

  // ── Datenbank-Sicherungen ─────────
  router.get('/sicherungen', (_req, res) => res.json(sicherung.status()));
  router.post('/sicherungen', async (_req, res) => {
    const s = await sicherung.lauf({ erzwingen: true });
    if (s.letzterFehler) return res.status(500).json({ fehler: `Sicherung fehlgeschlagen: ${s.letzterFehler}` });
    res.json(s);
  });

  router.get('/benutzer', (_req, res) => {
    res.json(db.prepare(`
      SELECT b.id, b.benutzername, b.anzeigename, b.email, b.rolle, b.gesperrt, b.totp_aktiv, b.sammlung_oeffentlich,
             b.erstellt_am, b.letzte_anmeldung, b.haendler_status, b.haendler_daten, b.haendler_paket, b.haendler_paket_bis, b.haendler_api_bis, b.haendler_test_bis, b.haendler_test_genutzt_am, COUNT(a.id) AS eintraege
      FROM benutzer b LEFT JOIN artikel a ON a.benutzer_id = b.id
      GROUP BY b.id ORDER BY b.erstellt_am`).all().map(({ haendler_daten: daten, ...b }) => ({
        ...b, speicher: speicher.info(b.id), haendler: daten ? JSON.parse(daten) : null,
      })));
  });

  // Gewerblichen Anbieter verifizieren (nach Prüfung der Anbieterkennzeichnung)
  router.post('/benutzer/:id/haendler', (req, res) => {
    const b = ziel(req);
    boerse.verifiziere(b.id, req.body?.verifiziert === true);
    res.json({ ok: true });
  });

  // Händler-Paket bzw. Zusatzpaket API-Anbindung bis zu einem Datum freischalten (Abrechnung außerhalb der App, z. B. per Rechnung)
  router.post('/benutzer/:id/paket', (req, res) => {
    const b = ziel(req);
    boerse.setzePaket(b.id, { angebote: req.body?.angebote, bis: req.body?.bis || null });
    res.json({ ok: true });
  });
  router.post('/benutzer/:id/api-zugang', (req, res) => {
    const b = ziel(req);
    boerse.setzeApi(b.id, req.body?.bis || null);
    res.json({ ok: true });
  });
  // Kostenloser Testzugang (Paket + API-Anbindung auf Zeit)
  router.post('/benutzer/:id/testzugang', (req, res) => {
    const b = ziel(req);
    boerse.starteTest(b.id, { tage: req.body?.tage, angebote: req.body?.angebote, durchAdmin: true });
    res.json({ ok: true });
  });
  router.get('/pakete', (_req, res) => res.json({ pakete: konfiguration.boerse.pakete, api_preis: konfiguration.boerse.apiPreis }));

  router.put('/benutzer/:id', (req, res) => {
    const b = ziel(req);
    const { rolle, gesperrt, speicher_limit_mb: limitMb } = req.body ?? {};
    const verliertAdmin = b.rolle === 'admin' && !b.gesperrt && ((rolle && rolle !== 'admin') || gesperrt);
    if (verliertAdmin && anzahlAdmins() <= 1) throw new KontoFehler('Es muss mindestens ein aktiver Administrator bleiben.', 409);
    if (rolle !== undefined) {
      if (!['admin', 'moderator', 'nutzer'].includes(rolle)) throw new KontoFehler('Ungültige Rolle.');
      db.prepare('UPDATE benutzer SET rolle = ? WHERE id = ?').run(rolle, b.id);
      if (rolle !== b.rolle) {
        const name = { admin: 'Administrator', moderator: 'Moderator', nutzer: 'Nutzer' }[rolle];
        benachrichtigungen.sende(b.id, {
          art: 'rolle', titel: `Deine Rolle: ${name}`,
          text: rolle === 'moderator' ? 'Du kannst jetzt Einreichungen prüfen und Katalogeinträge bearbeiten – unter „Mehr → Moderation“. Danke für deine Hilfe!' : null,
          link: rolle === 'nutzer' ? null : rolle === 'moderator' ? '#/moderation' : '#/admin',
        });
      }
    }
    if (limitMb !== undefined) {
      // null/leer = Standard, 0 = unbegrenzt, sonst MB
      const wert = limitMb === null || limitMb === '' ? null : Number(limitMb);
      if (wert !== null && (!Number.isInteger(wert) || wert < 0 || wert > 10_000_000)) {
        throw new KontoFehler('Bitte ein Speicherlimit in ganzen MB angeben (0 = unbegrenzt, leer = Standard).');
      }
      db.prepare('UPDATE benutzer SET speicher_limit_mb = ? WHERE id = ?').run(wert, b.id);
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
