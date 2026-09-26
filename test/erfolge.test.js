import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

let server;
let nutzer;
before(async () => {
  server = await starteTestServer();
  await server.registriere('admin');
  nutzer = await server.registriere('sammlerin');
});
after(async () => { await server.stoppe(); });

test('Erfolge werden beim Sammeln freigeschaltet und gemeldet', async () => {
  let e = (await nutzer.api('/api/erfolge')).json;
  assert.equal(e.freigeschaltet, 0);
  assert.ok(e.gesamt >= 15);

  await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Tetris', plattform: 'Game Boy', region: 'pal_de', vollstaendigkeit: 'cib' } });
  e = (await nutzer.api('/api/erfolge')).json;
  const erste = e.erfolge.find((x) => x.schluessel === 'erster_eintrag');
  assert.ok(erste.freigeschaltet_am);
  const sammler = e.erfolge.find((x) => x.schluessel === 'sammler_10');
  assert.equal(sammler.stand, 1);
  assert.equal(sammler.ziel, 10);
  assert.equal(sammler.freigeschaltet_am, null);

  const n = (await nutzer.api('/api/benachrichtigungen')).json;
  assert.ok(n.eintraege.some((b) => b.art === 'erfolg' && b.titel.includes('Erste Schritte')));

  // Mit 10 Stück ist „Sammler“ erreicht – genau eine Benachrichtigung
  await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Kirby', plattform: 'Game Boy', anzahl: 9 } });
  e = (await nutzer.api('/api/erfolge')).json;
  assert.ok(e.erfolge.find((x) => x.schluessel === 'sammler_10').freigeschaltet_am);
  const liste = (await nutzer.api('/api/benachrichtigungen')).json.eintraege.filter((b) => b.titel.includes('Sammler') && b.art === 'erfolg');
  assert.equal(liste.length, 1);
});
