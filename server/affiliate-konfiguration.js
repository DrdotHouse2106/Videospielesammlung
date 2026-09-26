// ─────────────────────────────────────────────────────────────────────────────
// Affiliate-Partnerlinks („Hier kaufen“)
//
// Die Partner-IDs unten gelten NUR auf den unter `domains` eingetragenen Websites,
// d. h. wenn PUBLIC_URL auf eine dieser Domains zeigt. Hintergrund: Partnerprogramme
// wie Amazon PartnerNet erlauben Links mit einer ID nur auf Websites, die im
// Partnerkonto des ID-Inhabers angemeldet sind. Andere Installationen dieses Projekts
// verwenden die IDs daher nicht – deren Betreiber können eigene IDs über die .env
// bzw. Administration → Einstellungen setzen (AFFILIATE_AMAZON_TAG, AFFILIATE_EBAY_CAMPID)
// oder die Links abschalten (AFFILIATE_LINKS=false).
//
// Transparenz: Links werden in der Oberfläche immer als „Anzeige“ gekennzeichnet.
// ─────────────────────────────────────────────────────────────────────────────
export const AFFILIATE_STANDARD = {
  // Eigene Website(s), die im Amazon-PartnerNet bzw. eBay Partner Network angemeldet sind,
  // z. B. ['sammlung.example.de']. Subdomains sind eingeschlossen, „www.“ wird ignoriert.
  domains: ['zockdb.de', 'zock-db.de'],
  amazon: {
    // Partner-ID aus dem Amazon-PartnerNet, z. B. "meinprojekt-21"
    tag: '',
    domain: 'www.amazon.de',
  },
  ebay: {
    // Kampagnen-ID aus dem eBay Partner Network (10-stellige Zahl)
    campid: '',
    customid: 'zockdb',
  },
};
