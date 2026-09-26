// Schnäppchen-Alarm: Benachrichtigung, wenn ein Angebot deutlich unter dem Marktwert liegt.
//
// - Für alle kostenlos einstellbar: Schwelle (z. B. höchstens 60 % des Marktwerts) und Umfang
//   (nur Spiele der Wunschliste, bestimmte Plattformen oder alle Angebote).
// - Frühzugang (Abo): Benachrichtigung sofort; alle anderen nach der eingestellten Wartezeit (Standard 60 Minuten).
//   Das steht offen in den Nutzungsbedingungen – jeder kann den Frühzugang buchen.
// - Marktwert in dieser Reihenfolge: Median echter Börsen-Verkäufe → PriceCharting-Marktpreis (lose/CIB passend zum
//   Angebot) → Durchschnitt der Preisangaben der letzten 90 Tage (ab 3 Werten). Ohne Marktwert kein Alarm.
import { KontoFehler } from './konten.js';
import { ValidierungsFehler } from './validierung.js';

export const MAX_SCHWELLE = 80;         // höher ist kein Schnäppchen mehr
const MAX_JE_TAG = 30;                  // Schutz vor Benachrichtigungsflut
const UMFAENGE = ['wunschliste', 'plattformen', 'alle'];
const heute = () => new Date().toISOString().slice(0, 10);
const sqlZeit = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export function erstelleSchnaeppchenDienst(db, { konfiguration, benachrichtigungen, preise, preisindex }) {
  const q = {
    angebot: db.prepare(`SELECT a.*, k.titel, p.kurz AS plattform_kurz FROM angebote a JOIN katalog k ON k.id = a.katalog_id
      LEFT JOIN plattformen p ON p.id = a.plattform_id WHERE a.id = ?`),
    vorhanden: db.prepare('SELECT * FROM schnaeppchen WHERE angebot_id = ?'),
    speichern: db.prepare(`INSERT INTO schnaeppchen (angebot_id, preis, marktwert, prozent, quelle) VALUES (@angebot_id, @preis, @marktwert, @prozent, @quelle)
      ON CONFLICT (angebot_id) DO UPDATE SET preis = excluded.preis, marktwert = excluded.marktwert, prozent = excluded.prozent,
        quelle = excluded.quelle, erkannt_am = datetime('now')`),
    entfernen: db.prepare('DELETE FROM schnaeppchen WHERE angebot_id = ?'),
    preise90: db.prepare(`SELECT preis FROM preis_historie WHERE katalog_id = ? AND herkunft <> 'marktpreis' AND datum >= date('now', '-90 days')`),
    planen: db.prepare('INSERT OR IGNORE INTO schnaeppchen_versand (angebot_id, benutzer_id, faellig_am) VALUES (?, ?, ?)'),
  };

  /** Marktwert eines Titels passend zur Vollständigkeit. */
  function marktwert(katalogId, vollstaendigkeit) {
    const verkauf = preisindex.fuerKatalog(katalogId);
    if (verkauf.median) return { wert: verkauf.median, quelle: 'verkaeufe' };
    const markt = preise.gespeichert(katalogId, 'pal')?.daten;
    const stufe = vollstaendigkeit === 'cib' ? (markt?.cib ?? markt?.lose) : (markt?.lose ?? markt?.cib);
    if (stufe > 0) return { wert: stufe, quelle: 'marktpreis' };
    const werte = q.preise90.all(katalogId).map((z) => z.preis);
    if (werte.length >= 3) return { wert: Math.round((werte.reduce((s, w) => s + w, 0) / werte.length) * 100) / 100, quelle: 'preise90' };
    return null;
  }

  /** Wer soll über dieses Schnäppchen benachrichtigt werden? */
  function interessenten(a, prozent) {
    return db.prepare(`SELECT b.id, b.fruehzugang_bis, b.schnaeppchen_umfang, b.schnaeppchen_plattformen FROM benutzer b
      WHERE b.schnaeppchen_aktiv = 1 AND b.gesperrt = 0 AND b.id != @anbieter AND b.schnaeppchen_schwelle >= @prozent
        AND NOT EXISTS (SELECT 1 FROM blockierungen x WHERE (x.benutzer_id = b.id AND x.blockiert_id = @anbieter) OR (x.benutzer_id = @anbieter AND x.blockiert_id = b.id))`)
      .all({ anbieter: a.benutzer_id, prozent })
      .filter((b) => {
        if (b.schnaeppchen_umfang === 'alle') return true;
        if (b.schnaeppchen_umfang === 'plattformen') {
          let liste = [];
          try { liste = JSON.parse(b.schnaeppchen_plattformen || '[]'); } catch { /* leer */ }
          if (a.plattform_id) return liste.includes(a.plattform_id);
          return db.prepare('SELECT plattform_id FROM katalog_plattformen WHERE katalog_id = ?').all(a.katalog_id).some((p) => liste.includes(p.plattform_id));
        }
        // Wunschliste: gleicher Titel, passende oder egal welche Plattform
        return Boolean(db.prepare('SELECT 1 FROM wunschliste WHERE benutzer_id = ? AND katalog_id = ? AND (plattform_id IS NULL OR plattform_id = ?)')
          .get(b.id, a.katalog_id, a.plattform_id ?? -1));
      });
  }

  /** Prüft neue bzw. geänderte aktive Angebote und plant Benachrichtigungen. */
  function pruefe(angebotIds) {
    let neu = 0;
    const warte = konfiguration.privat.fruehzugangMinuten * 60_000;
    for (const id of angebotIds) {
      const a = q.angebot.get(id);
      if (!a || a.status !== 'aktiv' || a.preis === null || a.art === 'tausch') { q.entfernen.run(id); continue; }
      const mw = marktwert(a.katalog_id, a.vollstaendigkeit);
      const prozent = mw ? Math.round((a.preis / mw.wert) * 100) : null;
      if (!mw || prozent > MAX_SCHWELLE) { q.entfernen.run(a.id); continue; }
      const alt = q.vorhanden.get(a.id);
      q.speichern.run({ angebot_id: a.id, preis: a.preis, marktwert: mw.wert, prozent, quelle: mw.quelle });
      if (alt && alt.preis <= a.preis) continue; // schon gemeldet und nicht günstiger geworden
      neu += 1;
      const jetzt = Date.now();
      for (const b of interessenten(a, prozent)) {
        const frueh = b.fruehzugang_bis && b.fruehzugang_bis >= heute();
        q.planen.run(a.id, b.id, sqlZeit(frueh ? jetzt : jetzt + warte));
      }
    }
    if (neu) versende();
    return neu;
  }

  /** Fällige Benachrichtigungen verschicken (Frühzugang sofort, andere nach der Wartezeit). */
  function versende() {
    const faellig = db.prepare(`SELECT v.angebot_id, v.benutzer_id, s.prozent, s.marktwert FROM schnaeppchen_versand v
      JOIN schnaeppchen s ON s.angebot_id = v.angebot_id
      WHERE v.gesendet_am IS NULL AND v.faellig_am <= ? ORDER BY v.faellig_am LIMIT 500`).all(sqlZeit(Date.now()));
    let gesendet = 0;
    for (const v of faellig) {
      db.prepare("UPDATE schnaeppchen_versand SET gesendet_am = datetime('now') WHERE angebot_id = ? AND benutzer_id = ?").run(v.angebot_id, v.benutzer_id);
      const a = q.angebot.get(v.angebot_id);
      if (!a || a.status !== 'aktiv') continue; // inzwischen weg – nichts schicken
      const heuteGesendet = db.prepare("SELECT COUNT(*) AS n FROM schnaeppchen_versand WHERE benutzer_id = ? AND gesendet_am >= date('now')").get(v.benutzer_id).n;
      if (heuteGesendet > MAX_JE_TAG) continue;
      const euro = (n) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
      benachrichtigungen.sende(v.benutzer_id, {
        art: 'schnaeppchen',
        titel: `Schnäppchen: ${a.titel}${a.plattform_kurz ? ` (${a.plattform_kurz})` : ''} für ${euro(a.preis)}`,
        text: `${100 - v.prozent} % unter dem Marktwert von ca. ${euro(v.marktwert)}.`,
        link: `#/boerse/angebot/${a.id}`,
      });
      gesendet += 1;
    }
    return gesendet;
  }

  function einstellungen(benutzerId) {
    const b = db.prepare('SELECT schnaeppchen_aktiv, schnaeppchen_schwelle, schnaeppchen_umfang, schnaeppchen_plattformen, fruehzugang_bis FROM benutzer WHERE id = ?').get(benutzerId);
    let plattformen = [];
    try { plattformen = JSON.parse(b.schnaeppchen_plattformen || '[]'); } catch { /* leer */ }
    return {
      aktiv: Boolean(b.schnaeppchen_aktiv),
      schwelle: b.schnaeppchen_schwelle,
      umfang: b.schnaeppchen_umfang,
      plattformen,
      fruehzugang_bis: b.fruehzugang_bis && b.fruehzugang_bis >= heute() ? b.fruehzugang_bis : null,
      fruehzugang_minuten: konfiguration.privat.fruehzugangMinuten,
      fruehzugang_preis: konfiguration.privat.fruehzugangPreis,
      max_schwelle: MAX_SCHWELLE,
    };
  }

  function speichere(benutzerId, eingabe = {}) {
    if (!db.prepare('SELECT 1 FROM benutzer WHERE id = ?').get(benutzerId)) throw new KontoFehler('Benutzer nicht gefunden.', 404);
    const schwelle = Number(eingabe.schwelle);
    if (!Number.isInteger(schwelle) || schwelle < 10 || schwelle > MAX_SCHWELLE) {
      throw new ValidierungsFehler({ schwelle: `Bitte einen Wert zwischen 10 und ${MAX_SCHWELLE} % wählen.` });
    }
    if (!UMFAENGE.includes(eingabe.umfang)) throw new ValidierungsFehler({ umfang: 'Ungültige Auswahl.' });
    const plattformen = Array.isArray(eingabe.plattformen) ? [...new Set(eingabe.plattformen.map(Number).filter(Number.isInteger))].slice(0, 100) : [];
    if (eingabe.umfang === 'plattformen' && !plattformen.length) throw new ValidierungsFehler({ plattformen: 'Bitte mindestens eine Plattform auswählen.' });
    db.prepare(`UPDATE benutzer SET schnaeppchen_aktiv = ?, schnaeppchen_schwelle = ?, schnaeppchen_umfang = ?, schnaeppchen_plattformen = ? WHERE id = ?`)
      .run(eingabe.aktiv ? 1 : 0, schwelle, eingabe.umfang, JSON.stringify(plattformen), benutzerId);
    return einstellungen(benutzerId);
  }

  return { marktwert, pruefe, versende, einstellungen, speichere };
}
