import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let admin;
let nina;
let otto;
let spiel;
before(async () => {
  server = await starteTestServer();
  admin = await server.registriere('admin');
  nina = await server.registriere('nina');
  otto = await server.registriere('otto');
  spiel = (await admin.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', veroeffentlichen: true } })).json;
});
after(async () => { await server.stoppe(); });
const post = (c, pfad, daten = {}) => c.api(pfad, { methode: 'POST', daten });

test('Links werden geprüft: nur https, keine Zugangsdaten, keine Duplikate', async () => {
  const ungueltig = [
    { art: 'handbuch', url: 'http://unsicher.example/a.pdf' },
    { art: 'handbuch', url: 'javascript:alert(1)' },
    { art: 'handbuch', url: 'https://nutzer:pass@example.de/x' },
    { art: 'quatsch', url: 'https://example.de/x' },
  ];
  for (const d of ungueltig) assert.equal((await post(nina, `/api/katalog/${spiel.id}/links`, d)).status, 400, d.url);
  const ok = await post(nina, `/api/katalog/${spiel.id}/links`, { art: 'handbuch', url: 'https://www.nintendo.de/anleitung/sm64.pdf', titel: 'Offizielle Anleitung' });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.domain, 'nintendo.de');
  assert.equal(ok.json.status, 'eingereicht');
  const doppelt = await post(otto, `/api/katalog/${spiel.id}/links`, { art: 'handbuch', url: 'https://www.nintendo.de/anleitung/sm64.pdf' });
  assert.match(doppelt.json.felder.url, /bereits/);
});

test('Vorgeschlagene Links erscheinen erst nach Freigabe – auch öffentlich', async () => {
  const link = (await post(nina, `/api/katalog/${spiel.id}/links`, { art: 'cover_vorne', url: 'https://cover.example/sm64-pal.jpg' })).json;
  const gast = server.client();
  const vorher = (await gast.api(`/api/katalog-seite/${spiel.id}`)).json.links;
  assert.ok(!vorher.some((l) => l.id === link.id));
  assert.ok((await otto.api(`/api/katalog/${spiel.id}/links`)).json.every((l) => l.id !== link.id));
  assert.ok((await nina.api(`/api/katalog/${spiel.id}/links`)).json.some((l) => l.id === link.id), 'Einreicher sieht seinen Vorschlag');

  const schlange = (await admin.api('/api/moderation/warteschlange')).json;
  assert.ok(schlange.links.some((l) => l.id === link.id && l.eingereicht_von === 'nina'));
  assert.equal((await post(otto, `/api/moderation/links/${link.id}/freigeben`)).status, 403);
  await post(admin, `/api/moderation/links/${link.id}/freigeben`);

  const oeffentlich = (await gast.api(`/api/katalog-seite/${spiel.id}`)).json.links.find((l) => l.id === link.id);
  assert.equal(oeffentlich.url, 'https://cover.example/sm64-pal.jpg');
  assert.equal(oeffentlich.eigener, false);
  assert.equal(oeffentlich.darf_loeschen, false);
  // Freigegebene Links kann der Einreicher nicht mehr selbst löschen, das Moderationsteam schon
  assert.equal((await nina.api(`/api/links/${link.id}`, { methode: 'DELETE' })).status, 404);
});

test('Private Links sind persönliche Lesezeichen', async () => {
  const privat = (await post(otto, `/api/katalog/${spiel.id}/links`, { art: 'handbuch', url: 'https://archiv.example/sm64', sichtbarkeit: 'privat' })).json;
  assert.equal(privat.status, 'privat');
  assert.ok(!(await admin.api('/api/moderation/warteschlange')).json.links.some((l) => l.id === privat.id));
  assert.ok(!(await nina.api(`/api/katalog/${spiel.id}/links`)).json.some((l) => l.id === privat.id));
  assert.equal((await otto.api(`/api/links/${privat.id}`, { methode: 'DELETE' })).status, 204);
});

test('Freigegebene Links lassen sich melden und entfernen', async () => {
  const link = (await post(admin, `/api/katalog/${spiel.id}/links`, { art: 'label', url: 'https://labels.example/sm64', sichtbarkeit: 'freigegeben' })).json;
  assert.equal(link.status, 'freigegeben', 'Moderatoren dürfen direkt freigeben');
  assert.equal((await post(server.client(), '/api/melden', { bereich: 'link', ziel_id: link.id, grund: 'urheberrecht', text: 'Die Seite bietet raubkopierte Scans an.' })).status, 201);
  const meldung = (await admin.api('/api/moderation/meldungen')).json.find((m) => m.bereich === 'link');
  assert.match(meldung.ziel_titel, /labels\.example/);
  await post(admin, `/api/moderation/meldungen/${meldung.id}/erledigen`, { aktion: 'entfernen' });
  assert.ok(!(await server.client().api(`/api/katalog-seite/${spiel.id}`)).json.links.some((l) => l.id === link.id));
});

test('Optional nur erlaubte Domains', async () => {
  const s = await starteTestServer({ env: { LINK_DOMAINS: 'nintendo.de, archive.org' } });
  try {
    const a = await s.registriere('anton');
    const k = (await a.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'T', veroeffentlichen: true } })).json;
    const nein = await a.api(`/api/katalog/${k.id}/links`, { methode: 'POST', daten: { art: 'handbuch', url: 'https://irgendwo.example/x' } });
    assert.match(nein.json.felder.url, /nintendo\.de, archive\.org/);
    const ja = await a.api(`/api/katalog/${k.id}/links`, { methode: 'POST', daten: { art: 'handbuch', url: 'https://web.archive.org/details/x' } });
    assert.equal(ja.status, 201);
  } finally {
    await s.stoppe();
  }
});
