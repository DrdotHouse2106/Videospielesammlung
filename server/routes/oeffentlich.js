// Katalog-Seiten, die – wenn PUBLIC_CATALOG aktiv ist – auch ohne Anmeldung erreichbar sind.
// Enthält nur freigegebene, nicht personenbezogene Daten (plus eigene Daten, wenn angemeldet).
import { Router } from 'express';
import { istModerator, HERSTELLER_REIHENFOLGE } from '../../shared/konstanten.js';
import { katalogZeileZuObjekt, SICHTBAR_SQL, sichtbarParameter, fuerBenutzer } from '../services/katalog.js';
import { linkZuObjekt } from './links.js';

const SEITENGROESSE = 48;

export function oeffentlichRouter({ db, katalog, plattformen, preise, affiliate, preisimport, boerse, konfiguration }) {
  const router = Router();

  // Ohne Anmeldung nur, wenn der öffentliche Katalog eingeschaltet ist.
  router.use((req, res, next) => {
    if (req.benutzer || konfiguration.oeffentlicherKatalog) return next();
    res.status(401).json({ fehler: 'Bitte melde dich an.', code: 'nicht_angemeldet' });
  });

  router.get('/plattformen', (req, res) => {
    const zaehler = db.prepare(`
      SELECT kp.plattform_id AS id, COUNT(DISTINCT k.id) AS eintraege
      FROM katalog_plattformen kp JOIN katalog k ON k.id = kp.katalog_id
      WHERE k.status = 'freigegeben'
      GROUP BY kp.plattform_id`).all();
    const meine = req.benutzer
      ? db.prepare('SELECT plattform_id AS id, COALESCE(SUM(anzahl), 0) AS stueck FROM artikel WHERE benutzer_id = ? AND plattform_id IS NOT NULL GROUP BY plattform_id')
        .all(req.benutzer.id)
      : [];
    const katalogZahl = new Map(zaehler.map((z) => [z.id, z.eintraege]));
    const meineZahl = new Map(meine.map((z) => [z.id, z.stueck]));
    const liste = plattformen.alle().map((p) => ({ ...p, katalog: katalogZahl.get(p.id) ?? 0, meine: meineZahl.get(p.id) ?? 0 }));
    liste.sort((a, b) => (HERSTELLER_REIHENFOLGE.indexOf(a.hersteller) + 1 || 99) - (HERSTELLER_REIHENFOLGE.indexOf(b.hersteller) + 1 || 99)
      || (a.erscheinungsjahr ?? 9999) - (b.erscheinungsjahr ?? 9999));
    res.json(liste);
  });

  // Durchsuchbarer globaler Katalog (freigegebene Einträge, die gepflegt oder in Sammlungen sind)
  router.get('/katalog-liste', (req, res) => {
    // Alle freigegebenen Einträge der Datenbank (gepflegte und aus IGDB übernommene)
    const bedingungen = ["k.status = 'freigegeben'"];
    const parameter = {};
    if (['spiel', 'konsole', 'zubehoer'].includes(req.query.typ)) {
      bedingungen.push('k.typ = @typ');
      parameter.typ = req.query.typ;
    }
    const plattformId = Number(req.query.plattform);
    if (Number.isInteger(plattformId) && plattformId > 0) {
      bedingungen.push('EXISTS (SELECT 1 FROM katalog_plattformen kp WHERE kp.katalog_id = k.id AND kp.plattform_id = @plattform)');
      parameter.plattform = plattformId;
    }
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      bedingungen.push("k.titel LIKE @q ESCAPE '\\'");
      parameter.q = `%${req.query.q.trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    }
    const seite = Math.max(1, Number.parseInt(req.query.seite, 10) || 1);
    const where = bedingungen.join(' AND ');
    const gesamt = db.prepare(`SELECT COUNT(*) AS n FROM katalog k WHERE ${where}`).get(parameter).n;
    const zeilen = db.prepare(`
      SELECT k.*, (SELECT COUNT(DISTINCT a.benutzer_id) FROM artikel a WHERE a.katalog_id = k.id) AS besitzer
      FROM katalog k WHERE ${where}
      ORDER BY besitzer DESC, k.titel COLLATE NOCASE LIMIT ${SEITENGROESSE} OFFSET ${(seite - 1) * SEITENGROESSE}`).all(parameter);
    res.json({
      gesamt, seite, seiten: Math.max(1, Math.ceil(gesamt / SEITENGROESSE)),
      eintraege: zeilen.map((z) => fuerBenutzer(katalogZeileZuObjekt(z), req.benutzer)),
    });
  });

  // Alles für die Seite eines Spiels/Geräts
  router.get('/katalog-seite/:id', (req, res) => {
    const b = req.benutzer;
    const eintrag = katalogZeileZuObjekt(db.prepare(`SELECT k.* FROM katalog k WHERE k.id = @id AND ${SICHTBAR_SQL}`)
      .get({ id: Number(req.params.id), ...sichtbarParameter(b) }));
    if (!eintrag) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });

    const plattformListe = db.prepare(`SELECT p.id, p.name, p.kurz, p.hersteller FROM katalog_plattformen kp
      JOIN plattformen p ON p.id = kp.plattform_id WHERE kp.katalog_id = ? ORDER BY p.erscheinungsjahr`).all(eintrag.id);
    const varianten = db.prepare(`
      SELECT v.*, (SELECT COUNT(*) FROM artikel a WHERE a.variante_id = v.id AND a.benutzer_id = @benutzer) AS meine
      FROM katalog_varianten v WHERE v.katalog_id = @katalog
        AND (v.status = 'freigegeben' OR v.erstellt_von = @benutzer OR @moderator = 1)
      ORDER BY v.erscheinungsjahr IS NULL, v.erscheinungsjahr, v.bezeichnung COLLATE NOCASE`)
      .all({ katalog: eintrag.id, ...sichtbarParameter(b) })
      .map((v) => ({ ...fuerBenutzer(v, b), eigene: v.erstellt_von === b?.id, erstellt_von: undefined, geprueft_von: undefined }));

    const verlauf = db.prepare(`SELECT id, herkunft, art, preis, datum, quelle, preisregion, zustand, vollstaendigkeit, region, url, notiz, anzahl, benutzer_id
      FROM preis_historie WHERE katalog_id = ? ORDER BY datum, id`).all(eintrag.id)
      .map(({ benutzer_id: autor, ...h }) => ({ ...h, eigene: Boolean(b && autor === b.id), darf_loeschen: Boolean(b && (autor === b.id || istModerator(b))) }));

    const marktpreise = {};
    for (const region of ['pal', 'ntsc', 'jp']) {
      const p = preise.gespeichert(eintrag.id, region);
      if (p.daten) marktpreise[region] = { ...p.daten, abgerufen_am: p.abgerufen_am };
    }

    const meineExemplare = b
      ? db.prepare(`SELECT a.id, a.titel, a.plattform, a.region, a.zustand, a.vollstaendigkeit, a.farbe, a.edition, a.modellnummer, a.variante_id, a.anzahl
          FROM artikel a WHERE a.katalog_id = ? AND a.benutzer_id = ? ORDER BY a.id`).all(eintrag.id, b.id)
      : [];
    // Nur Anzahl und Art der Dateien – die Dateien selbst sind erst nach Anmeldung sichtbar
    const medienUebersicht = db.prepare(`SELECT art, COUNT(*) AS anzahl FROM medien WHERE katalog_id = ? AND sichtbarkeit = 'freigegeben'
      GROUP BY art`).all(eintrag.id);
    const medienAnzahl = medienUebersicht.reduce((s, m) => s + m.anzahl, 0);
    const ebayAngebote = eintrag.status === 'freigegeben' && affiliate.aktiv ? preisimport.angeboteFuer(eintrag.id) : null;

    res.json({
      eintrag: {
        ...fuerBenutzer(eintrag, b),
        eigener: Boolean(b && eintrag.erstellt_von === b.id),
        erstellt_von: undefined,
        geprueft_von: undefined,
      },
      plattformen: plattformListe,
      varianten,
      community: preise.community(eintrag.id),
      marktpreise,
      historie: verlauf,
      kaufen: eintrag.status === 'freigegeben' ? affiliate.links(eintrag, plattformListe[0]?.name ?? eintrag.plattformen[0]) : [],
      meineExemplare,
      medienAnzahl,
      medienUebersicht,
      // Freigegebene Links sind öffentlich; eigene (private/eingereichte) nur für den Ersteller
      links: db.prepare(`SELECT * FROM externe_links WHERE katalog_id = @k AND (status = 'freigegeben' OR benutzer_id = @b)
        ORDER BY art, erstellt_am`).all({ k: eintrag.id, b: b?.id ?? -1 }).map((l) => linkZuObjekt(l, b)),
      ebayAngebote,
      boerse: eintrag.status === 'freigegeben' ? boerse.zusammenfassung(eintrag.id, b) : null,
      angemeldet: Boolean(b),
    });
  });

  return router;
}
