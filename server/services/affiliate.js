// Erzeugt „Hier kaufen“-Links: Suchlinks mit Partner-ID sowie vom Moderationsteam
// hinterlegte Direktlinks zu konkreten Angeboten.
import { AFFILIATE_STANDARD } from '../affiliate-konfiguration.js';

/** Hostname ohne „www.“ aus einer URL, z. B. PUBLIC_URL. */
function hostname(url) {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Gehört der Host zu einer der freigegebenen Domains (inkl. Subdomains)? */
export function domainErlaubt(host, domains = AFFILIATE_STANDARD.domains) {
  if (!host) return false;
  return domains.map((d) => String(d).toLowerCase().replace(/^www\./, '')).filter(Boolean)
    .some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Eigene IDs des Betreibers (.env / Administration → Einstellungen) haben Vorrang.
 * Die Standard-IDs aus dem Code gelten nur, wenn PUBLIC_URL auf eine in
 * affiliate-konfiguration.js eingetragene Domain zeigt – andere Installationen
 * nutzen sie nicht (Partnerprogramme erlauben Links nur auf angemeldeten Websites).
 */
export function ladeAffiliateKonfiguration(env = process.env) {
  const aus = ['0', 'false', 'nein', 'no', 'off'].includes(String(env.AFFILIATE_LINKS ?? '').trim().toLowerCase());
  const standardErlaubt = domainErlaubt(hostname(env.PUBLIC_URL));
  const wert = (eigen, standard) => {
    const e = String(eigen ?? '').trim();
    if (e) return { id: e, quelle: 'eigen' };
    if (standard && standardErlaubt) return { id: standard, quelle: 'standard' };
    return { id: '', quelle: 'keine' };
  };
  const amazon = wert(env.AFFILIATE_AMAZON_TAG, AFFILIATE_STANDARD.amazon.tag);
  const ebay = wert(env.AFFILIATE_EBAY_CAMPID, AFFILIATE_STANDARD.ebay.campid);
  return {
    aktiv: !aus,
    amazonTag: amazon.id,
    amazonQuelle: amazon.quelle,
    amazonDomain: (env.AFFILIATE_AMAZON_DOMAIN || AFFILIATE_STANDARD.amazon.domain).trim(),
    ebayCampid: ebay.id,
    ebayQuelle: ebay.quelle,
    ebayCustomid: AFFILIATE_STANDARD.ebay.customid,
    standardDomains: AFFILIATE_STANDARD.domains,
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
