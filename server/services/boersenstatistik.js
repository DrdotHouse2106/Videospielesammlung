// Anbieter-Statistik der Tauschbörse: Aufrufe, Anfragen und Wunschlisten-Treffer je Angebot und Tag.
//
// Datenschutz: Gespeichert werden ausschließlich Tageszähler. Mehrfachaufrufe derselben Person am selben Tag
// werden über einen Hash mit täglich wechselndem Zufallswert (nur im Arbeitsspeicher) herausgefiltert.
// Eigene Aufrufe und Suchmaschinen-Bots zählen nicht. Nach 400 Tagen werden die Werte gelöscht.
import crypto from 'node:crypto';

const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|preview|monitor|curl|wget|python|headless/i;
const heute = () => new Date().toISOString().slice(0, 10);
const MAX_GESEHEN = 200_000; // Schutz des Arbeitsspeichers bei Flutung
export const STATISTIK_ZEITRAEUME = [7, 30, 90, 365];

export function erstelleBoersenStatistik(db) {
  const q = {
    zaehle: Object.fromEntries(['aufrufe', 'anfragen', 'treffer'].map((feld) => [feld, db.prepare(
      `INSERT INTO boerse_statistik (angebot_id, benutzer_id, tag, ${feld}) VALUES (?, ?, ?, ?)
        ON CONFLICT (angebot_id, tag) DO UPDATE SET ${feld} = ${feld} + excluded.${feld}`,
    )])),
    aufraeumen: db.prepare("DELETE FROM boerse_statistik WHERE tag < date('now', '-400 days')"),
  };

  let salzTag = null;
  let salz = null;
  let gesehen = new Set();

  function zaehle(feld, angebotId, benutzerId, anzahl = 1) {
    if (!angebotId || !benutzerId || anzahl <= 0) return;
    q.zaehle[feld].run(angebotId, benutzerId, heute(), anzahl);
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
    const tage = STATISTIK_ZEITRAEUME.includes(Number(tageRoh)) ? Number(tageRoh) : 30;
    const ab = new Date(Date.now() - (tage - 1) * 86_400_000).toISOString().slice(0, 10);
    const summe = (zeile) => ({ aufrufe: zeile?.aufrufe ?? 0, anfragen: zeile?.anfragen ?? 0, treffer: zeile?.treffer ?? 0 });

    const jeTag = new Map(db.prepare(`SELECT tag, SUM(aufrufe) AS aufrufe, SUM(anfragen) AS anfragen, SUM(treffer) AS treffer
      FROM boerse_statistik WHERE benutzer_id = ? AND tag >= ? GROUP BY tag`).all(benutzerId, ab).map((z) => [z.tag, summe(z)]));
    const verlauf = [];
    for (let i = tage - 1; i >= 0; i -= 1) {
      const tag = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      verlauf.push({ tag, ...summe(jeTag.get(tag)) });
    }
    const gesamt = verlauf.reduce((s, t) => ({
      aufrufe: s.aufrufe + t.aufrufe, anfragen: s.anfragen + t.anfragen, treffer: s.treffer + t.treffer,
    }), summe());

    // Zeitraum davor zum Vergleich
    const vorher = summe(db.prepare(`SELECT SUM(aufrufe) AS aufrufe, SUM(anfragen) AS anfragen, SUM(treffer) AS treffer
      FROM boerse_statistik WHERE benutzer_id = ? AND tag >= date(?, ?) AND tag < ?`).get(benutzerId, ab, `-${tage} days`, ab));

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

    return { tage, zeitraeume: STATISTIK_ZEITRAEUME, gesamt, vorher, verlauf, angebote, gefragt };
  }

  return {
    aufruf,
    zaehle,
    fuer,
    aufraeumen: () => q.aufraeumen.run().changes,
  };
}
