// Katalog: Zwischenspeicher für IGDB-Treffer und Heimat eigener Einträge
// (Hardware, Zubehör, deutsche Exoten, die in keiner Online-Datenbank stehen).
//
// Sichtbarkeit:
//  - „freigegeben“ (IGDB-Treffer oder vom Moderationsteam geprüft) → für alle sichtbar
//  - „privat“, „eingereicht“, „abgelehnt“ → nur für den Ersteller (und Moderatoren)

import crypto from 'node:crypto';
import { istModerator } from '../../shared/konstanten.js';
import { bereinigeProduktname, barcodeVarianten } from './titel.js';

export function katalogZeileZuObjekt(zeile) {
  if (!zeile) return null;
  const { daten: _daten, ...rest } = zeile;
  return { ...rest, plattformen: JSON.parse(zeile.plattformen || '[]') };
}

/**
 * Entfernt interne Moderationsangaben für Unbeteiligte: KI-Hinweise sieht nur das Moderationsteam,
 * Prüfnotizen nur Ersteller und Moderationsteam.
 */
export function fuerBenutzer(eintrag, benutzer) {
  if (!eintrag) return eintrag;
  const moderator = istModerator(benutzer);
  const eigener = Boolean(benutzer && eintrag.erstellt_von === benutzer.id);
  const { ki_hinweis: kiHinweis, pruefung_notiz: notiz, ...rest } = eintrag;
  return {
    ...rest,
    ...(moderator ? { ki_hinweis: kiHinweis } : {}),
    ...(moderator || eigener ? { pruefung_notiz: notiz } : {}),
  };
}

/** SQL-Bedingung: Katalogeintrag (Alias k) ist für @benutzer sichtbar. */
export const SICHTBAR_SQL = "(k.status = 'freigegeben' OR k.erstellt_von = @benutzer OR @moderator = 1)";
export const sichtbarParameter = (benutzer) => ({ benutzer: benutzer?.id ?? -1, moderator: istModerator(benutzer) ? 1 : 0 });

export function istSichtbar(eintrag, benutzer) {
  if (!eintrag) return false;
  return eintrag.status === 'freigegeben' || Boolean(benutzer && (eintrag.erstellt_von === benutzer.id || istModerator(benutzer)));
}

export function erstelleKatalogDienst(db, { igdb, barcode, cache, plattformen }) {
  const upsert = db.prepare(`
    INSERT INTO katalog (quelle, externe_id, typ, titel, plattformen, erscheinungsjahr, hersteller, cover_url, beschreibung,
                         erstellt_von, status, eingereicht_am)
    VALUES (@quelle, @externe_id, @typ, @titel, @plattformen, @erscheinungsjahr, @hersteller, @cover_url, @beschreibung,
            @erstellt_von, @status, CASE WHEN @status = 'eingereicht' THEN datetime('now') END)
    ON CONFLICT (quelle, externe_id) DO UPDATE SET
      titel = excluded.titel, plattformen = excluded.plattformen, erscheinungsjahr = excluded.erscheinungsjahr,
      hersteller = excluded.hersteller, cover_url = excluded.cover_url, beschreibung = excluded.beschreibung,
      aktualisiert_am = datetime('now')
    WHERE katalog.manuell_bearbeitet = 0
    RETURNING *`);
  const perQuelle = db.prepare('SELECT * FROM katalog WHERE quelle = ? AND externe_id = ?');
  const perId = db.prepare('SELECT * FROM katalog WHERE id = ?');
  const lokaleSuche = db.prepare(`
    SELECT k.* FROM katalog k
    WHERE k.titel LIKE @muster ESCAPE '\\' AND (@typ IS NULL OR k.typ = @typ) AND ${SICHTBAR_SQL}
    ORDER BY (k.erstellt_von = @benutzer) DESC, (k.quelle = 'eigen') DESC, (k.titel LIKE @anfang ESCAPE '\\') DESC, length(k.titel)
    LIMIT 15`);
  const barcodeLesen = db.prepare('SELECT * FROM barcodes WHERE code = ?');
  const barcodeSchreiben = db.prepare(`
    INSERT INTO barcodes (code, produktname, quelle) VALUES (@code, @produktname, @quelle)
    ON CONFLICT (code) DO UPDATE SET produktname = excluded.produktname, quelle = excluded.quelle, abgerufen_am = datetime('now')`);
  // Eigene Zuordnung zuerst, danach freigegebene Einträge nach Häufigkeit
  const barcodeZuordnung = db.prepare(`
    SELECT k.*, SUM(z.benutzer_id = @benutzer) AS eigene, COUNT(*) AS anzahl
    FROM barcode_zuordnungen z JOIN katalog k ON k.id = z.katalog_id
    WHERE z.code = @code AND (k.status = 'freigegeben' OR z.benutzer_id = @benutzer)
    GROUP BY k.id ORDER BY eigene DESC, (k.status = 'freigegeben') DESC, anzahl DESC LIMIT 5`);
  const zuordnungSchreiben = db.prepare('INSERT OR IGNORE INTO barcode_zuordnungen (code, katalog_id, benutzer_id) VALUES (?, ?, ?)');
  const artikelMitBarcode = db.prepare('SELECT id, titel, plattform, typ FROM artikel WHERE barcode = ? AND benutzer_id = ?');

  function speichere(eintrag) {
    const status = eintrag.status ?? (eintrag.quelle === 'igdb' ? 'freigegeben' : 'privat');
    const zeile = upsert.get({
      erstellt_von: null, erscheinungsjahr: null, hersteller: null, cover_url: null, beschreibung: null,
      ...eintrag, status, plattformen: JSON.stringify(eintrag.plattformen ?? []),
    });
    // Manuell bearbeitete Einträge werden von Importen (IGDB) nicht überschrieben
    if (!zeile) return katalogZeileZuObjekt(perQuelle.get(eintrag.quelle, eintrag.externe_id));
    plattformen?.verknuepfeKatalog(zeile.id, eintrag.plattformen);
    return katalogZeileZuObjekt(zeile);
  }

  /** Bearbeitung eines Eintrags durch Ersteller oder Moderation (auch IGDB-Einträge). */
  function aktualisiere(id, daten, { plattformenNeu = false } = {}) {
    return db.transaction(() => {
      const zeile = db.prepare(`UPDATE katalog SET typ = @typ, titel = @titel, plattformen = @plattformen,
          erscheinungsjahr = @erscheinungsjahr, hersteller = @hersteller, cover_url = @cover_url, beschreibung = @beschreibung,
          sammlerhinweise = @sammlerhinweise, seo_titel = @seo_titel, seo_beschreibung = @seo_beschreibung,
          manuell_bearbeitet = CASE WHEN quelle = 'igdb' THEN 1 ELSE manuell_bearbeitet END, aktualisiert_am = datetime('now')
        WHERE id = @id RETURNING *`).get({ sammlerhinweise: null, seo_titel: null, seo_beschreibung: null, ...daten, plattformen: JSON.stringify(daten.plattformen ?? []), id });
      if (plattformenNeu) db.prepare('DELETE FROM katalog_plattformen WHERE katalog_id = ?').run(id);
      plattformen?.verknuepfeKatalog(id, daten.plattformen);
      return katalogZeileZuObjekt(zeile);
    })();
  }

  /** Legt einen eigenen Katalogeintrag an (Status je nach Rolle und Wunsch). */
  function legeEigenenAn(daten, benutzer, { einreichen = false, veroeffentlichen = false } = {}) {
    let status = 'privat';
    if (istModerator(benutzer) && veroeffentlichen) status = 'freigegeben';
    else if (einreichen) status = 'eingereicht';
    return speichere({ ...daten, quelle: 'eigen', externe_id: crypto.randomUUID(), erstellt_von: benutzer.id, status });
  }

  const holeEintrag = (id) => katalogZeileZuObjekt(perId.get(id));

  function holeSichtbar(id, benutzer) {
    const eintrag = holeEintrag(Number(id));
    return istSichtbar(eintrag, benutzer) ? eintrag : null;
  }

  function sucheLokal(begriff, typ, benutzer) {
    const bereinigt = begriff.replace(/[\\%_]/g, (z) => `\\${z}`);
    return lokaleSuche
      .all({ muster: `%${bereinigt}%`, anfang: `${bereinigt}%`, typ: typ ?? null, ...sichtbarParameter(benutzer) })
      .map(katalogZeileZuObjekt);
  }

  /** Online bei IGDB suchen (mit Cache) und Treffer im lokalen Katalog ablegen. */
  async function sucheOnline(begriff, typ = 'spiel') {
    if (!igdb.konfiguriert || typ === 'zubehoer') return [];
    const schluessel = `igdb:${typ}:${begriff.toLowerCase()}`;
    const treffer = await cache.merke(schluessel, () =>
      typ === 'konsole' ? igdb.sucheKonsolen(begriff) : igdb.sucheSpiele(begriff),
    );
    return db.transaction(() => treffer.map(speichere))();
  }

  async function suche(begriff, typ, benutzer) {
    const text = String(begriff ?? '').trim();
    if (text.length < 2) return { lokal: [], online: [], fehler: null };
    const lokal = sucheLokal(text, typ || null, benutzer);
    let online = [];
    let fehler = null;
    try {
      online = await sucheOnline(text, typ || 'spiel');
    } catch (e) {
      fehler = e.message;
    }
    const lokaleIds = new Set(lokal.map((e) => e.id));
    return { lokal, online: online.filter((e) => !lokaleIds.has(e.id)), fehler };
  }

  /**
   * Barcode auflösen:
   *  1. Bereits zugeordnet (eigene Zuordnung oder zu einem freigegebenen Eintrag)?
   *  2. Sonst Produktname über Barcode-Datenbanken ermitteln und bei IGDB suchen.
   */
  async function sucheBarcode(code, benutzer) {
    const varianten = barcodeVarianten(code);
    const vorhandeneArtikel = varianten.flatMap((v) => artikelMitBarcode.all(v, benutzer.id));
    const zugeordnet = varianten.flatMap((v) => barcodeZuordnung.all({ code: v, benutzer: benutzer.id })).map(katalogZeileZuObjekt);
    let bekannt = varianten.map((v) => barcodeLesen.get(v)).find(Boolean);
    if (zugeordnet.length) {
      return { code, produktname: bekannt?.produktname ?? null, quelle: 'lokal', suchbegriff: zugeordnet[0].titel,
        treffer: zugeordnet, vorhandeneArtikel, fehler: null };
    }

    let fehler = null;
    if (!bekannt?.produktname) {
      try {
        const gefunden = await barcode.sucheProduktname(code);
        if (gefunden) {
          barcodeSchreiben.run({ code, produktname: gefunden.produktname, quelle: gefunden.quelle });
          bekannt = { code, ...gefunden };
        }
      } catch (e) {
        fehler = e.message;
      }
    }

    const produktname = bekannt?.produktname ?? null;
    const suchbegriff = produktname ? bereinigeProduktname(produktname) : null;
    let treffer = [];
    if (suchbegriff) {
      const ergebnis = await suche(suchbegriff, 'spiel', benutzer);
      treffer = [...ergebnis.lokal, ...ergebnis.online];
      fehler ??= ergebnis.fehler;
    }
    return { code, produktname, quelle: bekannt?.quelle ?? null, suchbegriff, treffer, vorhandeneArtikel, fehler };
  }

  /** Merkt sich, zu welchem Katalogeintrag ein Barcode gehört (lernender Cache, je Benutzer). */
  function verknuepfeBarcode(code, katalogId, benutzerId) {
    if (!code || !katalogId || !perId.get(katalogId)) return;
    zuordnungSchreiben.run(code, katalogId, benutzerId);
  }

  /** Jeder Artikel braucht einen Katalogeintrag (für Scans, Kommentare, Varianten) – notfalls privat. */
  function stelleSicherFuerArtikel(artikel, benutzer) {
    if (artikel.katalog_id) return artikel.katalog_id;
    const eintrag = legeEigenenAn({
      typ: artikel.typ, titel: artikel.titel, plattformen: artikel.plattform ? [artikel.plattform] : [],
      cover_url: artikel.cover_url?.startsWith('http') ? artikel.cover_url : null,
    }, benutzer);
    db.prepare('UPDATE artikel SET katalog_id = ? WHERE id = ?').run(eintrag.id, artikel.id);
    return eintrag.id;
  }

  return {
    speichere, aktualisiere, legeEigenenAn, holeEintrag, holeSichtbar, sucheLokal, suche, sucheBarcode, verknuepfeBarcode, stelleSicherFuerArtikel,
  };
}
