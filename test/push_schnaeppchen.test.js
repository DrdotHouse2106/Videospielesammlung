import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let anna; // Verkäuferin
let ben; // Schnäppchenjäger ohne Frühzugang
let carl; // mit Frühzugang
let dora; // strengere Schwelle
let spiel;
const gesendet = [];
const weg = new Set(); // Endpunkte, die der Push-Dienst als abgelaufen meldet

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });
const warte = () => new Promise((r) => setTimeout(r, 30));
const id = (name) => server.db.prepare('SELECT id FROM benutzer WHERE benutzername = ?').get(name).id;

/** Ein „Browser“: Schlüsselpaar und Auth-Geheimnis wie bei PushManager.subscribe(). */
function geraet(endpunkt) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, abo: { endpoint: endpunkt, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } } };
}

/** Entschlüsselt eine Push-Nachricht so, wie es der Browser tut (RFC 8291). */
function entschluessele(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const geheim = body.subarray(21 + idlen);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(asPub), auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(geheim.subarray(-16));
  const klar = Buffer.concat([d.update(geheim.subarray(0, -16)), d.final()]);
  assert.equal(klar.at(-1), 2, 'Padding-Trenner des letzten Datensatzes');
  return JSON.parse(klar.subarray(0, -1).toString());
}

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0', PREMIUM_EARLY_MINUTES: '30' } });
  server.kontext.konfiguration.pushFetchFn = async (url, optionen) => {
    gesendet.push({ url, ...optionen });
    return new Response(null, { status: weg.has(url) ? 410 : 201 });
  };
  admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  carl = await server.registriere('carl');
  dora = await server.registriere('dora');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

test('Web-Push: Abo, verschlüsselte Nachricht, VAPID-Signatur, abgelaufene Abos', async () => {
  const { schluessel } = (await ben.api('/api/push/schluessel')).json;
  assert.equal(Buffer.from(schluessel, 'base64url').length, 65);
  assert.equal((await server.client().api('/api/push/schluessel')).status, 401, 'nur angemeldet');

  assert.equal((await post(ben, '/api/push', { abo: geraet('http://intern.example/push').abo })).status, 400, 'nur https');
  const handy = geraet('https://push.example.org/send/abc');
  assert.equal((await post(ben, '/api/push', { abo: handy.abo, geraet: 'Android' })).status, 201);
  assert.equal((await ben.api('/api/push/geraete')).json[0].geraet, 'Android');

  assert.equal((await post(ben, '/api/push/test', {})).json.gesendet, 1);
  const n = gesendet.at(-1);
  assert.equal(n.url, handy.abo.endpoint);
  assert.equal(n.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(n.headers.TTL, '86400');
  assert.equal(entschluessele(n.body, handy).titel, 'Push funktioniert 🎮');

  // VAPID: JWT für den Push-Dienst, signiert mit dem Server-Schlüssel
  const [, jwt, k] = n.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, schluessel);
  const [kopf, inhalt, signatur] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(inhalt, 'base64url')).aud, 'https://push.example.org');
  const roh = Buffer.from(k, 'base64url');
  const oeffentlich = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: roh.subarray(1, 33).toString('base64url'), y: roh.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${kopf}.${inhalt}`), { key: oeffentlich, dsaEncoding: 'ieee-p1363' }, Buffer.from(signatur, 'base64url')));

  // Jede Benachrichtigung geht auch als Push raus
  server.kontext.benachrichtigungen.sende(id('ben'), { art: 'boerse', titel: 'Neuer Treffer', text: 'Super Metroid', link: '#/boerse/angebot/1' });
  await warte();
  assert.deepEqual(entschluessele(gesendet.at(-1).body, handy), { titel: 'Neuer Treffer', text: 'Super Metroid', link: '#/boerse/angebot/1', tag: 'boerse' });

  // Abgelaufenes Abo wird entfernt
  weg.add(handy.abo.endpoint);
  assert.equal((await post(ben, '/api/push/test', {})).json.gesendet, 0);
  assert.equal((await ben.api('/api/push/geraete')).json.length, 0);
});

test('Schnäppchen-Alarm: Marktwert, Schwelle, Umfang, Frühzugang zuerst', async () => {
  // Marktwert aus drei echten Verkäufen: Median 100 €
  for (const preis of [95, 100, 110]) {
    server.db.prepare(`INSERT INTO markt_angebote (katalog_id, art, eingestellt_am, beendet_am, ergebnis, verkaufspreis, verkauf_status)
      VALUES (?, 'verkauf', date('now'), date('now'), 'verkauft', ?, 'bestaetigt')`).run(spiel.id, preis);
  }
  // Einstellungen prüfen
  assert.equal((await put(ben, '/api/schnaeppchen', { aktiv: true, schwelle: 95, umfang: 'alle' })).status, 400);
  assert.equal((await put(ben, '/api/schnaeppchen', { aktiv: true, schwelle: 60, umfang: 'plattformen', plattformen: [] })).status, 400);
  assert.equal((await put(ben, '/api/schnaeppchen', { aktiv: true, schwelle: 60, umfang: 'alle' })).status, 200);
  await put(dora, '/api/schnaeppchen', { aktiv: true, schwelle: 40, umfang: 'alle' });
  await put(carl, '/api/schnaeppchen', { aktiv: true, schwelle: 60, umfang: 'wunschliste' });
  await put(carl, `/api/boerse/wunschliste/${spiel.id}`, {});
  server.db.prepare("UPDATE benutzer SET fruehzugang_bis = date('now', '+30 days') WHERE id = ?").run(id('carl'));
  assert.ok((await carl.api('/api/schnaeppchen')).json.fruehzugang_bis);

  // Kein Schnäppchen: 90 % des Marktwerts
  const normal = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '90', zustand: 'gut', vollstaendigkeit: 'cib' })).json;
  // Schnäppchen: 50 %
  const guenstig = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '50', zustand: 'gut', vollstaendigkeit: 'cib' })).json;
  const schnaeppchenVon = async (c) => (await c.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.art === 'schnaeppchen');

  // Frühzugang: sofort; alle anderen erst nach der Wartezeit
  let carlN = await schnaeppchenVon(carl);
  assert.equal(carlN.length, 1);
  assert.match(carlN[0].titel, /Schnäppchen: Super Metroid \(SNES\) für 50,00/);
  assert.match(carlN[0].text, /50 % unter dem Marktwert von ca\. 100,00/);
  assert.equal(carlN[0].link, `#/boerse/angebot/${guenstig.id}`);
  assert.equal((await schnaeppchenVon(ben)).length, 0, 'ohne Frühzugang noch nicht');
  const plan = server.db.prepare('SELECT faellig_am FROM schnaeppchen_versand WHERE benutzer_id = ?').get(id('ben'));
  const vorsprung = (Date.parse(`${plan.faellig_am.replace(' ', 'T')}Z`) - Date.now()) / 60_000;
  assert.ok(vorsprung > 28 && vorsprung <= 30, `Vorsprung ${vorsprung} Minuten`);

  // Wartezeit abgelaufen
  server.db.prepare("UPDATE schnaeppchen_versand SET faellig_am = datetime('now', '-1 minute')").run();
  server.kontext.schnaeppchen.versende();
  assert.equal((await schnaeppchenVon(ben)).length, 1);
  assert.equal((await schnaeppchenVon(dora)).length, 0, 'Schwelle 40 % nicht erreicht');
  assert.equal((await schnaeppchenVon(anna)).length, 0, 'nie für eigene Angebote');
  assert.equal((await schnaeppchenVon(carl)).length, 1, 'nicht doppelt');

  // Abzeichen und Filter in der Börse
  const liste = (await ben.api('/api/boerse/angebote')).json.eintraege;
  assert.equal(liste.find((a) => a.id === guenstig.id).schnaeppchen_prozent, 50);
  assert.equal(liste.find((a) => a.id === normal.id).schnaeppchen_prozent, null);
  assert.deepEqual((await ben.api('/api/boerse/angebote?schnaeppchen=1')).json.eintraege.map((a) => a.id), [guenstig.id]);

  // Preis steigt → kein Schnäppchen mehr; verkaufte Angebote werden nicht mehr gemeldet
  await put(anna, `/api/boerse/angebote/${guenstig.id}`, { preis: '95' });
  assert.equal((await ben.api('/api/boerse/angebote?schnaeppchen=1')).json.eintraege.length, 0);
});
