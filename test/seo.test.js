import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { slug, katalogPfad } from '../shared/seo.js';
import { markdownHtml } from '../server/routes/seo.js';

let server;
let moderator;
let nutzer;
let suchtreffer;

const seite = async (pfad) => {
  const r = await fetch(`${server.basis}${pfad}`, { redirect: 'manual' });
  return { status: r.status, ort: r.headers.get('location'), text: await r.text() };
};

before(async () => {
  server = await starteTestServer({ env: { AFFILIATE_AMAZON_TAG: 'test-21', PUBLIC_URL: 'https://sammlung.example.de' } });
  moderator = await server.registriere('chef'); // erster Benutzer = Admin
  nutzer = await server.registriere('sammler');
  // Ein IGDB-Suchtreffer landet freigegeben im Katalog, ohne dass ihn jemand sammelt
  suchtreffer = server.kontext.katalog.speichere({
    quelle: 'igdb', externe_id: '1074', typ: 'spiel', titel: 'Super Mario 64', plattformen: ['Nintendo 64'],
    erscheinungsjahr: 1996, hersteller: 'Nintendo', beschreibung: 'Mario erkundet Prinzessin Peachs Schloss.',
    cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co6ku4.jpg',
  });
});
after(async () => { await server.stoppe(); });

test('Adressen: sprechende Slugs mit Umlauten und Plattform', () => {
  assert.equal(slug('Pokémon: Gelbe Edition – Spezial Pikachu'), 'pokemon-gelbe-edition-spezial-pikachu');
  assert.equal(slug('Mario & Luigi'), 'mario-und-luigi');
  assert.equal(katalogPfad({ id: 7, typ: 'spiel', titel: 'Zelda' }, 'SNES'), '/spiel/7-zelda-snes');
  assert.equal(katalogPfad({ id: 8, typ: 'konsole', titel: 'SNES Mini' }, 'SNES'), '/konsole/8-snes-mini');
});

test('Reine Suchtreffer: aufrufbar, aber noindex und nicht in der Sitemap', async () => {
  const kurz = await seite(`/spiel/${suchtreffer.id}`);
  assert.equal(kurz.status, 301);
  assert.equal(kurz.ort, `/spiel/${suchtreffer.id}-super-mario-64-n64`);
  const s = await seite(kurz.ort);
  assert.equal(s.status, 200);
  assert.match(s.text, /<meta name="robots" content="noindex,follow">/);
  assert.match(s.text, /Noch hat kein Sammler/);
  const sitemap = await seite('/sitemap-katalog-1.xml');
  assert.doesNotMatch(sitemap.text, /super-mario-64/);
  assert.doesNotMatch((await seite('/sitemap-plattformen.xml')).text, /plattform\/n64/);
});

test('Sobald jemand das Spiel sammelt: indexierbar mit Metadaten, JSON-LD und Sammleranzahl', async () => {
  const a = await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', plattform: 'Nintendo 64', katalog_id: suchtreffer.id } });
  assert.equal(a.status, 201, a.text);
  await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Super Mario 64', plattform: 'Nintendo 64', katalog_id: suchtreffer.id } });
  server.db.prepare(`INSERT INTO preis_historie (katalog_id, herkunft, art, preis, datum, quelle, anzahl) VALUES
    (?, 'ebay', 'angebot', 40, date('now', '-3 days'), 'ebay', 6), (?, 'meldung', 'verkauf', 25, date('now', '-10 days'), 'nutzer', 1)`)
    .run(suchtreffer.id, suchtreffer.id);

  const pfad = `/spiel/${suchtreffer.id}-super-mario-64-n64`;
  const s = await seite(pfad);
  assert.equal(s.status, 200);
  assert.match(s.text, /<meta name="robots" content="index,follow/);
  assert.match(s.text, /<title>Super Mario 64 \(N64\) – Wert, Varianten &amp; Infos \| ZockDB<\/title>/);
  assert.match(s.text, new RegExp(`<link rel="canonical" href="https://sammlung\\.example\\.de${pfad}">`));
  assert.match(s.text, /<meta name="description" content="Super Mario 64 für Nintendo 64 \(1996\)\. Aktueller Wert ca\. 37,86/);
  assert.match(s.text, /<b>1<\/b> Sammler hat diesen Eintrag in seiner Sammlung · 2 Exemplare insgesamt/);
  assert.match(s.text, /Spanne 25,00\s€ – 40,00\s€, 7 Preisangaben/);
  assert.match(s.text, /"@type":"VideoGame"/);
  assert.match(s.text, /"@type":"BreadcrumbList"/);
  assert.match(s.text, /rel="sponsored noopener"/);
  assert.match(s.text, /Anzeige/);
  assert.match(s.text, /href="\/\?app=1#\/katalog\/\d+\?app=1"/);

  const sitemap = await seite('/sitemap-katalog-1.xml');
  assert.match(sitemap.text, new RegExp(`<loc>https://sammlung\\.example\\.de${pfad}</loc><lastmod>\\d{4}-\\d\\d-\\d\\d</lastmod>`));
  assert.match((await seite('/sitemap-plattformen.xml')).text, /<loc>https:\/\/sammlung\.example\.de\/plattform\/n64<\/loc>/);
  assert.match((await seite('/sitemap.xml')).text, /<sitemapindex/);

  const plattform = await seite('/plattform/n64');
  assert.equal(plattform.status, 200);
  assert.match(plattform.text, /Super Mario 64/);
  assert.match(plattform.text, /1 Sammler/);
  assert.match((await seite('/plattformen')).text, /Nintendo 64/);
  // Falscher Typ-Präfix → kanonische Adresse
  assert.equal((await seite(`/konsole/${suchtreffer.id}-irgendwas`)).ort, pfad);
});

test('Sammlerhinweise: Markdown sicher gerendert, SEO-Angaben nur durch Moderatoren', async () => {
  assert.equal(markdownHtml('<script>alert(1)</script> **fett** [x](javascript:alert(1))'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt; <strong>fett</strong> [x](javascript:alert(1))</p>');

  const aenderung = await moderator.api(`/api/katalog/${suchtreffer.id}`, { methode: 'PUT', daten: {
    sammlerhinweise: '## PAL-Versionen\n- **Erstauflage:** graues Modul\n- Players Choice <b>rot</b>',
    seo_titel: 'Super Mario 64 – PAL-Varianten und Wert', seo_beschreibung: 'Alles über die PAL-Fassungen.',
  } });
  assert.equal(aenderung.status, 200, aenderung.text);
  const s = await seite(`/spiel/${suchtreffer.id}-super-mario-64-n64`);
  assert.match(s.text, /<h2>Sammlerhinweise<\/h2><h3>PAL-Versionen<\/h3><ul><li><strong>Erstauflage:<\/strong> graues Modul<\/li><li>Players Choice &lt;b&gt;rot&lt;\/b&gt;<\/li><\/ul>/);
  assert.match(s.text, /<title>Super Mario 64 – PAL-Varianten und Wert<\/title>/);
  assert.match(s.text, /content="Alles über die PAL-Fassungen\."/);

  // Eigener Eintrag eines Nutzers: Sammlerhinweise ja, SEO-Felder nein
  const eigen = (await nutzer.api('/api/katalog', { methode: 'POST', daten: { typ: 'konsole', titel: 'Hausgemachte Konsole', plattformen: ['SNES'] } })).json;
  const r = await nutzer.api(`/api/katalog/${eigen.id}`, { methode: 'PUT', daten: { sammlerhinweise: 'Selbst gebaut', seo_titel: 'Spam!' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.sammlerhinweise, 'Selbst gebaut');
  assert.equal(r.json.seo_titel, null);
  // Private Einträge haben keine öffentliche Seite
  assert.equal((await seite(`/konsole/${eigen.id}`)).status, 404);
});

test('Vorschlag für Sammlerhinweise landet bei den Meldungen', async () => {
  const r = await nutzer.api('/api/melden', { methode: 'POST', daten: { bereich: 'katalog', ziel_id: suchtreffer.id, grund: 'ergaenzung', text: 'Es gibt eine Players-Choice-Version.' } });
  assert.equal(r.status, 201, r.text);
  const liste = (await moderator.api('/api/moderation/meldungen')).json;
  assert.ok(JSON.stringify(liste).includes('Players-Choice-Version'));
});

test('robots.txt, API ohne Indexierung und abgeschalteter öffentlicher Katalog', async () => {
  const robots = await seite('/robots.txt');
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, /Sitemap: https:\/\/sammlung\.example\.de\/sitemap\.xml/);
  const api = await fetch(`${server.basis}/api/health`);
  assert.equal(api.headers.get('x-robots-tag'), 'noindex, nofollow');

  const zu = await starteTestServer({ env: { PUBLIC_CATALOG: 'false' } });
  try {
    const r = await fetch(`${zu.basis}/spiel/1`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/?app=1#/katalog/1');
    assert.match(await (await fetch(`${zu.basis}/robots.txt`)).text(), /Disallow: \/\n/);
  } finally {
    await zu.stoppe();
  }
});

test('Startseite für Besucher mit beliebten und neuen Spielen, App für Angemeldete', async () => {
  const s = await seite('/');
  assert.equal(s.status, 200);
  assert.match(s.text, /<title>ZockDB – Deine Spielesammlung an einem Platz<\/title>/);
  assert.match(s.text, /Beliebt bei Sammlern/);
  assert.match(s.text, /Neu in ZockDB/);
  assert.match(s.text, /super-mario-64-n64/);
  assert.match(s.text, /"@type":"SearchAction"/);
  assert.match(s.text, /href="\/\?app=1#\/"/);
  // Mit Sitzungs-Cookie oder ?app geht es in die App (hier ohne gebaute Oberfläche: 404)
  const angemeldet = await fetch(`${server.basis}/`, { headers: { Cookie: 'vss_sitzung=abc' }, redirect: 'manual' });
  assert.doesNotMatch(await angemeldet.text(), /Beliebt bei Sammlern/);
  assert.doesNotMatch((await seite('/?app=1')).text, /Beliebt bei Sammlern/);
  assert.match((await seite('/sitemap-plattformen.xml')).text, /<loc>https:\/\/sammlung\.example\.de\/<\/loc>/);
});

test('Suche für alle: Treffer mit Sammleranzahl, nicht indexiert', async () => {
  const s = await seite('/suche?q=mario');
  assert.equal(s.status, 200);
  assert.match(s.text, /Suche: „mario“/);
  assert.match(s.text, /Super Mario 64/);
  assert.match(s.text, /<meta name="robots" content="noindex,follow">/);
  const leer = await seite('/suche?q=gibtsnicht');
  assert.match(leer.text, /Keine Treffer/);
  assert.match((await seite('/suche?q=%25')).text, /Keine Treffer/, 'Platzhalter werden maskiert');
});

test('Sammlung per geheimem Link teilen: ohne Konto sichtbar, ohne private Angaben, widerrufbar', async () => {
  await nutzer.api('/api/artikel', { methode: 'POST', daten: { typ: 'konsole', titel: 'Nintendo 64 Konsole', plattform: 'Nintendo 64', kaufpreis: 123.45, seriennummer: 'NUS-GEHEIM-1', notizen: 'Geheime Notiz', marktwert: 80 } });
  const f = (await nutzer.api('/api/konto/freigabe', { methode: 'POST', daten: { wert_zeigen: true } })).json;
  assert.equal(f.aktiv, true);
  assert.match(f.url, /^https:\/\/sammlung\.example\.de\/sammlung\/[\w-]{20,}$/);
  const s = await seite(f.pfad);
  assert.equal(s.status, 200);
  assert.match(s.text, /Die Sammlung von sammler/);
  assert.match(s.text, /Nintendo 64 Konsole/);
  assert.match(s.text, /geschätzter Wert/);
  assert.match(s.text, /noindex/);
  for (const privat of ['123,45', 'NUS-GEHEIM-1', 'Geheime Notiz']) assert.doesNotMatch(s.text, new RegExp(privat));
  const r = await fetch(`${server.basis}${f.pfad}`);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');

  const neu = (await nutzer.api('/api/konto/freigabe', { methode: 'POST', daten: { neu: true } })).json;
  assert.notEqual(neu.pfad, f.pfad);
  assert.equal((await seite(f.pfad)).status, 404, 'alter Link ungültig');
  await nutzer.api('/api/konto/freigabe', { methode: 'DELETE' });
  assert.equal((await seite(neu.pfad)).status, 404);
  assert.equal((await seite('/sammlung/zu-kurz')).status, 404);
});
