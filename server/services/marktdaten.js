// Auswertung und Export des anonymen Marktarchivs (markt_angebote, markt_nachfrage).
// Enthält keine Benutzerdaten – geeignet für Preisentwicklungen, Marktberichte und die Weitergabe an Dritte.

/** Schützt Zellen vor Formel-Ausführung in Tabellenprogrammen. */
const zelle = (wert) => {
  if (wert === null || wert === undefined) return '';
  let t = String(wert);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = `'${t}`;
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csv = (spalten, zeilen) => `﻿${[spalten.join(';'), ...zeilen.map((z) => spalten.map((s) => zelle(z[s])).join(';'))].join('\r\n')}\r\n`;
const datum = (w) => (/^\d{4}-\d{2}-\d{2}$/.test(w ?? '') ? w : null);

export function erstelleMarktdatenDienst(db) {
  function uebersicht() {
    const g = db.prepare(`SELECT COUNT(*) AS anzeigen, SUM(beendet_am IS NULL) AS laufend, SUM(ergebnis = 'verkauft') AS verkauft,
        SUM(gewerblich) AS gewerblich, MIN(eingestellt_am) AS seit, COUNT(DISTINCT katalog_id) AS titel,
        ROUND(AVG(CASE WHEN ergebnis = 'verkauft' THEN julianday(beendet_am) - julianday(eingestellt_am) END), 1) AS tage_bis_verkauf
      FROM markt_angebote`).get();
    const nachfrage = db.prepare('SELECT COUNT(DISTINCT tag) AS tage, MIN(tag) AS seit FROM markt_nachfrage').get();
    // Meistverkaufte Titel mit Durchschnittspreis beim Verkauf
    const top = db.prepare(`SELECT m.katalog_id, k.titel, COUNT(*) AS verkauft, ROUND(AVG(m.preis_ende), 2) AS preis_schnitt,
        MIN(m.preis_ende) AS preis_min, MAX(m.preis_ende) AS preis_max
      FROM markt_angebote m LEFT JOIN katalog k ON k.id = m.katalog_id
      WHERE m.ergebnis = 'verkauft' AND m.preis_ende IS NOT NULL
      GROUP BY m.katalog_id ORDER BY verkauft DESC, preis_schnitt DESC LIMIT 20`).all();
    // Monatlicher Verlauf: neue Anzeigen, Verkäufe, Durchschnittspreis der Verkäufe
    const monate = db.prepare(`SELECT substr(eingestellt_am, 1, 7) AS monat, COUNT(*) AS neu FROM markt_angebote GROUP BY monat ORDER BY monat`).all();
    const verkaeufe = new Map(db.prepare(`SELECT substr(beendet_am, 1, 7) AS monat, COUNT(*) AS verkauft, ROUND(AVG(preis_ende), 2) AS preis_schnitt
      FROM markt_angebote WHERE ergebnis = 'verkauft' GROUP BY monat`).all().map((z) => [z.monat, z]));
    const verlauf = monate.map((m) => ({ ...m, verkauft: verkaeufe.get(m.monat)?.verkauft ?? 0, preis_schnitt: verkaeufe.get(m.monat)?.preis_schnitt ?? null }));
    return {
      anzeigen: g.anzeigen ?? 0, laufend: g.laufend ?? 0, verkauft: g.verkauft ?? 0, gewerblich: g.gewerblich ?? 0,
      titel: g.titel ?? 0, seit: g.seit, tage_bis_verkauf: g.tage_bis_verkauf, nachfrage, top, verlauf: verlauf.slice(-24),
    };
  }

  function angeboteCsv({ von, bis } = {}) {
    const zeilen = db.prepare(`SELECT m.id, m.katalog_id, k.titel, k.typ, p.name AS plattform, v.bezeichnung AS variante, m.art, m.zustand,
        m.vollstaendigkeit, m.region, m.anzahl, m.gewerblich, m.preis_start, m.preis_ende, m.preis_min, m.preis_max, m.preisaenderungen,
        m.aufrufe, m.anfragen, m.treffer, m.eingestellt_am, m.beendet_am, m.ergebnis
      FROM markt_angebote m LEFT JOIN katalog k ON k.id = m.katalog_id LEFT JOIN plattformen p ON p.id = m.plattform_id
      LEFT JOIN katalog_varianten v ON v.id = m.variante_id
      WHERE (@von IS NULL OR m.eingestellt_am >= @von) AND (@bis IS NULL OR m.eingestellt_am <= @bis)
      ORDER BY m.id`).all({ von: datum(von), bis: datum(bis) });
    return csv(['id', 'katalog_id', 'titel', 'typ', 'plattform', 'variante', 'art', 'zustand', 'vollstaendigkeit', 'region', 'anzahl',
      'gewerblich', 'preis_start', 'preis_ende', 'preis_min', 'preis_max', 'preisaenderungen', 'aufrufe', 'anfragen', 'treffer',
      'eingestellt_am', 'beendet_am', 'ergebnis'], zeilen);
  }

  function nachfrageCsv({ von, bis } = {}) {
    const zeilen = db.prepare(`SELECT n.tag, n.katalog_id, k.titel, k.typ, n.suchende, n.max_preis_schnitt, n.angebote_aktiv, n.preis_min, n.preis_schnitt
      FROM markt_nachfrage n LEFT JOIN katalog k ON k.id = n.katalog_id
      WHERE (@von IS NULL OR n.tag >= @von) AND (@bis IS NULL OR n.tag <= @bis)
      ORDER BY n.tag, n.katalog_id`).all({ von: datum(von), bis: datum(bis) });
    return csv(['tag', 'katalog_id', 'titel', 'typ', 'suchende', 'max_preis_schnitt', 'angebote_aktiv', 'preis_min', 'preis_schnitt'], zeilen);
  }

  return { uebersicht, angeboteCsv, nachfrageCsv };
}
