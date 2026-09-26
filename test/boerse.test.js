import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let anna; // Verkäuferin
let ben; // Sammler mit Wunschliste
let neu; // frisches Konto ohne E-Mail
let spiel;
let zweites;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0', MARKET_MAX_OFFERS: '3' } });
  admin = await server.registriere('admin');
  anna = await server.registriere('anna');
  ben = await server.registriere('ben');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
  zweites = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Zelda: A Link to the Past', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
});
after(async () => { await server.stoppe(); });

test('Wunschliste, Angebot und Treffer-Benachrichtigung', async () => {
  let r = await put(ben, `/api/boerse/wunschliste/${spiel.id}`, { min_zustand: 'gut', nur_cib: true, max_preis: '80' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.treffer, 0);

  // Passt nicht (lose) → kein Treffer
  r = await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '60', zustand: 'sehr_gut', vollstaendigkeit: 'nur_geraet', plz_bereich: '40213' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.plz_bereich, '40', 'nur zwei Ziffern der PLZ werden gespeichert');
  assert.equal(r.json.plattform, 'Super Nintendo', 'einzige Plattform wird automatisch gesetzt');
  let n = (await ben.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.art === 'boerse');
  assert.equal(n.length, 0);

  // Passt → Treffer
  const passend = (await post(anna, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '75,50', zustand: 'sehr_gut', vollstaendigkeit: 'cib', beschreibung: 'Top Zustand' })).json;
  n = (await ben.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.art === 'boerse');
  assert.equal(n.length, 1);
  assert.match(n[0].titel, /Super Metroid/);
  assert.equal(n[0].link, `#/boerse/angebot/${passend.id}`);

  const treffer = (await ben.api('/api/boerse/treffer')).json;
  assert.deepEqual(treffer.map((a) => a.id), [passend.id]);
  const wl = (await ben.api('/api/boerse/wunschliste')).json;
  assert.equal(wl[0].treffer, 1);
  assert.equal(wl[0].guenstigster, 75.5);

  // Erneutes Speichern des Angebots meldet denselben Treffer nicht noch einmal
  await put(anna, `/api/boerse/angebote/${passend.id}`, { preis: '70' });
  n = (await ben.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.art === 'boerse');
  assert.equal(n.length, 1);

  // Katalogseite und öffentliche Seite zeigen die Zahlen
  const seite = (await ben.api(`/api/katalog-seite/${spiel.id}`)).json;
  assert.equal(seite.boerse.angebote, 2);
  assert.equal(seite.boerse.ab_preis, 60);
  assert.ok(seite.boerse.mein_wunsch);
  const html = (await server.client().api(`/spiel/${spiel.id}`)).text;
  assert.match(html, /Tauschbörse/);
  assert.match(html, /2<\/b> Angebote von Sammlern/);
});

test('Liste, Filter und Sichtbarkeit', async () => {
  let l = (await ben.api('/api/boerse/angebote?q=metroid')).json;
  assert.equal(l.gesamt, 2);
  assert.ok(l.eintraege.every((a) => !('sku' in a) && !('artikel_id' in a)), 'interne Felder bleiben verborgen');
  l = (await ben.api('/api/boerse/angebote?cib=1')).json;
  assert.equal(l.gesamt, 1);
  l = (await ben.api('/api/boerse/angebote?max_preis=65')).json;
  assert.equal(l.gesamt, 1);
  l = (await ben.api('/api/boerse/angebote?anbieter=gewerblich')).json;
  assert.equal(l.gesamt, 0);

  // Ohne Anmeldung gibt es keine Angebotsdetails
  const gast = server.client();
  assert.equal((await gast.api('/api/boerse/angebote')).status, 401);

  // Private Katalogeinträge können nicht angeboten werden
  const privat = (await post(anna, '/api/katalog', { typ: 'spiel', titel: 'Eigenbau' })).json;
  const r = await post(anna, '/api/boerse/angebote', { katalog_id: privat.id, preis: 5 });
  assert.equal(r.status, 400);
});

test('Limit aktiver Angebote und Reaktivierung', async () => {
  const drittes = (await post(anna, '/api/boerse/angebote', { katalog_id: zweites.id, art: 'tausch', preis: '99' })).json;
  assert.equal(drittes.preis, null, 'reine Tauschangebote haben keinen Preis');
  const r = await post(anna, '/api/boerse/angebote', { katalog_id: zweites.id, preis: 10 });
  assert.equal(r.status, 409);
  assert.match(r.json.fehler, /höchstens 3/);

  // Beenden gibt Platz frei, Reaktivieren prüft das Limit wieder
  assert.equal((await put(anna, `/api/boerse/angebote/${drittes.id}`, { status: 'beendet' })).json.status, 'beendet');
  assert.equal((await post(anna, '/api/boerse/angebote', { katalog_id: zweites.id, preis: 10 })).status, 201);
  assert.equal((await put(anna, `/api/boerse/angebote/${drittes.id}`, { status: 'aktiv' })).status, 409);

  // Fremde können nichts ändern
  assert.equal((await put(ben, `/api/boerse/angebote/${drittes.id}`, { preis: 1 })).status, 404);

  // Beendete Angebote sind für andere unsichtbar
  assert.equal((await ben.api(`/api/boerse/angebote/${drittes.id}`)).status, 404);
  const meine = (await anna.api('/api/boerse/meine')).json;
  assert.equal(meine.limit, 3);
  assert.equal(meine.aktive, 3);
  assert.equal(meine.angebote.length, 4);
});

test('Ablauf: abgelaufene Angebote werden beendet', async () => {
  const a = (await anna.api('/api/boerse/meine')).json.angebote.find((x) => x.status === 'aktiv');
  server.db.prepare("UPDATE angebote SET laeuft_ab = '2000-01-01 00:00:00' WHERE id = ?").run(a.id);
  assert.equal(server.kontext.boerse.raeumeAuf(), 1);
  assert.equal((await anna.api(`/api/boerse/angebote/${a.id}`)).json.status, 'abgelaufen');
  const n = (await anna.api('/api/benachrichtigungen')).json.eintraege;
  assert.ok(n.some((b) => b.titel === 'Ein Angebot ist abgelaufen'));
  // Verlängern
  assert.equal((await put(anna, `/api/boerse/angebote/${a.id}`, { status: 'aktiv' })).json.status, 'aktiv');
});

test('Nachrichten, Benachrichtigung, Bewertung und Blockieren', async () => {
  const angebot = (await ben.api('/api/boerse/treffer')).json[0];
  let r = await post(ben, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Hallo, ist das noch zu haben?' });
  assert.equal(r.status, 201, r.text);
  const uid = r.json.unterhaltung_id;
  // Zweite Anfrage landet in derselben Unterhaltung
  r = await post(ben, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Versand nach Köln möglich?' });
  assert.equal(r.json.unterhaltung_id, uid);

  // Anna: eine Benachrichtigung (nicht zwei), zwei ungelesene Nachrichten
  const n = (await anna.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.art === 'nachricht');
  assert.equal(n.length, 1);
  assert.equal((await anna.api('/api/boerse/nachrichten/anzahl')).json.ungelesen, 2);

  // Bewerten erst nach Antwort
  assert.equal((await post(ben, `/api/boerse/nachrichten/${uid}/bewertung`, { wert: 1 })).status, 409);
  let u = (await anna.api(`/api/boerse/nachrichten/${uid}`)).json;
  assert.equal(u.nachrichten.length, 2);
  assert.equal(u.rolle, 'anbieter');
  assert.equal((await anna.api('/api/boerse/nachrichten/anzahl')).json.ungelesen, 0);
  await post(anna, `/api/boerse/nachrichten/${uid}`, { text: 'Ja, Versand geht.' });
  u = (await ben.api(`/api/boerse/nachrichten/${uid}`)).json;
  assert.equal(u.darf_bewerten, true);
  assert.equal((await post(ben, `/api/boerse/nachrichten/${uid}/bewertung`, { wert: -1 })).status, 400, 'negative Bewertung braucht Begründung');
  r = await post(ben, `/api/boerse/nachrichten/${uid}/bewertung`, { wert: 1, text: 'Schnelle Antwort' });
  assert.equal(r.json.positiv, 1);
  const profil = (await ben.api(`/api/boerse/anbieter/${angebot.anbieter.id}`)).json;
  assert.equal(profil.bewertung.gesamt, 1);
  assert.equal(profil.bewertungen[0].text, 'Schnelle Antwort');

  // Dritte sehen die Unterhaltung nicht
  assert.equal((await admin.api(`/api/boerse/nachrichten/${uid}`)).status, 404);

  // Blockieren: keine Nachrichten, keine Angebote mehr
  const benId = (await anna.api(`/api/boerse/nachrichten/${uid}`)).json.partner.id;
  await post(anna, `/api/boerse/anbieter/${benId}/blockieren`, {});
  r = await post(ben, `/api/boerse/nachrichten/${uid}`, { text: 'Hallo?' });
  assert.equal(r.status, 403);
  assert.equal((await ben.api('/api/boerse/angebote?q=metroid')).json.gesamt, 0);
  const annaId = angebot.anbieter.id;
  assert.equal((await ben.api(`/api/boerse/anbieter/${annaId}`)).status, 404);
  await anna.api(`/api/boerse/anbieter/${benId}/blockieren`, { methode: 'DELETE' });
  assert.equal((await ben.api('/api/boerse/angebote?q=metroid')).json.gesamt, 2);
});

test('Neue Konten ohne E-Mail dürfen erst nach Wartezeit schreiben', async () => {
  server.kontext.konfiguration.boerse.mindestKontoalterTage = 3;
  try {
    neu = await server.registriere('neuling');
    const angebot = (await neu.api('/api/boerse/angebote?q=metroid')).json.eintraege[0];
    let r = await post(neu, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Hi' });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'zu_neu');
    server.db.prepare("UPDATE benutzer SET email = 'neu@example.org' WHERE benutzername = 'neuling'").run();
    r = await post(neu, `/api/boerse/angebote/${angebot.id}/anfrage`, { text: 'Hi' });
    assert.equal(r.status, 201);
  } finally {
    server.kontext.konfiguration.boerse.mindestKontoalterTage = 0;
  }
});

test('Tauschvorschläge finden passende Partner', async () => {
  const carla = await server.registriere('carla');
  const dirk = await server.registriere('dirk');
  const drittes = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Chrono Trigger', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
  const viertes = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Secret of Mana', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
  await post(carla, '/api/boerse/angebote', { katalog_id: drittes.id, art: 'tausch' });
  await put(carla, `/api/boerse/wunschliste/${viertes.id}`, {});
  await post(dirk, '/api/boerse/angebote', { katalog_id: viertes.id, art: 'beides', preis: 40 });
  await put(dirk, `/api/boerse/wunschliste/${drittes.id}`, {});
  const v = (await carla.api('/api/boerse/tausch')).json;
  assert.equal(v.length, 1);
  assert.equal(v[0].partner.name, 'dirk');
  assert.equal(v[0].du_bekommst[0].titel, 'Secret of Mana');
  assert.equal(v[0].du_gibst[0].titel, 'Chrono Trigger');
});

test('Gewerbliche Anbieter: Kennzeichnung, Verifizierung, Massen-Upload', async () => {
  const shop = await server.registriere('retroshop');
  // Ohne Anbieterkennzeichnung kein Massen-Upload
  let r = await post(shop, '/api/boerse/haendler/import/analyse', { text: 'Titel;Preis\nSuper Metroid;50' });
  assert.equal(r.status, 403);

  r = await put(shop, '/api/boerse/haendler', { firma: 'Retro Shop GmbH' });
  assert.equal(r.status, 400);
  assert.ok(r.json.felder.anschrift);
  r = await put(shop, '/api/boerse/haendler', {
    firma: 'Retro Shop GmbH', anschrift: 'Musterstraße 1, 40213 Düsseldorf', email: 'info@retroshop.example', shop_url: 'https://retroshop.example',
  });
  assert.equal(r.json.status, 'angemeldet');
  assert.equal(r.json.limit, 3, 'unverifiziert gilt das normale Limit');

  // Admin verifiziert → höheres Limit
  const shopId = server.db.prepare("SELECT id FROM benutzer WHERE benutzername = 'retroshop'").get().id;
  assert.equal((await post(admin, `/api/admin/benutzer/${shopId}/haendler`, { verifiziert: true })).status, 200);
  assert.equal((await shop.api('/api/boerse/haendler')).json.status, 'verifiziert');
  assert.equal((await shop.api('/api/boerse/haendler')).json.limit, 3, 'Verifizierung allein erhöht das Limit nicht');
  // Händler-Paket: nur eingestellte Pakete, danach gilt dessen Limit
  assert.equal((await post(admin, `/api/admin/benutzer/${shopId}/paket`, { angebote: 777, bis: '2099-12-31' })).status, 400);
  // Oberhalb des größten Pakets: individuell vereinbar
  assert.equal((await post(admin, `/api/admin/benutzer/${shopId}/paket`, { angebote: 12000, bis: '2099-12-31' })).status, 200);
  assert.equal((await shop.api('/api/boerse/haendler')).json.limit, 12000);
  assert.equal((await post(admin, `/api/admin/benutzer/${shopId}/paket`, { angebote: 500, bis: '2099-12-31' })).status, 200);
  const profil = (await shop.api('/api/boerse/haendler')).json;
  assert.equal(profil.limit, 500);
  assert.equal(profil.paket, 500);
  assert.deepEqual(profil.pakete.map((p) => p.angebote), [500, 1000, 5000]);
  assert.equal(profil.api_preis, 19.9);

  const csv = [
    'Artikelnummer;EAN;Titel;Plattform;Preis;Bestand;Zustand;Lieferumfang',
    'SM-1;;Super Metroid;SNES;49,90;2;sehr gut;komplett',
    `ZE-1;;;;29,00;1;gut;lose`,
    'XX-1;;Gibt es nicht;SNES;10;1;gut;',
    'SM-1;;Super Metroid;SNES;1;1;gut;',
  ].join('\n');
  r = await post(shop, '/api/boerse/haendler/import/analyse', { text: csv });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.zuordnung.sku, 0);
  assert.equal(r.json.zuordnung.preis, 4);
  assert.equal(r.json.zuordnung.anzahl, 5);
  assert.equal(r.json.vorschau[0].katalog_titel, 'Super Metroid');
  const zuordnung = { ...r.json.zuordnung };

  r = await post(shop, '/api/boerse/haendler/import', { text: csv, zuordnung });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.angelegt, 1);
  assert.equal(r.json.uebersprungen, 3);
  assert.deepEqual(r.json.fehlerhaft.map((f) => f.zeile), [3, 4, 5]);
  assert.ok(r.json.sammler_informiert >= 1, 'Ben sucht Super Metroid');
  const sm = (await shop.api('/api/boerse/meine')).json.angebote.find((a) => a.sku === 'SM-1');
  assert.equal(sm.preis, 49.9);
  assert.equal(sm.anzahl, 2);
  assert.equal(sm.vollstaendigkeit, 'cib');

  // Zweiter Lauf mit ZockDB-ID: aktualisiert per SKU, Bestand 0 beendet, fehlende werden beendet
  const csv2 = [
    'SKU;ZockDB-ID;Preis;Bestand',
    `SM-1;${spiel.id};44,90;1`,
    `ZE-1;${zweites.id};29,00;1`,
  ].join('\n');
  const z2 = (await post(shop, '/api/boerse/haendler/import/analyse', { text: csv2 })).json.zuordnung;
  r = await post(shop, '/api/boerse/haendler/import', { text: csv2, zuordnung: z2, beendeFehlende: true });
  assert.equal(r.json.aktualisiert, 1);
  assert.equal(r.json.angelegt, 1);
  let meine = (await shop.api('/api/boerse/meine')).json.angebote;
  assert.equal(meine.length, 2);
  assert.equal(meine.find((a) => a.sku === 'SM-1').preis, 44.9);

  const csv3 = `SKU;ZockDB-ID;Preis;Bestand\nSM-1;${spiel.id};44,90;0\n`;
  r = await post(shop, '/api/boerse/haendler/import', { text: csv3, zuordnung: { sku: 0, katalog_id: 1, preis: 2, anzahl: 3 }, beendeFehlende: true });
  assert.equal(r.json.beendet, 2);
  meine = (await shop.api('/api/boerse/meine')).json.angebote;
  assert.ok(meine.every((a) => a.status === 'beendet'));

  // Angebote gewerblicher Anbieter zeigen die Anbieterkennzeichnung
  await put(shop, `/api/boerse/angebote/${meine[0].id}`, { status: 'aktiv' });
  const detail = (await ben.api(`/api/boerse/angebote/${meine[0].id}`)).json;
  assert.equal(detail.anbieter.gewerblich, true);
  assert.equal(detail.anbieter.verifiziert, true);
  assert.equal(detail.anbieter.kennzeichnung.firma, 'Retro Shop GmbH');

  // CSV-Export der eigenen Angebote mit Formelschutz
  const exp = await shop.api('/api/boerse/meine.csv');
  assert.match(exp.text, /ZockDB-ID;Titel/);
  assert.match(exp.text, /Super Metroid/);

  // Nachfrage: volle Auswertung nur mit Händler-Paket
  const nf = (await shop.api('/api/boerse/nachfrage')).json;
  assert.equal(nf.voll, true);
  assert.ok(nf.eintraege.some((e) => e.titel === 'Super Metroid' && e.max_preis_hoechst === 80));
  const nfPrivat = (await ben.api('/api/boerse/nachfrage')).json;
  assert.equal(nfPrivat.voll, false);
  assert.ok(!('max_preis_hoechst' in nfPrivat.eintraege[0]));

  // Nach Ablauf des Pakets: Angebote über dem kostenlosen Limit werden beendet
  const csvViele = ['SKU;ZockDB-ID;Preis;Bestand', ...[1, 2, 3, 4, 5].map((i) => `V-${i};${spiel.id};${10 + i};1`)].join('\n');
  r = await post(shop, '/api/boerse/haendler/import', { text: csvViele, zuordnung: { sku: 0, katalog_id: 1, preis: 2, anzahl: 3 } });
  assert.equal(r.json.angelegt, 5);
  server.db.prepare("UPDATE benutzer SET haendler_paket_bis = '2000-01-01' WHERE id = ?").run(shopId);
  assert.equal(server.kontext.boerse.kuerzeNachPaketende(), 3);
  assert.equal((await shop.api('/api/boerse/meine')).json.aktive, 3);
  assert.ok((await shop.api('/api/benachrichtigungen')).json.eintraege.some((b) => b.titel === '3 Angebote wurden beendet'));
  // Ohne Paket greift das kostenlose Limit auch beim CSV-Upload
  r = await post(shop, '/api/boerse/haendler/import', { text: csvViele.replace(/V-/g, 'W-'), zuordnung: { sku: 0, katalog_id: 1, preis: 2, anzahl: 3 } });
  assert.equal(r.json.angelegt, 0);
  assert.match(r.json.fehlerhaft[0].grund, /Limit von 3/);

  // Änderung von Firma/Anschrift hebt die Verifizierung auf
  r = await put(shop, '/api/boerse/haendler', { firma: 'Retro Shop 2 GmbH', anschrift: 'Musterstraße 1, 40213 Düsseldorf', email: 'info@retroshop.example' });
  assert.equal(r.json.status, 'angemeldet');
});

test('Angebote melden und entfernen', async () => {
  const angebot = (await ben.api('/api/boerse/angebote?q=metroid')).json.eintraege[0];
  let r = await post(ben, '/api/melden', { bereich: 'angebot', ziel_id: angebot.id, grund: 'rechtswidrig', text: 'Raubkopie' });
  assert.equal(r.status, 201, r.text);
  const meldung = (await admin.api('/api/moderation/meldungen')).json.find((m) => m.bereich === 'angebot');
  assert.match(meldung.ziel_titel, /Angebot von/);
  r = await post(admin, `/api/moderation/meldungen/${meldung.id}/erledigen`, { aktion: 'entfernen', ergebnis: 'Reproduktion' });
  assert.equal(r.status, 200);
  assert.equal((await ben.api(`/api/boerse/angebote/${angebot.id}`)).status, 404);
});

test('Abgeschaltete Börse', async () => {
  server.kontext.konfiguration.boerse.aktiv = false;
  try {
    assert.equal((await ben.api('/api/boerse/angebote')).status, 404);
    assert.equal((await ben.api(`/api/katalog-seite/${spiel.id}`)).json.boerse, null);
    assert.equal((await ben.api('/api/auth/status')).json.boerse, false);
  } finally {
    server.kontext.konfiguration.boerse.aktiv = true;
  }
});
