import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let laden;
let spiel;

const post = (c, pfad, daten) => c.api(pfad, { methode: 'POST', daten });
const put = (c, pfad, daten) => c.api(pfad, { methode: 'PUT', daten });

before(async () => {
  server = await starteTestServer({ env: { MARKET_MIN_ACCOUNT_DAYS: '0' } });
  admin = await server.registriere('admin');
  laden = await server.registriere('laden');
  spiel = (await post(admin, '/api/katalog', { typ: 'spiel', titel: 'Super Metroid', plattformen: ['Super Nintendo'], veroeffentlichen: true })).json;
  await put(laden, '/api/boerse/haendler', {
    firma: 'Retroladen <GmbH>', anschrift: 'Musterstraße 1\n40213 Düsseldorf', email: 'info@retroladen.example',
    shop_url: 'https://retroladen.example', versandinfo: 'DHL 5,49 €', ustid: 'DE123456789',
  });
  await post(laden, '/api/boerse/angebote', { katalog_id: spiel.id, preis: '59,90', zustand: 'gut', vollstaendigkeit: 'cib' });
});
after(async () => { await server.stoppe(); });

test('Händlerseite erst nach Verifizierung; gelistet nur mit Paket', async () => {
  const gast = server.client();
  assert.equal((await gast.api('/haendler/2')).status, 404, 'unverifiziert nicht öffentlich');
  await post(admin, '/api/admin/benutzer/2/haendler', { verifiziert: true });

  // Kanonische Adresse mit Slug
  const umleitung = await fetch(`${server.basis}/haendler/2`, { redirect: 'manual' });
  assert.equal(umleitung.status, 301);
  assert.equal(umleitung.headers.get('location'), '/haendler/2-retroladen-gmbh');

  let html = (await gast.api('/haendler/2-retroladen-gmbh')).text;
  assert.match(html, /<h1>Retroladen &lt;GmbH&gt;<\/h1>/, 'Firmenname wird maskiert');
  assert.match(html, /Musterstraße 1<br>40213 Düsseldorf/);
  assert.match(html, /Super Metroid \(SNES\)<\/a> – <b>59,90/);
  assert.match(html, /DE123456789/);
  assert.match(html, /noindex/, 'ohne Paket nicht bei Google');
  assert.match(html, /rel="noopener nofollow"/, 'Shop-Link ohne Paket nofollow');
  assert.match(html, /"@type":"Store"/);
  assert.doesNotMatch((await gast.api('/sitemap-plattformen.xml')).text, /haendler/);
  assert.match((await gast.api('/haendler')).text, /Retroladen &lt;GmbH&gt;/);

  // Profil im Händlerbereich nennt die Adresse
  const profil = (await laden.api('/api/boerse/haendler')).json;
  assert.deepEqual(profil.oeffentlich, { pfad: '/haendler/2-retroladen-gmbh', indexiert: false });

  // Mit Paket: indexierbar, in der Sitemap, Shop-Link ohne nofollow
  const bis = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await post(admin, '/api/admin/benutzer/2/paket', { angebote: 500, bis })).status, 200);
  html = (await gast.api('/haendler/2-retroladen-gmbh')).text;
  assert.match(html, /index,follow/);
  assert.match(html, /rel="noopener" target="_blank">retroladen\.example/);
  assert.match((await gast.api('/sitemap-plattformen.xml')).text, /\/haendler\/2-retroladen-gmbh</);

  // Gesperrt → nicht mehr öffentlich
  server.db.prepare('UPDATE benutzer SET gesperrt = 1 WHERE id = 2').run();
  assert.equal((await gast.api('/haendler/2-retroladen-gmbh')).status, 404);
});
