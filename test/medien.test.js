import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { starteTestServer } from './hilfen.js';

let server;
let anna;
let bernd;
let artikel;
before(async () => {
  server = await starteTestServer();
  anna = await server.registriere('anna');
  bernd = await server.registriere('bernd');
  artikel = (await anna.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', plattform: 'Nintendo 64' } })).json;
});
after(async () => { await server.stoppe(); });

async function hochladen(client, artikelId, { puffer, typ, name, felder = {} }) {
  const formular = new FormData();
  for (const [k, v] of Object.entries(felder)) formular.append(k, v);
  formular.append('datei', new Blob([puffer], { type: typ }), name);
  return client.api(`/api/artikel/${artikelId}/medien`, { methode: 'POST', formular });
}

test('Hochauflösender TIFF-Scan: DPI wird erkannt, Anzeige- und Vorschaubild entstehen', async () => {
  // 1500 × 1500 Pixel bei 600 dpi = 63,5 mm Kantenlänge
  const tiff = await sharp({ create: { width: 1500, height: 1500, channels: 3, background: '#cc2244' } })
    .withMetadata({ density: 600 }).tiff().toBuffer();
  const antwort = await hochladen(anna, artikel.id, {
    puffer: tiff, typ: 'image/tiff', name: 'cover-vorne.tif', felder: { art: 'cover_vorne', sichtbarkeit: 'privat' },
  });
  assert.equal(antwort.status, 201, antwort.text);
  const medium = antwort.json;
  assert.equal(medium.breite, 1500);
  assert.equal(medium.dpi, 600);
  assert.match(medium.url, /-anzeige\.jpg$/);
  assert.match(medium.vorschau_url, /-vorschau\.webp$/);

  // Der Artikel hat nun automatisch einen Katalogeintrag
  const aktualisiert = (await anna.api(`/api/artikel/${artikel.id}`)).json;
  assert.ok(aktualisiert.katalog_id);

  const anzeige = await anna.api(medium.url);
  assert.equal(anzeige.status, 200);
  const meta = await sharp(anzeige.puffer).metadata();
  assert.equal(meta.width, 1500, 'Anzeigeversion behält die volle Auflösung');
  assert.equal(meta.format, 'jpeg');

  const original = await anna.api(`${medium.original_url}?download=1`);
  assert.match(original.headers.get('content-disposition'), /cover-vorne\.tif/);

  // Privat: andere Benutzer sehen weder Liste noch Datei
  // Der automatisch angelegte Katalogeintrag ist privat → für andere unsichtbar
  assert.equal((await bernd.api(`/api/katalog/${aktualisiert.katalog_id}/medien`)).status, 404);
  assert.equal((await bernd.api(medium.url)).status, 404);
  assert.equal((await server.client().api(medium.url)).status, 401);

  // Eingereicht: noch nicht sichtbar für andere, erst nach Freigabe durch das Moderationsteam
  await bernd.api(`/api/medien/${medium.id}`, { methode: 'PUT', daten: { sichtbarkeit: 'eingereicht' } }); // fremd → wirkungslos
  const eingereicht = (await anna.api(`/api/medien/${medium.id}`, { methode: 'PUT', daten: { sichtbarkeit: 'eingereicht' } })).json;
  assert.equal(eingereicht.sichtbarkeit, 'eingereicht');
  assert.equal((await bernd.api(medium.url)).status, 404);
  const warteschlange = (await anna.api('/api/moderation/warteschlange')).json; // anna ist Admin (erstes Konto)
  assert.equal(warteschlange.medien[0].id, medium.id);
  assert.equal((await bernd.api('/api/moderation/warteschlange')).status, 403);
  // Katalogeintrag des Artikels ist privat → erst freigeben, dann den Scan
  await anna.api(`/api/moderation/katalog/${aktualisiert.katalog_id}/freigeben`, { methode: 'POST', daten: {} });
  assert.equal((await anna.api(`/api/moderation/medien/${medium.id}/freigeben`, { methode: 'POST', daten: {} })).status, 200);
  const fremd = (await bernd.api(`/api/katalog/${aktualisiert.katalog_id}/medien`)).json;
  assert.equal(fremd.length, 1);
  assert.equal(fremd[0].darf_bearbeiten, false);
  assert.equal(fremd[0].hochgeladen_von, 'anna');
  assert.equal(fremd[0].sichtbarkeit, 'freigegeben');
  assert.ok(fremd[0].geprueft_am);
  assert.equal((await bernd.api(medium.url)).status, 200);
  assert.equal((await bernd.api(`/api/medien/${medium.id}`, { methode: 'DELETE' })).status, 404);
});

test('PDF-Handbuch wird angenommen, falsche Dateien abgelehnt', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF');
  const ok = await hochladen(anna, artikel.id, { puffer: pdf, typ: 'application/pdf', name: 'anleitung.pdf', felder: { art: 'handbuch' } });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.seiten, 2);
  assert.equal(ok.json.vorschau_url, null);

  const gefaelscht = await hochladen(anna, artikel.id, { puffer: Buffer.from('kein pdf'), typ: 'application/pdf', name: 'x.pdf', felder: { art: 'handbuch' } });
  assert.equal(gefaelscht.status, 400);
  const ohneArt = await hochladen(anna, artikel.id, { puffer: pdf, typ: 'application/pdf', name: 'x.pdf' });
  assert.equal(ohneArt.status, 400);
  const exe = await hochladen(anna, artikel.id, { puffer: Buffer.from('MZ'), typ: 'application/x-msdownload', name: 'x.exe', felder: { art: 'handbuch' } });
  assert.equal(exe.status, 400);
  // Fremder Artikel
  const fremd = await hochladen(bernd, artikel.id, { puffer: pdf, typ: 'application/pdf', name: 'x.pdf', felder: { art: 'handbuch' } });
  assert.equal(fremd.status, 404);
});

test('Teilen lässt sich serverweit abschalten', async () => {
  const s = await starteTestServer({ env: { MEDIA_SHARING: 'false' } });
  try {
    const c = await s.registriere('x-user');
    const a = (await c.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Test' } })).json;
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer();
    const r = await hochladen(c, a.id, { puffer: png, typ: 'image/png', name: 'a.png', felder: { art: 'cover_vorne', sichtbarkeit: 'eingereicht' } });
    assert.equal(r.status, 400);
    assert.match(r.json.felder.sichtbarkeit, /deaktiviert/);
  } finally {
    await s.stoppe();
  }
});
