import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { starteTestServer } from './hilfen.js';

let server;
let anna;
let ben;
let angebot;

const foto = (farbe = '#c00') => sharp({ create: { width: 2400, height: 1800, channels: 3, background: farbe } })
  .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'Anna', Make: 'Handy' } } }).toBuffer();

async function hochladen(c, id, anzahl = 1) {
  const formular = new FormData();
  for (let i = 0; i < anzahl; i++) formular.append('fotos', new Blob([await foto()], { type: 'image/jpeg' }), `foto${i}.jpg`);
  return c.api(`/api/boerse/angebote/${id}/fotos`, { methode: 'POST', formular });
}

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  const admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  const spiel = (await admin.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'Tetris', plattformen: ['Game Boy'], veroeffentlichen: true } })).json;
  angebot = (await anna.api('/api/boerse/angebote', { methode: 'POST', daten: { katalog_id: spiel.id, preis: 10 } })).json;
});
after(async () => { await server.stoppe(); });

test('Fotos hochladen: verkleinert, ohne Metadaten, Titelbild in der Liste', async () => {
  const r = await hochladen(anna, angebot.id, 2);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.fotos.length, 2);
  const bild = await anna.api(r.json.fotos[0].url);
  assert.equal(bild.status, 200);
  const meta = await sharp(bild.puffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.width <= 1600 && meta.height <= 1600, `${meta.width}x${meta.height}`);
  assert.equal(meta.exif, undefined, 'EXIF (z. B. GPS) entfernt');
  const vorschau = await sharp((await anna.api(r.json.fotos[0].vorschau)).puffer).metadata();
  assert.ok(vorschau.width <= 480);

  const liste = (await ben.api('/api/boerse/angebote')).json.eintraege;
  assert.equal(liste[0].foto, r.json.fotos[0].vorschau);
  assert.equal(liste[0].fotos_anzahl, 2);
  assert.equal((await ben.api('/api/boerse/angebote?mit_foto=1')).json.gesamt, 1);

  // Titelbild wechseln
  const zweites = r.json.fotos[1];
  const t = await anna.api(`/api/boerse/fotos/${zweites.id}/titelbild`, { methode: 'POST', daten: {} });
  assert.equal(t.json.fotos[0].id, zweites.id);
});

test('Sichtbarkeit, Rechte, Höchstzahl und Speicherkontingent', async () => {
  const url = (await ben.api(`/api/boerse/angebote/${angebot.id}`)).json.fotos[0].url;
  assert.equal((await ben.api(url)).status, 200, 'sichtbar, solange das Angebot aktiv ist');
  assert.equal((await server.client().api(url)).status, 401, 'nicht ohne Anmeldung');
  // Fremde dürfen keine Fotos hochladen oder löschen
  assert.equal((await hochladen(ben, angebot.id)).status, 404);
  const fotoId = (await anna.api(`/api/boerse/angebote/${angebot.id}`)).json.fotos[0].id;
  assert.equal((await ben.api(`/api/boerse/fotos/${fotoId}`, { methode: 'DELETE' })).status, 404);
  // Beendet → für andere nicht mehr abrufbar, für die Anbieterin schon
  await anna.api(`/api/boerse/angebote/${angebot.id}`, { methode: 'PUT', daten: { status: 'beendet' } });
  assert.equal((await ben.api(url)).status, 404);
  assert.equal((await anna.api(url)).status, 200);
  await anna.api(`/api/boerse/angebote/${angebot.id}`, { methode: 'PUT', daten: { status: 'aktiv' } });

  // Höchstens 6
  const r = await hochladen(anna, angebot.id, 5);
  assert.equal(r.status, 409);
  assert.equal((await anna.api(`/api/boerse/angebote/${angebot.id}`)).json.fotos.length, 6);

  // Fotos zählen zum Speicherkontingent
  const belegt = (await anna.api('/api/konto/speicher')).json.belegt;
  assert.ok(belegt > 0);
  const del = await anna.api(`/api/boerse/fotos/${fotoId}`, { methode: 'DELETE' });
  assert.equal(del.json.fotos.length, 5);
  assert.ok((await anna.api('/api/konto/speicher')).json.belegt < belegt);

  // Löschen des Angebots entfernt die Dateien
  const dateien = server.db.prepare('SELECT datei FROM angebot_fotos WHERE angebot_id = ?').all(angebot.id).map((f) => f.datei);
  assert.equal((await anna.api(`/api/boerse/angebote/${angebot.id}`, { methode: 'DELETE' })).status, 204);
  await new Promise((r2) => setTimeout(r2, 50));
  const fs = await import('node:fs');
  assert.ok(dateien.every((d) => !fs.existsSync(server.kontext.dateien.pfadVon(d))));
});

test('Anbieten aus der Sammlung übernimmt das Foto des Exemplars', async () => {
  const spiel = server.db.prepare("SELECT id FROM katalog WHERE titel = 'Tetris'").get();
  const artikel = (await anna.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Tetris', katalog_id: spiel.id } })).json;
  const formular = new FormData();
  formular.append('bild', new Blob([await foto('#0a0')], { type: 'image/jpeg' }), 'modul.jpg');
  assert.equal((await anna.api(`/api/artikel/${artikel.id}/bild`, { methode: 'POST', formular })).status, 200);
  const r = await anna.api('/api/boerse/angebote', { methode: 'POST', daten: { artikel_id: artikel.id, preis: 12 } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.fotos.length, 1);
});
