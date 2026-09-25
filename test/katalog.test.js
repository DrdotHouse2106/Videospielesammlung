import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let moni; // Moderatorin
let nina; // normale Nutzerin
let otto; // normaler Nutzer
before(async () => {
  server = await starteTestServer({ env: { AFFILIATE_AMAZON_TAG: 'testtag-21', AFFILIATE_EBAY_CAMPID: '5338000000' } });
  admin = await server.registriere('admin');
  moni = await server.registriere('moni');
  nina = await server.registriere('nina');
  otto = await server.registriere('otto');
  const liste = (await admin.api('/api/admin/benutzer')).json;
  await admin.api(`/api/admin/benutzer/${liste.find((b) => b.benutzername === 'moni').id}`, { methode: 'PUT', daten: { rolle: 'moderator' } });
});
after(async () => { await server.stoppe(); });

const post = (c, pfad, daten = {}) => c.api(pfad, { methode: 'POST', daten });

test('Eigene Artikel erzeugen private Katalogeinträge, die andere nicht sehen', async () => {
  const artikel = (await post(nina, '/api/artikel', { typ: 'zubehoer', titel: 'Hori Mini Pad Sonderfarbe', plattform: 'N64', barcode: '4961818000001' })).json;
  assert.ok(artikel.katalog_id);
  assert.equal(artikel.katalog_status, 'privat');
  assert.equal(artikel.plattform, 'Nintendo 64', 'Freitext „N64“ wird der Plattform zugeordnet');
  assert.equal(artikel.plattform_kurz, 'N64');

  assert.equal((await nina.api('/api/katalog/suche?q=Hori Mini')).json.lokal.length, 1);
  assert.equal((await otto.api('/api/katalog/suche?q=Hori Mini')).json.lokal.length, 0);
  assert.equal((await otto.api(`/api/katalog/${artikel.katalog_id}`)).status, 404);
  assert.equal((await otto.api(`/api/katalog/${artikel.katalog_id}/wert`)).status, 404);
  // Gelernter Barcode verrät den privaten Eintrag nicht
  const scan = (await otto.api('/api/katalog/barcode/4961818000001')).json;
  assert.equal(scan.treffer.length, 0);
  assert.equal((await nina.api('/api/katalog/barcode/4961818000001')).json.treffer[0].id, artikel.katalog_id);
  // Fremder privater Eintrag darf nicht verknüpft werden
  const r = await post(otto, '/api/artikel', { typ: 'zubehoer', titel: 'Klau', katalog_id: artikel.katalog_id });
  assert.equal(r.status, 400);
});

test('Einreichen → Ablehnen mit Begründung → erneut einreichen → Freigabe', async () => {
  const eintrag = (await post(nina, '/api/katalog', { typ: 'konsole', titel: 'Nintendo 64 Pikachu Edition', plattformen: ['Nintendo 64'] })).json;
  assert.equal(eintrag.status, 'privat');
  assert.equal((await post(nina, `/api/katalog/${eintrag.id}/einreichen`)).json.status, 'eingereicht');
  assert.equal((await post(nina, `/api/katalog/${eintrag.id}/einreichen`)).status, 409);

  assert.equal((await nina.api('/api/moderation/warteschlange')).status, 403);
  const schlange = (await moni.api('/api/moderation/warteschlange')).json;
  const wartend = schlange.katalog.find((k) => k.id === eintrag.id);
  assert.equal(wartend.eingereicht_von, 'nina');

  const abgelehnt = (await post(moni, `/api/moderation/katalog/${eintrag.id}/ablehnen`, { grund: 'Bitte Modellnummer ergänzen.' })).json;
  assert.equal(abgelehnt.status, 'abgelehnt');
  assert.equal((await nina.api(`/api/katalog/${eintrag.id}`)).json.pruefung_notiz, 'Bitte Modellnummer ergänzen.');
  assert.equal((await otto.api(`/api/katalog/${eintrag.id}`)).status, 404);

  await nina.api(`/api/katalog/${eintrag.id}`, { methode: 'PUT', daten: { titel: 'Nintendo 64 Pikachu Edition (NUS-101)' } });
  await post(nina, `/api/katalog/${eintrag.id}/einreichen`);
  const frei = (await post(moni, `/api/moderation/katalog/${eintrag.id}/freigeben`, { aenderungen: { erscheinungsjahr: 2000 } })).json;
  assert.equal(frei.status, 'freigegeben');
  assert.equal(frei.erscheinungsjahr, 2000);

  // Jetzt für alle sichtbar und nur noch vom Moderationsteam änderbar
  assert.equal((await otto.api('/api/katalog/suche?q=Pikachu')).json.lokal[0].id, eintrag.id);
  assert.equal((await nina.api(`/api/katalog/${eintrag.id}`, { methode: 'PUT', daten: { titel: 'X' } })).status, 403);
  assert.equal((await moni.api(`/api/katalog/${eintrag.id}`, { methode: 'PUT', daten: { beschreibung: 'Gelb-blaue Sonderedition' } })).status, 200);
});

test('Duplikate werden zusammengeführt – Artikel wandern mit', async () => {
  const original = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Super Mario 64', plattformen: ['Nintendo 64'], veroeffentlichen: true })).json;
  assert.equal(original.status, 'freigegeben');
  const doppelt = (await post(otto, '/api/artikel', { typ: 'spiel', titel: 'Super Mario 64 (PAL)', plattform: 'Nintendo 64', katalog_einreichen: true })).json;
  assert.equal(doppelt.katalog_status, 'eingereicht');
  const r = await post(moni, `/api/moderation/katalog/${doppelt.katalog_id}/zusammenfuehren`, { ziel_id: original.id });
  assert.equal(r.status, 200);
  const nachher = (await otto.api(`/api/artikel/${doppelt.id}`)).json;
  assert.equal(nachher.katalog_id, original.id);
  assert.equal((await moni.api(`/api/katalog/${doppelt.katalog_id}`)).status, 404);
});

test('Plattformen sind feste Kategorien mit Kürzel und Filter', async () => {
  await post(otto, '/api/artikel', { typ: 'spiel', titel: 'Astro Bot', plattform: 'PS5' });
  await post(otto, '/api/artikel', { typ: 'konsole', titel: 'PlayStation 5 Slim', plattform: 'PlayStation 5' });
  const plattformen = (await otto.api('/api/artikel/plattformen')).json;
  const ps5 = plattformen.find((p) => p.kurz === 'PS5');
  assert.equal(ps5.anzahl, 2);
  assert.equal(ps5.hersteller, 'Sony');
  const gefiltert = (await otto.api(`/api/artikel?plattform_id=${ps5.id}`)).json;
  assert.equal(gefiltert.length, 2);
  const alle = (await otto.api('/api/plattformen')).json;
  assert.ok(alle.length >= 40);
  assert.equal(alle.find((p) => p.id === ps5.id).meine, 2);
  // Nur das Moderationsteam darf Plattformen anlegen
  assert.equal((await post(otto, '/api/moderation/plattformen', { name: 'Evercade', kurz: 'EVC', hersteller: 'Blaze' })).status, 403);
  assert.equal((await post(moni, '/api/moderation/plattformen', { name: 'Evercade', kurz: 'EVC', hersteller: 'Blaze', aliase: 'Evercade VS' })).status, 201);
  const evercade = (await post(otto, '/api/artikel', { typ: 'konsole', titel: 'Evercade VS', plattform: 'Evercade VS' })).json;
  assert.equal(evercade.plattform, 'Evercade');
});

test('Varianten: freigegebene Liste + private Vorschläge, Exemplare je Variante', async () => {
  const ps1 = (await post(moni, '/api/katalog', { typ: 'konsole', titel: 'PlayStation', plattformen: ['PlayStation'], veroeffentlichen: true })).json;
  const v1 = (await post(moni, `/api/katalog/${ps1.id}/varianten`, { modellnummer: 'SCPH-1002', region: 'pal_eu', erscheinungsjahr: 1995, veroeffentlichen: true })).json;
  assert.equal(v1.bezeichnung, 'SCPH-1002');
  assert.equal(v1.status, 'freigegeben');
  const v2 = (await post(moni, `/api/katalog/${ps1.id}/varianten`, { bezeichnung: 'PSone', modellnummer: 'SCPH-102', veroeffentlichen: true })).json;
  const eigene = (await post(nina, `/api/katalog/${ps1.id}/varianten`, { bezeichnung: 'Debug-Station', modellnummer: 'DTL-H1202', einreichen: true })).json;
  assert.equal(eigene.status, 'eingereicht');

  assert.equal((await otto.api(`/api/katalog/${ps1.id}/varianten`)).json.length, 2, 'eingereichte Variante ist für andere unsichtbar');
  assert.equal((await nina.api(`/api/katalog/${ps1.id}/varianten`)).json.length, 3);

  // Zwei Exemplare derselben Konsole in unterschiedlichen Revisionen
  await post(otto, '/api/artikel', { typ: 'konsole', titel: 'PlayStation', katalog_id: ps1.id, variante_id: v1.id, modellnummer: 'SCPH-1002' });
  await post(otto, '/api/artikel', { typ: 'konsole', titel: 'PlayStation', katalog_id: ps1.id, variante_id: v2.id });
  const fremdeVariante = await post(otto, '/api/artikel', { typ: 'konsole', titel: 'PlayStation', katalog_id: ps1.id, variante_id: eigene.id });
  assert.equal(fremdeVariante.status, 400);

  const seite = (await otto.api(`/api/katalog-seite/${ps1.id}`)).json;
  assert.equal(seite.meineExemplare.length, 2);
  assert.deepEqual(seite.varianten.map((v) => v.meine), [1, 1]);
  assert.equal(seite.community.besitzer, 1);

  await post(moni, `/api/moderation/varianten/${eigene.id}/freigeben`);
  assert.equal((await otto.api(`/api/katalog/${ps1.id}/varianten`)).json.length, 3);
});

test('Kommentare sind privat', async () => {
  const k = (await post(nina, '/api/katalog', { typ: 'spiel', titel: 'Kommentar-Test', veroeffentlichen: false })).json;
  await post(nina, `/api/katalog/${k.id}/einreichen`);
  await post(moni, `/api/moderation/katalog/${k.id}/freigeben`);
  const kommentar = (await post(nina, `/api/katalog/${k.id}/kommentare`, { text: 'Suche noch die USK-Version' })).json;
  assert.equal((await nina.api(`/api/katalog/${k.id}/kommentare`)).json.length, 1);
  assert.equal((await otto.api(`/api/katalog/${k.id}/kommentare`)).json.length, 0);
  assert.equal((await otto.api(`/api/kommentare/${kommentar.id}`, { methode: 'DELETE' })).status, 404);
  const geaendert = (await nina.api(`/api/kommentare/${kommentar.id}`, { methode: 'PUT', daten: { text: 'Gefunden!' } })).json;
  assert.equal(geaendert.text, 'Gefunden!');
  assert.equal((await post(nina, `/api/katalog/${k.id}/kommentare`, { text: '  ' })).status, 400);
});

test('Preis-Historie: Meldungen von Angeboten und Verkäufen', async () => {
  const spiel = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Conker\'s Bad Fur Day', plattformen: ['Nintendo 64'], veroeffentlichen: true })).json;
  const ungueltig = await post(otto, `/api/katalog/${spiel.id}/historie`, { preis: 'abc', art: 'tausch', quelle: 'mond', datum: '2999-01-01' });
  assert.equal(ungueltig.status, 400);
  assert.deepEqual(Object.keys(ungueltig.json.felder).sort(), ['art', 'datum', 'preis', 'quelle']);

  await post(otto, `/api/katalog/${spiel.id}/historie`, { preis: '189,00', art: 'angebot', quelle: 'kleinanzeigen', datum: '2026-08-01', vollstaendigkeit: 'cib', region: 'pal_de', url: 'https://www.kleinanzeigen.de/s-anzeige/123' });
  const verkauf = (await post(nina, `/api/katalog/${spiel.id}/historie`, { preis: 165, art: 'verkauf', quelle: 'ebay', datum: '2026-08-15', vollstaendigkeit: 'cib' })).json;

  const seite = (await otto.api(`/api/katalog-seite/${spiel.id}`)).json;
  assert.equal(seite.historie.length, 2);
  const [angebot, fremd] = seite.historie;
  assert.equal(angebot.preis, 189);
  assert.equal(angebot.eigene, true);
  assert.equal(fremd.eigene, false);
  assert.equal(fremd.benutzer_id, undefined, 'Meldungen sind anonym');
  assert.equal((await otto.api(`/api/historie/${verkauf.id}`, { methode: 'DELETE' })).status, 404);
  assert.equal((await moni.api(`/api/historie/${verkauf.id}`, { methode: 'DELETE' })).status, 204);
});

test('Kauflinks: Affiliate-Suchlinks aus der Konfiguration und Direktlinks vom Moderationsteam', async () => {
  const spiel = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Banjo-Kazooie', plattformen: ['Nintendo 64'], veroeffentlichen: true })).json;
  let seite = (await otto.api(`/api/katalog-seite/${spiel.id}`)).json;
  const amazon = seite.kaufen.find((l) => l.anbieter === 'Amazon');
  assert.match(amazon.url, /^https:\/\/www\.amazon\.de\/s\?k=Banjo-Kazooie%20Nintendo%2064&tag=testtag-21$/);
  const ebay = seite.kaufen.find((l) => l.anbieter === 'eBay');
  assert.match(ebay.url, /campid=5338000000/);
  assert.match(ebay.url, /mkrid=707-53477-19255-0/);

  assert.equal((await post(otto, `/api/moderation/katalog/${spiel.id}/kauflinks`, { anbieter: 'X', url: 'https://x.de' })).status, 403);
  assert.equal((await post(moni, `/api/moderation/katalog/${spiel.id}/kauflinks`, { anbieter: 'Shop', url: 'http://unsicher.de' })).status, 400);
  await post(moni, `/api/moderation/katalog/${spiel.id}/kauflinks`, { anbieter: 'RetroShop', titel: 'CIB, PAL', url: 'https://shop.example/banjo?ref=abc', preis: '59,90' });
  seite = (await otto.api(`/api/katalog-seite/${spiel.id}`)).json;
  assert.equal(seite.kaufen[0].anbieter, 'RetroShop');
  assert.equal(seite.kaufen[0].preis, 59.9);
});

test('Öffentlicher Katalog ohne Anmeldung – abschaltbar', async () => {
  const spiel = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Perfect Dark', plattformen: ['Nintendo 64'], veroeffentlichen: true })).json;
  const privat = (await post(nina, '/api/katalog', { typ: 'spiel', titel: 'Geheimprojekt' })).json;
  const gast = server.client();
  const seite = await gast.api(`/api/katalog-seite/${spiel.id}`);
  assert.equal(seite.status, 200);
  assert.equal(seite.json.angemeldet, false);
  assert.equal(seite.json.meineExemplare.length, 0);
  assert.ok(seite.json.kaufen.length > 0);
  assert.equal((await gast.api(`/api/katalog-seite/${privat.id}`)).status, 404);
  assert.equal((await gast.api('/api/katalog-liste?q=Perfect')).json.eintraege[0].titel, 'Perfect Dark');
  assert.equal((await gast.api('/api/artikel')).status, 401, 'Sammlungen bleiben privat');

  const s = await starteTestServer({ env: { PUBLIC_CATALOG: 'false', AFFILIATE_LINKS: 'false', AFFILIATE_AMAZON_TAG: 'x-21' } });
  try {
    assert.equal((await s.client().api('/api/katalog-liste')).status, 401);
    const a = await s.registriere('anton');
    const k = (await a.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'T', veroeffentlichen: true } })).json;
    assert.deepEqual((await a.api(`/api/katalog-seite/${k.id}`)).json.kaufen, [], 'Affiliate-Links abgeschaltet');
  } finally {
    await s.stoppe();
  }
});

test('Öffentliche Sammlung verlinkt keine privaten Katalogeinträge', async () => {
  await nina.api('/api/konto', { methode: 'PUT', daten: { sammlung_oeffentlich: true } });
  const sammlung = (await otto.api('/api/community/nina')).json;
  const hori = sammlung.artikel.find((a) => a.titel.startsWith('Hori'));
  assert.equal(hori.katalog_id, null);
  assert.equal(hori.plattform_kurz, 'N64');
});
