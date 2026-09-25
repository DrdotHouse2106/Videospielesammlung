// ─────────────────────────────────────────────────────────────────────────────
// Affiliate-Partnerlinks („Hier kaufen“)
//
// Diese Standardwerte gelten für JEDE Installation, solange der Betreiber sie nicht
// über die .env-Datei überschreibt (AFFILIATE_AMAZON_TAG, AFFILIATE_EBAY_CAMPID)
// oder abschaltet (AFFILIATE_LINKS=false). Die Einnahmen finanzieren die
// Weiterentwicklung dieses Projekts. Hinweis: Laut Lizenz (PolyForm Noncommercial)
// ist der Betrieb mit eigenen Affiliate-IDs eine kommerzielle Nutzung.
//
// Transparenz: Links werden in der Oberfläche immer als „Anzeige“ gekennzeichnet.
// ─────────────────────────────────────────────────────────────────────────────
export const AFFILIATE_STANDARD = {
  amazon: {
    // Partner-ID aus dem Amazon-PartnerNet, z. B. "meinprojekt-21"
    tag: '',
    domain: 'www.amazon.de',
  },
  ebay: {
    // Kampagnen-ID aus dem eBay Partner Network (10-stellige Zahl)
    campid: '',
    customid: 'videospielesammlung',
  },
};
