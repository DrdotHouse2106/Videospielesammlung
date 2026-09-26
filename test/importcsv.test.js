import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { leseCsv, erkenneZuordnung, zeileZuArtikel } from '../server/services/csvimport.js';

test('CSV lesen: Anführungszeichen, Zeilenumbrüche, Trennzeichen-Erkennung', () => {
  const csv = leseCsv('﻿Title,Platform,Notes\n"Zelda, A Link to the Past",SNES,"Mit ""Poster""\nund Karte"\n\nTetris,Game Boy,\n');
  assert.equal(csv.trennzeichen, ',');
  assert.deepEqual(csv.kopf, ['Title', 'Platform', 'Notes']);
  assert.equal(csv.zeilen.length, 2);
  assert.equal(csv.zeilen[0][0], 'Zelda, A Link to the Past');
  assert.equal(csv.zeilen[0][2], 'Mit "Poster"\nund Karte');
});

test('CLZ-typische Spalten und Werte werden übersetzt', () => {
  const kopf = ['Title', 'Platform', 'Region', 'Completeness', 'Condition', 'Purchase Price', 'Purchase Date', 'Barcode', 'Quantity', 'Notes'];
  const z = erkenneZuordnung(kopf);
  assert.equal(z.titel, 0);
  assert.equal(z.kaufpreis, 5);
  const a = zeileZuArtikel(['Super Metroid', 'SNES', 'Germany', 'Complete', 'Very Good', '€ 1.234,50', '24.12.2019', '4 902370 501', '2', 'Top'], z);
  assert.deepEqual({ region: a.region, voll: a.vollstaendigkeit, zustand: a.zustand, datum: a.kaufdatum, anzahl: a.anzahl, preis: a.kaufpreis },
    { region: 'pal_de', voll: 'cib', zustand: 'sehr_gut', datum: '2019-12-24', anzahl: 2, preis: '1.234,50' });
  assert.equal(zeileZuArtikel(['X', 'N64', 'Australia', 'Loose', 'Sealed'], z).region, 'pal_eu');
  assert.equal(zeileZuArtikel(['X', 'N64', 'USA', 'Loose', ''], z).vollstaendigkeit, 'nur_geraet');
  assert.equal(zeileZuArtikel(['X', 'N64', 'Japan', 'New', ''], z).zustand, 'neu_ovp');
  assert.equal(zeileZuArtikel(['X', 'N64', '', '', '', '$1,234.50'], z).kaufpreis, '1234.50');
});

let server;
let nutzer;
before(async () => {
  server = await starteTestServer();
  const admin = await server.registriere('admin');
  await admin.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true } });
  nutzer = await server.registriere('sammler');
});
after(async () => { await server.stoppe(); });

test('Import über die API: Analyse, Katalogabgleich, fehlerhafte Zeilen', async () => {
  const text = 'Titel;Plattform;Zustand;Kaufpreis (EUR);Anzahl\nSuper Metroid;SNES;Gut;49,99;1\n;SNES;Gut;;1\nUnbekanntes Spiel;N64;;;3\n';
  const analyse = (await nutzer.api('/api/import/csv/analyse', { methode: 'POST', daten: { text } })).json;
  assert.equal(analyse.zeilen, 3);
  assert.equal(analyse.trennzeichen, ';');
  assert.equal(analyse.zuordnung.titel, 0);
  assert.equal(analyse.vorschau[0].plattform, 'Super Nintendo');

  const r = await nutzer.api('/api/import/csv', { methode: 'POST', daten: { text, zuordnung: analyse.zuordnung, standardTyp: 'spiel' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.importiert, 2);
  assert.equal(r.json.verknuepft, 1);
  assert.equal(r.json.fehlerhaft[0].zeile, 3);
  const liste = (await nutzer.api('/api/artikel')).json;
  const metroid = (liste.artikel ?? liste).find((a) => a.titel === 'Super Metroid');
  assert.ok(metroid.katalog_id);
  assert.equal(metroid.kaufpreis, 49.99);
  assert.equal(metroid.zustand, 'gut');
});
