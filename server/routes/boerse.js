// Tauschbörse: Angebote, Wunschliste, Nachrichten, Bewertungen, gewerbliche Anbieter und Massen-Upload.
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { FOTO_TYPEN, MAX_FOTOS } from '../services/angebotfotos.js';
import { erstelleDrossel } from '../services/drossel.js';
import { beschriftung, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, ANGEBOTSARTEN, ANGEBOTSSTATUS } from '../../shared/konstanten.js';

/** Schützt Zellen vor Formel-Ausführung in Tabellenprogrammen (=, +, -, @ am Anfang). */
const zelle = (wert) => {
  if (wert === null || wert === undefined) return '';
  let t = String(wert);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function boerseRouter({ db, boerse, boersenImport, anbindungen, angebotFotos, dateien, konfiguration }) {
  const router = Router();
  // Fotos: Upload in den Upload-Ordner, danach verkleinert/umgewandelt – das Original wird gelöscht
  const fotoUpload = (req, res, next) => multer({
    storage: multer.diskStorage({
      destination: dateien.verzeichnis,
      filename: (_req, datei, cb) => cb(null, `tmp-${crypto.randomUUID()}${FOTO_TYPEN[datei.mimetype]}`),
    }),
    limits: { fileSize: konfiguration.maxUploadMb * 1024 * 1024, files: MAX_FOTOS },
    fileFilter: (_req, datei, cb) => cb(null, Boolean(FOTO_TYPEN[datei.mimetype])),
  }).array('fotos', MAX_FOTOS)(req, res, next);
  // Manuelle Abgleiche und Verbindungstests schonen die Systeme der Händler
  const abrufDrossel = erstelleDrossel({ maxVersuche: 10, fensterMs: 60 * 60 * 1000 });
  const gedrosselt = (req, res) => {
    if (abrufDrossel.gesperrt(`a:${req.benutzer.id}`)) { res.status(429).json({ fehler: 'Zu viele Abrufe. Bitte in einer Stunde erneut versuchen.' }); return true; }
    abrufDrossel.fehlschlag(`a:${req.benutzer.id}`);
    return false;
  };

  // Ist die Börse abgeschaltet, sind alle Endpunkte (außer dem Status) nicht erreichbar
  router.use('/boerse', (req, res, next) => (boerse.aktiv() ? next() : res.status(404).json({ fehler: 'Die Tauschbörse ist auf diesem Server abgeschaltet.', code: 'boerse_aus' })));

  // ── Angebote ──────────────────────────────────────────────────
  router.get('/boerse/angebote', (req, res) => res.json(boerse.liste(req.query, req.benutzer)));

  router.get('/boerse/angebote/:id', (req, res) => {
    const a = boerse.hole(req.params.id, req.benutzer);
    if (!a) return res.status(404).json({ fehler: 'Angebot nicht gefunden oder nicht mehr aktiv.' });
    boerse.statistik.aufruf(a, { benutzerId: req.benutzer?.id, ip: req.ip, ua: req.get('user-agent') ?? '' });
    res.json(a);
  });

  router.post('/boerse/angebote', async (req, res) => {
    const angebot = boerse.legeAn(req.benutzer, req.body ?? {});
    // Foto des Exemplars aus der Sammlung übernehmen
    if (angebot.artikel_id) {
      const bild = db.prepare('SELECT bild_datei FROM artikel WHERE id = ? AND benutzer_id = ?').get(angebot.artikel_id, req.benutzer.id)?.bild_datei;
      if (bild) await angebotFotos.fuegeHinzu(req.benutzer, angebot.id, dateien.pfadVon(bild)).catch(() => {});
    }
    res.status(201).json(boerse.hole(angebot.id, req.benutzer));
  });

  router.post('/boerse/angebote/:id/fotos', fotoUpload, async (req, res) => {
    const temp = (req.files ?? []).map((f) => f.filename);
    try {
      if (!temp.length) return res.status(400).json({ fehler: 'Bitte Fotos im Format JPG, PNG oder WebP auswählen.' });
      for (const datei of temp) await angebotFotos.fuegeHinzu(req.benutzer, req.params.id, dateien.pfadVon(datei));
      res.json(boerse.hole(req.params.id, req.benutzer));
    } finally {
      dateien.loesche(temp);
    }
  });
  router.delete('/boerse/fotos/:id', (req, res) => res.json(boerse.hole(angebotFotos.entferne(req.benutzer, req.params.id), req.benutzer)));
  router.post('/boerse/fotos/:id/titelbild', (req, res) => res.json(boerse.hole(angebotFotos.alsTitelbild(req.benutzer, req.params.id), req.benutzer)));
  // Eigene Statistik: Aufrufe, Anfragen und Wunschlisten-Treffer (nur Tageszähler).
  // Vollständig nur mit Händler-Paket – sonst eine Vorschau mit den Gesamtzahlen der letzten 30 Tage.
  router.get('/boerse/statistik', (req, res) => res.json(boerse.statistikFuer(req.benutzer, req.query.tage)));

  router.put('/boerse/angebote/:id', (req, res) => res.json(boerse.aendere(req.benutzer, req.params.id, req.body ?? {})));
  router.delete('/boerse/angebote/:id', (req, res) => {
    const fotos = angebotFotos.dateienVon(req.params.id);
    boerse.loesche(req.benutzer, req.params.id);
    dateien.loesche(fotos);
    res.status(204).end();
  });

  // Verkaufspreis melden (Verkäufer) bzw. Kauf bestätigen (Käufer)
  router.post('/boerse/angebote/:id/verkauf', (req, res) => res.status(201).json(boerse.meldeVerkauf(req.benutzer, req.params.id, req.body ?? {})));
  router.post('/boerse/verkaeufe/:id/bestaetigen', (req, res) => res.json(boerse.bestaetigeKauf(req.benutzer, req.params.id, req.body ?? {})));

  router.post('/boerse/angebote/:id/anfrage', (req, res) => {
    res.status(201).json({ unterhaltung_id: boerse.frageAn(req.benutzer, req.params.id, req.body?.text) });
  });

  router.get('/boerse/meine', (req, res) => {
    const profil = boerse.haendlerProfil(req.benutzer.id);
    res.json({ angebote: boerse.meine(req.benutzer.id), limit: profil.limit, aktive: profil.aktive_angebote, plz: profil.plz });
  });

  // Eigene Angebote als CSV – enthält die ZockDB-ID, damit Händler ihre Datei ergänzen können
  router.get('/boerse/meine.csv', (req, res) => {
    const kopf = ['ZockDB-ID', 'Titel', 'Plattform', 'Artikelnummer', 'Preis', 'Bestand', 'Zustand', 'Vollständigkeit', 'Region', 'Angebotsart', 'Status', 'Läuft ab', 'Beschreibung'];
    const zeilen = boerse.meine(req.benutzer.id).map((a) => [
      a.katalog_id, a.titel, a.plattform, a.sku, a.preis === null ? '' : String(a.preis).replace('.', ','), a.anzahl,
      beschriftung(ZUSTAENDE, a.zustand), beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit), beschriftung(REGIONEN, a.region, 'kurz'),
      beschriftung(ANGEBOTSARTEN, a.art), beschriftung(ANGEBOTSSTATUS, a.status), a.laeuft_ab, a.beschreibung,
    ].map(zelle).join(';'));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="meine-angebote.csv"' });
    res.send(`﻿${[kopf.join(';'), ...zeilen].join('\r\n')}\r\n`);
  });

  // ── Wunschliste, Treffer, Tausch, Nachfrage ───────────────────
  router.get('/boerse/wunschliste', (req, res) => res.json(boerse.wuensche(req.benutzer.id)));
  router.put('/boerse/wunschliste/:katalogId', (req, res) => res.json(boerse.setzeWunsch(req.benutzer, req.params.katalogId, req.body ?? {})));
  router.delete('/boerse/wunschliste/:katalogId', (req, res) => {
    boerse.entferneWunsch(req.benutzer.id, req.params.katalogId);
    res.status(204).end();
  });
  router.get('/boerse/treffer', (req, res) => res.json(boerse.treffer(req.benutzer)));
  router.get('/boerse/tausch', (req, res) => res.json(boerse.tauschvorschlaege(req.benutzer)));
  router.get('/boerse/nachfrage', (req, res) => res.json(boerse.nachfrage(req.benutzer, req.query)));

  // ── Anbieter, Blockieren ──────────────────────────────────────
  router.get('/boerse/anbieter/:id', (req, res) => {
    const profil = boerse.anbieterProfil(req.params.id, req.benutzer);
    if (!profil) return res.status(404).json({ fehler: 'Anbieter nicht gefunden.' });
    res.json({ ...profil, angebote: boerse.liste({ anbieter_id: profil.id, seite: req.query.seite }, req.benutzer) });
  });
  router.post('/boerse/anbieter/:id/blockieren', (req, res) => {
    boerse.blockiere(req.benutzer, req.params.id);
    res.json({ ok: true });
  });
  router.delete('/boerse/anbieter/:id/blockieren', (req, res) => {
    boerse.entblocke(req.benutzer, req.params.id);
    res.json({ ok: true });
  });
  router.get('/boerse/blockiert', (req, res) => res.json(boerse.blockierte(req.benutzer.id)));

  // ── Nachrichten & Bewertungen ─────────────────────────────────
  router.get('/boerse/nachrichten', (req, res) => res.json(boerse.unterhaltungen(req.benutzer.id)));
  router.get('/boerse/nachrichten/anzahl', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ ungelesen: boerse.ungeleseneNachrichten(req.benutzer.id) });
  });
  router.get('/boerse/nachrichten/:id', (req, res) => res.json(boerse.unterhaltung(req.benutzer, req.params.id)));
  router.post('/boerse/nachrichten/:id', (req, res) => {
    boerse.antworte(req.benutzer, req.params.id, req.body?.text);
    res.status(201).json(boerse.unterhaltung(req.benutzer, req.params.id));
  });
  router.post('/boerse/nachrichten/:id/bewertung', (req, res) => res.json(boerse.bewerte(req.benutzer, req.params.id, req.body ?? {})));

  // ── Gewerbliche Anbieter ──────────────────────────────────────
  router.get('/boerse/haendler', (req, res) => res.json(boerse.haendlerProfil(req.benutzer.id)));
  router.put('/boerse/haendler', (req, res) => res.json(boerse.setzeHaendler(req.benutzer, req.body?.privat ? null : req.body ?? {})));
  router.post('/boerse/haendler/test', (req, res) => res.json(boerse.starteTest(req.benutzer.id)));
  router.put('/boerse/plz', (req, res) => res.json({ plz: boerse.setzePlz(req.benutzer, req.body?.plz) }));
  // Große Dateien kosten Rechenzeit – je Händler begrenzt
  const importDrossel = erstelleDrossel({ maxVersuche: 60, fensterMs: 60 * 60 * 1000 });
  const importBegrenzt = (req, res) => {
    if (importDrossel.gesperrt(`i:${req.benutzer.id}`)) { res.status(429).json({ fehler: 'Zu viele Uploads. Bitte in einer Stunde erneut versuchen.' }); return true; }
    importDrossel.fehlschlag(`i:${req.benutzer.id}`);
    return false;
  };
  router.post('/boerse/haendler/import/analyse', (req, res) => {
    if (importBegrenzt(req, res)) return;
    res.json(boersenImport.analyse(req.benutzer, req.body?.text));
  });
  router.post('/boerse/haendler/import', (req, res) => {
    if (importBegrenzt(req, res)) return;
    res.json(boersenImport.importiere(req.benutzer, {
      text: req.body?.text,
      zuordnung: req.body?.zuordnung,
      beendeFehlende: req.body?.beendeFehlende === true,
      standard: req.body?.standard ?? {},
    }));
  });

  // ── Automatische Shop-/ERP-Anbindung (Zusatzpaket API-Anbindung) ─
  router.get('/boerse/haendler/anbindung', (req, res) => res.json(anbindungen.info(req.benutzer.id)));
  router.put('/boerse/haendler/anbindung', (req, res) => res.json(anbindungen.speichere(req.benutzer, req.body ?? {})));
  router.delete('/boerse/haendler/anbindung', (req, res) => {
    anbindungen.entferne(req.benutzer.id);
    res.status(204).end();
  });
  router.post('/boerse/haendler/anbindung/test', async (req, res) => {
    if (gedrosselt(req, res)) return;
    res.json(await anbindungen.teste(req.benutzer));
  });
  router.post('/boerse/haendler/anbindung/abgleich', async (req, res) => {
    if (gedrosselt(req, res)) return;
    res.json(await anbindungen.synchronisiere(req.benutzer.id));
  });

  return router;
}
