// Marktpreise für Spiele & Hardware.
//
// Quelle 1 (optional): PriceCharting-API (https://www.pricecharting.com/api-documentation),
//   benötigt ein kostenpflichtiges Abo-Token (PRICECHARTING_TOKEN). Preise kommen in US-Dollar
//   und werden mit dem Tageskurs der Europäischen Zentralbank in Euro umgerechnet.
// Quelle 2: Community-Werte – anonymisierte Kaufpreise und Schätzwerte aller Benutzer dieser Instanz.
// Quelle 3: Eigene Schätzung (Feld „Marktwert“ am Artikel) – hat immer Vorrang.

const EZB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const STANDARD_KURS = 0.9; // Notlösung, falls die EZB nicht erreichbar ist
const MIN_WERTE_COMMUNITY = 3; // Mindestanzahl, damit einzelne Preise nicht rückverfolgbar sind

export function preisregion(region) {
  if (region === 'ntsc_u') return 'ntsc';
  if (region === 'ntsc_j') return 'jp';
  return 'pal';
}

/** Plattformname → Konsolenname, wie PriceCharting ihn verwendet. */
function konsolenname(plattform, region) {
  let name = String(plattform ?? '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/^Nintendo Entertainment System$/i, 'NES')
    .replace(/^Super Nintendo$/i, 'Super Nintendo')
    .replace(/^Nintendo GameCube$/i, 'Gamecube')
    .replace(/^Nintendo Wii U$/i, 'Wii U')
    .replace(/^Nintendo Wii$/i, 'Wii')
    .replace(/^Nintendo DS$/i, 'Nintendo DS')
    .replace(/^Sega Mega Drive$/i, region === 'ntsc' ? 'Sega Genesis' : 'Sega Mega Drive')
    .trim();
  if (region === 'pal') name = `PAL ${name}`;
  if (region === 'jp') name = `JP ${name}`;
  return name;
}

function median(werte) {
  const sortiert = werte.filter((w) => w != null).sort((a, b) => a - b);
  if (sortiert.length < MIN_WERTE_COMMUNITY) return null;
  const mitte = Math.floor(sortiert.length / 2);
  const m = sortiert.length % 2 ? sortiert[mitte] : (sortiert[mitte - 1] + sortiert[mitte]) / 2;
  return Math.round(m * 100) / 100;
}

/** Wählt den passenden Preis je nach Zustand und Vollständigkeit. */
export function preisFuerArtikel(preise, artikel) {
  if (!preise) return null;
  if (artikel.zustand === 'neu_ovp' && preise.neu) return { wert: preise.neu, stufe: 'Neu/OVP' };
  switch (artikel.vollstaendigkeit) {
    case 'cib': return preise.cib ? { wert: preise.cib, stufe: 'CIB' } : null;
    case 'nur_ovp': return preise.nur_ovp ? { wert: preise.nur_ovp, stufe: 'Nur OVP' } : null;
    case 'fehlt_anleitung':
      if (preise.lose && preise.nur_ovp) return { wert: Math.round((preise.lose + preise.nur_ovp) * 100) / 100, stufe: 'Lose + OVP' };
      return preise.lose ? { wert: preise.lose, stufe: 'Lose' } : null;
    default: return preise.lose ? { wert: preise.lose, stufe: 'Lose' } : null;
  }
}

export function erstellePreisDienst(db, { priceChartingToken, usdEurKurs, cacheStunden }, { cache, fetchFn = globalThis.fetch } = {}) {
  const aktiv = Boolean(priceChartingToken);
  const maxAlterMs = cacheStunden * 60 * 60 * 1000;
  const lesen = db.prepare('SELECT daten, abgerufen_am FROM preise WHERE katalog_id = ? AND preisregion = ?');
  const schreiben = db.prepare(`
    INSERT INTO preise (katalog_id, preisregion, daten, abgerufen_am) VALUES (?, ?, ?, ?)
    ON CONFLICT (katalog_id, preisregion) DO UPDATE SET daten = excluded.daten, abgerufen_am = excluded.abgerufen_am`);
  const katalogEintrag = db.prepare('SELECT id, titel, typ, plattformen FROM katalog WHERE id = ?');
  // Marktpreise zusätzlich als Verlauf speichern (höchstens ein Wert pro Tag und Stufe)
  const verlaufLoeschen = db.prepare(`DELETE FROM preis_historie WHERE katalog_id = ? AND herkunft = 'marktpreis'
                                      AND preisregion = ? AND art = ? AND datum = ?`);
  const verlaufSchreiben = db.prepare(`INSERT INTO preis_historie (katalog_id, herkunft, art, preis, datum, quelle, preisregion)
                                       VALUES (?, 'marktpreis', ?, ?, ?, 'pricecharting', ?)`);

  async function wechselkurs() {
    if (usdEurKurs) return usdEurKurs;
    try {
      return await cache.merke('wechselkurs:usd-eur', async () => {
        const antwort = await fetchFn(EZB_URL, { signal: AbortSignal.timeout(8000) });
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        const xml = await antwort.text();
        const usd = Number(xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1]);
        if (!usd) throw new Error('Kurs nicht gefunden');
        return Math.round((1 / usd) * 10000) / 10000;
      });
    } catch (fehler) {
      console.warn(`[preise] EZB-Wechselkurs nicht verfügbar (${fehler.message}), nutze ${STANDARD_KURS}.`);
      return STANDARD_KURS;
    }
  }

  function gespeichert(katalogId, region) {
    const zeile = lesen.get(katalogId, region);
    if (!zeile) return { vorhanden: false };
    return { vorhanden: true, veraltet: Date.now() - zeile.abgerufen_am > maxAlterMs, daten: zeile.daten ? JSON.parse(zeile.daten) : null, abgerufen_am: zeile.abgerufen_am };
  }

  /** Fragt PriceCharting ab und speichert das Ergebnis (auch „nicht gefunden“). */
  async function aktualisiere(katalogId, region, plattform) {
    if (!aktiv) return null;
    const eintrag = katalogEintrag.get(katalogId);
    if (!eintrag) return null;
    const plattformen = JSON.parse(eintrag.plattformen || '[]');
    const system = eintrag.typ === 'konsole' ? '' : konsolenname(plattform || plattformen[0] || '', region);
    const suche = `${eintrag.titel} ${system}`.trim();
    const url = `https://www.pricecharting.com/api/product?${new URLSearchParams({ t: priceChartingToken, q: suche })}`;
    const antwort = await fetchFn(url, { signal: AbortSignal.timeout(10000) });
    if (antwort.status === 429) throw new Error('PriceCharting-Anfragelimit erreicht.');
    const json = await antwort.json().catch(() => null);
    let daten = null;
    if (antwort.ok && json?.status === 'success' && json.id) {
      const kurs = await wechselkurs();
      const eur = (cent) => (cent ? Math.round((cent / 100) * kurs * 100) / 100 : null);
      daten = {
        quelle: 'PriceCharting',
        produkt_id: json.id,
        produktname: json['product-name'],
        konsole: json['console-name'],
        lose: eur(json['loose-price']),
        cib: eur(json['cib-price']),
        neu: eur(json['new-price']),
        nur_ovp: eur(json['box-only-price']),
        nur_anleitung: eur(json['manual-only-price']),
        kurs,
        suchbegriff: suche,
        link: `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(suche)}`,
      };
    }
    schreiben.run(katalogId, region, daten ? JSON.stringify(daten) : null, Date.now());
    if (daten) {
      const heute = new Date().toISOString().slice(0, 10);
      db.transaction(() => {
        for (const stufe of ['lose', 'cib', 'neu']) {
          if (!daten[stufe]) continue;
          verlaufLoeschen.run(katalogId, region, stufe, heute);
          verlaufSchreiben.run(katalogId, stufe, daten[stufe], heute, region);
        }
      })();
    }
    return daten;
  }

  /** Preis aus dem Speicher, bei Bedarf (und wenn erlaubt) frisch abrufen. */
  async function hole(katalogId, region, plattform, { abrufen = true } = {}) {
    const vorhanden = gespeichert(katalogId, region);
    if (vorhanden.vorhanden && !vorhanden.veraltet) return vorhanden.daten;
    if (!abrufen || !aktiv) return vorhanden.daten ?? null;
    try {
      return await aktualisiere(katalogId, region, plattform);
    } catch (fehler) {
      console.warn(`[preise] ${fehler.message}`);
      return vorhanden.daten ?? null;
    }
  }

  const communityAbfrage = db.prepare(`
    SELECT benutzer_id, anzahl, kaufpreis, marktwert FROM artikel WHERE katalog_id = ?`);

  /** Anonymisierte Kennzahlen aller Benutzer zu einem Katalogeintrag. */
  function community(katalogId) {
    const zeilen = communityAbfrage.all(katalogId);
    return {
      besitzer: new Set(zeilen.map((z) => z.benutzer_id)).size,
      exemplare: zeilen.reduce((summe, z) => summe + (z.anzahl ?? 1), 0),
      median_kaufpreis: median(zeilen.map((z) => z.kaufpreis)),
      median_marktwert: median(zeilen.map((z) => z.marktwert)),
      mindestanzahl: MIN_WERTE_COMMUNITY,
    };
  }

  /** Schätzwert eines Artikels (pro Stück) samt Herkunft. */
  function schaetze(artikel, communityWerte) {
    if (artikel.marktwert != null) return { wert: artikel.marktwert, quelle: 'Eigene Schätzung' };
    if (artikel.katalog_id) {
      const preis = preisFuerArtikel(gespeichert(artikel.katalog_id, preisregion(artikel.region)).daten, artikel);
      if (preis) return { wert: preis.wert, quelle: `PriceCharting (${preis.stufe})` };
      const c = communityWerte ?? community(artikel.katalog_id);
      if (c.median_marktwert != null) return { wert: c.median_marktwert, quelle: 'Community' };
    }
    return null;
  }

  return { aktiv, hole, aktualisiere, gespeichert, community, schaetze, wechselkurs };
}
