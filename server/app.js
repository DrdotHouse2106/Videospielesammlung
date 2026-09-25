import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { PROJEKT_WURZEL } from './config.js';
import { oeffneDatenbank } from './db.js';
import {
  ladeSitzung, pruefeHerkunft, erfordereAnmeldung, erfordereAdmin,
} from './middleware/auth.js';
import { erstelleCache } from './services/cache.js';
import { erstelleIgdbDienst } from './services/igdb.js';
import { erstelleBarcodeDienst } from './services/barcode.js';
import { erstelleKatalogDienst } from './services/katalog.js';
import { erstelleKontenDienst, KontoFehler } from './services/konten.js';
import { erstelleDateiDienst } from './services/dateien.js';
import { erstellePreisDienst } from './services/preise.js';
import { ladeSchluessel } from './services/sicherheit.js';
import { ValidierungsFehler } from './services/validierung.js';
import { authRouter } from './routes/auth.js';
import { artikelRouter } from './routes/artikel.js';
import { katalogRouter } from './routes/katalog.js';
import { statistikRouter } from './routes/statistik.js';
import { exportRouter } from './routes/export.js';
import { statusRouter } from './routes/status.js';
import { medienRouter } from './routes/medien.js';
import { werteRouter } from './routes/werte.js';
import { communityRouter } from './routes/community.js';
import { adminRouter } from './routes/admin.js';

const { version } = JSON.parse(fs.readFileSync(path.join(PROJEKT_WURZEL, 'package.json'), 'utf8'));

export function erstelleApp(konfiguration, { db = oeffneDatenbank(konfiguration.datenbankPfad), fetchFn } = {}) {
  const datenVerzeichnis = konfiguration.datenbankPfad === ':memory:'
    ? konfiguration.uploadVerzeichnis
    : path.dirname(konfiguration.datenbankPfad);
  const schluessel = ladeSchluessel(konfiguration.konten.appGeheimnis, datenVerzeichnis);

  const cache = erstelleCache(db, konfiguration.cacheTtlStunden);
  const igdb = erstelleIgdbDienst(konfiguration.igdb, db, { fetchFn });
  const barcode = erstelleBarcodeDienst(konfiguration.barcode, { fetchFn });
  const katalog = erstelleKatalogDienst(db, { igdb, barcode, cache });
  const konten = erstelleKontenDienst(db, { schluessel, sitzungTage: konfiguration.konten.sitzungTage });
  const dateien = erstelleDateiDienst(db, { uploadVerzeichnis: konfiguration.uploadVerzeichnis });
  const preise = erstellePreisDienst(db, konfiguration.preise, { cache, fetchFn });
  const kontext = { db, cache, igdb, barcode, katalog, konten, dateien, preise, konfiguration, version };

  const app = express();
  app.disable('x-powered-by');
  if (konfiguration.vertrauteProxies) {
    const wert = konfiguration.vertrauteProxies;
    app.set('trust proxy', /^\d+$/.test(wert) ? Number(wert) : wert);
  }

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'camera=(self)',
      'Content-Security-Policy': [
        "default-src 'self'",
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "object-src 'self'",
        "frame-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    });
    next();
  });

  // Ohne Anmeldung erreichbar, damit Docker-Healthchecks funktionieren.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api', pruefeHerkunft, express.json({ limit: '20mb' }), ladeSitzung(konten));
  app.use('/api', authRouter(kontext));

  const angemeldet = erfordereAnmeldung(konfiguration.konten);
  app.use('/api', angemeldet, statusRouter(kontext));
  app.use('/api/artikel', angemeldet, artikelRouter(kontext));
  app.use('/api/katalog', angemeldet, katalogRouter(kontext));
  app.use('/api/statistik', angemeldet, statistikRouter(kontext));
  app.use('/api/admin', angemeldet, erfordereAdmin, adminRouter(kontext));
  app.use('/api', angemeldet, medienRouter(kontext), werteRouter(kontext), communityRouter(kontext), exportRouter(kontext));
  app.use('/api', (_req, res) => res.status(404).json({ fehler: 'Unbekannter API-Endpunkt.' }));

  // Gebaute Oberfläche (npm run build) ausliefern, inkl. Fallback für die Single-Page-App.
  const distVerzeichnis = path.join(PROJEKT_WURZEL, 'dist');
  if (fs.existsSync(distVerzeichnis)) {
    app.use(express.static(distVerzeichnis, {
      setHeaders: (res, datei) => {
        if (datei.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
        else res.set('Cache-Control', 'no-cache');
      },
    }));
    app.get('/{*pfad}', (_req, res) => res.sendFile(path.join(distVerzeichnis, 'index.html')));
  }

  // Zentrale Fehlerbehandlung – alle Meldungen auf Deutsch.
  app.use((fehler, req, res, _next) => {
    if (fehler instanceof ValidierungsFehler) {
      return res.status(400).json({ fehler: fehler.message, felder: fehler.fehler });
    }
    if (fehler instanceof KontoFehler) return res.status(fehler.status).json({ fehler: fehler.message, code: fehler.code });
    if (fehler instanceof multer.MulterError) {
      const maxMb = req.path.includes('/medien') ? konfiguration.maxMedienMb : konfiguration.maxUploadMb;
      const meldung = fehler.code === 'LIMIT_FILE_SIZE'
        ? `Die Datei ist zu groß (maximal ${maxMb} MB).`
        : 'Die Datei konnte nicht hochgeladen werden.';
      return res.status(400).json({ fehler: meldung });
    }
    if (fehler.type === 'entity.parse.failed') return res.status(400).json({ fehler: 'Ungültige JSON-Daten.' });
    if (fehler.type === 'entity.too.large') return res.status(413).json({ fehler: 'Die Anfrage ist zu groß.' });
    if (fehler.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ fehler: 'Ein verknüpfter Eintrag existiert nicht.' });
    console.error(fehler);
    res.status(500).json({ fehler: 'Interner Serverfehler. Details stehen im Server-Log.' });
  });

  return { app, db, kontext };
}
