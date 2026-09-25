// Aktuelle Angebote über die offizielle eBay Browse API (https://developer.ebay.com/api-docs/buy/browse/overview.html).
// Benötigt einen kostenlosen eBay-Developer-Zugang (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET).
// Ist eine eBay-Partner-Kampagnen-ID hinterlegt, liefert eBay die Angebotslinks direkt als Affiliate-Links.

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SUCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

const woerter = (text) => String(text).toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

// Angebote, die offensichtlich nicht das Spiel/Gerät selbst sind
const AUSSCHLUSS = /\b(nur (die )?(hülle|huelle|ovp|anleitung)|leerhülle|leerhuelle|ersatzhülle|poster|lösungsbuch|loesungsbuch|guide|lösungsheft|reproduktion|repro|nachdruck)\b/i;

export function erstelleEbayDienst({ clientId, clientSecret, marktplatz = 'EBAY_DE', standort = 'DE', kategorien = '' }, affiliate, { fetchFn = globalThis.fetch } = {}) {
  const konfiguriert = Boolean(clientId && clientSecret);
  let token = null;
  let laeuftAb = 0;

  async function holeToken() {
    if (token && laeuftAb - 60_000 > Date.now()) return token;
    const antwort = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
      signal: AbortSignal.timeout(10_000),
    });
    if (!antwort.ok) throw new Error(`eBay-Anmeldung fehlgeschlagen (HTTP ${antwort.status}). EBAY_CLIENT_ID/SECRET prüfen.`);
    const daten = await antwort.json();
    token = daten.access_token;
    laeuftAb = Date.now() + daten.expires_in * 1000;
    return token;
  }

  /**
   * Sucht aktuelle Angebote und liefert passende Treffer (Titel muss alle Suchwörter enthalten).
   * @returns {Promise<{ angebote: object[], gesamt: number }>}
   */
  async function sucheAngebote(titel, zusatz = '') {
    if (!konfiguriert) return { angebote: [], gesamt: 0 };
    const suchbegriff = `${titel} ${zusatz}`.trim();
    const parameter = new URLSearchParams({
      q: suchbegriff.slice(0, 100),
      limit: '50',
      filter: `buyingOptions:{FIXED_PRICE},priceCurrency:EUR,itemLocationCountry:${standort}`,
    });
    if (kategorien) parameter.set('category_ids', kategorien);
    const headers = {
      Authorization: `Bearer ${await holeToken()}`,
      'X-EBAY-C-MARKETPLACE-ID': marktplatz,
      'Accept-Language': 'de-DE',
    };
    if (affiliate?.ebayCampid) {
      headers['X-EBAY-C-ENDUSERCTX'] = `affiliateCampaignId=${affiliate.ebayCampid},affiliateReferenceId=${affiliate.ebayCustomid}`;
    }
    const antwort = await fetchFn(`${SUCH_URL}?${parameter}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (antwort.status === 401) token = null;
    if (!antwort.ok) throw new Error(`eBay-Suche fehlgeschlagen (HTTP ${antwort.status}).`);
    const daten = await antwort.json();
    const pflicht = woerter(titel);
    const angebote = (daten.itemSummaries ?? [])
      .filter((a) => a.price?.currency === 'EUR' && Number(a.price.value) > 0)
      .filter((a) => {
        const t = new Set(woerter(a.title));
        return pflicht.every((w) => t.has(w)) && !AUSSCHLUSS.test(a.title);
      })
      .map((a) => ({
        titel: a.title,
        preis: Math.round(Number(a.price.value) * 100) / 100,
        zustand: a.condition ?? null,
        url: a.itemAffiliateWebUrl || a.itemWebUrl,
        bild: a.image?.imageUrl ?? null,
      }));
    return { angebote, gesamt: daten.total ?? angebote.length };
  }

  return { konfiguriert, sucheAngebote };
}

/** Median und Minimum, Ausreißer (unter 25 % bzw. über 400 % des Medians) werden verworfen. */
export function angebotsStatistik(preise) {
  const sortiert = [...preise].sort((a, b) => a - b);
  if (!sortiert.length) return null;
  const roh = sortiert[Math.floor(sortiert.length / 2)];
  const bereinigt = sortiert.filter((p) => p >= roh * 0.25 && p <= roh * 4);
  const mitte = Math.floor(bereinigt.length / 2);
  const median = bereinigt.length % 2 ? bereinigt[mitte] : (bereinigt[mitte - 1] + bereinigt[mitte]) / 2;
  return { median: Math.round(median * 100) / 100, minimum: bereinigt[0], anzahl: bereinigt.length };
}
