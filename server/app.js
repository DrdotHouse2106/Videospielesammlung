import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { PROJEKT_WURZEL } from './config.js';
import { oeffneDatenbank } from './db.js';
import { basicAuth } from './middleware/auth.js';
import { erstelleCache } from './services/cache.js';
import { erstelleIgdbDienst } from './services/igdb.js';
import { erstelleBarcodeDienst } from './services/barcode.js';
import { erstelleKatalogDienst } from './services/katalog.js';
import { ValidierungsFehler } from './services/validierung.js';
import { artikelRouter } from './routes/artikel.js';
import { katalogRouter } from './routes/katalog.js';
import { statistikRouter } from './routes/statistik.js';
import { exportRouter } from './routes/export.js';
import { statusRouter } from './routes/status.js';

const { version } = JSON.parse(fs.readFileSync(path.join(PROJEKT_WURZEL, 'package.json'), 'utf8'));

export function erstelleApp(konfiguration, { db = oeffneDatenbank(konfiguration.datenbankPfad), fetchFn } = {}) {
  const cache = erstelleCache(db, konfiguration.cacheTtlStunden);
  const igdb = erstelleIgdbDienst(konfiguration.igdb, db, { fetchFn });
  const barcode = erstelleBarcodeDienst(konfiguration.barcode, { fetchFn });
  const katalog = erstelleKatalogDienst(db, { igdb, barcode, cache });
  const kontext = { db, cache, igdb, barcode, katalog, konfiguration, version };

  const app = express();
  app.disable('x-powered-by');
  if (konfiguration.vertrauteProxies) app.set('trust proxy', konfiguration.vertrauteProxies);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self)',
    });
    next();
  });

  // Ohne Anmeldung erreichbar, damit Docker-Healthchecks funktionieren.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(basicAuth(konfiguration.auth));
  app.use(express.json({ limit: '20mb' }));

  app.use('/api', statusRouter(kontext));
  app.use('/api/artikel', artikelRouter(kontext));
  app.use('/api/katalog', katalogRouter(kontext));
  app.use('/api/statistik', statistikRouter(kontext));
  app.use('/api', exportRouter(kontext));
  app.use('/api', (_req, res) => res.status(404).json({ fehler: 'Unbekannter API-Endpunkt.' }));

  app.use('/uploads', express.static(konfiguration.uploadVerzeichnis, { maxAge: '30d', immutable: true }));

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
  app.use((fehler, _req, res, _next) => {
    if (fehler instanceof ValidierungsFehler) {
      return res.status(400).json({ fehler: fehler.message, felder: fehler.fehler });
    }
    if (fehler instanceof multer.MulterError) {
      const meldung = fehler.code === 'LIMIT_FILE_SIZE'
        ? `Das Bild ist zu groß (maximal ${konfiguration.maxUploadMb} MB).`
        : 'Das Bild konnte nicht hochgeladen werden.';
      return res.status(400).json({ fehler: meldung });
    }
    if (fehler.type === 'entity.parse.failed') return res.status(400).json({ fehler: 'Ungültige JSON-Daten.' });
    if (fehler.type === 'entity.too.large') return res.status(413).json({ fehler: 'Die Anfrage ist zu groß.' });
    if (fehler.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(400).json({ fehler: 'Der verknüpfte Katalogeintrag existiert nicht.' });
    console.error(fehler);
    res.status(500).json({ fehler: 'Interner Serverfehler. Details stehen im Server-Log.' });
  });

  return { app, db, kontext };
}
