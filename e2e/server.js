// Startet eine frische ZockDB-Instanz für die Browser-Tests (leere Datenbank in einem temporären Ordner).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ladeKonfiguration } from '../server/config.js';
import { erstelleApp } from '../server/app.js';
import { oeffneDatenbank } from '../server/db.js';

const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'zockdb-e2e-'));
const konfiguration = ladeKonfiguration({
  PORT: process.env.E2E_PORT || '4310',
  UPLOAD_DIR: path.join(ordner, 'uploads'),
  DATABASE_PATH: path.join(ordner, 'db.sqlite'),
  BARCODE_PROVIDERS: '',
  APP_SECRET: 'e2e-geheimnis',
  REGISTRATIONS_PER_HOUR: '1000',
  CAPTCHA_PROVIDER: 'aus',
  MARKET_MIN_ACCOUNT_DAYS: '0',
});
const { app } = erstelleApp(konfiguration, { db: oeffneDatenbank(konfiguration.datenbankPfad) });
const server = app.listen(konfiguration.port, '127.0.0.1', () => console.log(`E2E-Server auf Port ${konfiguration.port}`));

const beenden = () => server.close(() => { fs.rmSync(ordner, { recursive: true, force: true }); process.exit(0); });
process.on('SIGTERM', beenden);
process.on('SIGINT', beenden);
