// Meldungen von Inhalten (z. B. Urheberrechtsverletzungen) – Notice-and-Takedown.
import { Router } from 'express';
import { istModerator } from '../../shared/konstanten.js';
import { erstelleDrossel } from '../services/drossel.js';
import { ValidierungsFehler } from '../services/validierung.js';

export const MELDEGRUENDE = ['urheberrecht', 'rechtswidrig', 'falsch', 'spam', 'ergaenzung', 'sonstiges'];

/** Öffentlich (auch ohne Konto), damit Rechteinhaber Inhalte melden können. */
export function meldenRouter({ db, katalog }) {
  const router = Router();
  const drossel = erstelleDrossel({ maxVersuche: 20, fensterMs: 60 * 60 * 1000 });

  router.post('/melden', (req, res) => {
    if (drossel.gesperrt(req.ip)) return res.status(429).json({ fehler: 'Zu viele Meldungen. Bitte später erneut versuchen.' });
    const { bereich, grund } = req.body ?? {};
    const zielId = Number(req.body?.ziel_id);
    const fehler = {};
    if (!['medien', 'katalog', 'preis', 'link'].includes(bereich)) fehler.bereich = 'Ungültiger Bereich.';
    if (!MELDEGRUENDE.includes(grund)) fehler.grund = 'Bitte einen Grund wählen.';
    const text = String(req.body?.text ?? '').trim().slice(0, 3000);
    if (!text) fehler.text = 'Bitte beschreibe kurz das Problem.';
    const kontakt = String(req.body?.kontakt ?? '').trim().slice(0, 200) || null;
    if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);

    // Nur sichtbare Inhalte können gemeldet werden
    let sichtbar = false;
    if (bereich === 'katalog') sichtbar = Boolean(katalog.holeSichtbar(zielId, req.benutzer));
    if (bereich === 'preis') sichtbar = Boolean(db.prepare("SELECT 1 FROM preis_historie h JOIN katalog k ON k.id = h.katalog_id WHERE h.id = ? AND k.status = 'freigegeben'").get(zielId));
    if (bereich === 'link') sichtbar = Boolean(db.prepare("SELECT 1 FROM externe_links WHERE id = ? AND status = 'freigegeben'").get(zielId));
    if (bereich === 'medien') {
      const m = db.prepare('SELECT benutzer_id, sichtbarkeit FROM medien WHERE id = ?').get(zielId);
      sichtbar = Boolean(m && req.benutzer && (m.sichtbarkeit === 'freigegeben' || m.benutzer_id === req.benutzer.id));
    }
    if (!sichtbar) return res.status(404).json({ fehler: 'Der gemeldete Inhalt wurde nicht gefunden.' });

    drossel.fehlschlag(req.ip);
    db.prepare(`INSERT INTO inhalt_meldungen (bereich, ziel_id, grund, text, kontakt, benutzer_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(bereich, zielId, grund, text, kontakt, req.benutzer?.id ?? null);
    res.status(201).json({ ok: true });
  });

  return router;
}

/** Bearbeitung durch das Moderationsteam. */
export function meldungenModerationRouter({ db, benachrichtigungen }) {
  const router = Router();

  router.get('/meldungen', (req, res) => {
    const status = req.query.status === 'erledigt' ? 'erledigt' : 'offen';
    const zeilen = db.prepare(`
      SELECT m.*, COALESCE(b.anzeigename, b.benutzername) AS gemeldet_von,
        CASE m.bereich
          WHEN 'medien' THEN (SELECT COALESCE(md.titel, md.art) || ' – ' || k.titel FROM medien md JOIN katalog k ON k.id = md.katalog_id WHERE md.id = m.ziel_id)
          WHEN 'katalog' THEN (SELECT titel FROM katalog WHERE id = m.ziel_id)
          WHEN 'preis' THEN (SELECT printf('%.2f € (%s) – ', h.preis, h.quelle) || k.titel FROM preis_historie h JOIN katalog k ON k.id = h.katalog_id WHERE h.id = m.ziel_id)
          WHEN 'link' THEN (SELECT 'Link zu ' || l.domain || ' – ' || k.titel FROM externe_links l JOIN katalog k ON k.id = l.katalog_id WHERE l.id = m.ziel_id)
        END AS ziel_titel,
        CASE m.bereich
          WHEN 'medien' THEN (SELECT katalog_id FROM medien WHERE id = m.ziel_id)
          WHEN 'katalog' THEN m.ziel_id
          WHEN 'preis' THEN (SELECT katalog_id FROM preis_historie WHERE id = m.ziel_id)
          WHEN 'link' THEN (SELECT katalog_id FROM externe_links WHERE id = m.ziel_id)
        END AS katalog_id
      FROM inhalt_meldungen m LEFT JOIN benutzer b ON b.id = m.benutzer_id
      WHERE m.status = ? ORDER BY m.erstellt_am DESC LIMIT 200`).all(status);
    res.json(zeilen);
  });

  // aktion: 'entfernen' (Inhalt sperren/löschen) oder 'keine' (Meldung unbegründet)
  router.post('/meldungen/:id/erledigen', (req, res) => {
    const m = db.prepare("SELECT * FROM inhalt_meldungen WHERE id = ? AND status = 'offen'").get(Number(req.params.id));
    if (!m) return res.status(404).json({ fehler: 'Meldung nicht gefunden oder bereits erledigt.' });
    const aktion = req.body?.aktion === 'entfernen' ? 'entfernen' : 'keine';
    const ergebnis = String(req.body?.ergebnis ?? '').trim().slice(0, 1000) || (aktion === 'entfernen' ? 'Inhalt entfernt.' : 'Kein Verstoß festgestellt.');
    // Alle Meldenden mit Konto erfahren das Ergebnis
    const meldende = db.prepare(`SELECT DISTINCT benutzer_id, grund FROM inhalt_meldungen
      WHERE bereich = ? AND ziel_id = ? AND status = 'offen' AND benutzer_id IS NOT NULL`).all(m.bereich, m.ziel_id);
    db.transaction(() => {
      if (aktion === 'entfernen') {
        if (m.bereich === 'medien') {
          // Nicht mehr öffentlich; der Uploader behält die Datei privat
          db.prepare(`UPDATE medien SET sichtbarkeit = 'abgelehnt', pruefung_notiz = ?, geprueft_von = ?, geprueft_am = datetime('now') WHERE id = ?`)
            .run(`Nach Meldung entfernt: ${ergebnis}`, req.benutzer.id, m.ziel_id);
        } else if (m.bereich === 'link') {
          db.prepare(`UPDATE externe_links SET status = 'abgelehnt', pruefung_notiz = ?, geprueft_von = ? WHERE id = ?`)
            .run(`Nach Meldung entfernt: ${ergebnis}`, req.benutzer.id, m.ziel_id);
        } else if (m.bereich === 'preis') {
          db.prepare('DELETE FROM preis_historie WHERE id = ?').run(m.ziel_id);
        } else if (m.bereich === 'katalog' && istModerator(req.benutzer)) {
          db.prepare(`UPDATE katalog SET status = 'abgelehnt', pruefung_notiz = ?, geprueft_von = ? WHERE id = ? AND quelle = 'eigen'`)
            .run(`Nach Meldung entfernt: ${ergebnis}`, req.benutzer.id, m.ziel_id);
        }
      }
      // Alle offenen Meldungen zum selben Inhalt gemeinsam abschließen
      db.prepare(`UPDATE inhalt_meldungen SET status = 'erledigt', ergebnis = ?, erledigt_von = ?, erledigt_am = datetime('now')
                  WHERE bereich = ? AND ziel_id = ? AND status = 'offen'`).run(ergebnis, req.benutzer.id, m.bereich, m.ziel_id);
    })();
    const katalogId = {
      katalog: () => m.ziel_id,
      medien: () => db.prepare('SELECT katalog_id FROM medien WHERE id = ?').get(m.ziel_id)?.katalog_id,
      link: () => db.prepare('SELECT katalog_id FROM externe_links WHERE id = ?').get(m.ziel_id)?.katalog_id,
      preis: () => null,
    }[m.bereich]?.();
    for (const { benutzer_id: b, grund } of meldende) {
      benachrichtigungen.sende(b, {
        art: 'meldung',
        titel: grund === 'ergaenzung' ? 'Danke für deinen Vorschlag – er wurde bearbeitet' : 'Deine Meldung wurde bearbeitet',
        text: ergebnis, link: katalogId ? `#/katalog/${katalogId}` : null,
      });
    }
    res.json({ ok: true });
  });

  return router;
}
