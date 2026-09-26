import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let anna; // Verkäuferin
let ben; // Käufer
let carl; // weiterer Interessent
let spiel;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });
const markt = (angebotId) => server.db.prepare('SELECT * FROM markt_angebote WHERE angebot_id = ? ORDER BY id DESC').get(angebotId);

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  carl = await server.registriere('carl');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Chrono Trigger', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

async function angebotMitAnfrage(preis = '80') {
  const a = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis, zustand: 'gut', vollstaendigkeit: 'cib' })).json;
  const uid = (await post(ben, `/api/boerse/angebote/${a.id}/anfrage`, { text: 'Würdest du 65 € nehmen?' })).json.unterhaltung_id;
  await post(anna, `/api/boerse/nachrichten/${uid}`, { text: 'Für 70 € ist es deins.' });
  return { a, uid };
}

test('Verkäufer meldet Preis und Käufer, Käufer bestätigt mit tatsächlichem Preis', async () => {
  const { a, uid } = await angebotMitAnfrage();
  const eigen = (await anna.api(`/api/boerse/angebote/${a.id}`)).json;
  assert.deepEqual(eigen.interessenten.map((i) => i.name), ['ben']);
  assert.equal(eigen.verkauf, null);

  // Ungültig: Unterhaltung eines fremden Angebots → nichts ändert sich
  let r = await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'verkauft', verkauf: { preis: '70', unterhaltung_id: 999 } });
  assert.equal(r.status, 400);
  assert.equal((await anna.api(`/api/boerse/angebote/${a.id}`)).json.status, 'aktiv', 'Transaktion: Status bleibt unverändert');
  // Ungültig: Verkauf ohne Preis
  r = await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'verkauft', verkauf: { unterhaltung_id: uid } });
  assert.equal(r.status, 400);
  assert.match(r.json.felder.preis, /Verkaufspreis/);

  r = await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'verkauft', verkauf: { preis: '70', unterhaltung_id: uid } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.verkauf.status, 'gemeldet');
  assert.equal(r.json.verkauf.preis, 70);
  let m = markt(a.id);
  assert.deepEqual({ p: m.verkaufspreis, s: m.verkauf_status, z: m.ueber_zockdb, e: m.ergebnis }, { p: 70, s: 'gemeldet', z: 1, e: 'verkauft' });

  // Käufer wird benachrichtigt und sieht die Bestätigung in der Unterhaltung
  const n = (await ben.api('/api/benachrichtigungen')).json.eintraege.find((b) => /gekauft\?/.test(b.titel));
  assert.equal(n.link, `#/nachrichten/${uid}`);
  let u = (await ben.api(`/api/boerse/nachrichten/${uid}`)).json;
  assert.equal(u.verkauf.ich_kaeufer, true);
  assert.equal(u.verkauf.status, 'gemeldet');
  assert.equal((await anna.api(`/api/boerse/nachrichten/${uid}`)).json.verkauf.ich_kaeufer, false);

  // Andere dürfen nicht bestätigen; Käufer bestätigt mit tatsächlich gezahltem Preis
  assert.equal((await post(carl, `/api/boerse/verkaeufe/${u.verkauf.id}/bestaetigen`, { gekauft: true })).status, 404);
  assert.equal((await post(anna, `/api/boerse/verkaeufe/${u.verkauf.id}/bestaetigen`, { gekauft: true })).status, 404);
  r = await post(ben, `/api/boerse/verkaeufe/${u.verkauf.id}/bestaetigen`, { gekauft: true, preis: '68,50' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.status, 'bestaetigt');
  assert.equal((await post(ben, `/api/boerse/verkaeufe/${u.verkauf.id}/bestaetigen`, { gekauft: true })).status, 409);
  m = markt(a.id);
  assert.deepEqual({ p: m.verkaufspreis, s: m.verkauf_status }, { p: 68.5, s: 'bestaetigt' });
  assert.ok((await anna.api('/api/benachrichtigungen')).json.eintraege.some((b) => /bestätigt/.test(b.titel)));

  // Doppelt melden geht nicht
  assert.equal((await post(anna, `/api/boerse/angebote/${a.id}/verkauf`, { preis: '70' })).status, 409);

  // Datenauskunft enthält den Kauf für beide Seiten
  const auskunft = (await ben.api('/api/export/datenauskunft.json')).json;
  assert.equal(auskunft.tauschboerse.verkaeufe[0].rolle, 'kaeufer');
  assert.equal(auskunft.tauschboerse.verkaeufe[0].kaeufer_preis, 68.5);
});

test('Nachtragen, Verkauf außerhalb und bestrittener Kauf', async () => {
  // Ohne Angaben als verkauft markiert → später nachtragen, Käufer außerhalb von ZockDB
  const x = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '90', zustand: 'gut', vollstaendigkeit: 'cib' })).json;
  await put(anna, `/api/boerse/angebote/${x.id}`, { status: 'verkauft' });
  assert.equal(markt(x.id).verkauf_status, null, 'ohne Meldung nur Angebotspreis');
  assert.equal((await post(ben, `/api/boerse/angebote/${x.id}/verkauf`, { preis: '85' })).status, 404, 'nur der Anbieter');
  const r = await post(anna, `/api/boerse/angebote/${x.id}/verkauf`, { preis: '85', extern: true });
  assert.equal(r.status, 201, r.text);
  const m = markt(x.id);
  assert.deepEqual({ p: m.verkaufspreis, s: m.verkauf_status, z: m.ueber_zockdb }, { p: 85, s: 'gemeldet', z: 0 });

  // Bestritten: zählt nicht als Verkauf in der Auswertung
  const { a, uid } = await angebotMitAnfrage('500');
  await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'verkauft', verkauf: { preis: '500', unterhaltung_id: uid } });
  const v = (await ben.api(`/api/boerse/nachrichten/${uid}`)).json.verkauf;
  assert.equal((await post(ben, `/api/boerse/verkaeufe/${v.id}/bestaetigen`, { gekauft: false })).json.status, 'bestritten');
  assert.equal(markt(a.id).verkauf_status, 'bestritten');
  const d = (await admin.api('/api/admin/marktdaten')).json;
  const top = d.top.find((t) => t.titel === 'Chrono Trigger');
  assert.equal(top.verkauft, 2, 'bestrittener Verkauf zählt nicht');
  assert.equal(top.preis_max, 85);
  assert.equal(top.bestaetigt, 1);
  assert.equal(d.bestaetigt, 1);

  // Nach dem Löschen bleibt der anonyme Verkaufspreis im Archiv
  await anna.api(`/api/boerse/angebote/${x.id}`, { methode: 'DELETE' });
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM markt_angebote WHERE verkaufspreis = 85 AND angebot_id IS NULL').get().n, 1);
});
