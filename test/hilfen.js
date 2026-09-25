import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ladeKonfiguration } from '../server/config.js';
import { erstelleApp } from '../server/app.js';
import { oeffneDatenbank } from '../server/db.js';

/** Startet eine Test-Instanz mit In-Memory-Datenbank auf einem freien Port. */
export async function starteTestServer({ env = {}, fetchFn } = {}) {
  const uploadVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'vss-test-'));
  const konfiguration = ladeKonfiguration({
    UPLOAD_DIR: uploadVerzeichnis,
    BARCODE_PROVIDERS: '',
    ...env,
  });
  const { app, db } = erstelleApp(konfiguration, { db: oeffneDatenbank(':memory:'), fetchFn });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const basis = `http://127.0.0.1:${server.address().port}`;
  const api = async (pfad, { methode = 'GET', daten, headers = {} } = {}) => {
    const antwort = await fetch(`${basis}${pfad}`, {
      method: methode,
      headers: { ...(daten ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: daten ? JSON.stringify(daten) : undefined,
    });
    const text = await antwort.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: antwort.status, json, text, headers: antwort.headers };
  };
  const stoppe = async () => {
    await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(uploadVerzeichnis, { recursive: true, force: true });
  };
  return { api, stoppe, db };
}
