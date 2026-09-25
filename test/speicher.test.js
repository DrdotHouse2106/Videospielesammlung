import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let nutzer;
let artikel;

// Rauschen lässt sich kaum komprimieren – so entstehen verlässlich große Dateien (~600 KB)
const rauschen = () => sharp(crypto.randomBytes(500 * 400 * 3), { raw: { width: 500, height: 400, channels: 3 } }).png().toBuffer();

async function hochladen(client, artikelId, puffer, felder = { art: 'cover_vorne', sichtbarkeit: 'privat' }) {
  const formular = new FormData();
  for (const [k, v] of Object.entries(felder)) formular.append(k, v);
  formular.append('datei', new Blob([puffer], { type: 'image/png' }), 'scan.png');
  return client.api(`/api/artikel/${artikelId}/medien`, { methode: 'POST', formular });
}

before(async () => {
  server = await starteTestServer({ env: { STORAGE_QUOTA_MB: '1' } });
  admin = await server.registriere('chefin'); // erster Benutzer = Administrator
  nutzer = await server.registriere('sammler');
  artikel = (await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Speichertest', plattform: 'SNES' } })).json;
});
after(async () => { await server.stoppe(); });

test('Speicherkontingent: Uploads über dem Limit werden abgelehnt, Löschen gibt Platz frei', async () => {
  let konto = (await nutzer.api('/api/konto')).json;
  assert.equal(konto.speicher.belegt, 0);
  assert.equal(konto.speicher.limit, 1024 * 1024);

  const erster = await hochladen(nutzer, artikel.id, await rauschen());
  assert.equal(erster.status, 201, erster.text);
  konto = (await nutzer.api('/api/konto')).json;
  assert.ok(konto.speicher.belegt > 500 * 1024, 'Original und Vorschau werden gezählt');

  const zweiter = await hochladen(nutzer, artikel.id, await rauschen());
  assert.equal(zweiter.status, 413, zweiter.text);
  assert.equal(zweiter.json.code, 'speicher_voll');
  assert.match(zweiter.json.fehler, /Speicherplatz ist voll \(1 MB\)/);
  // Die abgelehnte Datei bleibt nicht liegen
  const belegtDanach = (await nutzer.api('/api/konto/speicher')).json.belegt;
  assert.equal(belegtDanach, konto.speicher.belegt);

  // Auch Artikelfotos zählen zum Kontingent
  const formular = new FormData();
  formular.append('bild', new Blob([await rauschen()], { type: 'image/png' }), 'foto.png');
  const foto = await nutzer.api(`/api/artikel/${artikel.id}/bild`, { methode: 'POST', formular });
  assert.equal(foto.status, 413, foto.text);

  assert.equal((await nutzer.api(`/api/medien/${erster.json.id}`, { methode: 'DELETE' })).status, 204);
  assert.equal((await nutzer.api('/api/konto/speicher')).json.belegt, 0);
  assert.equal((await hochladen(nutzer, artikel.id, await rauschen())).status, 201);
});

test('Freigegebene Scans belasten das Kontingent nicht mehr', async () => {
  const vorher = (await nutzer.api('/api/konto/speicher')).json.belegt;
  const liste = (await nutzer.api(`/api/katalog/${(await nutzer.api(`/api/artikel/${artikel.id}`)).json.katalog_id}/medien`)).json;
  await nutzer.api(`/api/medien/${liste[0].id}`, { methode: 'PUT', daten: { sichtbarkeit: 'eingereicht' } });
  assert.equal((await nutzer.api('/api/konto/speicher')).json.belegt, vorher);
  const frei = await admin.api(`/api/moderation/medien/${liste[0].id}/freigeben`, { methode: 'POST', daten: {} });
  assert.equal(frei.status, 200, frei.text);
  assert.equal((await nutzer.api('/api/konto/speicher')).json.belegt, 0);
});

test('Administrator kann das Limit je Benutzer anpassen, Admins sind standardmäßig unbegrenzt', async () => {
  assert.equal((await admin.api('/api/konto')).json.speicher.limit, null);
  const liste = (await admin.api('/api/admin/benutzer')).json;
  const eintrag = liste.find((b) => b.benutzername === 'sammler');
  assert.equal(eintrag.speicher.limit, 1024 * 1024);

  assert.equal((await admin.api(`/api/admin/benutzer/${eintrag.id}`, { methode: 'PUT', daten: { speicher_limit_mb: -3 } })).status, 400);
  assert.equal((await admin.api(`/api/admin/benutzer/${eintrag.id}`, { methode: 'PUT', daten: { speicher_limit_mb: 0 } })).status, 200);
  assert.equal((await nutzer.api('/api/konto/speicher')).json.limit, null);
  for (let i = 0; i < 3; i++) assert.equal((await hochladen(nutzer, artikel.id, await rauschen())).status, 201);

  await admin.api(`/api/admin/benutzer/${eintrag.id}`, { methode: 'PUT', daten: { speicher_limit_mb: null } });
  const info = (await nutzer.api('/api/konto/speicher')).json;
  assert.equal(info.limit, 1024 * 1024);
  assert.equal(info.frei, 0);
  assert.equal((await hochladen(nutzer, artikel.id, await rauschen())).status, 413);

  const uebersicht = (await admin.api('/api/admin/uebersicht')).json;
  assert.ok(uebersicht.speicher.gesamt >= info.belegt);
  assert.equal(uebersicht.speicher.standardMb, 1);
});
