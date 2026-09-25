// Automatischer Preisimport: aktualisiert regelmäßig Marktpreise (PriceCharting) und
// aktuelle eBay-Angebote für alle freigegebenen Katalogeinträge, die jemand sammelt.
// Ergebnisse landen in der Preis-Historie; die günstigsten eBay-Angebote werden für
// die Katalogseite zwischengespeichert.
import { angebotsStatistik } from './ebay.js';
import { preisregion } from './preise.js';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

export function erstellePreisImport(db, { preise, ebay, cache }) {
  const einstellungLesen = db.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'preisimport'");
  const einstellungSchreiben = db.prepare(`INSERT INTO einstellungen (schluessel, wert) VALUES ('preisimport', ?)
    ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`);
  const tagesWertLoeschen = db.prepare(`DELETE FROM preis_historie WHERE katalog_id = ? AND herkunft = 'ebay' AND datum = ?`);
  const tagesWertSchreiben = db.prepare(`INSERT INTO preis_historie (katalog_id, herkunft, art, preis, datum, quelle, anzahl, notiz)
    VALUES (?, 'ebay', 'angebot', ?, ?, 'ebay', ?, ?)`);
  let laeuft = false;

  const aktiv = () => preise.aktiv || ebay.konfiguriert;
  const status = () => ({ aktiv: aktiv(), laeuft, ...JSON.parse(einstellungLesen.get()?.wert ?? '{}') });

  /** Aktuelle eBay-Angebote für einen Katalogeintrag abrufen und speichern. */
  async function importiereEbay(eintrag, plattform) {
    const { angebote, gesamt } = await ebay.sucheAngebote(eintrag.titel, eintrag.typ === 'spiel' ? plattform : '');
    const statistik = angebotsStatistik(angebote.map((a) => a.preis));
    const heute = new Date().toISOString().slice(0, 10);
    cache.setze(`ebay:angebote:${eintrag.id}`, {
      abgerufen_am: new Date().toISOString(),
      gesamt,
      statistik,
      angebote: [...angebote].sort((a, b) => a.preis - b.preis).slice(0, 6),
    });
    if (statistik) {
      db.transaction(() => {
        tagesWertLoeschen.run(eintrag.id, heute);
        tagesWertSchreiben.run(eintrag.id, statistik.median, heute, statistik.anzahl,
          `Median aus ${statistik.anzahl} aktuellen Angeboten, ab ${statistik.minimum.toFixed(2).replace('.', ',')} €`);
      })();
    }
    return statistik;
  }

  /**
   * Ein Durchlauf. Bearbeitet höchstens „max“ Einträge – zuerst die, die am längsten
   * nicht aktualisiert wurden und die meisten Sammler haben.
   */
  async function lauf({ max = 150, pause = 400 } = {}) {
    if (laeuft || !aktiv()) return status();
    laeuft = true;
    const start = new Date().toISOString();
    let verarbeitet = 0;
    const fehler = [];
    try {
      const eintraege = db.prepare(`
        SELECT k.id, k.titel, k.typ,
               (SELECT a.plattform FROM artikel a WHERE a.katalog_id = k.id AND a.plattform IS NOT NULL LIMIT 1) AS plattform,
               (SELECT GROUP_CONCAT(DISTINCT a.region) FROM artikel a WHERE a.katalog_id = k.id) AS regionen,
               (SELECT COUNT(DISTINCT a.benutzer_id) FROM artikel a WHERE a.katalog_id = k.id) AS besitzer,
               (SELECT MAX(h.datum) FROM preis_historie h WHERE h.katalog_id = k.id AND h.herkunft IN ('ebay', 'marktpreis')) AS zuletzt
        FROM katalog k
        WHERE k.status = 'freigegeben' AND EXISTS (SELECT 1 FROM artikel a WHERE a.katalog_id = k.id)
        ORDER BY zuletzt IS NOT NULL, zuletzt, besitzer DESC
        LIMIT ?`).all(max);
      const heute = start.slice(0, 10);
      for (const e of eintraege) {
        if (e.zuletzt === heute) continue;
        try {
          if (ebay.konfiguriert) await importiereEbay(e, e.plattform);
          if (preise.aktiv) {
            const regionen = new Set((e.regionen ?? '').split(',').filter(Boolean).map(preisregion));
            if (!regionen.size) regionen.add('pal');
            for (const r of regionen) await preise.aktualisiere(e.id, r, e.plattform);
          }
          verarbeitet++;
        } catch (err) {
          fehler.push(`${e.titel}: ${err.message}`);
          if (fehler.length >= 5) break; // bei Störungen des Dienstes abbrechen
        }
        await warte(pause);
      }
    } finally {
      laeuft = false;
      einstellungSchreiben.run(JSON.stringify({ letzterLauf: start, ende: new Date().toISOString(), verarbeitet, fehler: fehler.slice(0, 5) }));
    }
    return status();
  }

  const angeboteFuer = (katalogId) => cache.hole(`ebay:angebote:${katalogId}`) ?? null;

  return { aktiv, status, lauf, importiereEbay, angeboteFuer };
}
