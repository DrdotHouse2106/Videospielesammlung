import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ladeKonfiguration } from '../server/config.js';
import { erstelleApp } from '../server/app.js';
import { oeffneDatenbank } from '../server/db.js';

/** Startet eine Test-Instanz mit In-Memory-Datenbank auf einem freien Port. */
export async function starteTestServer({ env = {}, fetchFn, kiAnbieterFn } = {}) {
  const uploadVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'vss-test-'));
  const konfiguration = ladeKonfiguration({
    UPLOAD_DIR: uploadVerzeichnis,
    DATABASE_PATH: ':memory:',
    BARCODE_PROVIDERS: '',
    APP_SECRET: 'test-geheimnis',
    REGISTRATIONS_PER_HOUR: '1000',
    ...env,
  });
  if (kiAnbieterFn) konfiguration.kiAnbieterFn = kiAnbieterFn;
  const { app, db, kontext } = erstelleApp(konfiguration, { db: oeffneDatenbank(':memory:'), fetchFn });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const basis = `http://127.0.0.1:${server.address().port}`;

  /** Ein „Browser“ mit eigenem Cookie-Speicher. */
  function client() {
    let cookie = '';
    const api = async (pfad, { methode = 'GET', daten, formular, headers = {} } = {}) => {
      const antwort = await fetch(`${basis}${pfad}`, {
        method: methode,
        headers: { ...(daten ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: formular ?? (daten ? JSON.stringify(daten) : undefined),
      });
      const gesetzt = antwort.headers.getSetCookie?.() ?? [];
      for (const c of gesetzt) cookie = c.split(';')[0].endsWith('=') ? '' : c.split(';')[0];
      const puffer = Buffer.from(await antwort.arrayBuffer());
      const text = puffer.toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
      return { status: antwort.status, json, text, puffer, headers: antwort.headers };
    };
    return { api, cookie: () => cookie };
  }

  /** Registriert ein Konto und liefert einen angemeldeten Client. */
  async function registriere(benutzername, passwort = 'sehr-geheimes-passwort') {
    const c = client();
    const antwort = await c.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername, passwort, bedingungen_akzeptiert: true } });
    if (antwort.status !== 201) throw new Error(`Registrierung fehlgeschlagen: ${antwort.text}`);
    return c;
  }

  const stoppe = async () => {
    await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(uploadVerzeichnis, { recursive: true, force: true });
  };
  return { client, registriere, stoppe, db, kontext, basis };
}
