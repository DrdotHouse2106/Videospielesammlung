// Lokaler Katalog: Zwischenspeicher für IGDB-Treffer und Heimat eigener Einträge
// (Hardware, Zubehör, deutsche Exoten, die in keiner Online-Datenbank stehen).

import { bereinigeProduktname, barcodeVarianten } from './titel.js';

export function katalogZeileZuObjekt(zeile) {
  if (!zeile) return null;
  const { daten, ...rest } = zeile;
  return { ...rest, plattformen: JSON.parse(zeile.plattformen || '[]') };
}

export function erstelleKatalogDienst(db, { igdb, barcode, cache }) {
  const upsert = db.prepare(`
    INSERT INTO katalog (quelle, externe_id, typ, titel, plattformen, erscheinungsjahr, hersteller, cover_url, beschreibung, erstellt_von)
    VALUES (@quelle, @externe_id, @typ, @titel, @plattformen, @erscheinungsjahr, @hersteller, @cover_url, @beschreibung, @erstellt_von)
    ON CONFLICT (quelle, externe_id) DO UPDATE SET
      titel = excluded.titel, plattformen = excluded.plattformen, erscheinungsjahr = excluded.erscheinungsjahr,
      hersteller = excluded.hersteller, cover_url = excluded.cover_url, beschreibung = excluded.beschreibung,
      aktualisiert_am = datetime('now')
    RETURNING *`);
  const perId = db.prepare('SELECT * FROM katalog WHERE id = ?');
  const lokaleSuche = db.prepare(`
    SELECT * FROM katalog
    WHERE titel LIKE @muster ESCAPE '\\' AND (@typ IS NULL OR typ = @typ)
    ORDER BY (quelle = 'eigen') DESC, (titel LIKE @anfang ESCAPE '\\') DESC, length(titel)
    LIMIT 15`);
  const barcodeLesen = db.prepare('SELECT * FROM barcodes WHERE code = ?');
  const barcodeSchreiben = db.prepare(`
    INSERT INTO barcodes (code, katalog_id, produktname, quelle) VALUES (@code, @katalog_id, @produktname, @quelle)
    ON CONFLICT (code) DO UPDATE SET
      katalog_id = COALESCE(excluded.katalog_id, barcodes.katalog_id),
      produktname = COALESCE(excluded.produktname, barcodes.produktname),
      quelle = COALESCE(excluded.quelle, barcodes.quelle),
      abgerufen_am = datetime('now')`);
  const artikelMitBarcode = db.prepare('SELECT id, titel, plattform, typ FROM artikel WHERE barcode = ? AND benutzer_id = ?');

  function speichere(eintrag) {
    return katalogZeileZuObjekt(
      upsert.get({ erstellt_von: null, ...eintrag, plattformen: JSON.stringify(eintrag.plattformen ?? []) }),
    );
  }

  function holeEintrag(id) {
    return katalogZeileZuObjekt(perId.get(id));
  }

  function sucheLokal(begriff, typ = null) {
    const bereinigt = begriff.replace(/[\\%_]/g, (z) => `\\${z}`);
    return lokaleSuche
      .all({ muster: `%${bereinigt}%`, anfang: `${bereinigt}%`, typ })
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

  async function suche(begriff, typ) {
    const text = String(begriff ?? '').trim();
    if (text.length < 2) return { lokal: [], online: [], fehler: null };
    const lokal = sucheLokal(text, typ || null);
    let online = [];
    let fehler = null;
    try {
      online = await sucheOnline(text, typ || 'spiel');
    } catch (e) {
      fehler = e.message;
    }
    // Online-Treffer, die schon unter „lokal“ stehen, nicht doppelt anzeigen.
    const lokaleIds = new Set(lokal.map((e) => e.id));
    return { lokal, online: online.filter((e) => !lokaleIds.has(e.id)), fehler };
  }

  /**
   * Barcode auflösen:
   *  1. Bereits bekannter Barcode (früher einem Katalogeintrag zugeordnet)?
   *  2. Sonst Produktname über Barcode-Datenbanken ermitteln und bei IGDB suchen.
   */
  async function sucheBarcode(code, benutzerId) {
    const varianten = barcodeVarianten(code);
    const vorhandeneArtikel = varianten.flatMap((v) => artikelMitBarcode.all(v, benutzerId));

    let bekannt = varianten.map((v) => barcodeLesen.get(v)).find(Boolean);
    const zugeordnet = bekannt?.katalog_id ? holeEintrag(bekannt.katalog_id) : null;
    if (zugeordnet) {
      return { code, produktname: bekannt.produktname, quelle: 'lokal', suchbegriff: zugeordnet.titel,
        treffer: [zugeordnet], vorhandeneArtikel, fehler: null };
    }

    let fehler = null;
    if (!bekannt?.produktname) {
      try {
        const gefunden = await barcode.sucheProduktname(code);
        if (gefunden) {
          barcodeSchreiben.run({ code, katalog_id: null, produktname: gefunden.produktname, quelle: gefunden.quelle });
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
      const ergebnis = await suche(suchbegriff, 'spiel');
      treffer = [...ergebnis.lokal, ...ergebnis.online];
      fehler ??= ergebnis.fehler;
    }
    return { code, produktname, quelle: bekannt?.quelle ?? null, suchbegriff, treffer, vorhandeneArtikel, fehler };
  }

  /** Merkt sich, zu welchem Katalogeintrag ein Barcode gehört (lernender Cache). */
  function verknuepfeBarcode(code, katalogId) {
    if (!code || !katalogId || !perId.get(katalogId)) return;
    barcodeSchreiben.run({ code, katalog_id: katalogId, produktname: null, quelle: 'nutzer' });
  }

  return { speichere, holeEintrag, sucheLokal, suche, sucheBarcode, verknuepfeBarcode };
}
