import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let nutzer;
before(async () => {
  server = await starteTestServer();
  nutzer = await server.registriere('sammler');
});
after(async () => { await server.stoppe(); });

test('Status und Metadaten sind auf Deutsch verfügbar', async () => {
  const { json } = await nutzer.api('/api/meta');
  assert.deepEqual(json.ARTIKELTYPEN.map((t) => t.label), ['Spiel', 'Konsole', 'Zubehör']);
  assert.ok(json.ZUSTAENDE.some((z) => z.label === 'Neu/OVP'));
  const status = await nutzer.api('/api/status');
  assert.equal(status.json.igdbKonfiguriert, false);
  assert.equal(status.json.registrierungOffen, true);
});

test('Artikel anlegen, filtern, ändern und löschen', async () => {
  const neu = await nutzer.api('/api/artikel', {
    methode: 'POST',
    daten: {
      typ: 'konsole', titel: 'PlayStation', plattform: 'PlayStation', farbe: 'Grau', modellnummer: 'SCPH-1002',
      region: 'pal_de', zustand: 'gut', vollstaendigkeit: 'cib', kaufpreis: '1.299,90', kaufdatum: '2024-05-01',
    },
  });
  assert.equal(neu.status, 201);
  assert.equal(neu.json.kaufpreis, 1299.9);
  assert.equal(neu.json.modellnummer, 'SCPH-1002');

  await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Tetris', plattform: 'Game Boy' } });

  const konsolen = await nutzer.api('/api/artikel?typ=konsole');
  assert.equal(konsolen.json.length, 1);
  const suche = await nutzer.api('/api/artikel?q=scph');
  assert.equal(suche.json[0].titel, 'PlayStation');

  const geaendert = await nutzer.api(`/api/artikel/${neu.json.id}`, { methode: 'PUT', daten: { zustand: 'sehr_gut' } });
  assert.equal(geaendert.json.zustand, 'sehr_gut');
  assert.equal(geaendert.json.farbe, 'Grau');

  const statistik = await nutzer.api('/api/statistik');
  assert.equal(statistik.json.gesamt.stueck, 2);

  const csv = await nutzer.api('/api/export.csv');
  assert.match(csv.text, /Artikeltyp;Titel/);
  assert.match(csv.text, /1299,90/);

  assert.equal((await nutzer.api(`/api/artikel/${neu.json.id}`, { methode: 'DELETE' })).status, 204);
  assert.equal((await nutzer.api(`/api/artikel/${neu.json.id}`)).status, 404);
});

test('Ungültige Eingaben liefern deutsche Fehlermeldungen je Feld', async () => {
  const { status, json } = await nutzer.api('/api/artikel', {
    methode: 'POST', daten: { typ: 'auto', titel: '', zustand: 'kaputt', kaufpreis: 'abc' },
  });
  assert.equal(status, 400);
  assert.ok(json.felder.typ);
  assert.match(json.felder.titel, /Titel/);
  assert.equal(json.felder.zustand, 'Ungültige Auswahl.');
  assert.ok(json.felder.kaufpreis);
});

test('Eigene Katalogeinträge sind durchsuchbar und Barcodes werden gelernt', async () => {
  const eintrag = await nutzer.api('/api/katalog', {
    methode: 'POST', daten: { typ: 'zubehoer', titel: 'Hori Controller Clear Red', plattformen: ['Nintendo 64'] },
  });
  assert.equal(eintrag.status, 201);
  assert.equal(eintrag.json.quelle, 'eigen');

  const treffer = await nutzer.api('/api/katalog/suche?q=hori&typ=zubehoer');
  assert.equal(treffer.json.lokal[0].id, eintrag.json.id);

  await nutzer.api('/api/artikel', {
    methode: 'POST',
    daten: { typ: 'zubehoer', titel: 'Hori Controller', katalog_id: eintrag.json.id, barcode: '4961818123456' },
  });
  const scan = await nutzer.api('/api/katalog/barcode/4961818123456');
  assert.equal(scan.json.quelle, 'lokal');
  assert.equal(scan.json.treffer[0].titel, 'Hori Controller Clear Red');
  assert.equal(scan.json.vorhandeneArtikel.length, 1);

  assert.equal((await nutzer.api('/api/katalog/barcode/123')).status, 400);
});

test('JSON-Export lässt sich wieder importieren', async () => {
  const exportDaten = (await nutzer.api('/api/export.json')).json;
  const vorher = exportDaten.artikel.length;
  const ergebnis = await nutzer.api('/api/import', { methode: 'POST', daten: exportDaten });
  assert.equal(ergebnis.json.importiert, vorher);
  assert.equal((await nutzer.api('/api/artikel')).json.length, vorher * 2);
});
