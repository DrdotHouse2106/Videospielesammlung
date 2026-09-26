// Erfolge (Abzeichen) und Sammlungsziele.
// Erfolge werden aus den vorhandenen Daten berechnet; beim ersten Erreichen wird das Datum gespeichert
// und eine Benachrichtigung verschickt.

/** Alle Erfolge. `wert(k)` liefert den aktuellen Stand aus den Kennzahlen, `ziel` den nötigen Wert. */
export const ERFOLGE = [
  { schluessel: 'erster_eintrag', symbol: '🎮', titel: 'Erste Schritte', beschreibung: 'Den ersten Artikel erfasst', ziel: 1, wert: (k) => k.stueck },
  { schluessel: 'sammler_10', symbol: '📦', titel: 'Sammler', beschreibung: '10 Exemplare in der Sammlung', ziel: 10, wert: (k) => k.stueck },
  { schluessel: 'sammler_100', symbol: '🏆', titel: 'Leidenschaftlicher Sammler', beschreibung: '100 Exemplare in der Sammlung', ziel: 100, wert: (k) => k.stueck },
  { schluessel: 'sammler_500', symbol: '🏛️', titel: 'Archivar', beschreibung: '500 Exemplare in der Sammlung', ziel: 500, wert: (k) => k.stueck },
  { schluessel: 'sammler_1000', symbol: '👑', titel: 'Museumsdirektor', beschreibung: '1.000 Exemplare in der Sammlung', ziel: 1000, wert: (k) => k.stueck },
  { schluessel: 'konsolen_5', symbol: '🕹️', titel: 'Hardware-Fan', beschreibung: '5 Konsolen gesammelt', ziel: 5, wert: (k) => k.konsolen },
  { schluessel: 'zubehoer_10', symbol: '🔌', titel: 'Voll ausgestattet', beschreibung: '10 Zubehörteile gesammelt', ziel: 10, wert: (k) => k.zubehoer },
  { schluessel: 'plattformen_5', symbol: '🧭', titel: 'Plattform-Hopper', beschreibung: 'Artikel für 5 verschiedene Plattformen', ziel: 5, wert: (k) => k.plattformen },
  { schluessel: 'plattformen_10', symbol: '🌍', titel: 'Systemkenner', beschreibung: 'Artikel für 10 verschiedene Plattformen', ziel: 10, wert: (k) => k.plattformen },
  { schluessel: 'cib_25', symbol: '📚', titel: 'Komplettist', beschreibung: '25 Spiele komplett mit OVP und Anleitung (CIB)', ziel: 25, wert: (k) => k.cib },
  { schluessel: 'neu_5', symbol: '✨', titel: 'Originalverschweißt', beschreibung: '5 Artikel neu und originalverschweißt', ziel: 5, wert: (k) => k.neu },
  { schluessel: 'retro_1', symbol: '⏳', titel: 'Zeitreisender', beschreibung: 'Ein Spiel, das vor 1990 erschienen ist', ziel: 1, wert: (k) => k.vor1990 },
  { schluessel: 'retro_25', symbol: '📼', titel: 'Retro-Veteran', beschreibung: '25 Spiele, die vor 1995 erschienen sind', ziel: 25, wert: (k) => k.vor1995 },
  { schluessel: 'regionen_3', symbol: '🗺️', titel: 'Regionen-Jäger', beschreibung: 'Artikel aus 3 Regionen (z. B. PAL, NTSC-U, NTSC-J)', ziel: 3, wert: (k) => k.regionen },
  { schluessel: 'varianten_3', symbol: '🧩', titel: 'Variantenjäger', beschreibung: '3 Varianten desselben Titels gesammelt', ziel: 3, wert: (k) => k.maxVarianten },
  { schluessel: 'scanner_10', symbol: '📷', titel: 'Scanner-Profi', beschreibung: '10 Artikel mit Barcode erfasst', ziel: 10, wert: (k) => k.barcodes },
  { schluessel: 'helfer_1', symbol: '🤝', titel: 'Helfer', beschreibung: 'Einen Beitrag zur gemeinsamen Datenbank freigegeben bekommen', ziel: 1, wert: (k) => k.beitraege },
  { schluessel: 'helfer_10', symbol: '🌟', titel: 'Kurator', beschreibung: '10 freigegebene Beiträge (Einträge, Varianten, Scans, Links)', ziel: 10, wert: (k) => k.beitraege },
  { schluessel: 'scan_1', symbol: '🖨️', titel: 'Archivist', beschreibung: 'Einen Scan für alle freigegeben bekommen', ziel: 1, wert: (k) => k.scans },
  { schluessel: 'sicher', symbol: '🛡️', titel: 'Sicher ist sicher', beschreibung: 'Zwei-Faktor-Anmeldung aktiviert', ziel: 1, wert: (k) => k.zweiFaktor },
  { schluessel: 'teilen', symbol: '📣', titel: 'Stolzer Sammler', beschreibung: 'Die eigene Sammlung geteilt', ziel: 1, wert: (k) => k.geteilt },
];

export function erstelleErfolgeDienst(db, { benachrichtigungen }) {
  const q = {
    artikel: db.prepare(`SELECT
        COALESCE(SUM(a.anzahl), 0) AS stueck,
        COALESCE(SUM(CASE WHEN a.typ = 'konsole' THEN a.anzahl END), 0) AS konsolen,
        COALESCE(SUM(CASE WHEN a.typ = 'zubehoer' THEN a.anzahl END), 0) AS zubehoer,
        COUNT(DISTINCT COALESCE(CAST(a.plattform_id AS TEXT), NULLIF(LOWER(TRIM(a.plattform)), ''))) AS plattformen,
        COALESCE(SUM(CASE WHEN a.vollstaendigkeit = 'cib' AND a.typ = 'spiel' THEN a.anzahl END), 0) AS cib,
        COALESCE(SUM(CASE WHEN a.zustand = 'neu_ovp' THEN a.anzahl END), 0) AS neu,
        COALESCE(SUM(CASE WHEN a.typ = 'spiel' AND k.erscheinungsjahr < 1990 THEN a.anzahl END), 0) AS vor1990,
        COALESCE(SUM(CASE WHEN a.typ = 'spiel' AND k.erscheinungsjahr < 1995 THEN a.anzahl END), 0) AS vor1995,
        COUNT(DISTINCT a.region) AS regionen,
        COUNT(CASE WHEN a.barcode IS NOT NULL AND a.barcode <> '' THEN 1 END) AS barcodes
      FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id WHERE a.benutzer_id = ?`),
    varianten: db.prepare(`SELECT COALESCE(MAX(n), 0) AS n FROM (SELECT COUNT(DISTINCT variante_id) AS n FROM artikel
      WHERE benutzer_id = ? AND variante_id IS NOT NULL GROUP BY katalog_id)`),
    beitraege: db.prepare(`SELECT
        (SELECT COUNT(*) FROM katalog WHERE erstellt_von = @b AND quelle = 'eigen' AND status = 'freigegeben')
      + (SELECT COUNT(*) FROM katalog_varianten WHERE erstellt_von = @b AND status = 'freigegeben')
      + (SELECT COUNT(*) FROM medien WHERE benutzer_id = @b AND sichtbarkeit = 'freigegeben')
      + (SELECT COUNT(*) FROM externe_links WHERE benutzer_id = @b AND status = 'freigegeben') AS beitraege,
        (SELECT COUNT(*) FROM medien WHERE benutzer_id = @b AND sichtbarkeit = 'freigegeben') AS scans`),
    konto: db.prepare('SELECT totp_aktiv, sammlung_oeffentlich, freigabe_token FROM benutzer WHERE id = ?'),
    erreicht: db.prepare('SELECT schluessel, freigeschaltet_am FROM erfolge WHERE benutzer_id = ?'),
    speichern: db.prepare('INSERT OR IGNORE INTO erfolge (benutzer_id, schluessel) VALUES (?, ?)'),
    plattformFortschritt: db.prepare(`
      SELECT p.id, p.name, p.kurz,
        COUNT(DISTINCT a.katalog_id) AS eigene,
        (SELECT COUNT(*) FROM katalog_plattformen kp JOIN katalog k ON k.id = kp.katalog_id
          WHERE kp.plattform_id = p.id AND k.status = 'freigegeben' AND k.typ = 'spiel') AS bekannt
      FROM artikel a JOIN plattformen p ON p.id = a.plattform_id
      WHERE a.benutzer_id = ? AND a.typ = 'spiel' AND a.katalog_id IS NOT NULL
      GROUP BY p.id ORDER BY eigene DESC LIMIT 12`),
  };

  function kennzahlen(benutzerId) {
    const k = q.artikel.get(benutzerId);
    const b = q.beitraege.get({ b: benutzerId });
    const konto = q.konto.get(benutzerId) ?? {};
    return {
      ...k,
      maxVarianten: q.varianten.get(benutzerId).n,
      beitraege: b.beitraege,
      scans: b.scans,
      zweiFaktor: konto.totp_aktiv ? 1 : 0,
      geteilt: konto.sammlung_oeffentlich || konto.freigabe_token ? 1 : 0,
    };
  }

  /** Neu erreichte Erfolge speichern und mitteilen. Liefert die neu freigeschalteten. */
  function pruefe(benutzerId) {
    if (!benutzerId) return [];
    const k = kennzahlen(benutzerId);
    const schon = new Set(q.erreicht.all(benutzerId).map((z) => z.schluessel));
    const neu = ERFOLGE.filter((e) => !schon.has(e.schluessel) && e.wert(k) >= e.ziel);
    for (const e of neu) {
      if (q.speichern.run(benutzerId, e.schluessel).changes) {
        benachrichtigungen?.sende(benutzerId, { art: 'erfolg', titel: `${e.symbol} Erfolg freigeschaltet: ${e.titel}`, text: e.beschreibung, link: '#/erfolge' });
      }
    }
    return neu.map((e) => e.schluessel);
  }

  function liste(benutzerId) {
    pruefe(benutzerId);
    const k = kennzahlen(benutzerId);
    const erreicht = new Map(q.erreicht.all(benutzerId).map((z) => [z.schluessel, z.freigeschaltet_am]));
    const erfolge = ERFOLGE.map(({ wert, ...e }) => ({
      ...e, stand: Math.min(wert(k), e.ziel), freigeschaltet_am: erreicht.get(e.schluessel) ?? null,
    }));
    return {
      erfolge,
      freigeschaltet: erfolge.filter((e) => e.freigeschaltet_am).length,
      gesamt: erfolge.length,
      plattformen: q.plattformFortschritt.all(benutzerId),
    };
  }

  /** Sicher aufrufen, ohne Fehler nach außen zu tragen (z. B. nach dem Speichern eines Artikels). */
  const pruefeLeise = (benutzerId) => {
    try {
      return pruefe(benutzerId);
    } catch (e) {
      console.warn('[erfolge]', e.message);
      return [];
    }
  };

  return { pruefe: pruefeLeise, liste, kennzahlen };
}
