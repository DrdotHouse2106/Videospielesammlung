import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

function falscheIgdb() {
  const aufrufe = [];
  const fetchFn = async (url, optionen = {}) => {
    aufrufe.push({ url: String(url), body: optionen.body });
    if (String(url).startsWith('https://id.twitch.tv')) {
      return Response.json({ access_token: 'token123', expires_in: 3600 });
    }
    if (String(url).endsWith('/games')) {
      return Response.json([{
        id: 1022, name: 'The Legend of Zelda', first_release_date: 509328000,
        cover: { image_id: 'co1uii' }, platforms: [{ name: 'NES' }],
        involved_companies: [{ publisher: true, company: { name: 'Nintendo' } }],
      }]);
    }
    return new Response('nicht gefunden', { status: 404 });
  };
  return { fetchFn, aufrufe };
}

test('IGDB-Suche wird zwischengespeichert und im Katalog abgelegt', async () => {
  const { fetchFn, aufrufe } = falscheIgdb();
  const server = await starteTestServer({ env: { TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'geheim' }, fetchFn });
  try {
    const erste = await server.api('/api/katalog/suche?q=zelda');
    assert.equal(erste.json.online.length, 1);
    const spiel = erste.json.online[0];
    assert.equal(spiel.hersteller, 'Nintendo');
    assert.equal(spiel.erscheinungsjahr, 1986);
    assert.equal(spiel.cover_url, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1uii.jpg');

    const zweite = await server.api('/api/katalog/suche?q=Zelda');
    assert.equal(zweite.json.lokal[0].id, spiel.id, 'Treffer steht jetzt im lokalen Katalog');
    assert.equal(aufrufe.filter((a) => a.url.endsWith('/games')).length, 1, 'zweite Suche kommt aus dem Cache');
    assert.equal(aufrufe.filter((a) => a.url.includes('twitch')).length, 1, 'Token wird wiederverwendet');
  } finally {
    await server.stoppe();
  }
});

test('Barcode → Produktname → IGDB-Suche', async () => {
  const { fetchFn } = falscheIgdb();
  const mitUpc = async (url, optionen) => (String(url).includes('upcitemdb')
    ? Response.json({ items: [{ title: 'The Legend of Zelda - [NES] PAL' }] })
    : fetchFn(url, optionen));
  const server = await starteTestServer({
    env: { TWITCH_CLIENT_ID: 'id', TWITCH_CLIENT_SECRET: 'geheim', BARCODE_PROVIDERS: 'upcitemdb' },
    fetchFn: mitUpc,
  });
  try {
    const { json } = await server.api('/api/katalog/barcode/045496630010');
    assert.equal(json.produktname, 'The Legend of Zelda - [NES] PAL');
    assert.equal(json.suchbegriff, 'The Legend of Zelda');
    assert.equal(json.treffer[0].titel, 'The Legend of Zelda');
  } finally {
    await server.stoppe();
  }
});
