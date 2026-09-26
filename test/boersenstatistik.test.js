import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let anna;
let ben;
let spiel;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

test('Statistik zählt Aufrufe, Anfragen und Treffer ohne Personenbezug', async () => {
  await ben.api(`/api/boerse/wunschliste/${spiel.id}`, { methode: 'PUT', daten: {} });
  const angebot = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '60', zustand: 'gut', vollstaendigkeit: 'cib' })).json;

  // Mehrfache Aufrufe derselben Person zählen einmal, eigene und Bot-Aufrufe gar nicht
  await ben.api(`/api/boerse/angebote/${angebot.id}`);
  await ben.api(`/api/boerse/angebote/${angebot.id}`);
  await anna.api(`/api/boerse/angebote/${angebot.id}`);
  await admin.api(`/api/boerse/angebote/${angebot.id}`, { headers: { 'User-Agent': 'Googlebot/2.1' } });
  await admin.api(`/api/boerse/angebote/${angebot.id}`);

  // Zwei Nachrichten in derselben Unterhaltung = eine Anfrage
  await post(ben, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Noch da?' });
  await post(ben, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Versand möglich?' });

  // Ohne Händler-Paket nur die Vorschau mit Gesamtzahlen
  const vorschau = (await anna.api('/api/boerse/statistik?tage=7')).json;
  assert.equal(vorschau.gesperrt, true);
  assert.deepEqual(vorschau.gesamt, { aufrufe: 2, anfragen: 1, treffer: 1 });
  assert.equal(vorschau.verlauf, undefined);
  assert.equal(vorschau.angebote, undefined);

  // Mit Paket (hier Testzugang durch den Administrator) die volle Auswertung
  await anna.api('/api/boerse/haendler', { methode: 'PUT', daten: { firma: 'Annas Retroladen', anschrift: 'Musterstraße 1, 40213 Düsseldorf', email: 'anna@example.org' } });
  await post(admin, '/api/admin/benutzer/2/haendler', { verifiziert: true });
  assert.equal((await post(admin, '/api/admin/benutzer/2/testzugang', { tage: 30 })).status, 200);
  const s = (await anna.api('/api/boerse/statistik?tage=7')).json;
  assert.equal(s.gesperrt, false);
  assert.equal(s.tage, 7);
  assert.equal(s.verlauf.length, 7);
  assert.deepEqual(s.gesamt, { aufrufe: 2, anfragen: 1, treffer: 1 });
  assert.deepEqual(s.verlauf.at(-1), { tag: new Date().toISOString().slice(0, 10), aufrufe: 2, anfragen: 1, treffer: 1 });
  assert.equal(s.angebote.length, 1);
  assert.equal(s.angebote[0].titel, 'Super Metroid');
  assert.equal(s.angebote[0].quote, 50);
  assert.equal(s.gefragt[0].gesucht_von, 1);

  // Andere sehen nur ihre eigenen Zahlen; ungültiger Zeitraum → 30 Tage
  const fremd = (await admin.api('/api/boerse/statistik?tage=12345')).json;
  assert.equal(fremd.gesperrt, false, 'Administratoren sehen immer die volle Ansicht');
  assert.equal(fremd.tage, 30);
  assert.deepEqual(fremd.gesamt, { aufrufe: 0, anfragen: 0, treffer: 0 });
  assert.equal(fremd.angebote.length, 0);

  // Nur Zähler, keine Besucherdaten in der Datenbank
  const spalten = server.db.prepare('PRAGMA table_info(boerse_statistik)').all().map((c) => c.name);
  assert.deepEqual(spalten.sort(), ['anfragen', 'angebot_id', 'aufrufe', 'benutzer_id', 'tag', 'treffer']);

  // Verlauf bleibt nach dem Löschen des Angebots erhalten
  assert.equal((await anna.api(`/api/boerse/angebote/${angebot.id}`, { methode: 'DELETE' })).status, 204);
  const danach = (await anna.api('/api/boerse/statistik?tage=7')).json;
  assert.equal(danach.gesamt.aufrufe, 2);
  assert.equal(danach.angebote[0].geloescht, true);

  // Teil der Datenauskunft
  const auskunft = (await anna.api('/api/export/datenauskunft.json')).json;
  assert.equal(auskunft.tauschboerse.statistik.length, 1);

  // Alte Werte bleiben erhalten; „Gesamt“ zeigt Monatswerte ab dem ersten Tag
  server.db.prepare("INSERT INTO boerse_statistik (angebot_id, benutzer_id, tag, aufrufe) VALUES (999, 2, date('now', '-500 days'), 5)").run();
  server.kontext.boerse.raeumeAuf();
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM boerse_statistik WHERE angebot_id = 999').get().n, 1);
  const alles = (await anna.api('/api/boerse/statistik?tage=0')).json;
  assert.equal(alles.tage, 0);
  assert.equal(alles.einheit, 'monat');
  assert.equal(alles.gesamt.aufrufe, 7);
  assert.equal(alles.vorher, null);
  assert.ok(alles.verlauf.length >= 16 && alles.verlauf.length <= 18, `${alles.verlauf.length} Monate`);
  assert.equal(alles.verlauf.reduce((n, m) => n + m.aufrufe, 0), 7);
});
