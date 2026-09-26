// Anbieter-Statistik der Tauschbörse: Aufrufe, Anfragen und Wunschlisten-Treffer je Angebot und Tag.
//
// Datenschutz: Gespeichert werden ausschließlich Tageszähler. Mehrfachaufrufe derselben Person am selben Tag
// werden über einen Hash mit täglich wechselndem Zufallswert (nur im Arbeitsspeicher) herausgefiltert.
// Eigene Aufrufe und Suchmaschinen-Bots zählen nicht. Die Werte bleiben dauerhaft erhalten (Langzeitvergleiche);
// mit dem Konto werden sie gelöscht – im anonymen Marktarchiv (markt_angebote) bleiben nur die Summen je Anzeige.
import crypto from 'node:crypto';

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|curl|wget|python|headless/i;
const heute = () => new Date().toISOString().slice(0, 10);
const MAX_GESEHEN = 200_000; // Schutz des Arbeitsspeichers bei Flutung
export const STATISTIK_ZEITRAEUME = [7, 30, 90, 365, 730, 0]; // 0 = gesamter Zeitraum

export function erstelleBoersenStatistik(db) {
  const q = {
    zaehle: Object.fromEntries(['aufrufe', 'anfragen', 'treffer'].map((feld) => [feld, db.prepare(
      `INSERT INTO boerse_statistik (angebot_id, benutzer_id, tag, ${feld}) VALUES (?, ?, ?, ?)
        ON CONFLICT (angebot_id, tag) DO UPDATE SET ${feld} = ${feld} + excluded.${feld}`,
    )])),
    archiv: Object.fromEntries(['aufrufe', 'anfragen', 'treffer'].map((feld) => [feld, db.prepare(
      `UPDATE markt_angebote SET ${feld} = ${feld} + ? WHERE angebot_id = ? AND beendet_am IS NULL`,
    )])),
    // Tageswerte der Nachfrage je Katalogeintrag (einmal am Tag, nur Einträge mit Suchenden oder Angeboten)
    nachfrage: db.prepare(`INSERT OR IGNORE INTO markt_nachfrage (tag, katalog_id, suchende, max_preis_schnitt, angebote_aktiv, preis_min, preis_schnitt)
      SELECT date('now'), k.id,
        (SELECT COUNT(*) FROM wunschliste w WHERE w.katalog_id = k.id),
        (SELECT ROUND(AVG(w.max_preis), 2) FROM wunschliste w WHERE w.katalog_id = k.id),
        (SELECT COUNT(*) FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert')),
        (SELECT MIN(a.preis) FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert')),
        (SELECT ROUND(AVG(a.preis), 2) FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert'))
      FROM katalog k
      WHERE EXISTS (SELECT 1 FROM wunschliste w WHERE w.katalog_id = k.id)
         OR EXISTS (SELECT 1 FROM angebote a WHERE a.katalog_id = k.id AND a.status IN ('aktiv', 'reserviert'))`),
  };

  let salzTag = null;
  let salz = null;
  let gesehen = new Set();

  function zaehle(feld, angebotId, benutzerId, anzahl = 1) {
    if (!angebotId || !benutzerId || anzahl <= 0) return;
    q.zaehle[feld].run(angebotId, benutzerId, heute(), anzahl);
    q.archiv[feld].run(anzahl, angebotId);
  }

  /** Zählt einen Aufruf der Angebotsseite – höchstens einmal je Besucher und Tag. */
  function aufruf(angebot, { benutzerId = null, ip = '', ua = '' } = {}) {
    if (!angebot || angebot.eigenes || BOT.test(ua)) return false;
    const tag = heute();
    if (salzTag !== tag || gesehen.size > MAX_GESEHEN) {
      salzTag = tag;
      salz = crypto.randomBytes(16);
      gesehen = new Set();
    }
    const wer = benutzerId ? `b${benutzerId}` : `a${ip}|${ua}`;
    const schluessel = crypto.createHmac('sha256', salz).update(`${angebot.id}|${wer}`).digest('base64url').slice(0, 22);
    if (gesehen.has(schluessel)) return false;
    gesehen.add(schluessel);
    zaehle('aufrufe', angebot.id, angebot.benutzer_id);
    return true;
  }

  /** Auswertung für einen Anbieter über die letzten `tage` Tage. */
  function fuer(benutzerId, tageRoh = 30) {
    const wahl = tageRoh === undefined || tageRoh === '' ? 30 : Number(tageRoh);
    const summe = (zeile) => ({ aufrufe: zeile?.aufrufe ?? 0, anfragen: zeile?.anfragen ?? 0, treffer: zeile?.treffer ?? 0 });
    const erster = db.prepare('SELECT MIN(tag) AS tag FROM boerse_statistik WHERE benutzer_id = ?').get(benutzerId).tag;
    // „Gesamt“: ab dem ersten gezählten Tag (mindestens 30 Tage)
    const gesamtTage = erster ? Math.max(30, Math.round((Date.parse(heute()) - Date.parse(erster)) / 86_400_000) + 1) : 30;
    const tage = STATISTIK_ZEITRAEUME.includes(wahl) ? wahl : 30;
    const anzahlTage = tage === 0 ? gesamtTage : tage;
    const ab = new Date(Date.now() - (anzahlTage - 1) * 86_400_000).toISOString().slice(0, 10);
    // Längere Zeiträume als Monatswerte, sonst Tageswerte
    const monatlich = anzahlTage > 366;
    const schluessel = monatlich ? 'substr(tag, 1, 7)' : 'tag';

    const jeEinheit = new Map(db.prepare(`SELECT ${schluessel} AS einheit, SUM(aufrufe) AS aufrufe, SUM(anfragen) AS anfragen, SUM(treffer) AS treffer
      FROM boerse_statistik WHERE benutzer_id = ? AND tag >= ? GROUP BY einheit`).all(benutzerId, ab).map((z) => [z.einheit, summe(z)]));
    const verlauf = [];
    if (monatlich) {
      const d = new Date(`${ab.slice(0, 7)}-01T00:00:00Z`);
      const ende = heute().slice(0, 7);
      for (let m = d.toISOString().slice(0, 7); m <= ende; d.setUTCMonth(d.getUTCMonth() + 1), m = d.toISOString().slice(0, 7)) {
        verlauf.push({ tag: m, ...summe(jeEinheit.get(m)) });
      }
    } else {
      for (let i = anzahlTage - 1; i >= 0; i -= 1) {
        const tag = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
        verlauf.push({ tag, ...summe(jeEinheit.get(tag)) });
      }
    }
    const gesamt = verlauf.reduce((s, t) => ({
      aufrufe: s.aufrufe + t.aufrufe, anfragen: s.anfragen + t.anfragen, treffer: s.treffer + t.treffer,
    }), summe());

    // Zeitraum davor zum Vergleich
    const vorher = summe(db.prepare(`SELECT SUM(aufrufe) AS aufrufe, SUM(anfragen) AS anfragen, SUM(treffer) AS treffer
      FROM boerse_statistik WHERE benutzer_id = ? AND tag >= date(?, ?) AND tag < ?`).get(benutzerId, ab, `-${anzahlTage} days`, ab));

    const angebote = db.prepare(`SELECT s.angebot_id AS id, SUM(s.aufrufe) AS aufrufe, SUM(s.anfragen) AS anfragen, SUM(s.treffer) AS treffer,
        a.status, a.preis, a.art, k.titel, p.kurz AS plattform_kurz,
        (SELECT COUNT(*) FROM wunschliste w WHERE w.katalog_id = a.katalog_id AND w.benutzer_id != a.benutzer_id) AS gesucht_von
      FROM boerse_statistik s
      LEFT JOIN angebote a ON a.id = s.angebot_id AND a.benutzer_id = s.benutzer_id
      LEFT JOIN katalog k ON k.id = a.katalog_id LEFT JOIN plattformen p ON p.id = a.plattform_id
      WHERE s.benutzer_id = ? AND s.tag >= ?
      GROUP BY s.angebot_id ORDER BY SUM(s.anfragen) DESC, SUM(s.aufrufe) DESC, SUM(s.treffer) DESC LIMIT 50`).all(benutzerId, ab)
      .map((z) => ({
        ...z,
        titel: z.titel ?? 'Gelöschtes Angebot',
        geloescht: z.status === null,
        // Anteil der Aufrufe, aus denen eine Anfrage wurde
        quote: z.aufrufe > 0 ? Math.round((z.anfragen / z.aufrufe) * 1000) / 10 : null,
      }));

    // Gefragte Titel: aktive Angebote mit den meisten Suchenden auf Wunschlisten
    const gefragt = db.prepare(`SELECT a.id, k.titel, p.kurz AS plattform_kurz, a.preis,
        (SELECT COUNT(*) FROM wunschliste w WHERE w.katalog_id = a.katalog_id AND w.benutzer_id != a.benutzer_id) AS gesucht_von
      FROM angebote a JOIN katalog k ON k.id = a.katalog_id LEFT JOIN plattformen p ON p.id = a.plattform_id
      WHERE a.benutzer_id = ? AND a.status IN ('aktiv', 'reserviert')
      ORDER BY gesucht_von DESC, a.id DESC LIMIT 10`).all(benutzerId).filter((z) => z.gesucht_von > 0);

    return { tage, zeitraeume: STATISTIK_ZEITRAEUME, einheit: monatlich ? 'monat' : 'tag', seit: erster, gesamt, vorher: tage === 0 ? null : vorher, verlauf, angebote, gefragt };
  }

  return {
    aufruf,
    zaehle,
    fuer,
    /** Tägliche Nachfrage-Werte ins Marktarchiv (mehrfacher Aufruf am selben Tag schadet nicht). */
    erfasseNachfrage: () => q.nachfrage.run().changes,
  };
}
