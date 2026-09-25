import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { ladeKonfiguration } from '../server/config.js';
import { erstelleApp } from '../server/app.js';

const PASSWORT = 'sehr-geheimes-passwort';
let server;
let admin;
let nutzer;

before(async () => {
  server = await starteTestServer({ env: { STORAGE_QUOTA_MB: '1024' } });
  admin = await server.registriere('chefin');
  nutzer = await server.registriere('sammler');
});
after(async () => { await server.stoppe(); });

const speichern = (daten) => admin.api('/api/admin/einstellungen', { methode: 'PUT', daten });
const eintrag = async (schluessel) => (await admin.api('/api/admin/einstellungen')).json.einstellungen.find((e) => e.schluessel === schluessel);

test('Nur Administratoren sehen und ändern die Einstellungen', async () => {
  assert.equal((await nutzer.api('/api/admin/einstellungen')).status, 403);
  const antwort = await admin.api('/api/admin/einstellungen');
  assert.equal(antwort.status, 200);
  assert.ok(antwort.json.nurEnv.includes('APP_SECRET'));
  assert.ok(!antwort.json.einstellungen.some((e) => e.schluessel === 'APP_SECRET' || e.schluessel === 'DATABASE_PATH'));
  assert.equal((await eintrag('STORAGE_QUOTA_MB')).herkunft, 'env');
  assert.equal((await eintrag('PUBLIC_URL')).herkunft, 'standard');
});

test('Einfache Werte wirken sofort ohne Neustart', async () => {
  const antwort = await speichern({ werte: { STORAGE_QUOTA_MB: '5', PUBLIC_URL: 'https://sammlung.example.de/' } });
  assert.equal(antwort.status, 200, antwort.text);
  assert.deepEqual(antwort.json.geaendert.sort(), ['PUBLIC_URL', 'STORAGE_QUOTA_MB']);
  assert.equal((await nutzer.api('/api/konto/speicher')).json.limit, 5 * 1024 * 1024);
  assert.equal((await eintrag('STORAGE_QUOTA_MB')).herkunft, 'web');
  assert.equal((await eintrag('PUBLIC_URL')).wert, 'https://sammlung.example.de');
  const robots = await (await fetch(`${server.basis}/robots.txt`)).text();
  assert.match(robots, /Sitemap: https:\/\/sammlung\.example\.de\/sitemap\.xml/);

  const falsch = await speichern({ werte: { STORAGE_QUOTA_MB: 'viel', APP_SECRET: 'x' } });
  assert.equal(falsch.status, 400);
  assert.ok(falsch.json.felder.STORAGE_QUOTA_MB);
  assert.match(falsch.json.felder.APP_SECRET, /nur in der \.env/);

  // Zurück auf den .env-Wert
  assert.equal((await speichern({ zuruecksetzen: ['STORAGE_QUOTA_MB'] })).status, 200);
  assert.equal((await nutzer.api('/api/konto/speicher')).json.limit, 1024 * 1024 * 1024);
  assert.equal((await eintrag('STORAGE_QUOTA_MB')).herkunft, 'env');
});

test('Sicherheitsrelevante Änderungen nur mit Passwort', async () => {
  const ohne = await speichern({ werte: { REGISTRATION_OPEN: 'false' } });
  assert.equal(ohne.status, 403);
  assert.equal(ohne.json.code, 'bestaetigung_noetig');
  assert.equal((await speichern({ werte: { REGISTRATION_OPEN: 'false' }, passwort: 'falsch-falsch-falsch' })).status, 403);
  assert.equal((await speichern({ werte: { REGISTRATION_OPEN: 'false' }, passwort: PASSWORT })).status, 200);

  const gast = server.client();
  assert.equal((await gast.api('/api/auth/status')).json.registrierungOffen, false);
  const reg = await gast.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: 'neuling', passwort: PASSWORT, bedingungen_akzeptiert: true } });
  assert.equal(reg.status, 403);

  assert.equal((await speichern({ zuruecksetzen: ['REGISTRATION_OPEN'], passwort: PASSWORT })).status, 200);
  assert.equal((await gast.api('/api/auth/status')).json.registrierungOffen, true);
});

test('API-Schlüssel werden verschlüsselt gespeichert, nie im Klartext ausgeliefert und aktivieren Dienste live', async () => {
  const schluessel = 'sk-sehr-geheimer-schluessel-9876';
  assert.equal(server.kontext.ki.aktiv, false);
  const antwort = await speichern({ werte: { AI_PROVIDER: 'anthropic', AI_API_KEY: schluessel }, passwort: PASSWORT });
  assert.equal(antwort.status, 200, antwort.text);
  assert.ok(!antwort.text.includes(schluessel));
  assert.equal(server.kontext.ki.aktiv, true, 'KI-Dienst wurde neu aufgebaut');
  assert.equal(server.kontext.konfiguration.ki.apiKey, schluessel);

  const e = await eintrag('AI_API_KEY');
  assert.equal(e.wert, null);
  assert.equal(e.maskiert, '••••9876');
  const zeile = server.db.prepare("SELECT wert, verschluesselt FROM server_einstellungen WHERE schluessel = 'AI_API_KEY'").get();
  assert.equal(zeile.verschluesselt, 1);
  assert.ok(!zeile.wert.includes(schluessel));

  // Leeres Feld = unverändert
  assert.deepEqual((await speichern({ werte: { AI_API_KEY: '' } })).json.geaendert, []);

  // Protokoll ohne Klartext
  const protokoll = (await admin.api('/api/admin/einstellungen')).json.protokoll;
  assert.ok(protokoll.some((p) => p.schluessel === 'AI_API_KEY' && p.neu === '••••9876'));
  assert.ok(!JSON.stringify(protokoll).includes(schluessel));

  // Nach einem Neustart (gleiche Datenbank, gleiches APP_SECRET) gilt die Einstellung weiter
  const { kontext } = erstelleApp(ladeKonfiguration({ DATABASE_PATH: ':memory:', UPLOAD_DIR: server.kontext.konfiguration.uploadVerzeichnis, APP_SECRET: 'test-geheimnis' }), { db: server.db });
  assert.equal(kontext.konfiguration.ki.apiKey, schluessel);
  assert.equal(kontext.ki.aktiv, true);

  // Entfernen
  assert.equal((await speichern({ entfernen: ['AI_API_KEY'], passwort: PASSWORT })).status, 200);
  assert.equal(server.kontext.ki.aktiv, false);
  assert.equal((await eintrag('AI_API_KEY')).gesetzt, false);
});
