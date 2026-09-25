// Erzeugt „Hier kaufen“-Links: Suchlinks mit Partner-ID sowie vom Moderationsteam
// hinterlegte Direktlinks zu konkreten Angeboten.
import { AFFILIATE_STANDARD } from '../affiliate-konfiguration.js';

export function ladeAffiliateKonfiguration(env = process.env) {
  const aus = ['0', 'false', 'nein', 'no', 'off'].includes(String(env.AFFILIATE_LINKS ?? '').trim().toLowerCase());
  return {
    aktiv: !aus,
    amazonTag: (env.AFFILIATE_AMAZON_TAG ?? AFFILIATE_STANDARD.amazon.tag).trim(),
    amazonDomain: (env.AFFILIATE_AMAZON_DOMAIN || AFFILIATE_STANDARD.amazon.domain).trim(),
    ebayCampid: (env.AFFILIATE_EBAY_CAMPID ?? AFFILIATE_STANDARD.ebay.campid).trim(),
    ebayCustomid: AFFILIATE_STANDARD.ebay.customid,
  };
}

export function erstelleAffiliateDienst(db, konfiguration) {
  const direktlinks = db.prepare('SELECT * FROM kauflinks WHERE katalog_id = ? AND aktiv = 1 ORDER BY preis IS NULL, preis, id');

  /** Liefert alle Kaufmöglichkeiten zu einem Katalogeintrag. */
  function links(eintrag, plattformName) {
    if (!konfiguration.aktiv || !eintrag) return [];
    const ergebnis = direktlinks.all(eintrag.id).map((l) => ({
      id: l.id, anbieter: l.anbieter, titel: l.titel, url: l.url, preis: l.preis, art: 'direkt',
    }));
    const suchbegriff = [eintrag.titel, eintrag.typ === 'spiel' ? plattformName : null].filter(Boolean).join(' ');
    const q = encodeURIComponent(suchbegriff);
    if (konfiguration.amazonTag) {
      ergebnis.push({
        anbieter: 'Amazon', titel: `„${suchbegriff}“ bei Amazon suchen`, art: 'suche',
        url: `https://${konfiguration.amazonDomain}/s?k=${q}&tag=${encodeURIComponent(konfiguration.amazonTag)}`,
      });
    }
    if (konfiguration.ebayCampid) {
      ergebnis.push({
        anbieter: 'eBay', titel: `„${suchbegriff}“ bei eBay suchen`, art: 'suche',
        url: `https://www.ebay.de/sch/i.html?_nkw=${q}&mkcid=1&mkrid=707-53477-19255-0&siteid=77`
          + `&campid=${encodeURIComponent(konfiguration.ebayCampid)}&customid=${encodeURIComponent(konfiguration.ebayCustomid)}&toolid=10001&mkevt=1`,
      });
    }
    return ergebnis;
  }

  return { aktiv: konfiguration.aktiv, links };
}
