import crypto from 'node:crypto';
import { Router } from 'express';
import {
  ARTIKELTYPEN, ZUSTAENDE, VOLLSTAENDIGKEITEN, REGIONEN, beschriftung,
} from '../../shared/konstanten.js';
import { pruefeArtikel, ValidierungsFehler } from '../services/validierung.js';

const CSV_SPALTEN = [
  ['id', 'ID'],
  ['typ', 'Artikeltyp', (w) => beschriftung(ARTIKELTYPEN, w)],
  ['titel', 'Titel'],
  ['plattform', 'Plattform'],
  ['region', 'Region', (w) => beschriftung(REGIONEN, w)],
  ['zustand', 'Zustand', (w) => beschriftung(ZUSTAENDE, w)],
  ['vollstaendigkeit', 'Vollständigkeit', (w) => beschriftung(VOLLSTAENDIGKEITEN, w)],
  ['farbe', 'Farbe'],
  ['edition', 'Edition/Variante'],
  ['modellnummer', 'Modellnummer'],
  ['seriennummer', 'Seriennummer'],
  ['barcode', 'Barcode'],
  ['anzahl', 'Anzahl'],
  ['kaufpreis', 'Kaufpreis (EUR)', (w) => (w == null ? '' : w.toFixed(2).replace('.', ','))],
  ['kaufdatum', 'Kaufdatum', (w) => (w ? w.split('-').reverse().join('.') : '')],
  ['marktwert', 'Marktwert (EUR)', (w) => (w == null ? '' : w.toFixed(2).replace('.', ','))],
  ['notizen', 'Eigene Notizen'],
  ['erstellt_am', 'Erfasst am'],
];

function csvFeld(wert) {
  let text = wert == null ? '' : String(wert);
  // Formel-Injektion in Excel/LibreOffice verhindern: Zellen, die mit = + - @ beginnen, als Text markieren
  if (typeof wert === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportRouter({ db, plattformen }) {
  const router = Router();
  const datumHeute = () => new Date().toISOString().slice(0, 10);

  router.get('/export.json', (req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel WHERE benutzer_id = ? ORDER BY id').all(req.benutzer.id)
      .map(({ benutzer_id: _b, bild_datei: _d, bild_groesse: _g, ...rest }) => rest);
    const eigeneKatalogeintraege = db.prepare(`SELECT * FROM katalog WHERE quelle = 'eigen'
      AND id IN (SELECT katalog_id FROM artikel WHERE benutzer_id = @b UNION SELECT id FROM katalog WHERE erstellt_von = @b)
      ORDER BY id`).all({ b: req.benutzer.id }).map(({ erstellt_von: _e, ...rest }) => rest);
    res.attachment(`zockdb-${datumHeute()}.json`);
    res.json({ format: 'zockdb', version: 1, exportiert_am: new Date().toISOString(), artikel, eigeneKatalogeintraege });
  });

  /**
   * Datenauskunft (Art. 15 und 20 DSGVO): alle personenbezogenen Daten des Kontos in maschinenlesbarer Form.
   * Geheimnisse (Passwort-Hash, 2FA-Geheimnis, Zugangsdaten von Shop-Anbindungen, Sitzungs-Tokens) werden nicht ausgegeben.
   */
  router.get('/export/datenauskunft.json', (req, res) => {
    const b = req.benutzer.id;
    const alle = (sql) => db.prepare(sql).all(b);
    const konto = db.prepare(`SELECT id, benutzername, anzeigename, email, rolle, gesperrt, totp_aktiv, sammlung_oeffentlich, benachrichtigung_email,
        freigabe_token IS NOT NULL AS freigabe_link_aktiv, freigabe_wert, speicher_limit_mb, bedingungen_akzeptiert_am, erstellt_am, letzte_anmeldung,
        haendler_status, haendler_daten, haendler_paket, haendler_paket_bis, haendler_api_bis, haendler_test_bis, haendler_test_genutzt_am, boerse_plz, guthaben
      FROM benutzer WHERE id = ?`).get(b);
    let haendlerDaten = null;
    try { haendlerDaten = JSON.parse(konto.haendler_daten || 'null'); } catch { /* ungültig */ }
    const anbindung = db.prepare('SELECT typ, intervall_stunden, beende_fehlende, aktiv, letzter_lauf, letzter_fehler, geaendert_am FROM haendler_anbindungen WHERE benutzer_id = ?').get(b) ?? null;
    const unterhaltungen = db.prepare(`SELECT u.id, u.titel, u.angebot_id, u.erstellt_am, u.letzte_nachricht_am,
        CASE WHEN u.anfragender_id = @b THEN 'anfragender' ELSE 'anbieter' END AS rolle,
        (SELECT COALESCE(anzeigename, benutzername) FROM benutzer WHERE id = CASE WHEN u.anfragender_id = @b THEN u.anbieter_id ELSE u.anfragender_id END) AS partner
      FROM unterhaltungen u WHERE u.anfragender_id = @b OR u.anbieter_id = @b ORDER BY u.id`).all({ b })
      .map((u) => ({
        ...u,
        nachrichten: db.prepare('SELECT absender_id = ? AS eigene, text, erstellt_am FROM nachrichten WHERE unterhaltung_id = ? ORDER BY id').all(b, u.id)
          .map((n) => ({ ...n, eigene: Boolean(n.eigene) })),
      }));
    res.attachment(`zockdb-datenauskunft-${datumHeute()}.json`);
    res.json({
      hinweis: 'Datenauskunft nach Art. 15 DSGVO. Nicht enthalten sind Geheimnisse wie Passwort-Hash, 2FA-Schlüssel, Sitzungs-Tokens und Zugangsdaten von Shop-Anbindungen.',
      erstellt_am: new Date().toISOString(),
      konto: { ...konto, haendler_daten: haendlerDaten, totp_aktiv: Boolean(konto.totp_aktiv) },
      angemeldete_geraete: alle('SELECT geraet, erstellt_am, laeuft_ab FROM sitzungen WHERE benutzer_id = ? AND stufe = \'voll\' ORDER BY erstellt_am'),
      sammlung: alle('SELECT * FROM artikel WHERE benutzer_id = ? ORDER BY id').map(({ benutzer_id: _b, ...rest }) => rest),
      eigene_katalogeintraege: alle("SELECT id, typ, titel, plattformen, erscheinungsjahr, hersteller, status, erstellt_am FROM katalog WHERE erstellt_von = ? ORDER BY id"),
      scans_und_dokumente: alle('SELECT id, katalog_id, art, titel, sichtbarkeit, originalname, mime, groesse, erstellt_am FROM medien WHERE benutzer_id = ? ORDER BY id'),
      kommentare: alle('SELECT katalog_id, text, erstellt_am, aktualisiert_am FROM kommentare WHERE benutzer_id = ? ORDER BY id'),
      preismeldungen: alle('SELECT katalog_id, art, preis, datum, quelle, zustand, vollstaendigkeit, region, url, notiz, erstellt_am FROM preis_historie WHERE benutzer_id = ? ORDER BY id'),
      links: alle('SELECT katalog_id, art, titel, url, status, erstellt_am FROM externe_links WHERE benutzer_id = ? ORDER BY id'),
      meldungen: alle('SELECT bereich, ziel_id, grund, text, status, ergebnis, erstellt_am FROM inhalt_meldungen WHERE benutzer_id = ? ORDER BY id'),
      benachrichtigungen: alle('SELECT art, titel, text, gelesen, erstellt_am FROM benachrichtigungen WHERE benutzer_id = ? ORDER BY id'),
      erfolge: alle('SELECT schluessel, freigeschaltet_am FROM erfolge WHERE benutzer_id = ?'),
      tauschboerse: {
        angebote: alle('SELECT * FROM angebote WHERE benutzer_id = ? ORDER BY id').map(({ benutzer_id: _b, ...rest }) => rest),
        statistik: alle('SELECT angebot_id, tag, aufrufe, anfragen, treffer FROM boerse_statistik WHERE benutzer_id = ? ORDER BY tag, angebot_id'),
        schnaeppchen_alarm: db.prepare('SELECT schnaeppchen_aktiv AS aktiv, schnaeppchen_schwelle AS schwelle, schnaeppchen_umfang AS umfang, schnaeppchen_plattformen AS plattformen, fruehzugang_bis FROM benutzer WHERE id = ?').get(b),
        schnaeppchen_gemeldet: alle('SELECT angebot_id, faellig_am, gesendet_am FROM schnaeppchen_versand WHERE benutzer_id = ? ORDER BY faellig_am'),
        verkaeufe: db.prepare(`SELECT titel, preis, kaeufer_preis, status, extern, erstellt_am, bestaetigt_am,
            CASE WHEN verkaeufer_id = @b THEN 'verkaeufer' ELSE 'kaeufer' END AS rolle
          FROM verkaeufe WHERE verkaeufer_id = @b OR kaeufer_id = @b ORDER BY id`).all({ b }),
        wunschliste: alle('SELECT katalog_id, plattform_id, region, min_zustand, nur_cib, max_preis, notiz, erstellt_am FROM wunschliste WHERE benutzer_id = ?'),
        unterhaltungen,
        bewertungen_erhalten: alle(`SELECT r.wert, r.text, r.erstellt_am, COALESCE(v.anzeigename, v.benutzername) AS von FROM bewertungen r
          LEFT JOIN benutzer v ON v.id = r.von_id WHERE r.fuer_id = ?`),
        bewertungen_abgegeben: alle(`SELECT r.wert, r.text, r.erstellt_am, COALESCE(f.anzeigename, f.benutzername) AS fuer FROM bewertungen r
          LEFT JOIN benutzer f ON f.id = r.fuer_id WHERE r.von_id = ?`),
        blockiert: alle(`SELECT COALESCE(x.anzeigename, x.benutzername) AS benutzer, k.erstellt_am FROM blockierungen k JOIN benutzer x ON x.id = k.blockiert_id
          WHERE k.benutzer_id = ?`),
        shop_anbindung: anbindung,
      },
      push_geraete: alle('SELECT geraet, erstellt_am, zuletzt_am FROM push_abos WHERE benutzer_id = ? ORDER BY id'),
      abos: alle('SELECT anbieter, produkt, angebote, netto, status, laeuft_bis, erstellt_am FROM abos WHERE benutzer_id = ? ORDER BY id'),
      gutschriften: alle('SELECT grund, netto, steuersatz, brutto, erpnext_gutschrift AS beleg, erstellt_am FROM gutschriften WHERE benutzer_id = ? ORDER BY id'),
      zahlungen_und_rechnungen: alle(`SELECT anbieter, beschreibung, netto, verrechnet, steuersatz, brutto, zeitraum_von, zeitraum_bis, erpnext_rechnung AS rechnung,
          faellig_am, bezahlt_am, erstellt_am FROM zahlungen WHERE benutzer_id = ? ORDER BY id`),
    });
  });

  // CSV im deutschen Excel-Format: Semikolon als Trenner, Dezimalkomma, UTF-8 mit BOM.
  router.get('/export.csv', (req, res) => {
    const artikel = db.prepare('SELECT * FROM artikel WHERE benutzer_id = ? ORDER BY titel COLLATE NOCASE').all(req.benutzer.id);
    const zeilen = [
      CSV_SPALTEN.map(([, kopf]) => csvFeld(kopf)).join(';'),
      ...artikel.map((a) => CSV_SPALTEN.map(([feld, , format]) => csvFeld(format ? format(a[feld]) : a[feld])).join(';')),
    ];
    res.attachment(`zockdb-${datumHeute()}.csv`);
    res.type('text/csv; charset=utf-8').send(`﻿${zeilen.join('\r\n')}\r\n`);
  });

  // Import einer zuvor exportierten JSON-Datei. Artikel werden ergänzt, nicht ersetzt.
  router.post('/import', (req, res) => {
    const daten = req.body;
    const liste = Array.isArray(daten) ? daten : daten?.artikel;
    if (!Array.isArray(liste)) return res.status(400).json({ fehler: 'Unbekanntes Dateiformat. Bitte eine Export-Datei dieser App verwenden.' });

    const katalogIds = new Map();
    const katalogEinfuegen = db.prepare(`
      INSERT INTO katalog (quelle, externe_id, typ, titel, plattformen, erscheinungsjahr, hersteller, cover_url, beschreibung, erstellt_von, status)
      VALUES ('eigen', @externe_id, @typ, @titel, @plattformen, @erscheinungsjahr, @hersteller, @cover_url, @beschreibung, @erstellt_von, 'privat')
      RETURNING id`);
    const eigenerMitExternerId = db.prepare("SELECT id, erstellt_von FROM katalog WHERE quelle = 'eigen' AND externe_id = ?");
    // Nur freigegebene oder eigene Katalogeinträge dürfen verknüpft werden
    const katalogVorhanden = db.prepare("SELECT id FROM katalog WHERE id = ? AND (status = 'freigegeben' OR erstellt_von = ?)");
    const felder = ['benutzer_id', 'typ', 'titel', 'plattform', 'katalog_id', 'barcode', 'cover_url', 'zustand', 'vollstaendigkeit', 'region',
      'farbe', 'edition', 'modellnummer', 'seriennummer', 'notizen', 'kaufpreis', 'kaufdatum', 'anzahl', 'marktwert', 'plattform_id'];
    const einfuegen = db.prepare(`INSERT INTO artikel (${felder.join(', ')}) VALUES (${felder.map((f) => `@${f}`).join(', ')})`);

    const fehlerhaft = [];
    let importiert = 0;
    db.transaction(() => {
      for (const eintrag of daten?.eigeneKatalogeintraege ?? []) {
        if (!eintrag?.titel || !eintrag?.externe_id) continue;
        const vorhanden = eigenerMitExternerId.get(String(eintrag.externe_id));
        if (vorhanden?.erstellt_von === req.benutzer.id) {
          katalogIds.set(eintrag.id, vorhanden.id);
          continue;
        }
        const { id } = katalogEinfuegen.get({
          externe_id: vorhanden ? crypto.randomUUID() : String(eintrag.externe_id), typ: eintrag.typ ?? 'spiel', titel: String(eintrag.titel),
          plattformen: typeof eintrag.plattformen === 'string' ? eintrag.plattformen : JSON.stringify(eintrag.plattformen ?? []),
          erscheinungsjahr: eintrag.erscheinungsjahr ?? null, hersteller: eintrag.hersteller ?? null,
          cover_url: eintrag.cover_url ?? null, beschreibung: eintrag.beschreibung ?? null, erstellt_von: req.benutzer.id,
        });
        katalogIds.set(eintrag.id, id);
      }
      liste.forEach((roh, index) => {
        try {
          const artikel = pruefeArtikel({ ...roh, katalog_id: null });
          const alteKatalogId = roh?.katalog_id;
          artikel.katalog_id = katalogIds.get(alteKatalogId) ?? (katalogVorhanden.get(alteKatalogId ?? -1, req.benutzer.id)?.id ?? null);
          if (artikel.cover_url?.startsWith('/')) artikel.cover_url = null; // Fotos werden nicht mit exportiert
          const plattform = plattformen.zuordnen(artikel.plattform);
          einfuegen.run({ ...artikel, benutzer_id: req.benutzer.id, plattform_id: plattform?.id ?? null, plattform: plattform?.name ?? artikel.plattform });
          importiert++;
        } catch (fehler) {
          if (!(fehler instanceof ValidierungsFehler)) throw fehler;
          fehlerhaft.push({ zeile: index + 1, titel: roh?.titel ?? null, fehler: fehler.fehler });
        }
      });
    })();
    res.json({ importiert, fehlerhaft });
  });

  return router;
}
