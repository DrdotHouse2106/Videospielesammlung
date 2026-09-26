import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { median } from '../server/services/preisindex.js';

let server;
let admin;
let spiel;
let selten;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const monat = (zurueck) => {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() - zurueck);
  return d.toISOString().slice(0, 10);
};
/** Legt einen archivierten Verkauf an (wie er durch Trigger + Verkaufsmeldung entsteht). */
function verkauf(katalogId, preis, { status = 'gemeldet', am = monat(0), plattformId = null } = {}) {
  server.db.prepare(`INSERT INTO markt_angebote (katalog_id, plattform_id, art, preis_start, preis_ende, eingestellt_am, beendet_am, ergebnis, verkaufspreis, verkauf_status)
    VALUES (?, ?, 'verkauf', ?, ?, ?, ?, 'verkauft', ?, ?)`).run(katalogId, plattformId, preis + 10, preis, am, am, preis, status);
}

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  admin = await server.registriere('admin');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
  selten = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Hagane', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

test('Median ist robust gegen Ausreißer', () => {
  assert.equal(median([40, 45, 50, 9999]), 47.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

test('Preisindex: nur echte Verkäufe, Median, Mindestanzahl, Aufsteiger und Sitemap', async () => {
  // Super Metroid: 4 Verkäufe vor 7–9 Monaten (~40 €), 3 aktuelle (~60 €), dazu ein bestrittener Ausreißer
  for (const [p, m] of [[38, 9], [40, 8], [42, 7], [41, 7]]) verkauf(spiel.id, p, { am: monat(m) });
  for (const p of [58, 60, 62]) verkauf(spiel.id, p, { status: 'bestaetigt' });
  verkauf(spiel.id, 5000, { status: 'bestritten' });
  // Hagane: nur 2 Verkäufe → kein Preis (Mindestanzahl)
  verkauf(selten.id, 300); verkauf(selten.id, 320);
  // Wunschliste
  const ben = await server.registriere('ben');
  await ben.api(`/api/boerse/wunschliste/${selten.id}`, { methode: 'PUT', daten: { max_preis: '250' } });

  const html = (await server.client().api('/preisindex')).text;
  assert.match(html, /<h1>Preisindex: was Retro-Spiele wirklich kosten<\/h1>/);
  assert.match(html, /index,follow/);
  assert.match(html, /9<\/b><span class="leise">Verkäufe in 12 Monaten/, 'bestrittener Verkauf zählt nicht');
  assert.match(html, /Super Metroid<\/a><span class="preis">42,00/, 'Median statt Durchschnitt');
  assert.doesNotMatch(html, /Hagane<\/a><span class="preis">[^<]*€/, 'unter der Mindestanzahl kein Preis in der Verkaufsliste');
  assert.match(html, /Preisaufsteiger/);
  assert.match(html, /\+48 %/, '40,50 € → 60,00 €');
  assert.match(html, /Hagane<\/a><span class="preis">1 sucht/);
  assert.match(html, /"@type":"ItemList"/);
  assert.doesNotMatch(html, /5\.000/);

  // Plattformseite, Link von der Plattform, Sitemap
  const snes = await server.client().api('/preisindex/snes');
  assert.equal(snes.status, 200);
  assert.match(snes.text, /Preisindex für Super Nintendo/);
  assert.equal((await server.client().api('/preisindex/gibtsnicht')).status, 404);
  assert.match((await server.client().api('/sitemap-plattformen.xml')).text, /\/preisindex\/snes</);

  // Katalogseite (öffentlich) und App-Zusammenfassung zeigen den Verkaufsmedian
  const seite = (await server.client().api(`/spiel/${spiel.id}`, { headers: {} })).text;
  assert.match(seite, /7×<\/b> verkauft – Median <b>42,00/);
  const info = (await admin.api(`/api/katalog-seite/${spiel.id}`)).json.boerse.verkauf;
  assert.deepEqual({ n: info.verkaeufe, m: info.median, b: info.bestaetigt }, { n: 7, m: 42, b: 3 });
  assert.equal((await admin.api(`/api/katalog-seite/${selten.id}`)).json.boerse.verkauf, null);
});

test('Ohne Daten: Seite bleibt erreichbar, aber nicht indexierbar', async () => {
  const leer = await starteTestServer();
  try {
    const html = (await leer.client().api('/preisindex')).text;
    assert.match(html, /noindex/);
    assert.match(html, /Noch zu wenige Verkäufe/);
  } finally {
    await leer.stoppe();
  }
});
