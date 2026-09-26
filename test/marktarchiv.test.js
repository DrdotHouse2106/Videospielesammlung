import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let anna;
let ben;
let spiel;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });
const archiv = () => server.db.prepare('SELECT * FROM markt_angebote ORDER BY id').all();

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

test('Archiv begleitet eine Anzeige von Einstellen bis Verkauf – ohne Anbieter', async () => {
  await put(ben, `/api/boerse/wunschliste/${spiel.id}`, { max_preis: '70' });
  const a = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '80', zustand: 'gut', vollstaendigkeit: 'cib', plz_bereich: '40213' })).json;
  let [z] = archiv();
  assert.equal(z.angebot_id, a.id);
  assert.equal(z.preis_start, 80);
  assert.equal(z.beendet_am, null);
  assert.equal(z.gewerblich, 0);
  assert.ok(!('benutzer_id' in z) && !('plz_bereich' in z) && !('beschreibung' in z), 'keine personenbezogenen Spalten');

  // Preis senken (erzeugt Treffer), Aufruf und Anfrage
  await put(anna, `/api/boerse/angebote/${a.id}`, { preis: '65' });
  await ben.api(`/api/boerse/angebote/${a.id}`);
  await post(ben, `/api/boerse/angebote/${a.id}/anfrage`, { text: 'Noch da?' });
  await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'reserviert' });
  await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'verkauft' });
  [z] = archiv();
  assert.deepEqual(
    { start: z.preis_start, ende: z.preis_ende, min: z.preis_min, max: z.preis_max, aenderungen: z.preisaenderungen },
    { start: 80, ende: 65, min: 65, max: 80, aenderungen: 1 },
  );
  assert.deepEqual({ aufrufe: z.aufrufe, anfragen: z.anfragen, treffer: z.treffer }, { aufrufe: 1, anfragen: 1, treffer: 1 });
  assert.equal(z.ergebnis, 'verkauft');
  assert.equal(z.beendet_am, new Date().toISOString().slice(0, 10));

  // Wieder einstellen = neue Anzeige; Löschen beendet sie und trennt die Verbindung
  await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'aktiv', preis: '70' });
  assert.equal(archiv().length, 2);
  assert.equal(archiv()[1].preis_start, 70);
  await anna.api(`/api/boerse/angebote/${a.id}`, { methode: 'DELETE' });
  const [erste, zweite] = archiv();
  assert.equal(erste.ergebnis, 'verkauft', 'Ergebnis der ersten Anzeige bleibt');
  assert.equal(zweite.ergebnis, 'geloescht');
  assert.equal(erste.angebot_id, null);
  assert.equal(zweite.angebot_id, null);
});

test('Ablauf, Konto-Löschung und tägliche Nachfrage', async () => {
  const r = await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '50', zustand: 'gut', vollstaendigkeit: 'nur_geraet' });
  assert.equal(r.status, 201, r.text);
  const alt = r.json;
  const bleibt = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '55', zustand: 'gut', vollstaendigkeit: 'nur_geraet' })).json;
  server.db.prepare("UPDATE angebote SET laeuft_ab = '2000-01-01 00:00:00' WHERE id = ?").run(alt.id);
  server.kontext.boerse.raeumeAuf();
  server.kontext.boerse.raeumeAuf(); // zweiter Lauf am selben Tag: keine doppelten Nachfrage-Werte
  assert.equal(archiv().find((z) => z.angebot_id === alt.id).ergebnis, 'abgelaufen');

  const nachfrage = server.db.prepare('SELECT * FROM markt_nachfrage').all();
  assert.equal(nachfrage.length, 1);
  assert.deepEqual(
    { katalog: nachfrage[0].katalog_id, suchende: nachfrage[0].suchende, preis: nachfrage[0].max_preis_schnitt, aktiv: nachfrage[0].angebote_aktiv, min: nachfrage[0].preis_min },
    { katalog: spiel.id, suchende: 1, preis: 70, aktiv: 1, min: 55 },
  );

  // Konto löschen: persönliche Statistik weg, anonymes Archiv bleibt
  const vorher = archiv().length;
  assert.equal((await anna.api('/api/konto', { methode: 'DELETE', daten: { passwort: 'sehr-geheimes-passwort' } })).status, 204);
  assert.equal(archiv().length, vorher);
  assert.ok(archiv().every((z) => z.angebot_id === null));
  assert.equal(archiv().find((z) => z.preis_start === 55).ergebnis, 'geloescht');
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM boerse_statistik').get().n, 0);
  assert.ok(bleibt.id);
});

test('Marktdaten nur für Administratoren: Übersicht und CSV', async () => {
  assert.equal((await ben.api('/api/admin/marktdaten')).status, 403);
  const d = (await admin.api('/api/admin/marktdaten')).json;
  assert.equal(d.anzeigen, 4);
  assert.equal(d.verkauft, 1);
  assert.equal(d.top[0].titel, 'Super Metroid');
  assert.equal(d.top[0].preis_schnitt, 65);
  assert.equal(d.verlauf.at(-1).neu, 4);

  const csv = await admin.api('/api/admin/marktdaten/angebote.csv');
  assert.equal(csv.status, 200);
  const zeilen = csv.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(zeilen.length, 5);
  assert.match(zeilen[0], /^id;katalog_id;titel;/);
  assert.doesNotMatch(csv.text, /anna|ben|40213/);
  const leer = await admin.api('/api/admin/marktdaten/angebote.csv?von=2999-01-01');
  assert.equal(leer.text.trim().split('\r\n').length, 1);
  const n = await admin.api('/api/admin/marktdaten/nachfrage.csv');
  assert.match(n.text, /Super Metroid/);
});
