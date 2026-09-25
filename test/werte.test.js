import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

const EZB_XML = `<gesmes:Envelope><Cube><Cube time="2026-09-25"><Cube currency='USD' rate='1.25'/></Cube></Cube></gesmes:Envelope>`;

function falschePreise() {
  const anfragen = [];
  const fetchFn = async (url) => {
    const u = String(url);
    anfragen.push(u);
    if (u.includes('ecb.europa.eu')) return new Response(EZB_XML);
    if (u.includes('pricecharting.com/api/product')) {
      return Response.json({
        status: 'success', id: '6910', 'product-name': 'Super Mario 64', 'console-name': 'PAL Nintendo 64',
        'loose-price': 2500, 'cib-price': 10000, 'new-price': 50000, 'box-only-price': 5000, 'manual-only-price': 1500,
      });
    }
    return new Response('?', { status: 404 });
  };
  return { fetchFn, anfragen };
}

test('Marktpreise von PriceCharting werden in Euro umgerechnet und je Vollständigkeit gewählt', async () => {
  const { fetchFn, anfragen } = falschePreise();
  const s = await starteTestServer({ env: { PRICECHARTING_TOKEN: 'token' }, fetchFn });
  try {
    const c = await s.registriere('sammlerin');
    const eintrag = (await c.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', plattformen: ['Nintendo 64'] } })).json;
    const neu = (daten) => c.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', plattform: 'Nintendo 64', katalog_id: eintrag.id, region: 'pal_de', ...daten } });
    await neu({ vollstaendigkeit: 'cib', kaufpreis: '60' });
    await neu({ vollstaendigkeit: 'nur_geraet', kaufpreis: '15', anzahl: 2 });
    await neu({ vollstaendigkeit: 'nur_geraet', marktwert: '99' }); // eigene Schätzung hat Vorrang

    const vorher = (await c.api('/api/werte')).json;
    assert.equal(vorher.ohnePreisdaten, 3);

    const aktualisierung = (await c.api('/api/werte/aktualisieren', { methode: 'POST' })).json;
    assert.deepEqual(aktualisierung, { aktualisiert: 1, offen: 0 }, 'gleiche Spiele werden nur einmal abgefragt');
    assert.ok(anfragen.some((u) => u.includes('q=Super+Mario+64+PAL+Nintendo+64')));

    const werte = (await c.api('/api/werte')).json;
    // 1 USD = 0,8 EUR → lose 20 €, CIB 80 €
    const cib = werte.artikel.find((a) => a.vollstaendigkeit === 'cib' && a.kaufpreis === 60);
    assert.equal(cib.wert, 80);
    assert.equal(cib.quelle, 'PriceCharting (CIB)');
    const lose = werte.artikel.find((a) => a.kaufpreis === 15);
    assert.equal(lose.gesamtwert, 40);
    const geschaetzt = werte.artikel.find((a) => a.quelle === 'Eigene Schätzung');
    assert.equal(geschaetzt.wert, 99);
    assert.equal(werte.sammlungswert, 80 + 40 + 99);
    assert.equal(werte.kaufwert, 60 + 30);
    assert.equal(werte.differenz, (80 + 40) - 90);

    const einzel = (await c.api(`/api/katalog/${eintrag.id}/wert?region=pal`)).json;
    assert.equal(einzel.marktpreise.cib, 80);
    assert.equal(einzel.community.besitzer, 1);
    assert.equal(einzel.community.exemplare, 4);
  } finally {
    await s.stoppe();
  }
});

test('Community-Werte erscheinen erst ab drei Angaben', async () => {
  const s = await starteTestServer();
  try {
    const erste = await s.registriere('eins');
    const eintrag = (await erste.api('/api/katalog', { methode: 'POST', daten: { typ: 'konsole', titel: 'Sega Saturn' } })).json;
    const nutzer = [erste, await s.registriere('zwei'), await s.registriere('drei')];
    const preise = ['100', '150', '400'];
    for (let i = 0; i < 2; i++) {
      await nutzer[i].api('/api/artikel', { methode: 'POST', daten: { typ: 'konsole', titel: 'Sega Saturn', katalog_id: eintrag.id, kaufpreis: preise[i], marktwert: preise[i] } });
    }
    let wert = (await erste.api(`/api/katalog/${eintrag.id}/wert`)).json;
    assert.equal(wert.community.besitzer, 2);
    assert.equal(wert.community.median_kaufpreis, null);

    await nutzer[2].api('/api/artikel', { methode: 'POST', daten: { typ: 'konsole', titel: 'Sega Saturn', katalog_id: eintrag.id, kaufpreis: preise[2], marktwert: preise[2] } });
    wert = (await erste.api(`/api/katalog/${eintrag.id}/wert`)).json;
    assert.equal(wert.community.besitzer, 3);
    assert.equal(wert.community.median_kaufpreis, 150);
    assert.equal(wert.priceChartingAktiv, false);

    // Ein vierter Sammler ohne eigene Schätzung bekommt den Community-Median als Wert
    const vier = await s.registriere('vier');
    await vier.api('/api/artikel', { methode: 'POST', daten: { typ: 'konsole', titel: 'Sega Saturn', katalog_id: eintrag.id } });
    const werte = (await vier.api('/api/werte')).json;
    assert.equal(werte.artikel[0].wert, 150);
    assert.equal(werte.artikel[0].quelle, 'Community');
  } finally {
    await s.stoppe();
  }
});
