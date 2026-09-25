import { Router } from 'express';
import { KontoFehler } from '../services/konten.js';

export function adminRouter({ db, konten, dateien, speicher, preisimport, igdb, ebay, preise, affiliate, ki, konfiguration }) {
  const router = Router();
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

  router.get('/benutzer', (_req, res) => {
    res.json(db.prepare(`
      SELECT b.id, b.benutzername, b.anzeigename, b.rolle, b.gesperrt, b.totp_aktiv, b.sammlung_oeffentlich,
             b.erstellt_am, b.letzte_anmeldung, COUNT(a.id) AS eintraege
      FROM benutzer b LEFT JOIN artikel a ON a.benutzer_id = b.id
      GROUP BY b.id ORDER BY b.erstellt_am`).all().map((b) => ({ ...b, speicher: speicher.info(b.id) })));
  });

  router.put('/benutzer/:id', (req, res) => {
    const b = ziel(req);
    const { rolle, gesperrt, speicher_limit_mb: limitMb } = req.body ?? {};
    const verliertAdmin = b.rolle === 'admin' && !b.gesperrt && ((rolle && rolle !== 'admin') || gesperrt);
    if (verliertAdmin && anzahlAdmins() <= 1) throw new KontoFehler('Es muss mindestens ein aktiver Administrator bleiben.', 409);
    if (rolle !== undefined) {
      if (!['admin', 'moderator', 'nutzer'].includes(rolle)) throw new KontoFehler('Ungültige Rolle.');
      db.prepare('UPDATE benutzer SET rolle = ? WHERE id = ?').run(rolle, b.id);
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
