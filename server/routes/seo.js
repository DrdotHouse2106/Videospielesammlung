// Öffentliche, vom Server erzeugte Seiten für Suchmaschinen (ohne JavaScript-Bundle):
//   /spiel/:id-slug, /konsole/:id-slug, /zubehoer/:id-slug – ein Katalogeintrag
//   /plattformen, /plattform/:slug                          – Übersichten
//   /sitemap.xml, /sitemap-*.xml, /robots.txt
//
// Seiten werden erst beim Aufruf erzeugt, nichts wird vorab gespeichert.
// Indexierbar (Sitemap, kein noindex) sind nur freigegebene Einträge, die mindestens ein Benutzer
// in seiner Sammlung hat oder die vom Moderationsteam gepflegt wurden – und die nicht „dünn“ sind.
// Reine IGDB-Suchtreffer bleiben aufrufbar, sind aber für Suchmaschinen gesperrt.
import { Router } from 'express';
import { HERSTELLER_REIHENFOLGE, ARTIKELTYPEN, MEDIENARTEN, REGIONEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, beschriftung } from '../../shared/konstanten.js';
import { katalogPfad, plattformPfad, slug, KATALOG_PRAEFIXE, APP_START, appLink } from '../../shared/seo.js';
import { leseCookies } from '../middleware/auth.js';
import { COOKIE_NAME } from '../services/konten.js';
import { erstelleDrossel } from '../services/drossel.js';
import { MARKE } from '../../shared/marke.js';
import { katalogZeileZuObjekt } from '../services/katalog.js';

const APP = MARKE.name;
const PRO_SEITE = 60;
const PRO_SITEMAP = 40000;

/** Gepflegt oder gesammelt – und nicht nur ein leerer Suchtreffer (Alias k). */
export const INDEXIERBAR_SQL = `(k.status = 'freigegeben'
  AND (EXISTS (SELECT 1 FROM artikel a WHERE a.katalog_id = k.id)
       OR k.quelle = 'eigen'
       OR COALESCE(TRIM(k.sammlerhinweise), '') <> ''
       OR EXISTS (SELECT 1 FROM medien m WHERE m.katalog_id = k.id AND m.sichtbarkeit = 'freigegeben')
       OR EXISTS (SELECT 1 FROM externe_links l WHERE l.katalog_id = k.id AND l.status = 'freigegeben'))
  AND (COALESCE(TRIM(k.beschreibung), '') <> '' OR COALESCE(TRIM(k.sammlerhinweise), '') <> ''
       OR k.cover_url IS NOT NULL OR EXISTS (SELECT 1 FROM preis_historie h WHERE h.katalog_id = k.id)))`;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (z) => ESC[z]);
const euro = (n) => Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const zahl = (n) => Number(n).toLocaleString('de-DE');
const kuerze = (text, max) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};
const jsonLd = (daten) => `<script type="application/ld+json">${JSON.stringify(daten).replace(/</g, '\\u003c')}</script>`;

// ── Kleiner, sicherer Markdown-Renderer (wie im Client: Überschriften, Listen, fett, kursiv, Links) ──
function inlineMd(text) {
  return esc(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="nofollow ugc noopener" target="_blank">$1</a>');
}
export function markdownHtml(text) {
  return String(text ?? '').replace(/\r/g, '').split(/\n{2,}/).map((block) => {
    const zeilen = block.split('\n').filter((z) => z.trim());
    if (!zeilen.length) return '';
    const u = zeilen[0].match(/^(#{1,3})\s+(.*)$/);
    if (u && zeilen.length === 1) return `<h3>${inlineMd(u[2])}</h3>`;
    if (zeilen.every((z) => /^\s*[-*]\s+/.test(z))) return `<ul>${zeilen.map((z) => `<li>${inlineMd(z.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    if (zeilen.every((z) => /^\s*\d+\.\s+/.test(z))) return `<ol>${zeilen.map((z) => `<li>${inlineMd(z.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`;
    if (u) return `<h3>${inlineMd(u[2])}</h3>${markdownHtml(zeilen.slice(1).join('\n'))}`; // Überschrift direkt gefolgt von Text/Liste
    return `<p>${zeilen.map(inlineMd).join('<br>')}</p>`;
  }).join('\n');
}

const CSS = `
:root{--hg:#16131f;--karte:#201c2c;--rand:#2f2940;--text:#ece9f5;--leise:#a39cb8;--akzent:#8b5cf6;--akzent-hell:#b79cff;--akzent-text:#fff}
@media (prefers-color-scheme: light){:root{--hg:#f6f4fb;--karte:#fff;--rand:#e2ddef;--text:#1d1830;--leise:#5f5873;--akzent:#7c3aed;--akzent-hell:#6d28d9}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--hg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
a{color:var(--akzent-hell)}
.kopf{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--rand)}
.kopf a.marke{display:flex;align-items:center;gap:8px;color:var(--text);font-weight:700;text-decoration:none}
.kopf img{width:32px;height:32px}.kopf-rechts{display:flex;align-items:center;gap:6px}.suchknopf{color:var(--text);padding:8px;border-radius:10px;display:inline-flex}
.suche{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.suche input{flex:1 1 100%;min-width:0;padding:12px 14px;border-radius:12px;border:1px solid var(--rand);background:var(--karte);color:var(--text);font-size:16px}.suche select{flex:1;padding:12px;border-radius:12px;border:1px solid var(--rand);background:var(--karte);color:var(--text);font-size:15px}@media(min-width:640px){.suche input{flex:1}.suche select{flex:0 0 auto}}
.held{text-align:center;padding:24px 0 8px}.held img{width:88px;height:88px}.held h1{font-size:34px;margin:8px 0 2px}.held .unter{color:var(--akzent-hell);font-weight:600;margin:0 0 10px}.knoepfe{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:14px 0}
.merkmale{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.merkmale div{background:var(--karte);border:1px solid var(--rand);border-radius:14px;padding:12px}.kopf .marke span{display:flex;flex-direction:column;line-height:1.15}.kopf .marke small{font-weight:400;font-size:12px;color:var(--leise)}@media(max-width:380px){.kopf .marke small{display:none}}
.knopf{white-space:nowrap;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:12px;background:var(--akzent);color:var(--akzent-text);font-weight:600;text-decoration:none}
.knopf.zweit{background:transparent;border:1px solid var(--rand);color:var(--text)}
main{max-width:860px;margin:0 auto;padding:16px}
nav.pfad{font-size:14px;color:var(--leise);margin-bottom:12px}nav.pfad a{color:var(--leise)}
h1{font-size:28px;line-height:1.2;margin:0 0 6px}h2{font-size:20px;margin:0 0 10px}h3{font-size:17px;margin:14px 0 6px}
.kopfbereich{display:grid;gap:16px}@media(min-width:640px){.kopfbereich{grid-template-columns:220px 1fr}}
.cover{width:100%;max-width:220px;aspect-ratio:3/4;object-fit:cover;border-radius:14px;background:var(--karte);border:1px solid var(--rand)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{padding:3px 10px;border-radius:999px;background:var(--karte);border:1px solid var(--rand);font-size:13px;color:var(--text);text-decoration:none}
.karte{background:var(--karte);border:1px solid var(--rand);border-radius:16px;padding:16px;margin:16px 0}
.zahlen{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.zahl{background:var(--hg);border-radius:12px;padding:10px}.zahl b{display:block;font-size:22px}
.leise{color:var(--leise);font-size:14px}
ul.liste{list-style:none;padding:0;margin:0}ul.liste li{padding:8px 0;border-top:1px solid var(--rand)}ul.liste li:first-child{border-top:0}
.raster{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;list-style:none;padding:0;margin:0}
.raster a{display:block;color:var(--text);text-decoration:none}.raster img{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:12px;background:var(--karte);border:1px solid var(--rand)}
.raster .platzhalter{width:100%;aspect-ratio:3/4;border-radius:12px;background:var(--karte);border:1px solid var(--rand);display:grid;place-items:center;font-size:36px}
.werbung{font-size:12px;color:var(--leise);border:1px solid var(--rand);border-radius:6px;padding:1px 6px;margin-left:6px}
.seiten{display:flex;justify-content:space-between;gap:8px;margin-top:16px}
footer{max-width:860px;margin:24px auto;padding:16px;color:var(--leise);font-size:14px;display:flex;flex-wrap:wrap;gap:12px}footer a{color:var(--leise)}
`;

export function seoRouter({ db, konfiguration, preise, affiliate, preisimport, katalog, igdb, besucher }) {
  const router = Router();
  // Ohne PUBLIC_URL aus der Anfrage – aber nur mit gültigem Hostnamen (Schutz vor manipulierten Host-Headern)
  const basis = (req) => {
    if (konfiguration.oeffentlicheUrl) return konfiguration.oeffentlicheUrl;
    const host = String(req.get('host') ?? '');
    return `${req.protocol}://${/^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host) ? host : 'localhost'}`;
  };

  const eintragPerId = db.prepare(`SELECT k.*, ${INDEXIERBAR_SQL} AS indexierbar FROM katalog k WHERE k.id = ?`);
  const plattformenVon = db.prepare(`SELECT p.id, p.name, p.kurz, p.hersteller FROM katalog_plattformen kp
    JOIN plattformen p ON p.id = kp.plattform_id WHERE kp.katalog_id = ? ORDER BY p.erscheinungsjahr`);
  const varianten = db.prepare(`SELECT bezeichnung, modellnummer, farbe, edition, region, erscheinungsjahr, beschreibung
    FROM katalog_varianten WHERE katalog_id = ? AND status = 'freigegeben'
    ORDER BY erscheinungsjahr IS NULL, erscheinungsjahr, bezeichnung COLLATE NOCASE`);
  const medienUebersicht = db.prepare(`SELECT art, COUNT(*) AS anzahl FROM medien
    WHERE katalog_id = ? AND sichtbarkeit = 'freigegeben' GROUP BY art`);
  const externeLinks = db.prepare(`SELECT art, titel, url, domain FROM externe_links
    WHERE katalog_id = ? AND status = 'freigegeben' ORDER BY art, erstellt_am`);
  const preiseLetzte90 = db.prepare(`SELECT preis, COALESCE(anzahl, 1) AS anzahl FROM preis_historie
    WHERE katalog_id = ? AND herkunft <> 'marktpreis' AND datum >= date('now', '-90 days')`);
  const letzteAenderung = db.prepare(`SELECT MAX(d) AS d FROM (
    SELECT COALESCE(aktualisiert_am, erstellt_am) AS d FROM katalog WHERE id = @id
    UNION ALL SELECT MAX(datum) FROM preis_historie WHERE katalog_id = @id)`);

  const sichtbarOeffentlich = () => konfiguration.oeffentlicherKatalog;

  function seite(req, { titel, beschreibung, pfad, indexierbar = true, bild, inhalt, strukturiert = [], appZiel = APP_START }) {
    const url = `${basis(req)}${pfad}`;
    return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<meta name="description" content="${esc(beschreibung)}">
<link rel="canonical" href="${esc(url)}">
${indexierbar ? '<meta name="robots" content="index,follow,max-image-preview:large">' : '<meta name="robots" content="noindex,follow">'}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${APP}">
<meta property="og:locale" content="de_DE">
<meta property="og:title" content="${esc(titel)}">
<meta property="og:description" content="${esc(beschreibung)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(bild || `${basis(req)}/icons/icon-512.png`)}">
<meta name="twitter:card" content="${bild ? 'summary_large_image' : 'summary'}">
<meta name="theme-color" content="#16131f">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>${CSS}</style>
${strukturiert.map(jsonLd).join('\n')}
</head>
<body>
<header class="kopf">
  <a class="marke" href="/plattformen"><img src="/icons/icon.svg" alt="" width="28" height="28"><span>${APP}<small>${esc(MARKE.untertitel)}</small></span></a>
  <span class="kopf-rechts"><a class="suchknopf" href="/suche" aria-label="Spiele suchen"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></a>
  <a class="knopf" href="${esc(appZiel)}">Zur App</a></span>
</header>
<main>
${inhalt}
</main>
<footer>
  <a href="/plattformen">Alle Plattformen</a>
  <a href="/suche">Suche</a>
  <a href="${appLink('/seite/impressum')}">Impressum</a>
  <a href="${appLink('/seite/datenschutz')}">Datenschutz</a>
  <a href="${appLink('/seite/nutzungsbedingungen')}">Nutzungsbedingungen</a>
</footer>
</body>
</html>`;
  }

  function sende(res, html, status = 200) {
    res.status(status).type('html').set('Cache-Control', 'public, max-age=300').send(html);
  }

  function nichtGefunden(req, res) {
    sende(res, seite(req, {
      titel: `Nicht gefunden | ${APP}`, beschreibung: 'Diese Seite gibt es nicht (mehr).', pfad: req.path, indexierbar: false,
      inhalt: '<h1>Nicht gefunden</h1><p>Diesen Eintrag gibt es nicht oder er ist nicht öffentlich.</p><p><a href="/plattformen">Zu allen Plattformen</a></p>',
    }), 404);
  }

  /** Preis-Kennzahlen der letzten 90 Tage (Angebote, eBay-Tageswerte, Meldungen). */
  function wert90(katalogId) {
    const zeilen = preiseLetzte90.all(katalogId);
    if (!zeilen.length) return null;
    const anzahl = zeilen.reduce((s, z) => s + z.anzahl, 0);
    const schnitt = zeilen.reduce((s, z) => s + z.preis * z.anzahl, 0) / anzahl;
    const werte = zeilen.map((z) => z.preis);
    return { schnitt: Math.round(schnitt * 100) / 100, min: Math.min(...werte), max: Math.max(...werte), anzahl };
  }

  // ── Einzelne Katalogseite ───────────────────────────────────────────
  function katalogSeite(req, res) {
    const id = Number.parseInt(req.params.teil, 10);
    if (!sichtbarOeffentlich()) return res.redirect(302, appLink(`/katalog/${id}`));
    const zeile = Number.isInteger(id) ? eintragPerId.get(id) : null;
    if (!zeile || zeile.status !== 'freigegeben') return nichtGefunden(req, res);
    const e = katalogZeileZuObjekt(zeile);
    const plattformen = plattformenVon.all(e.id);
    const kanonisch = katalogPfad(e, plattformen[0]?.kurz);
    if (req.path !== kanonisch) return res.redirect(301, kanonisch);

    const typ = ARTIKELTYPEN.find((t) => t.value === e.typ);
    const plattformNamen = plattformen.length ? plattformen.map((p) => p.name) : e.plattformen;
    const community = preise.community(e.id);
    const wert = wert90(e.id);
    const markt = preise.gespeichert(e.id, 'pal').daten;
    const vars = varianten.all(e.id);
    const medien = medienUebersicht.all(e.id);
    const links = externeLinks.all(e.id);
    const kaufen = affiliate.links(e, plattformNamen[0]);
    const angebote = affiliate.aktiv ? preisimport.angeboteFuer(e.id) : null;
    const angebotListe = angebote?.angebote ?? [];

    // Metadaten – automatisch erzeugt, vom Moderationsteam überschreibbar
    const kurz = plattformen[0]?.kurz || plattformNamen[0];
    const titel = e.seo_titel || (e.typ === 'spiel'
      ? `${e.titel}${kurz ? ` (${kurz})` : ''} – Wert, Varianten & Infos | ${APP}`
      : `${e.titel} – Wert, Modelle & Revisionen | ${APP}`);
    const teile = [`${e.titel}${plattformNamen.length ? ` für ${plattformNamen.slice(0, 3).join(', ')}` : ''}${e.erscheinungsjahr ? ` (${e.erscheinungsjahr})` : ''}.`];
    if (wert) teile.push(`Aktueller Wert ca. ${euro(wert.schnitt)}.`);
    else if (markt?.lose) teile.push(`Marktwert ab ca. ${euro(markt.lose)}.`);
    if (community.besitzer) teile.push(`${zahl(community.besitzer)} ${community.besitzer === 1 ? 'Sammler besitzt' : 'Sammler besitzen'} es.`);
    teile.push(vars.length ? `${vars.length} Varianten, Preisverlauf und Sammlerhinweise.` : 'Preisverlauf, Varianten und Sammlerhinweise.');
    if (e.beschreibung && teile.join(' ').length < 110) teile.push(e.beschreibung);
    const beschreibung = kuerze(e.seo_beschreibung || teile.join(' '), 158);

    const url = `${basis(req)}${kanonisch}`;
    const strukturiert = [
      {
        '@context': 'https://schema.org',
        '@type': e.typ === 'spiel' ? 'VideoGame' : 'Product',
        name: e.titel,
        url,
        ...(e.cover_url ? { image: e.cover_url } : {}),
        ...(e.beschreibung ? { description: kuerze(e.beschreibung, 500) } : {}),
        ...(e.typ === 'spiel'
          ? {
            ...(plattformNamen.length ? { gamePlatform: plattformNamen } : {}),
            ...(e.erscheinungsjahr ? { datePublished: String(e.erscheinungsjahr) } : {}),
            ...(e.hersteller ? { publisher: { '@type': 'Organization', name: e.hersteller } } : {}),
          }
          : { ...(e.hersteller ? { brand: { '@type': 'Brand', name: e.hersteller } } : {}), category: typ?.label }),
        // Nur echte, aktuelle Angebote – keine erfundenen Preise oder Bewertungen
        ...(angebotListe.length ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'EUR',
            lowPrice: Math.min(...angebotListe.map((a) => a.preis)).toFixed(2),
            highPrice: Math.max(...angebotListe.map((a) => a.preis)).toFixed(2),
            offerCount: angebote.gesamt ?? angebotListe.length,
          },
        } : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Plattformen', item: `${basis(req)}/plattformen` },
          ...(plattformen[0] ? [{ '@type': 'ListItem', position: 2, name: plattformen[0].name, item: `${basis(req)}${plattformPfad(plattformen[0])}` }] : []),
          { '@type': 'ListItem', position: plattformen[0] ? 3 : 2, name: e.titel, item: url },
        ],
      },
    ];

    const wertText = [];
    if (wert) {
      wertText.push(`In den letzten 90 Tagen lag der Preis im Schnitt bei <b>${euro(wert.schnitt)}</b> `
        + `(Spanne ${euro(wert.min)} – ${euro(wert.max)}, ${zahl(wert.anzahl)} ${wert.anzahl === 1 ? 'Preisangabe' : 'Preisangaben'}).`);
    }
    if (markt && (markt.lose || markt.cib || markt.neu)) {
      const stufen = [['lose', 'lose'], ['cib', 'komplett (CIB)'], ['neu', 'neu/OVP']].filter(([k]) => markt[k]).map(([k, l]) => `${l} ${euro(markt[k])}`);
      wertText.push(`Marktpreis (PAL, PriceCharting): ${stufen.join(' · ')}.`);
    }
    if (community.median_marktwert != null) wertText.push(`Sammler schätzen den Wert im Median auf ${euro(community.median_marktwert)}.`);
    if (!wertText.length) wertText.push('Für diesen Eintrag liegen noch keine Preisdaten vor. Sammler können in der App Preise melden.');

    const medienAnzahl = medien.reduce((s, m) => s + m.anzahl, 0);
    const appZiel = appLink(`/katalog/${e.id}?app=1`);
    const inhalt = `
<nav class="pfad" aria-label="Brotkrumen"><a href="/plattformen">Plattformen</a>${plattformen[0] ? ` › <a href="${plattformPfad(plattformen[0])}">${esc(plattformen[0].name)}</a>` : ''} › ${esc(e.titel)}</nav>
<div class="kopfbereich">
  ${e.cover_url ? `<img class="cover" src="${esc(e.cover_url)}" alt="${esc(`${e.titel} – Cover`)}" width="220" height="293">` : ''}
  <div>
    <h1>${esc(e.titel)}</h1>
    <div class="chips">
      <span class="chip">${esc(typ?.label ?? '')}</span>
      ${plattformen.map((p) => `<a class="chip" href="${plattformPfad(p)}">${esc(p.name)}</a>`).join('')}
      ${e.erscheinungsjahr ? `<span class="chip">${e.erscheinungsjahr}</span>` : ''}
      ${e.hersteller ? `<span class="chip">${esc(e.hersteller)}</span>` : ''}
    </div>
    <p>${community.besitzer
      ? `<b>${zahl(community.besitzer)}</b> ${community.besitzer === 1 ? 'Sammler hat' : 'Sammler haben'} diesen Eintrag in ${community.besitzer === 1 ? 'seiner' : 'ihrer'} Sammlung${community.exemplare > community.besitzer ? ` · ${zahl(community.exemplare)} Exemplare insgesamt` : ''}.`
      : 'Noch hat kein Sammler diesen Eintrag in seiner Sammlung – sei der Erste!'}</p>
    <p><a class="knopf" href="${appZiel}">＋ In meine Sammlung</a></p>
  </div>
</div>
${e.beschreibung ? `<section class="karte"><h2>Beschreibung</h2>${markdownHtml(e.beschreibung)}</section>` : ''}
<section class="karte"><h2>Was ist ${esc(e.titel)} wert?</h2>${wertText.map((t) => `<p>${t}</p>`).join('')}
<p class="leise">Preise schwanken je nach Zustand, Vollständigkeit (lose, mit Anleitung, OVP) und Region. Den vollständigen Preisverlauf siehst du in der App.</p></section>
${e.sammlerhinweise ? `<section class="karte"><h2>Sammlerhinweise</h2>${markdownHtml(e.sammlerhinweise)}</section>` : ''}
${vars.length ? `<section class="karte"><h2>Varianten & Revisionen (${vars.length})</h2><ul class="liste">${vars.map((v) => `<li><b>${esc(v.bezeichnung)}</b>${[v.modellnummer, v.region, v.edition, v.farbe, v.erscheinungsjahr].filter(Boolean).length ? ` <span class="leise">· ${esc([v.modellnummer, v.region, v.edition, v.farbe, v.erscheinungsjahr].filter(Boolean).join(' · '))}</span>` : ''}${v.beschreibung ? `<br><span class="leise">${esc(kuerze(v.beschreibung, 300))}</span>` : ''}</li>`).join('')}</ul></section>` : ''}
${links.length ? `<section class="karte"><h2>Cover & Handbücher im Netz</h2><ul class="liste">${links.map((l) => `<li><a href="${esc(l.url)}" rel="nofollow ugc noopener" target="_blank">${esc(l.titel || beschriftung(MEDIENARTEN, l.art))}</a> <span class="leise">· ${esc(l.domain)}</span></li>`).join('')}</ul><p class="leise">Externe Seiten – für deren Inhalte sind die jeweiligen Betreiber verantwortlich.</p></section>` : ''}
${medienAnzahl ? `<section class="karte"><h2>Scans & Dokumente</h2><p>${medien.map((m) => `${zahl(m.anzahl)} × ${esc(beschriftung(MEDIENARTEN, m.art))}`).join(' · ')}</p><p class="leise">Von Sammlern hochgeladene Scans sind nach der Anmeldung sichtbar.</p><p><a class="knopf zweit" href="${appZiel}">Anmelden und ansehen</a></p></section>` : ''}
${kaufen.length || angebotListe.length ? `<section class="karte"><h2>Hier kaufen <span class="werbung">Anzeige</span></h2><ul class="liste">
${angebotListe.slice(0, 5).map((a) => `<li><a href="${esc(a.url)}" rel="sponsored noopener" target="_blank">${esc(kuerze(a.titel, 90))}</a> – <b>${euro(a.preis)}</b></li>`).join('')}
${kaufen.map((k) => `<li><a href="${esc(k.url)}" rel="sponsored noopener" target="_blank">${esc(k.titel)}</a>${k.preis ? ` – <b>${euro(k.preis)}</b>` : ''}</li>`).join('')}
</ul><p class="leise">Affiliate-Links: Beim Kauf über diese Links erhalten wir ggf. eine Provision. Für dich ändert sich der Preis nicht – du unterstützt damit den Betrieb dieser Seite.</p></section>` : ''}
<section class="karte"><h2>Deine Sammlung verwalten</h2><p>Erfasse Spiele, Konsolen und Zubehör mit Barcode-Scanner, verfolge den Wert deiner Sammlung und verwalte Varianten und Revisionen – kostenlos.</p><p><a class="knopf" href="${appZiel}">Jetzt loslegen</a></p></section>`;

    const geaendert = String(letzteAenderung.get({ id: e.id }).d ?? e.erstellt_am ?? '');
    const zeitpunkt = new Date(geaendert.length === 10 ? `${geaendert}T00:00:00Z` : `${geaendert.replace(' ', 'T')}Z`);
    if (!Number.isNaN(zeitpunkt.getTime())) res.set('Last-Modified', zeitpunkt.toUTCString());
    sende(res, seite(req, { titel, beschreibung, pfad: kanonisch, indexierbar: Boolean(zeile.indexierbar), bild: e.cover_url, inhalt, strukturiert, appZiel }));
  }
  for (const praefix of KATALOG_PRAEFIXE) router.get(`/${praefix}/:teil`, katalogSeite);

  // Kachelliste (Cover, Titel, Jahr, Sammler) – für Startseite, Suche und Plattformen
  const symbol = (typ) => ARTIKELTYPEN.find((t) => t.value === typ)?.icon ?? '🎮';
  const kurzVon = db.prepare(`SELECT p.kurz FROM katalog_plattformen kp JOIN plattformen p ON p.id = kp.plattform_id
    WHERE kp.katalog_id = ? ORDER BY p.erscheinungsjahr LIMIT 1`).pluck();
  function kacheln(eintraege, kurz) {
    return `<ul class="raster">${eintraege.map((e) => `<li><a href="${katalogPfad(e, kurz ?? e.kurz ?? kurzVon.get(e.id))}">${e.cover_url
      ? `<img src="${esc(e.cover_url)}" alt="${esc(`${e.titel} – Cover`)}" loading="lazy" width="150" height="200">`
      : `<span class="platzhalter" aria-hidden="true">${symbol(e.typ)}</span>`}<b>${esc(e.titel)}</b><br><span class="leise">${[e.erscheinungsjahr, e.besitzer ? `${zahl(e.besitzer)} Sammler` : null].filter(Boolean).join(' · ')}</span></a></li>`).join('')}</ul>`;
  }
  function suchformular({ q = '', typ = '' } = {}) {
    return `<form class="suche" action="/suche" method="get" role="search">
<input type="search" name="q" value="${esc(q)}" placeholder="Spiel, Konsole oder Zubehör suchen …" aria-label="Suchbegriff" maxlength="100">
<select name="typ" aria-label="Art"><option value="">Alles</option>${ARTIKELTYPEN.map((t) => `<option value="${t.value}"${t.value === typ ? ' selected' : ''}>${esc(t.mehrzahl)}</option>`).join('')}</select>
<button class="knopf" type="submit">Suchen</button></form>`;
  }
  const BESITZER_SQL = '(SELECT COUNT(DISTINCT a.benutzer_id) FROM artikel a WHERE a.katalog_id = k.id)';

  // ── Startseite für Besucher ─────────────────────────────────────────
  // Angemeldete Benutzer (Sitzungs-Cookie) und die installierte App (?app) bekommen die App.
  const neueste = db.prepare(`SELECT k.id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, ${BESITZER_SQL} AS besitzer
    FROM katalog k WHERE ${INDEXIERBAR_SQL}
    ORDER BY COALESCE((SELECT MIN(a.erstellt_am) FROM artikel a WHERE a.katalog_id = k.id), k.geprueft_am, k.erstellt_am) DESC LIMIT 12`);
  const beliebteste = db.prepare(`SELECT * FROM (SELECT k.id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, ${BESITZER_SQL} AS besitzer
    FROM katalog k WHERE ${INDEXIERBAR_SQL}) WHERE besitzer > 0 ORDER BY besitzer DESC, titel COLLATE NOCASE LIMIT 12`);
  const kennzahlen = db.prepare(`SELECT
    (SELECT COUNT(*) FROM katalog WHERE status = 'freigegeben') AS eintraege,
    (SELECT COUNT(*) FROM benutzer) AS sammler,
    (SELECT COALESCE(SUM(anzahl), 0) FROM artikel) AS exemplare`);

  router.get('/', (req, res, next) => {
    if (!sichtbarOeffentlich() || req.query.app !== undefined || leseCookies(req.headers.cookie)[COOKIE_NAME]) return next();
    const k = kennzahlen.get();
    const neu = neueste.all();
    const beliebt = beliebteste.all();
    const plattformListe = allePlattformen().filter((p) => p.anzahl > 0).sort((a, b) => b.anzahl - a.anzahl).slice(0, 16);
    const b = basis(req);
    const inhalt = `
<section class="held">
  <img src="/icons/icon.svg" alt="${esc(MARKE.name)}-Logo" width="88" height="88">
  <h1>${esc(MARKE.name)}</h1>
  <p class="unter">${esc(MARKE.untertitel)}</p>
  <p>Erfasse deine Spiele, Konsolen und dein Zubehör per Barcode-Scanner, behalte den Wert deiner Sammlung im Blick
  und finde Varianten, Preise und Sammlerhinweise – kostenlos.</p>
  ${suchformular()}
  <div class="knoepfe"><a class="knopf" href="${appLink('/?registrieren=1')}">Kostenlos registrieren</a><a class="knopf zweit" href="${appLink('/')}">Anmelden</a></div>
  ${k.eintraege ? `<p class="leise">${zahl(k.eintraege)} Einträge im Katalog · ${zahl(k.sammler)} Sammler · ${zahl(k.exemplare)} erfasste Exemplare</p>` : ''}
</section>
${beliebt.length ? `<section class="karte"><h2>Beliebt bei Sammlern</h2>${kacheln(beliebt)}</section>` : ''}
${neu.length ? `<section class="karte"><h2>Neu in ${esc(MARKE.name)}</h2>${kacheln(neu)}</section>` : ''}
${plattformListe.length ? `<section class="karte"><h2>Nach Plattform stöbern</h2><div class="chips">${plattformListe.map((p) => `<a class="chip" href="${p.pfad}">${esc(p.name)} <span class="leise">(${zahl(p.anzahl)})</span></a>`).join('')}</div><p><a href="/plattformen">Alle Plattformen</a></p></section>` : ''}
<section class="karte"><h2>Was ${esc(MARKE.name)} kann</h2><div class="merkmale">
  <div><b>📷 Barcode-Scanner</b><br><span class="leise">Spiel mit der Handykamera scannen – fertig erfasst.</span></div>
  <div><b>💶 Wert im Blick</b><br><span class="leise">Preisverlauf, aktuelle Angebote und der Wert deiner Sammlung.</span></div>
  <div><b>🧩 Varianten & Revisionen</b><br><span class="leise">PAL/USK, Editionen, Modellnummern – sauber getrennt.</span></div>
  <div><b>📖 Cover & Handbücher</b><br><span class="leise">Hochauflösende Scans zum Nachdrucken beschädigter Cover.</span></div>
</div></section>`;
    sende(res, seite(req, {
      titel: `${MARKE.name} – ${MARKE.untertitel}`,
      beschreibung: kuerze(`${MARKE.untertitel}: Spiele, Konsolen und Zubehör sammeln, bewerten und verwalten – mit Barcode-Scanner, Preisverlauf, Varianten und Sammlerhinweisen. Kostenlos.`, 158),
      pfad: '/', indexierbar: true, bild: `${b}/icons/icon-512.png`, inhalt,
      strukturiert: [{
        '@context': 'https://schema.org', '@type': 'WebSite', name: MARKE.name, url: `${b}/`, inLanguage: 'de-DE',
        potentialAction: { '@type': 'SearchAction', target: `${b}/suche?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
      }],
    }));
  });

  // ── Suche für alle (auch ohne Konto) ────────────────────────────────
  const onlineDrossel = erstelleDrossel({ maxVersuche: 30, fensterMs: 60 * 60 * 1000 });
  router.get('/suche', async (req, res) => {
    if (!sichtbarOeffentlich()) return res.redirect(302, appLink('/katalog'));
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const typ = ARTIKELTYPEN.some((t) => t.value === req.query.typ) ? req.query.typ : '';
    const seiteNr = Math.max(1, Number.parseInt(req.query.seite, 10) || 1);
    const muster = `%${q.replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    const abfrage = (grenze, versatz) => db.prepare(`SELECT k.id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, ${BESITZER_SQL} AS besitzer
      FROM katalog k WHERE k.status = 'freigegeben' AND k.titel LIKE @muster ESCAPE '\\' AND (@typ = '' OR k.typ = @typ)
      ORDER BY besitzer DESC, (k.titel LIKE @anfang ESCAPE '\\') DESC, length(k.titel), k.titel COLLATE NOCASE
      LIMIT ${grenze} OFFSET ${versatz}`).all({ muster, anfang: `${muster.slice(1)}`, typ });
    const zaehlen = () => db.prepare(`SELECT COUNT(*) AS n FROM katalog k WHERE k.status = 'freigegeben'
      AND k.titel LIKE @muster ESCAPE '\\' AND (@typ = '' OR k.typ = @typ)`).get({ muster, typ }).n;

    let gesamt = q ? zaehlen() : 0;
    // Wenig Treffer? Einmal online bei IGDB nachschlagen (begrenzt je IP), Treffer landen im Katalog.
    if (q.length >= 3 && gesamt < 5 && seiteNr === 1 && typ !== 'zubehoer' && igdb?.konfiguriert && !onlineDrossel.gesperrt(req.ip)) {
      onlineDrossel.fehlschlag(req.ip);
      try {
        await katalog.sucheOnline(q, typ || 'spiel');
        gesamt = zaehlen();
      } catch (e) {
        console.warn('[suche]', e.message);
      }
    }
    if (q && seiteNr === 1) besucher?.erfasseSuche(q, gesamt);
    const seiten = Math.max(1, Math.ceil(gesamt / PRO_SEITE));
    const treffer = q ? abfrage(PRO_SEITE, (seiteNr - 1) * PRO_SEITE) : [];
    const link = (n) => `/suche?q=${encodeURIComponent(q)}${typ ? `&typ=${typ}` : ''}${n > 1 ? `&seite=${n}` : ''}`;
    const inhalt = `<h1>${q ? `Suche: „${esc(q)}“` : 'Spiele, Konsolen & Zubehör suchen'}</h1>
${suchformular({ q, typ })}
${!q ? `<p class="leise">Durchsuche den Katalog – ganz ohne Konto. Oder <a href="/plattformen">stöbere nach Plattform</a>.</p>`
    : treffer.length ? `<p class="leise">${zahl(gesamt)} ${gesamt === 1 ? 'Treffer' : 'Treffer'}</p>${kacheln(treffer)}`
      : `<p>Keine Treffer. Fehlt ein Spiel? Nach der Anmeldung kannst du es selbst anlegen und zur Aufnahme einreichen.</p><p><a class="knopf" href="${appLink('/')}">Anmelden oder registrieren</a></p>`}
${seiten > 1 ? `<nav class="seiten">${seiteNr > 1 ? `<a class="knopf zweit" href="${link(seiteNr - 1)}">← Zurück</a>` : '<span></span>'}<span class="leise">Seite ${seiteNr} von ${seiten}</span>${seiteNr < seiten ? `<a class="knopf zweit" href="${link(seiteNr + 1)}">Weiter →</a>` : '<span></span>'}</nav>` : ''}`;
    // Suchergebnisseiten gehören nicht in den Suchindex
    sende(res, seite(req, {
      titel: q ? `Suche: ${q} | ${APP}` : `Suche | ${APP}`,
      beschreibung: 'Spiele, Konsolen und Zubehör im Katalog suchen – mit Wert, Varianten und Sammlerhinweisen.',
      pfad: '/suche', indexierbar: false, inhalt,
    }));
  });

  // ── Geteilte Sammlung (geheimer Link, auch ohne Konto, nicht indexiert) ──────
  const perFreigabe = db.prepare("SELECT id, benutzername, COALESCE(anzeigename, benutzername) AS name, freigabe_wert FROM benutzer WHERE freigabe_token = ? AND gesperrt = 0");
  const geteilteArtikel = db.prepare(`SELECT a.id, a.typ, a.titel, a.plattform, a.region, a.zustand, a.vollstaendigkeit, a.farbe, a.edition,
      a.anzahl, a.marktwert, a.katalog_id AS privat_katalog_id,
      CASE WHEN k.status = 'freigegeben' THEN k.id END AS katalog_id,
      CASE WHEN k.status = 'freigegeben' THEN k.titel END AS katalog_titel,
      CASE WHEN k.status = 'freigegeben' THEN k.typ END AS katalog_typ,
      CASE WHEN k.status = 'freigegeben' THEN k.cover_url END AS cover_url,
      p.kurz AS plattform_kurz, p.name AS plattform_name, v.bezeichnung AS variante
    FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id LEFT JOIN plattformen p ON p.id = a.plattform_id
    LEFT JOIN katalog_varianten v ON v.id = a.variante_id AND v.status = 'freigegeben'
    WHERE a.benutzer_id = ? ORDER BY COALESCE(p.name, a.plattform, 'zzz') COLLATE NOCASE, a.titel COLLATE NOCASE LIMIT 5000`);

  router.get('/sammlung/:token', (req, res) => {
    const token = String(req.params.token);
    const b = token.length >= 16 ? perFreigabe.get(token) : null;
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!b) return nichtGefunden(req, res);
    const artikel = geteilteArtikel.all(b.id);
    const stueck = artikel.reduce((s, a) => s + (a.anzahl ?? 1), 0);
    const jeTyp = Object.fromEntries(ARTIKELTYPEN.map((t) => [t.value, artikel.filter((a) => a.typ === t.value).reduce((s, a) => s + (a.anzahl ?? 1), 0)]));
    let wert = 0;
    if (b.freigabe_wert) {
      for (const a of artikel) {
        const w = preise.schaetze({ ...a, katalog_id: a.privat_katalog_id });
        if (w) wert += w.wert * (a.anzahl ?? 1);
      }
    }
    const gruppen = new Map();
    for (const a of artikel) {
      const name = a.plattform_name || a.plattform || 'Ohne Plattform';
      if (!gruppen.has(name)) gruppen.set(name, []);
      gruppen.get(name).push(a);
    }
    const eintrag = (a) => {
      const details = [beschriftung(REGIONEN, a.region, 'kurz'), beschriftung(ZUSTAENDE, a.zustand), beschriftung(VOLLSTAENDIGKEITEN, a.vollstaendigkeit, 'kurz'),
        a.variante, a.edition, a.farbe, (a.anzahl ?? 1) > 1 ? `${a.anzahl}×` : null].filter(Boolean);
      const bild = a.cover_url ? `<img src="${esc(a.cover_url)}" alt="" loading="lazy" width="150" height="200">` : `<span class="platzhalter" aria-hidden="true">${symbol(a.typ)}</span>`;
      const inhaltKachel = `${bild}<b>${esc(a.titel)}</b><br><span class="leise">${esc(details.join(' · '))}</span>`;
      const ziel = a.katalog_id && sichtbarOeffentlich() ? katalogPfad({ id: a.katalog_id, titel: a.katalog_titel, typ: a.katalog_typ }, a.plattform_kurz) : null;
      return `<li>${ziel ? `<a href="${ziel}">${inhaltKachel}</a>` : `<div>${inhaltKachel}</div>`}</li>`;
    };
    const inhalt = `<h1>Die Sammlung von ${esc(b.name)}</h1>
<div class="zahlen">
  <div class="zahl"><b>${zahl(stueck)}</b>Exemplare</div>
  ${ARTIKELTYPEN.filter((t) => jeTyp[t.value]).map((t) => `<div class="zahl"><b>${zahl(jeTyp[t.value])}</b>${esc(t.mehrzahl)}</div>`).join('')}
  <div class="zahl"><b>${zahl(gruppen.size)}</b>Plattformen</div>
  ${b.freigabe_wert && wert > 0 ? `<div class="zahl"><b>${euro(Math.round(wert))}</b>geschätzter Wert</div>` : ''}
</div>
${artikel.length ? [...gruppen].map(([name, liste]) => `<section class="karte"><h2>${esc(name)} <span class="leise">(${liste.length})</span></h2><ul class="raster">${liste.map(eintrag).join('')}</ul></section>`).join('')
    : '<p class="leise">Diese Sammlung ist noch leer.</p>'}
<section class="karte"><h2>Deine eigene Sammlung</h2><p>Erfasse deine Spiele, Konsolen und dein Zubehör – kostenlos, mit Barcode-Scanner und Wertübersicht.</p><p><a class="knopf" href="${appLink('/?registrieren=1')}">Kostenlos registrieren</a></p></section>`;
    // Nicht zwischenspeichern: Beim Widerrufen soll der Link sofort ungültig sein
    res.type('html').set('Cache-Control', 'private, no-store').send(seite(req, {
      titel: `Die Sammlung von ${b.name} | ${APP}`,
      beschreibung: `${zahl(stueck)} Spiele, Konsolen und Zubehör in der Sammlung von ${b.name}.`,
      pfad: `/sammlung/${token}`, indexierbar: false, inhalt,
    }));
  });

  // ── Plattformen ─────────────────────────────────────────────────────
  const plattformZaehler = db.prepare(`SELECT kp.plattform_id AS id, COUNT(DISTINCT k.id) AS anzahl
    FROM katalog_plattformen kp JOIN katalog k ON k.id = kp.katalog_id WHERE ${INDEXIERBAR_SQL} GROUP BY kp.plattform_id`);
  const allePlattformen = () => {
    const zahlen = new Map(plattformZaehler.all().map((z) => [z.id, z.anzahl]));
    return db.prepare('SELECT id, name, kurz, hersteller, erscheinungsjahr FROM plattformen').all()
      .map((p) => ({ ...p, anzahl: zahlen.get(p.id) ?? 0, pfad: plattformPfad(p) }));
  };

  router.get('/plattformen', (req, res) => {
    if (!sichtbarOeffentlich()) return res.redirect(302, APP_START);
    const liste = allePlattformen().filter((p) => p.anzahl > 0);
    const gruppen = new Map();
    for (const p of liste.sort((a, b) => (a.erscheinungsjahr ?? 9999) - (b.erscheinungsjahr ?? 9999))) {
      if (!gruppen.has(p.hersteller)) gruppen.set(p.hersteller, []);
      gruppen.get(p.hersteller).push(p);
    }
    const reihenfolge = [...gruppen.keys()].sort((a, b) => (HERSTELLER_REIHENFOLGE.indexOf(a) + 1 || 99) - (HERSTELLER_REIHENFOLGE.indexOf(b) + 1 || 99));
    const inhalt = `<h1>Retro- und Videospiele nach Plattform</h1>
<p>Spiele, Konsolen und Zubehör aus den Sammlungen unserer Benutzer – mit Wert, Varianten und Sammlerhinweisen.</p>
${reihenfolge.map((h) => `<section class="karte"><h2>${esc(h || 'Sonstige')}</h2><div class="chips">${gruppen.get(h).map((p) => `<a class="chip" href="${p.pfad}">${esc(p.name)} <span class="leise">(${zahl(p.anzahl)})</span></a>`).join('')}</div></section>`).join('')}
${liste.length ? '' : '<p class="leise">Noch keine Einträge vorhanden.</p>'}
<section class="karte"><h2>Deine Sammlung verwalten</h2><p>Kostenlos erfassen, bewerten und den Überblick behalten – mit Barcode-Scanner und Preisverlauf.</p><p><a class="knopf" href="${APP_START}">Zur App</a></p></section>`;
    sende(res, seite(req, {
      titel: `Retro- und Videospiele nach Plattform – Werte & Varianten | ${APP} – ${MARKE.untertitel}`,
      beschreibung: `Spiele, Konsolen und Zubehör für ${zahl(liste.length)} Plattformen: aktuelle Werte, Varianten, Revisionen und wie viele Sammler sie besitzen.`,
      pfad: '/plattformen', indexierbar: liste.length > 0, inhalt,
    }));
  });

  router.get('/plattform/:slug', (req, res) => {
    if (!sichtbarOeffentlich()) return res.redirect(302, APP_START);
    const p = allePlattformen().find((x) => slug(x.kurz || x.name) === req.params.slug);
    if (!p) return nichtGefunden(req, res);
    const seiteNr = Math.max(1, Number.parseInt(req.query.seite, 10) || 1);
    const seiten = Math.max(1, Math.ceil(p.anzahl / PRO_SEITE));
    if (seiteNr > seiten) return nichtGefunden(req, res);
    const eintraege = db.prepare(`
      SELECT k.id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr,
             (SELECT COUNT(DISTINCT a.benutzer_id) FROM artikel a WHERE a.katalog_id = k.id) AS besitzer
      FROM katalog_plattformen kp JOIN katalog k ON k.id = kp.katalog_id
      WHERE kp.plattform_id = ? AND ${INDEXIERBAR_SQL}
      ORDER BY besitzer DESC, k.titel COLLATE NOCASE LIMIT ${PRO_SEITE} OFFSET ${(seiteNr - 1) * PRO_SEITE}`).all(p.id);
    const pfad = `${p.pfad}${seiteNr > 1 ? `?seite=${seiteNr}` : ''}`;
    const inhalt = `<nav class="pfad" aria-label="Brotkrumen"><a href="/plattformen">Plattformen</a> › ${esc(p.name)}</nav>
<h1>${esc(p.name)}${p.kurz && p.kurz !== p.name ? ` (${esc(p.kurz)})` : ''}</h1>
<p>${zahl(p.anzahl)} Spiele, Konsolen und Zubehör für ${esc(p.name)}${p.erscheinungsjahr ? ` (erschienen ${p.erscheinungsjahr})` : ''} – sortiert danach, wie viele Sammler sie besitzen.</p>
${kacheln(eintraege, p.kurz)}
${seiten > 1 ? `<nav class="seiten">${seiteNr > 1 ? `<a class="knopf zweit" href="${p.pfad}${seiteNr > 2 ? `?seite=${seiteNr - 1}` : ''}">← Zurück</a>` : '<span></span>'}<span class="leise">Seite ${seiteNr} von ${seiten}</span>${seiteNr < seiten ? `<a class="knopf zweit" href="${p.pfad}?seite=${seiteNr + 1}">Weiter →</a>` : '<span></span>'}</nav>` : ''}`;
    sende(res, seite(req, {
      titel: `${p.name} – Spiele, Konsolen & Sammlerwerte${seiteNr > 1 ? ` (Seite ${seiteNr})` : ''} | ${APP}`,
      beschreibung: `${zahl(p.anzahl)} Einträge für ${p.name}: aktuelle Werte, Varianten und wie viele Sammler sie besitzen.`,
      pfad, indexierbar: p.anzahl > 0, inhalt,
      strukturiert: [{
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Plattformen', item: `${basis(req)}/plattformen` },
          { '@type': 'ListItem', position: 2, name: p.name, item: `${basis(req)}${p.pfad}` },
        ],
      }],
    }));
  });

  // ── Sitemap & robots.txt ─────────────────────────────────────────────
  const anzahlIndexierbar = db.prepare(`SELECT COUNT(*) AS n FROM katalog k WHERE ${INDEXIERBAR_SQL}`);
  const sitemapEintraege = db.prepare(`
    SELECT k.id, k.titel, k.typ, substr(COALESCE(k.aktualisiert_am, k.erstellt_am), 1, 10) AS geaendert,
           (SELECT p.kurz FROM katalog_plattformen kp JOIN plattformen p ON p.id = kp.plattform_id
            WHERE kp.katalog_id = k.id ORDER BY p.erscheinungsjahr LIMIT 1) AS kurz
    FROM katalog k WHERE ${INDEXIERBAR_SQL} ORDER BY k.id LIMIT ? OFFSET ?`);
  const xml = (res, text) => res.type('application/xml; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(text);
  const urlEintrag = (loc, lastmod) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;

  router.get('/sitemap.xml', (req, res) => {
    const b = basis(req);
    if (!sichtbarOeffentlich()) return xml(res, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    const teile = Math.max(1, Math.ceil(anzahlIndexierbar.get().n / PRO_SITEMAP));
    xml(res, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${esc(b)}/sitemap-plattformen.xml</loc></sitemap>
${Array.from({ length: teile }, (_, i) => `<sitemap><loc>${esc(b)}/sitemap-katalog-${i + 1}.xml</loc></sitemap>`).join('\n')}
</sitemapindex>`);
  });

  router.get('/sitemap-plattformen.xml', (req, res) => {
    const b = basis(req);
    const liste = sichtbarOeffentlich() ? allePlattformen().filter((p) => p.anzahl > 0) : [];
    xml(res, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEintrag(`${b}/`)}
${liste.length ? urlEintrag(`${b}/plattformen`) : ''}
${liste.map((p) => urlEintrag(`${b}${p.pfad}`)).join('\n')}
</urlset>`);
  });

  router.get('/sitemap-katalog-:nr.xml', (req, res) => {
    const b = basis(req);
    const nr = Math.max(1, Number.parseInt(req.params.nr, 10) || 1);
    const zeilen = sichtbarOeffentlich() ? sitemapEintraege.all(PRO_SITEMAP, (nr - 1) * PRO_SITEMAP) : [];
    xml(res, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${zeilen.map((z) => urlEintrag(`${b}${katalogPfad(z, z.kurz)}`, z.geaendert)).join('\n')}
</urlset>`);
  });

  router.get('/robots.txt', (req, res) => {
    const b = basis(req);
    res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=3600').send(sichtbarOeffentlich()
      ? `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${b}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n');
  });

  return router;
}
