// Massen-Upload für gewerbliche Anbieter: Angebote aus einer CSV-Datei (z. B. Export aus Shopware,
// WooCommerce, JTL oder einer Tabelle) anlegen und aktualisieren.
//
// Abgleich: Enthält die Datei eine Artikelnummer (SKU), wird ein bestehendes Angebot mit derselben
// Nummer aktualisiert statt neu angelegt. So lässt sich der Bestand regelmäßig mit derselben Datei
// synchronisieren; Bestand 0 beendet das Angebot.
import { leseCsv, erkenneZuordnung, regionVon, zustandVon, vollstaendigkeitVon, betragVon } from './csvimport.js';
import { ValidierungsFehler } from './validierung.js';
import { KontoFehler } from './konten.js';
import { pruefeAngebot, plzBereich } from './boerse.js';

export const MAX_ZEILEN = 20000;

export const HAENDLER_IMPORT_FELDER = [
  { feld: 'sku', titel: 'Artikelnummer (SKU)', namen: ['sku', 'artikelnummer', 'art.-nr.', 'artnr', 'art.nr.', 'productnumber', 'product number', 'produktnummer', 'bestellnummer', 'item number'] },
  { feld: 'katalog_id', titel: 'ZockDB-ID', namen: ['zockdb-id', 'zockdb id', 'zockdb_id', 'katalog_id', 'katalog-id'] },
  { feld: 'barcode', titel: 'Barcode (EAN/UPC)', namen: ['ean', 'barcode', 'gtin', 'upc'] },
  { feld: 'titel', titel: 'Titel', namen: ['titel', 'title', 'name', 'produktname', 'artikelname', 'bezeichnung', 'spiel'] },
  { feld: 'plattform', titel: 'Plattform', namen: ['plattform', 'platform', 'system', 'konsole'] },
  { feld: 'preis', titel: 'Preis (EUR)', namen: ['preis', 'price', 'verkaufspreis', 'vk', 'bruttopreis', 'price (gross)', 'preis (eur)'] },
  { feld: 'anzahl', titel: 'Bestand', namen: ['bestand', 'stock', 'anzahl', 'menge', 'quantity', 'lagerbestand'] },
  { feld: 'zustand', titel: 'Zustand', namen: ['zustand', 'condition'] },
  { feld: 'vollstaendigkeit', titel: 'Vollständigkeit', namen: ['vollständigkeit', 'vollstaendigkeit', 'completeness', 'lieferumfang'] },
  { feld: 'region', titel: 'Region', namen: ['region', 'land', 'version'] },
  { feld: 'art', titel: 'Angebotsart', namen: ['angebotsart', 'art', 'offer type'] },
  { feld: 'beschreibung', titel: 'Beschreibung', namen: ['beschreibung', 'description', 'zustandsbeschreibung', 'hinweis'] },
];

function artVon(wert) {
  const t = String(wert ?? '').trim().toLowerCase();
  if (!t) return 'verkauf';
  if (t.includes('beide') || t.includes('both')) return 'beides';
  if (t.includes('tausch') || t.includes('trade')) return 'tausch';
  return 'verkauf';
}

/** Wandelt eine Zeile anhand der Zuordnung in Rohdaten um. */
export function zeileZuAngebot(zeile, zuordnung) {
  const w = (feld) => (zuordnung[feld] === undefined ? '' : String(zeile[zuordnung[feld]] ?? '').trim());
  const bestand = w('anzahl') === '' ? 1 : Number.parseInt(w('anzahl'), 10);
  return {
    sku: w('sku') || null,
    katalog_id: /^\d+$/.test(w('katalog_id')) ? Number(w('katalog_id')) : null,
    barcode: w('barcode').replace(/\D/g, '') || null,
    titel: w('titel') || null,
    plattform: w('plattform') || null,
    preis: betragVon(w('preis')),
    bestand: Number.isInteger(bestand) ? bestand : NaN,
    zustand: zustandVon(w('zustand'), w('vollstaendigkeit')),
    vollstaendigkeit: vollstaendigkeitVon(w('vollstaendigkeit')),
    region: regionVon(w('region')),
    art: artVon(w('art')),
    beschreibung: w('beschreibung') || null,
  };
}

export function erstelleBoersenImport(db, { boerse, plattformen, konfiguration }) {
  const q = {
    katalog: db.prepare("SELECT id FROM katalog WHERE id = ? AND status = 'freigegeben'"),
    barcode: db.prepare(`SELECT z.katalog_id AS id, COUNT(*) AS n FROM barcode_zuordnungen z JOIN katalog k ON k.id = z.katalog_id
      WHERE z.code = ? AND k.status = 'freigegeben' GROUP BY z.katalog_id ORDER BY n DESC LIMIT 2`),
    titel: db.prepare(`SELECT k.id FROM katalog k WHERE k.status = 'freigegeben' AND k.titel = @titel COLLATE NOCASE
      AND (@plattform IS NULL OR EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = k.id AND kp.plattform_id = @plattform))
      LIMIT 2`),
    katalogPlattformen: db.prepare('SELECT plattform_id FROM katalog_plattformen WHERE katalog_id = ?'),
    perSku: db.prepare('SELECT * FROM angebote WHERE benutzer_id = ? AND sku = ?'),
    benutzer: db.prepare('SELECT * FROM benutzer WHERE id = ?'),
    anzahlAktiv: db.prepare("SELECT COUNT(*) AS n FROM angebote WHERE benutzer_id = ? AND status IN ('aktiv', 'reserviert')"),
  };

  function lies(textRoh) {
    const text = String(textRoh ?? '');
    if (!text.trim()) throw new ValidierungsFehler({ datei: 'Die Datei ist leer.' });
    const csv = leseCsv(text);
    if (!csv.kopf.length || !csv.zeilen.length) throw new ValidierungsFehler({ datei: 'Keine Datenzeilen gefunden. Die erste Zeile muss die Spaltenüberschriften enthalten.' });
    if (csv.zeilen.length > MAX_ZEILEN) throw new ValidierungsFehler({ datei: `Maximal ${MAX_ZEILEN.toLocaleString('de-DE')} Zeilen pro Datei.` });
    return csv;
  }

  /** Sucht den passenden Katalogeintrag: ZockDB-ID → Barcode → Titel (+ Plattform). */
  function ordneZu(roh) {
    const plattform = roh.plattform ? plattformen.zuordnen(roh.plattform) : null;
    let katalogId = null;
    let grund = null;
    if (roh.katalog_id) {
      katalogId = q.katalog.get(roh.katalog_id)?.id ?? null;
      if (!katalogId) grund = `ZockDB-ID ${roh.katalog_id} ist unbekannt oder nicht freigegeben.`;
    }
    if (!katalogId && roh.barcode) {
      const t = q.barcode.all(roh.barcode);
      if (t.length === 1 || (t.length > 1 && t[0].n > t[1].n)) { katalogId = t[0].id; grund = null; }
    }
    if (!katalogId && roh.titel) {
      const t = q.titel.all({ titel: roh.titel, plattform: plattform?.id ?? null });
      if (t.length === 1) { katalogId = t[0].id; grund = null; } else if (!grund) {
        grund = t.length > 1 ? 'Titel ist mehrdeutig – bitte Plattform oder ZockDB-ID angeben.' : 'Kein passender Eintrag im Katalog gefunden.';
      }
    }
    if (!katalogId && !grund) grund = 'Weder ZockDB-ID, Barcode noch Titel angegeben.';
    let plattformId = plattform?.id ?? null;
    if (katalogId) {
      const moegliche = q.katalogPlattformen.all(katalogId).map((z) => z.plattform_id);
      if (plattformId && moegliche.length && !moegliche.includes(plattformId)) plattformId = null;
      if (!plattformId && moegliche.length === 1) [plattformId] = moegliche;
    }
    return { katalogId, plattformId, grund };
  }

  function zuordnungAus(eingabe, kopf) {
    const zuordnung = {};
    for (const { feld } of HAENDLER_IMPORT_FELDER) {
      const i = eingabe?.[feld];
      if (Number.isInteger(i) && i >= 0 && i < kopf.length) zuordnung[feld] = i;
    }
    if (zuordnung.titel === undefined && zuordnung.katalog_id === undefined && zuordnung.barcode === undefined) {
      throw new ValidierungsFehler({ zuordnung: 'Bitte mindestens eine Spalte für Titel, Barcode oder ZockDB-ID auswählen.' });
    }
    return zuordnung;
  }

  function sicherHaendler(benutzer) {
    boerse.sicherAktiv();
    const b = q.benutzer.get(benutzer.id);
    if (!b.haendler_status) throw new KontoFehler('Der Massen-Upload steht gewerblichen Anbietern zur Verfügung. Bitte zuerst die Anbieterkennzeichnung ausfüllen.', 403, 'kein_haendler');
    return b;
  }

  function analyse(benutzer, text) {
    sicherHaendler(benutzer);
    const csv = lies(text);
    const zuordnung = erkenneZuordnung(csv.kopf, HAENDLER_IMPORT_FELDER);
    return {
      trennzeichen: csv.trennzeichen,
      kopf: csv.kopf,
      zeilen: csv.zeilen.length,
      felder: HAENDLER_IMPORT_FELDER.map(({ feld, titel }) => ({ feld, titel })),
      zuordnung,
      vorschau: csv.zeilen.slice(0, 8).map((z) => {
        const roh = zeileZuAngebot(z, zuordnung);
        const { katalogId, grund } = ordneZu(roh);
        const titel = katalogId ? db.prepare('SELECT titel FROM katalog WHERE id = ?').get(katalogId).titel : null;
        return { ...roh, katalog_id: katalogId, katalog_titel: titel, grund };
      }),
    };
  }

  /**
   * Import: legt Angebote an bzw. aktualisiert sie (per SKU). `beendeFehlende` beendet eigene Angebote mit SKU,
   * die nicht (mehr) in der Datei stehen – so bleibt der Bestand synchron.
   */
  function importiere(benutzer, { text, zuordnung: zuordnungEingabe, beendeFehlende = false, standard = {} } = {}) {
    sicherHaendler(benutzer);
    const csv = lies(text);
    const zuordnung = zuordnungAus(zuordnungEingabe, csv.kopf);
    return verarbeite(benutzer, csv.zeilen.map((z) => zeileZuAngebot(z, zuordnung)), { beendeFehlende, standard });
  }

  /**
   * Legt Angebote aus bereits gelesenen Zeilen an bzw. aktualisiert sie – gemeinsam genutzt vom CSV-Upload
   * und von den automatischen Shop-Anbindungen. `rohZeilen` im Format von zeileZuAngebot().
   */
  function verarbeite(benutzer, rohZeilen, { beendeFehlende = false, standard = {} } = {}) {
    const b = sicherHaendler(benutzer);
    if (rohZeilen.length > MAX_ZEILEN) throw new ValidierungsFehler({ datei: `Maximal ${MAX_ZEILEN.toLocaleString('de-DE')} Artikel pro Abgleich.` });
    const vorgaben = pruefeAngebot({
      versand: standard.versand ?? true, abholung: standard.abholung ?? false, verhandelbar: standard.verhandelbar ?? false,
      plz_bereich: standard.plz_bereich ?? b.boerse_plz ?? '',
    }, { teilweise: true });
    const limit = boerse.limitFuer(b);
    let aktiv = q.anzahlAktiv.get(b.id).n;
    const laeuftAb = new Date(Date.now() + konfiguration.boerse.laufzeitTage * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

    const ergebnis = { angelegt: 0, aktualisiert: 0, beendet: 0, uebersprungen: 0, fehlerhaft: [] };
    const fuerTreffer = [];
    const skusInDatei = new Set();
    const fehler = (index, roh, grund) => {
      ergebnis.uebersprungen++;
      if (ergebnis.fehlerhaft.length < 500) ergebnis.fehlerhaft.push({ zeile: index + 2, titel: roh.titel ?? roh.sku ?? null, grund });
    };

    db.transaction(() => {
      rohZeilen.forEach((roh, index) => {
        if (roh.sku) {
          if (skusInDatei.has(roh.sku)) return fehler(index, roh, `Artikelnummer ${roh.sku} kommt mehrfach vor.`);
          skusInDatei.add(roh.sku);
        }
        if (!Number.isInteger(roh.bestand) || roh.bestand < 0) return fehler(index, roh, 'Ungültiger Bestand.');
        const vorhanden = roh.sku ? q.perSku.get(b.id, roh.sku) : null;
        if (vorhanden?.status === 'entfernt') return fehler(index, roh, 'Dieses Angebot wurde vom Moderationsteam entfernt.');
        // Bestand 0 = ausverkauft → Angebot beenden
        if (roh.bestand === 0) {
          if (vorhanden && ['aktiv', 'reserviert'].includes(vorhanden.status)) {
            db.prepare("UPDATE angebote SET status = 'beendet', anzahl = 0, aktualisiert_am = datetime('now') WHERE id = ?").run(vorhanden.id);
            ergebnis.beendet++;
            aktiv--;
          }
          return undefined;
        }
        const { katalogId, plattformId, grund } = vorhanden && !roh.katalog_id && !roh.barcode && !roh.titel
          ? { katalogId: vorhanden.katalog_id, plattformId: vorhanden.plattform_id, grund: null }
          : ordneZu(roh);
        if (!katalogId) return fehler(index, roh, grund);
        let daten;
        try {
          daten = pruefeAngebot({
            art: roh.art, preis: roh.preis ?? '', zustand: roh.zustand, vollstaendigkeit: roh.vollstaendigkeit, region: roh.region,
            beschreibung: roh.beschreibung, anzahl: Math.min(roh.bestand, 9999), sku: roh.sku,
          }, { teilweise: true });
        } catch (e) {
          if (!(e instanceof ValidierungsFehler)) throw e;
          return fehler(index, roh, Object.values(e.fehler).join(' '));
        }
        const werte = { ...vorgaben, ...daten, katalog_id: katalogId, plattform_id: plattformId };
        if (vorhanden) {
          const wirdSichtbar = !['aktiv', 'reserviert'].includes(vorhanden.status);
          if (wirdSichtbar && aktiv >= limit) return fehler(index, roh, `Limit von ${limit.toLocaleString('de-DE')} aktiven Angeboten erreicht.`);
          db.prepare(`UPDATE angebote SET katalog_id = @katalog_id, plattform_id = @plattform_id, art = @art, preis = @preis,
              zustand = @zustand, vollstaendigkeit = @vollstaendigkeit, region = @region, beschreibung = @beschreibung, anzahl = @anzahl,
              versand = @versand, abholung = @abholung, verhandelbar = @verhandelbar, plz_bereich = @plz_bereich,
              status = CASE WHEN status = 'reserviert' THEN 'reserviert' ELSE 'aktiv' END, laeuft_ab = @laeuft_ab, aktualisiert_am = datetime('now')
            WHERE id = @id`).run({ ...werte, id: vorhanden.id, laeuft_ab: laeuftAb });
          if (wirdSichtbar) aktiv++;
          ergebnis.aktualisiert++;
          fuerTreffer.push(vorhanden.id);
        } else {
          if (aktiv >= limit) return fehler(index, roh, `Limit von ${limit.toLocaleString('de-DE')} aktiven Angeboten erreicht.`);
          const { id } = db.prepare(`INSERT INTO angebote (benutzer_id, katalog_id, plattform_id, art, preis, verhandelbar, zustand, vollstaendigkeit,
              region, beschreibung, anzahl, versand, abholung, plz_bereich, sku, laeuft_ab)
            VALUES (@benutzer_id, @katalog_id, @plattform_id, @art, @preis, @verhandelbar, @zustand, @vollstaendigkeit,
              @region, @beschreibung, @anzahl, @versand, @abholung, @plz_bereich, @sku, @laeuft_ab) RETURNING id`)
            .get({ ...werte, sku: roh.sku, benutzer_id: b.id, laeuft_ab: laeuftAb, plz_bereich: plzBereich(werte.plz_bereich) });
          aktiv++;
          ergebnis.angelegt++;
          fuerTreffer.push(id);
        }
        return undefined;
      });

      if (beendeFehlende) {
        const offene = db.prepare("SELECT id, sku FROM angebote WHERE benutzer_id = ? AND sku IS NOT NULL AND status IN ('aktiv', 'reserviert')").all(b.id);
        for (const a of offene) {
          if (skusInDatei.has(a.sku)) continue;
          db.prepare("UPDATE angebote SET status = 'beendet', aktualisiert_am = datetime('now') WHERE id = ?").run(a.id);
          ergebnis.beendet++;
        }
      }
    })();

    const t = boerse.benachrichtigeTreffer(fuerTreffer);
    return { ...ergebnis, zeilen: rohZeilen.length, sammler_informiert: t.sammler };
  }

  return { analyse, importiere, verarbeite, lies, zuordnungAus };
}
