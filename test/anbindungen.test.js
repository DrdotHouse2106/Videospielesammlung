import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { istInterneAdresse } from '../server/services/anbindungen.js';

let server;
let admin;
let shop;
let shopId;
const abrufe = [];

// Nachgebildete Shopware-6-API und ein CSV-Feed
async function fetchFn(url, optionen = {}) {
  abrufe.push({ url: String(url), optionen });
  const json = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
  if (String(url) === 'https://shop.example.com/api/oauth/token') {
    const body = JSON.parse(optionen.body);
    return body.client_secret === 'richtig' ? json({ access_token: 'tok', expires_in: 600 }) : json({ errors: [] }, 401);
  }
  if (String(url) === 'https://shop.example.com/api/search/product') {
    assert.equal(optionen.headers.Authorization, 'Bearer tok');
    return json({
      data: [
        { productNumber: 'SW-1', ean: null, name: 'Super Metroid', stock: 3, availableStock: 2, price: [{ gross: 59.9 }], customFields: { zockdb_id: String(globalThis.metroidId), zockdb_zustand: 'sehr gut' } },
        { productNumber: 'SW-2', ean: '4012345678901', name: 'Irgendwas', stock: 1, price: [{ gross: 10 }], customFields: {} },
      ],
    });
  }
  if (String(url) === 'https://feed.example.com/export.csv') {
    return new Response('Artikelnummer;ZockDB-ID;Preis;Bestand\nCSV-1;' + globalThis.metroidId + ';49,00;1\n', { status: 200 });
  }
  if (String(url) === 'https://umleitung.example.com/x.csv') return new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/' } });
  return new Response('nicht gefunden', { status: 404 });
}

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });

before(async () => {
  server = await starteTestServer({ fetchFn, env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  server.kontext.anbindungen.setzeLookup(async (host) => (host === 'intern.example.com' ? [{ address: '192.168.1.10' }] : [{ address: '93.184.216.34' }]));
  admin = await server.registriere('admin');
  shop = await server.registriere('shop');
  globalThis.metroidId = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json.id;
  await put(shop, '/api/boerse/haendler', { firma: 'Shop GmbH', anschrift: 'Weg 1, 12345 Ort', email: 'info@shop.example' });
  shopId = server.db.prepare("SELECT id FROM benutzer WHERE benutzername = 'shop'").get().id;
  await post(admin, `/api/admin/benutzer/${shopId}/haendler`, { verifiziert: true });
});
after(async () => { await server.stoppe(); });

test('Interne Adressen werden erkannt', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.5', '169.254.169.254', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) {
    assert.equal(istInterneAdresse(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '2a00:1450:4001:80b::200e']) assert.equal(istInterneAdresse(ip), false, ip);
});

test('Anbindung nur mit Händler-Pro', async () => {
  const r = await put(shop, '/api/boerse/haendler/anbindung', { typ: 'csv_url', url: 'https://feed.example.com/export.csv' });
  assert.equal(r.status, 402);
  assert.equal(r.json.code, 'kein_pro');
  // Abgelaufenes Pro zählt nicht
  await post(admin, `/api/admin/benutzer/${shopId}/pro`, { bis: '2000-01-01' });
  assert.equal((await put(shop, '/api/boerse/haendler/anbindung', { typ: 'csv_url', url: 'https://feed.example.com/export.csv' })).status, 402);
  await post(admin, `/api/admin/benutzer/${shopId}/pro`, { bis: '2099-12-31' });
  const n = (await shop.api('/api/benachrichtigungen')).json.eintraege;
  assert.ok(n.some((b) => b.titel === 'Händler-Pro ist freigeschaltet'));
});

test('Shopware 6: Zugang verschlüsselt, Test und Abgleich', async () => {
  let r = await put(shop, '/api/boerse/haendler/anbindung', { typ: 'shopware6', url: 'http://shop.example.com', client_id: 'SWIA1', client_secret: 'richtig' });
  assert.equal(r.status, 400, 'nur https');
  r = await put(shop, '/api/boerse/haendler/anbindung', { typ: 'shopware6', url: 'https://shop.example.com', client_id: 'SWIA1', client_secret: 'richtig', beende_fehlende: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.geheimnis_gesetzt, true);
  assert.ok(!('client_secret' in r.json), 'Geheimnis wird nie ausgeliefert');
  const gespeichert = server.db.prepare('SELECT zugang FROM haendler_anbindungen').get().zugang;
  assert.ok(!gespeichert.includes('richtig'), 'Zugang liegt verschlüsselt in der Datenbank');

  // Leeres Geheimnis beim Speichern behält das bisherige
  r = await put(shop, '/api/boerse/haendler/anbindung', { typ: 'shopware6', url: 'https://shop.example.com', client_id: 'SWIA1', client_secret: '', intervall_stunden: 12, beende_fehlende: true });
  assert.equal(r.json.intervall_stunden, 12);

  r = await post(shop, '/api/boerse/haendler/anbindung/test', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.artikel, 2);

  r = await post(shop, '/api/boerse/haendler/anbindung/abgleich', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.angelegt, 1);
  assert.equal(r.json.uebersprungen, 1);
  const a = (await shop.api('/api/boerse/meine')).json.angebote.find((x) => x.sku === 'SW-1');
  assert.equal(a.preis, 59.9);
  assert.equal(a.anzahl, 2);
  assert.equal(a.zustand, 'sehr_gut');
  assert.equal((await shop.api('/api/boerse/haendler/anbindung')).json.letztes_ergebnis.angelegt, 1);

  // Falsche Zugangsdaten → verständlicher Fehler, wird gespeichert
  await put(shop, '/api/boerse/haendler/anbindung', { typ: 'shopware6', url: 'https://shop.example.com', client_id: 'SWIA1', client_secret: 'falsch' });
  r = await post(shop, '/api/boerse/haendler/anbindung/abgleich', {});
  assert.equal(r.status, 400);
  assert.match(r.json.fehler, /Zugangsdaten/);
  assert.match((await shop.api('/api/boerse/haendler/anbindung')).json.letzter_fehler, /Zugangsdaten/);
});

test('CSV-Feed, Schutz vor internen Zielen und Weiterleitungen, Zeitsteuerung', async () => {
  await put(shop, '/api/boerse/haendler/anbindung', { typ: 'csv_url', url: 'https://intern.example.com/export.csv' });
  let r = await post(shop, '/api/boerse/haendler/anbindung/test', {});
  assert.equal(r.status, 400);
  assert.match(r.json.fehler, /internen Netz/);

  await put(shop, '/api/boerse/haendler/anbindung', { typ: 'csv_url', url: 'https://umleitung.example.com/x.csv' });
  r = await post(shop, '/api/boerse/haendler/anbindung/test', {});
  assert.equal(r.status, 400);
  assert.match(r.json.fehler, /leitet weiter/);
  assert.equal(abrufe.at(-1).optionen.redirect, 'manual');

  await put(shop, '/api/boerse/haendler/anbindung', { typ: 'csv_url', url: 'https://feed.example.com/export.csv' });
  assert.equal(await server.kontext.anbindungen.lauf(), 1, 'fällige Anbindung wird abgeglichen');
  assert.equal(await server.kontext.anbindungen.lauf(), 0, 'danach erst nach dem Intervall wieder');
  const meine = (await shop.api('/api/boerse/meine')).json.angebote;
  assert.ok(meine.some((x) => x.sku === 'CSV-1' && x.preis === 49));

  // Ohne Pro kein automatischer Abgleich
  await post(admin, `/api/admin/benutzer/${shopId}/pro`, { bis: null });
  server.db.prepare('UPDATE haendler_anbindungen SET letzter_lauf = NULL').run();
  assert.equal(await server.kontext.anbindungen.lauf(), 0);
});
