import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { starteTestServer } from './hilfen.js';

// Falsche eBay- und IGDB-API
function falscheApis() {
  const fetchFn = async (url) => {
    const u = String(url);
    if (u.startsWith('https://api.ebay.com/identity')) return Response.json({ access_token: 'ebay-token', expires_in: 7200 });
    if (u.startsWith('https://api.ebay.com/buy/browse')) {
      return Response.json({
        total: 6,
        itemSummaries: [
          { title: 'Retro Racer N64 PAL OVP', price: { value: '60.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/1', itemAffiliateWebUrl: 'https://ebay.de/itm/1?campid=5338000000' },
          { title: 'Retro Racer Nintendo 64 Modul', price: { value: '40.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/2' },
          { title: 'Retro Racer N64', price: { value: '50.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/3' },
          { title: 'Retro Racer N64 nur die Hülle', price: { value: '5.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/4' },
          { title: 'Super Mario 64', price: { value: '35.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/5' },
          { title: 'Retro Racer Sammlerstück', price: { value: '999.00', currency: 'EUR' }, itemWebUrl: 'https://ebay.de/itm/6' },
        ],
      });
    }
    if (u.startsWith('https://id.twitch.tv')) return Response.json({ access_token: 't', expires_in: 3600 });
    if (u.endsWith('/games')) return Response.json([{ id: 7, name: 'IGDB Spiel', summary: 'Original', platforms: [{ name: 'Nintendo 64' }] }]);
    return new Response('', { status: 404 });
  };
  return fetchFn;
}

let server;
let admin;
let moni;
let nina;
before(async () => {
  server = await starteTestServer({
    env: { EBAY_CLIENT_ID: 'id', EBAY_CLIENT_SECRET: 'geheim', AFFILIATE_EBAY_CAMPID: '5338000000', TWITCH_CLIENT_ID: 'x', TWITCH_CLIENT_SECRET: 'y' },
    fetchFn: falscheApis(),
  });
  admin = await server.registriere('admin');
  moni = await server.registriere('moni');
  nina = await server.registriere('nina');
  const liste = (await admin.api('/api/admin/benutzer')).json;
  await admin.api(`/api/admin/benutzer/${liste.find((b) => b.benutzername === 'moni').id}`, { methode: 'PUT', daten: { rolle: 'moderator' } });
});
after(async () => { await server.stoppe(); });
const post = (c, pfad, daten = {}) => c.api(pfad, { methode: 'POST', daten });

test('Registrierung verlangt die Zustimmung zu den Nutzungsbedingungen', async () => {
  const r = await server.client().api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: 'ohne', passwort: 'sehr-geheimes-passwort' } });
  assert.equal(r.status, 400);
  assert.match(r.json.felder.bedingungen, /Nutzungsbedingungen/);
});

test('Rechtliche Seiten: öffentlich lesbar, nur vom Admin änderbar', async () => {
  const gast = server.client();
  const liste = (await gast.api('/api/seiten')).json;
  assert.deepEqual(liste.map((s) => s.slug), ['impressum', 'datenschutz', 'nutzungsbedingungen', 'sicherheit']);
  assert.match((await gast.api('/api/seiten/datenschutz')).json.inhalt, /DSGVO/);
  assert.equal((await moni.api('/api/admin/seiten/impressum', { methode: 'PUT', daten: { titel: 'X', inhalt: 'Y' } })).status, 403);
  const neu = (await admin.api('/api/admin/seiten/impressum', { methode: 'PUT', daten: { titel: 'Impressum', inhalt: '# Impressum\n\nMax Muster' } })).json;
  assert.equal(neu.inhalt, '# Impressum\n\nMax Muster');
  assert.equal((await gast.api('/api/seiten/impressum')).json.inhalt, '# Impressum\n\nMax Muster');
});

test('Moderatoren bearbeiten auch IGDB-Einträge – Importe überschreiben das nicht', async () => {
  const treffer = (await nina.api('/api/katalog/suche?q=IGDB Spiel')).json.online[0];
  assert.equal((await nina.api(`/api/katalog/${treffer.id}`, { methode: 'PUT', daten: { beschreibung: 'Hack' } })).status, 403);
  const geaendert = (await moni.api(`/api/katalog/${treffer.id}`, { methode: 'PUT', daten: { beschreibung: 'Deutsche Beschreibung' } })).json;
  assert.equal(geaendert.beschreibung, 'Deutsche Beschreibung');
  assert.equal(geaendert.manuell_bearbeitet, 1);
  server.kontext.cache.raeumeAuf();
  server.db.prepare('DELETE FROM api_cache').run();
  await nina.api('/api/katalog/suche?q=IGDB Spiel'); // erneuter Import
  assert.equal((await nina.api(`/api/katalog/${treffer.id}`)).json.beschreibung, 'Deutsche Beschreibung');
});

test('Inhalte melden (auch ohne Konto) und durch das Moderationsteam entfernen', async () => {
  const spiel = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Melde-Test', veroeffentlichen: true })).json;
  const artikel = (await post(nina, '/api/artikel', { typ: 'spiel', titel: 'Melde-Test', katalog_id: spiel.id })).json;
  const formular = new FormData();
  formular.append('art', 'handbuch');
  formular.append('sichtbarkeit', 'eingereicht');
  formular.append('datei', new Blob([await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer()], { type: 'image/png' }), 'h.png');
  const medium = (await nina.api(`/api/artikel/${artikel.id}/medien`, { methode: 'POST', formular })).json;
  await post(moni, `/api/moderation/medien/${medium.id}/freigeben`);

  const gast = server.client();
  assert.equal((await post(gast, '/api/melden', { bereich: 'medien', ziel_id: medium.id, grund: 'urheberrecht', text: 'x' })).status, 404,
    'Scans sind ohne Anmeldung unsichtbar und daher auch nicht meldbar');
  assert.equal((await post(gast, '/api/melden', { bereich: 'katalog', ziel_id: spiel.id, grund: 'falsch', text: 'Falsches Jahr' })).status, 201);
  assert.equal((await post(admin, '/api/melden', { bereich: 'medien', ziel_id: medium.id, grund: 'urheberrecht', text: 'Ich bin Rechteinhaber', kontakt: 'recht@example.de' })).status, 201);
  assert.equal((await post(admin, '/api/melden', { bereich: 'medien', ziel_id: medium.id, grund: 'quatsch', text: '' })).status, 400);

  assert.equal((await nina.api('/api/moderation/meldungen')).status, 403);
  const offen = (await moni.api('/api/moderation/meldungen')).json;
  assert.equal(offen.length, 2);
  const meldung = offen.find((m) => m.bereich === 'medien');
  assert.equal(meldung.katalog_id, spiel.id);
  assert.equal((await moni.api('/api/moderation/warteschlange')).json.offeneMeldungen, 2);

  await post(moni, `/api/moderation/meldungen/${meldung.id}/erledigen`, { aktion: 'entfernen', ergebnis: 'Urheberrechtlich geschützt' });
  const nachher = (await nina.api(`/api/medien/${medium.id}`)).json;
  assert.equal(nachher.sichtbarkeit, 'abgelehnt', 'Uploader behält die Datei privat');
  assert.match(nachher.pruefung_notiz, /Urheberrechtlich/);
  assert.equal((await admin.api(`/api/medien/${medium.id}`)).status, 404);
  assert.equal((await moni.api('/api/moderation/meldungen')).json.length, 1);
});

test('Automatischer eBay-Import: Angebote filtern, Median speichern, Affiliate-Links', async () => {
  const spiel = (await post(moni, '/api/katalog', { typ: 'spiel', titel: 'Retro Racer', plattformen: ['Nintendo 64'], veroeffentlichen: true })).json;
  await post(nina, '/api/artikel', { typ: 'spiel', titel: 'Retro Racer', katalog_id: spiel.id, plattform: 'Nintendo 64' });

  const status = await server.kontext.preisimport.lauf({ pause: 0 });
  assert.ok(status.verarbeitet >= 1);
  assert.deepEqual(status.fehler, []);

  const seite = (await server.client().api(`/api/katalog-seite/${spiel.id}`)).json;
  // Nicht passende Titel („Super Mario“, „nur die Hülle“) werden verworfen, Ausreißer (999 €) ebenso
  assert.deepEqual(seite.ebayAngebote.angebote.map((a) => a.preis), [40, 50, 60, 999]);
  assert.equal(seite.ebayAngebote.statistik.median, 50);
  assert.equal(seite.ebayAngebote.statistik.anzahl, 3);
  assert.match(seite.ebayAngebote.angebote[2].url, /campid=5338000000/);
  const verlauf = seite.historie.find((h) => h.herkunft === 'ebay');
  assert.equal(verlauf.preis, 50);
  assert.equal(verlauf.anzahl, 3);

  const uebersicht = (await admin.api('/api/admin/uebersicht')).json;
  assert.equal(uebersicht.dienste.ebay, true);
  assert.ok(uebersicht.preisimport.letzterLauf);
  assert.equal((await moni.api('/api/admin/uebersicht')).status, 403);
});
