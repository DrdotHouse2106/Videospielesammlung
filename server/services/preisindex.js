// Preisindex: Auswertungen des anonymen Marktarchivs für öffentliche Seiten (Google) und die Spieleseiten.
//
// Grundsätze:
// - Preise nur aus echten Verkäufen (bestätigt oder vom Verkäufer gemeldet) – bestrittene Verkäufe und reine
//   Angebotspreise zählen nicht.
// - Median statt Durchschnitt (robust gegen Ausreißer und Scheinverkäufe).
// - Werte erst ab MIN_VERKAEUFE Verkäufen je Titel bzw. Monat – sonst ließen sich einzelne Verkäufe zuordnen.

export const MIN_VERKAEUFE = 3;
const ECHT = "m.ergebnis = 'verkauft' AND m.verkauf_status IN ('bestaetigt', 'gemeldet') AND m.verkaufspreis IS NOT NULL";
// Plattform einer Anzeige – falls nicht angegeben, die (erste) Plattform des Katalogeintrags
const PLATTFORM = `COALESCE(m.plattform_id, (SELECT kp.plattform_id FROM katalog_plattformen kp WHERE kp.katalog_id = m.katalog_id
  ORDER BY kp.plattform_id LIMIT 1))`;

export function median(werte) {
  if (!werte.length) return null;
  const s = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2) * 100) / 100;
}
const monatAb = (monate) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - monate + 1);
  return d.toISOString().slice(0, 7);
};

export function erstellePreisindexDienst(db) {
  /** Echte Verkäufe (optional je Plattform) ab einem Monat (YYYY-MM). */
  function verkaeufe({ plattformId = null, ab } = {}) {
    return db.prepare(`SELECT m.katalog_id, m.verkaufspreis AS preis, m.verkauf_status, substr(m.beendet_am, 1, 7) AS monat, m.beendet_am,
        k.titel, k.typ, k.cover_url, k.erscheinungsjahr, ${PLATTFORM} AS plattform_id
      FROM markt_angebote m JOIN katalog k ON k.id = m.katalog_id AND k.status = 'freigegeben'
      WHERE ${ECHT} AND substr(m.beendet_am, 1, 7) >= @ab
        AND (@p IS NULL OR ${PLATTFORM} = @p)`).all({ ab, p: plattformId });
  }

  function gruppiere(zeilen) {
    const je = new Map();
    for (const z of zeilen) {
      if (!je.has(z.katalog_id)) je.set(z.katalog_id, { ...z, preise: [], bestaetigt: 0 });
      const g = je.get(z.katalog_id);
      g.preise.push(z.preis);
      if (z.verkauf_status === 'bestaetigt') g.bestaetigt += 1;
    }
    return [...je.values()];
  }

  /** Übersicht für /preisindex bzw. /preisindex/:plattform. */
  function uebersicht({ plattformId = null } = {}) {
    const jahr = verkaeufe({ plattformId, ab: monatAb(12) });
    const meistverkauft = gruppiere(jahr)
      .filter((g) => g.preise.length >= MIN_VERKAEUFE)
      .map((g) => ({
        id: g.katalog_id, titel: g.titel, typ: g.typ, cover_url: g.cover_url, erscheinungsjahr: g.erscheinungsjahr,
        verkaeufe: g.preise.length, bestaetigt: g.bestaetigt, median: median(g.preise), min: Math.min(...g.preise), max: Math.max(...g.preise),
      }))
      .sort((a, b) => b.verkaeufe - a.verkaeufe || b.median - a.median)
      .slice(0, 30);

    // Preisaufsteiger: Median der letzten 6 Monate gegenüber den 6 Monaten davor
    const grenze = monatAb(6);
    const jetzt = new Map(gruppiere(jahr.filter((z) => z.monat >= grenze)).map((g) => [g.katalog_id, g]));
    const vorher = gruppiere(jahr.filter((z) => z.monat < grenze));
    const aufsteiger = vorher
      .filter((g) => g.preise.length >= MIN_VERKAEUFE && (jetzt.get(g.katalog_id)?.preise.length ?? 0) >= MIN_VERKAEUFE)
      .map((g) => {
        const alt = median(g.preise);
        const neu = median(jetzt.get(g.katalog_id).preise);
        return { id: g.katalog_id, titel: g.titel, typ: g.typ, cover_url: g.cover_url, alt, neu, prozent: alt ? Math.round(((neu - alt) / alt) * 100) : null };
      })
      .filter((a) => a.prozent !== null && a.prozent > 0)
      .sort((a, b) => b.prozent - a.prozent)
      .slice(0, 10);

    // Meistgesucht: Wunschlisten (anonyme Summen), dazu Preisvorstellung und aktuelle Angebote
    const gesucht = db.prepare(`SELECT k.id, k.titel, k.typ, k.cover_url, k.erscheinungsjahr, COUNT(DISTINCT w.benutzer_id) AS suchende,
        CASE WHEN COUNT(w.max_preis) >= ${MIN_VERKAEUFE} THEN ROUND(AVG(w.max_preis), 2) END AS preisvorstellung,
        (SELECT COUNT(*) FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert')) AS angebote,
        (SELECT MIN(a.preis) FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert')) AS ab_preis
      FROM wunschliste w JOIN katalog k ON k.id = w.katalog_id AND k.status = 'freigegeben'
      WHERE @p IS NULL OR w.plattform_id = @p
         OR (w.plattform_id IS NULL AND EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = k.id AND kp.plattform_id = @p))
      GROUP BY k.id ORDER BY suchende DESC, k.titel COLLATE NOCASE LIMIT 30`).all({ p: plattformId });

    // Verlauf: Verkäufe und Median je Monat (24 Monate)
    const zwei = verkaeufe({ plattformId, ab: monatAb(24) });
    const jeMonat = new Map();
    for (const z of zwei) {
      if (!jeMonat.has(z.monat)) jeMonat.set(z.monat, []);
      jeMonat.get(z.monat).push(z.preis);
    }
    const verlauf = [];
    for (let i = 23; i >= 0; i -= 1) {
      const m = monatAb(i + 1);
      const preise = jeMonat.get(m) ?? [];
      verlauf.push({ monat: m, verkaeufe: preise.length, median: preise.length >= MIN_VERKAEUFE ? median(preise) : null });
    }

    return {
      kennzahlen: {
        verkaeufe: jahr.length,
        bestaetigt: jahr.filter((z) => z.verkauf_status === 'bestaetigt').length,
        titel: new Set(jahr.map((z) => z.katalog_id)).size,
        suchende: db.prepare(`SELECT COUNT(DISTINCT w.benutzer_id) AS n FROM wunschliste w
          WHERE @p IS NULL OR w.plattform_id = @p OR (w.plattform_id IS NULL AND EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = w.katalog_id AND kp.plattform_id = @p))`)
          .get({ p: plattformId }).n,
      },
      meistverkauft, aufsteiger, gesucht, verlauf,
    };
  }

  /** Verkaufspreise eines Katalogeintrags (12 Monate) – nur ab MIN_VERKAEUFE. */
  function fuerKatalog(katalogId) {
    const preise = db.prepare(`SELECT m.verkaufspreis AS preis, m.verkauf_status FROM markt_angebote m
      WHERE m.katalog_id = ? AND ${ECHT} AND substr(m.beendet_am, 1, 7) >= ?`).all(katalogId, monatAb(12));
    if (preise.length < MIN_VERKAEUFE) return { verkaeufe: preise.length, median: null };
    const werte = preise.map((p) => p.preis);
    return {
      verkaeufe: werte.length, bestaetigt: preise.filter((p) => p.verkauf_status === 'bestaetigt').length,
      median: median(werte), min: Math.min(...werte), max: Math.max(...werte),
    };
  }

  /** Plattformen, für die es Verkäufe oder Suchende gibt (Links und Sitemap). */
  function plattformenMitDaten() {
    return db.prepare(`SELECT p.id, p.name, p.kurz, p.hersteller,
        (SELECT COUNT(*) FROM markt_angebote m JOIN katalog k ON k.id = m.katalog_id AND k.status = 'freigegeben'
          WHERE ${ECHT} AND ${PLATTFORM} = p.id) AS verkaeufe,
        (SELECT COUNT(*) FROM wunschliste w WHERE w.plattform_id = p.id
          OR (w.plattform_id IS NULL AND EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = w.katalog_id AND kp.plattform_id = p.id))) AS wuensche
      FROM plattformen p`).all().filter((p) => p.verkaeufe > 0 || p.wuensche > 0);
  }

  return { uebersicht, fuerKatalog, plattformenMitDaten };
}
