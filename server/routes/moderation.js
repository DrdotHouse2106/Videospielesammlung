// Moderation: Einreichungen prüfen, Duplikate zusammenführen, Kauflinks und Plattformen pflegen.
// Zugriff nur für die Rollen „moderator“ und „admin“.
import { Router } from 'express';
import { katalogZeileZuObjekt } from '../services/katalog.js';
import { pruefeKatalogEintrag, leseEuro, ValidierungsFehler } from '../services/validierung.js';
import { plattformZuObjekt } from '../services/plattformen.js';

export function moderationRouter({ db, katalog, plattformen, benachrichtigungen }) {
  const router = Router();
  const grund = (req) => String(req.body?.grund ?? '').trim().slice(0, 1000) || null;

  router.get('/warteschlange', (_req, res) => {
    const katalogEintraege = db.prepare(`
      SELECT k.*, COALESCE(b.anzeigename, b.benutzername) AS eingereicht_von,
             (SELECT COUNT(*) FROM artikel a WHERE a.katalog_id = k.id) AS artikel_anzahl
      FROM katalog k LEFT JOIN benutzer b ON b.id = k.erstellt_von
      WHERE k.status = 'eingereicht' ORDER BY k.eingereicht_am`).all().map(katalogZeileZuObjekt);
    const varianten = db.prepare(`
      SELECT v.*, k.titel AS katalog_titel, COALESCE(b.anzeigename, b.benutzername) AS eingereicht_von
      FROM katalog_varianten v JOIN katalog k ON k.id = v.katalog_id LEFT JOIN benutzer b ON b.id = v.erstellt_von
      WHERE v.status = 'eingereicht' ORDER BY v.erstellt_am`).all();
    const medien = db.prepare(`
      SELECT m.id, m.katalog_id, m.art, m.titel, m.mime, m.groesse, m.breite, m.hoehe, m.dpi, m.seiten, m.erstellt_am,
             m.vorschau_datei, m.anzeige_datei, m.datei, k.titel AS katalog_titel, COALESCE(b.anzeigename, b.benutzername) AS eingereicht_von
      FROM medien m JOIN katalog k ON k.id = m.katalog_id LEFT JOIN benutzer b ON b.id = m.benutzer_id
      WHERE m.sichtbarkeit = 'eingereicht' ORDER BY m.erstellt_am`).all()
      .map(({ vorschau_datei: v, anzeige_datei: a, datei: d, ...m }) => ({
        ...m, vorschau_url: v ? `/api/dateien/${v}` : null, url: `/api/dateien/${a ?? d}`,
      }));
    const meldungen = db.prepare("SELECT COUNT(*) AS n FROM inhalt_meldungen WHERE status = 'offen'").get().n;
    const links = db.prepare(`
      SELECT l.*, k.titel AS katalog_titel, COALESCE(b.anzeigename, b.benutzername) AS eingereicht_von
      FROM externe_links l JOIN katalog k ON k.id = l.katalog_id LEFT JOIN benutzer b ON b.id = l.benutzer_id
      WHERE l.status = 'eingereicht' ORDER BY l.erstellt_am`).all();
    res.json({ katalog: katalogEintraege, varianten, medien, links, offeneMeldungen: meldungen });
  });

  // ── Katalogeinträge ─────────────────────────────────────────
  function eingereichterEintrag(req, res) {
    const e = katalog.holeEintrag(Number(req.params.id));
    if (!e || e.quelle !== 'eigen') {
      res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
      return null;
    }
    return e;
  }

  router.post('/katalog/:id/freigeben', (req, res) => {
    const e = eingereichterEintrag(req, res);
    if (!e) return;
    db.transaction(() => {
      // Optional mit Korrekturen (Titel, Plattformen, Jahr …)
      if (req.body?.aenderungen) {
        const daten = pruefeKatalogEintrag({ ...e, ...req.body.aenderungen });
        katalog.aktualisiere(e.id, daten, { plattformenNeu: Array.isArray(req.body.aenderungen.plattformen) });
      }
      db.prepare(`UPDATE katalog SET status = 'freigegeben', geprueft_von = ?, geprueft_am = datetime('now'), pruefung_notiz = ?,
                  automatisch_geprueft = 0, ki_hinweis = NULL WHERE id = ?`).run(req.benutzer.id, grund(req), e.id);
    })();
    const neu = katalog.holeEintrag(e.id);
    benachrichtigungen.sende(e.erstellt_von, {
      art: 'freigabe', titel: `„${neu.titel}“ wurde freigegeben`,
      text: grund(req) ?? 'Dein Eintrag ist jetzt für alle sichtbar. Danke für deinen Beitrag!', link: `#/katalog/${e.id}`,
    });
    res.json(neu);
  });

  router.post('/katalog/:id/ablehnen', (req, res) => {
    const e = eingereichterEintrag(req, res);
    if (!e) return;
    db.prepare(`UPDATE katalog SET status = 'abgelehnt', geprueft_von = ?, geprueft_am = datetime('now'), pruefung_notiz = ?,
                automatisch_geprueft = 0, ki_hinweis = NULL WHERE id = ?`).run(req.benutzer.id, grund(req) ?? 'Ohne Begründung abgelehnt.', e.id);
    benachrichtigungen.sende(e.erstellt_von, {
      art: 'ablehnung', titel: `„${e.titel}“ wurde abgelehnt`, text: grund(req) ?? 'Ohne Begründung abgelehnt.', link: `#/katalog/${e.id}`,
    });
    res.json(katalog.holeEintrag(e.id));
  });

  // Duplikat: alles (Artikel, Scans, Kommentare, Historie …) in einen bestehenden Eintrag übernehmen
  router.post('/katalog/:id/zusammenfuehren', (req, res) => {
    const quelle = eingereichterEintrag(req, res);
    if (!quelle) return;
    const ziel = katalog.holeEintrag(Number(req.body?.ziel_id));
    if (!ziel || ziel.id === quelle.id || ziel.status !== 'freigegeben') {
      throw new ValidierungsFehler({ ziel_id: 'Bitte einen anderen, freigegebenen Katalogeintrag als Ziel wählen.' });
    }
    db.transaction(() => {
      const verschiebe = (tabelle) => db.prepare(`UPDATE ${tabelle} SET katalog_id = ? WHERE katalog_id = ?`).run(ziel.id, quelle.id);
      ['artikel', 'medien', 'kommentare', 'preis_historie', 'katalog_varianten', 'kauflinks'].forEach(verschiebe);
      db.prepare('INSERT OR IGNORE INTO barcode_zuordnungen (code, katalog_id, benutzer_id) SELECT code, ?, benutzer_id FROM barcode_zuordnungen WHERE katalog_id = ?')
        .run(ziel.id, quelle.id);
      db.prepare('INSERT OR IGNORE INTO katalog_plattformen (katalog_id, plattform_id) SELECT ?, plattform_id FROM katalog_plattformen WHERE katalog_id = ?')
        .run(ziel.id, quelle.id);
      db.prepare('DELETE FROM katalog WHERE id = ?').run(quelle.id);
    })();
    res.json(katalog.holeEintrag(ziel.id));
  });

  // ── Varianten & Scans ───────────────────────────────────────
  // Zusatzspalten je Tabelle (KI-Kennzeichnung bzw. Prüfdatum)
  const ZUSATZ = {
    katalog_varianten: { frei: ', automatisch_geprueft = 0, ki_hinweis = NULL', ab: ', automatisch_geprueft = 0, ki_hinweis = NULL' },
    medien: { frei: ", geprueft_am = datetime('now')", ab: '' },
    externe_links: { frei: '', ab: '' },
  };
  // Wem gehört der Beitrag, und wie heißt er in der Benachrichtigung?
  const BESITZER = {
    katalog_varianten: { spalte: 'erstellt_von', name: (z) => `Deine Variante „${z.bezeichnung}“` },
    medien: { spalte: 'benutzer_id', name: (z) => `Dein Scan${z.titel ? ` „${z.titel}“` : ''}` },
    externe_links: { spalte: 'benutzer_id', name: (z) => `Dein Link zu ${z.domain}` },
  };
  function benachrichtige(tabelle, id, freigegeben, text) {
    const z = db.prepare(`SELECT * FROM ${tabelle} WHERE id = ?`).get(id);
    const b = BESITZER[tabelle];
    if (!z) return;
    benachrichtigungen.sende(z[b.spalte], {
      art: freigegeben ? 'freigabe' : 'ablehnung',
      titel: `${b.name(z)} wurde ${freigegeben ? 'freigegeben' : 'abgelehnt'}`,
      text: text ?? (freigegeben ? 'Danke für deinen Beitrag!' : null),
      link: `#/katalog/${z.katalog_id}`,
    });
  }
  for (const [pfad, tabelle, feld] of [['varianten', 'katalog_varianten', 'status'], ['medien', 'medien', 'sichtbarkeit'], ['links', 'externe_links', 'status']]) {
    router.post(`/${pfad}/:id/freigeben`, (req, res) => {
      const r = db.prepare(`UPDATE ${tabelle} SET ${feld} = 'freigegeben', geprueft_von = ?, pruefung_notiz = ?${ZUSATZ[tabelle].frei}
                            WHERE id = ?`).run(req.benutzer.id, grund(req), Number(req.params.id));
      if (!r.changes) return res.status(404).json({ fehler: 'Nicht gefunden.' });
      benachrichtige(tabelle, Number(req.params.id), true, grund(req));
      res.json({ ok: true });
    });
    router.post(`/${pfad}/:id/ablehnen`, (req, res) => {
      const text = grund(req) ?? 'Ohne Begründung abgelehnt.';
      const r = db.prepare(`UPDATE ${tabelle} SET ${feld} = 'abgelehnt', geprueft_von = ?, pruefung_notiz = ?${ZUSATZ[tabelle].ab} WHERE id = ?`)
        .run(req.benutzer.id, text, Number(req.params.id));
      if (!r.changes) return res.status(404).json({ fehler: 'Nicht gefunden.' });
      benachrichtige(tabelle, Number(req.params.id), false, text);
      res.json({ ok: true });
    });
  }

  // ── KI-Protokoll: alle automatischen Prüfungen nachvollziehbar ─
  router.get('/ki-protokoll', (_req, res) => {
    res.json(db.prepare(`
      SELECT p.*, CASE p.bereich
          WHEN 'katalog' THEN (SELECT titel FROM katalog WHERE id = p.ziel_id)
          ELSE (SELECT v.bezeichnung || ' – ' || k.titel FROM katalog_varianten v JOIN katalog k ON k.id = v.katalog_id WHERE v.id = p.ziel_id)
        END AS ziel_titel,
        CASE p.bereich WHEN 'katalog' THEN p.ziel_id ELSE (SELECT katalog_id FROM katalog_varianten WHERE id = p.ziel_id) END AS katalog_id
      FROM ki_pruefungen p ORDER BY p.id DESC LIMIT 200`).all());
  });

  // Automatische Freigabe zurücknehmen → zurück in die menschliche Prüfung
  router.post('/:bereich/:id/zuruecknehmen', (req, res) => {
    const tabelle = { katalog: 'katalog', varianten: 'katalog_varianten' }[req.params.bereich];
    if (!tabelle) return res.status(404).json({ fehler: 'Nicht gefunden.' });
    const r = db.prepare(`UPDATE ${tabelle} SET status = 'eingereicht', menschliche_pruefung = 1, automatisch_geprueft = 0,
      ki_hinweis = 'Automatische Entscheidung vom Moderationsteam zurückgenommen.' WHERE id = ? AND automatisch_geprueft = 1`).run(Number(req.params.id));
    if (!r.changes) return res.status(409).json({ fehler: 'Nur automatisch entschiedene Einträge können zurückgenommen werden.' });
    res.json({ ok: true });
  });

  // ── Kauflinks (z. B. Affiliate-Direktlinks) ─────────────────
  function pruefeKauflink(eingabe = {}) {
    const fehler = {};
    const anbieter = String(eingabe.anbieter ?? '').trim().slice(0, 60);
    const url = String(eingabe.url ?? '').trim();
    if (!anbieter) fehler.anbieter = 'Bitte den Shop/Anbieter angeben.';
    if (!/^https:\/\//i.test(url) || url.length > 2000) fehler.url = 'Der Link muss mit https:// beginnen.';
    const preis = eingabe.preis === '' || eingabe.preis == null ? null : leseEuro(eingabe.preis);
    if (eingabe.preis && preis === null) fehler.preis = 'Ungültiger Preis.';
    if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
    return { anbieter, url, preis, titel: String(eingabe.titel ?? '').trim().slice(0, 200) || null, aktiv: eingabe.aktiv === false ? 0 : 1 };
  }

  router.get('/katalog/:id/kauflinks', (req, res) => {
    res.json(db.prepare('SELECT * FROM kauflinks WHERE katalog_id = ? ORDER BY id').all(Number(req.params.id)));
  });

  router.post('/katalog/:id/kauflinks', (req, res) => {
    const e = katalog.holeEintrag(Number(req.params.id));
    if (!e) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    const d = pruefeKauflink(req.body);
    res.status(201).json(db.prepare(`INSERT INTO kauflinks (katalog_id, anbieter, titel, url, preis, aktiv, erstellt_von)
      VALUES (@katalog_id, @anbieter, @titel, @url, @preis, @aktiv, @erstellt_von) RETURNING *`)
      .get({ ...d, katalog_id: e.id, erstellt_von: req.benutzer.id }));
  });

  router.put('/kauflinks/:id', (req, res) => {
    const d = pruefeKauflink(req.body);
    const l = db.prepare(`UPDATE kauflinks SET anbieter = @anbieter, titel = @titel, url = @url, preis = @preis, aktiv = @aktiv
      WHERE id = @id RETURNING *`).get({ ...d, id: Number(req.params.id) });
    if (!l) return res.status(404).json({ fehler: 'Kauflink nicht gefunden.' });
    res.json(l);
  });

  router.delete('/kauflinks/:id', (req, res) => {
    db.prepare('DELETE FROM kauflinks WHERE id = ?').run(Number(req.params.id));
    res.status(204).end();
  });

  // ── Plattformen ─────────────────────────────────────────────
  function pruefePlattform(eingabe = {}) {
    const fehler = {};
    const name = String(eingabe.name ?? '').trim().slice(0, 100);
    const kurz = String(eingabe.kurz ?? '').trim().slice(0, 20);
    if (!name) fehler.name = 'Bitte einen Namen angeben.';
    if (!kurz) fehler.kurz = 'Bitte ein Kürzel angeben (z. B. PS5).';
    const typ = ['konsole', 'handheld', 'computer', 'sonstige'].includes(eingabe.typ) ? eingabe.typ : 'konsole';
    const jahr = eingabe.erscheinungsjahr ? Number(eingabe.erscheinungsjahr) : null;
    if (jahr !== null && (!Number.isInteger(jahr) || jahr < 1950 || jahr > 2100)) fehler.erscheinungsjahr = 'Ungültiges Jahr.';
    const aliase = (Array.isArray(eingabe.aliase) ? eingabe.aliase : String(eingabe.aliase ?? '').split(','))
      .map((a) => String(a).trim()).filter(Boolean).slice(0, 30);
    if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
    return { name, kurz, typ, erscheinungsjahr: jahr, hersteller: String(eingabe.hersteller ?? '').trim().slice(0, 60) || 'Sonstige', aliase: JSON.stringify(aliase) };
  }

  router.post('/plattformen', (req, res) => {
    const d = pruefePlattform(req.body);
    if (db.prepare('SELECT 1 FROM plattformen WHERE name = ?').get(d.name)) throw new ValidierungsFehler({ name: 'Diese Plattform gibt es bereits.' });
    const p = db.prepare(`INSERT INTO plattformen (name, kurz, hersteller, typ, erscheinungsjahr, aliase)
      VALUES (@name, @kurz, @hersteller, @typ, @erscheinungsjahr, @aliase) RETURNING *`).get(d);
    plattformen.indexNeuLaden();
    res.status(201).json(plattformZuObjekt(p));
  });

  router.put('/plattformen/:id', (req, res) => {
    const d = pruefePlattform(req.body);
    const p = db.prepare(`UPDATE plattformen SET name = @name, kurz = @kurz, hersteller = @hersteller, typ = @typ,
      erscheinungsjahr = @erscheinungsjahr, aliase = @aliase WHERE id = @id RETURNING *`).get({ ...d, id: Number(req.params.id) });
    if (!p) return res.status(404).json({ fehler: 'Plattform nicht gefunden.' });
    db.prepare('UPDATE artikel SET plattform = ? WHERE plattform_id = ?').run(p.name, p.id);
    plattformen.indexNeuLaden();
    res.json(plattformZuObjekt(p));
  });

  return router;
}
