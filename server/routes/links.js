// Links zu externen Webseiten, die Cover, Handbücher o. Ä. anbieten.
// Statt Dateien selbst bereitzustellen, wird direkt auf die Quelle verlinkt.
// Nutzer schlagen Links vor (oder speichern sie privat); sichtbar für alle werden sie
// erst nach Freigabe durch das Moderationsteam.
import { Router } from 'express';
import { MEDIENARTEN, istModerator } from '../../shared/konstanten.js';
import { ValidierungsFehler } from '../services/validierung.js';

const ARTEN = MEDIENARTEN.map((a) => a.value);

export function linkZuObjekt(l, benutzer) {
  const eigener = Boolean(benutzer && l.benutzer_id === benutzer.id);
  return {
    id: l.id, katalog_id: l.katalog_id, art: l.art, titel: l.titel, url: l.url, domain: l.domain, status: l.status,
    erstellt_am: l.erstellt_am, eigener,
    pruefung_notiz: eigener || istModerator(benutzer) ? l.pruefung_notiz : undefined,
    darf_loeschen: Boolean(benutzer && ((eigener && l.status !== 'freigegeben') || istModerator(benutzer))),
  };
}

/** Prüft URL und Domain; optional nur erlaubte Domains (LINK_DOMAINS). */
export function pruefeLink(eingabe, erlaubteDomains = []) {
  const fehler = {};
  if (!ARTEN.includes(eingabe.art)) fehler.art = 'Bitte wählen, was der Link zeigt.';
  const roh = String(eingabe.url ?? '').trim();
  let url = null;
  try {
    url = new URL(roh);
  } catch { /* ungültig */ }
  if (!url || url.protocol !== 'https:' || roh.length > 1000 || url.username || url.password) {
    fehler.url = 'Bitte eine vollständige, sichere Adresse angeben (beginnt mit https://).';
  }
  const domain = url ? url.hostname.toLowerCase().replace(/^www\./, '') : '';
  if (url && !fehler.url && erlaubteDomains.length
    && !erlaubteDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    fehler.url = `Links sind nur zu diesen Seiten erlaubt: ${erlaubteDomains.join(', ')}.`;
  }
  if (Object.keys(fehler).length) throw new ValidierungsFehler(fehler);
  return { art: eingabe.art, url: url.href, domain, titel: String(eingabe.titel ?? '').trim().slice(0, 200) || null };
}

export function linksRouter({ db, katalog, konfiguration }) {
  const router = Router();

  router.get('/katalog/:id/links', (req, res) => {
    const e = katalog.holeSichtbar(req.params.id, req.benutzer);
    if (!e) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    const zeilen = db.prepare(`SELECT * FROM externe_links WHERE katalog_id = @k
      AND (status = 'freigegeben' OR benutzer_id = @b OR (@m = 1 AND status = 'eingereicht')) ORDER BY art, erstellt_am`)
      .all({ k: e.id, b: req.benutzer.id, m: istModerator(req.benutzer) ? 1 : 0 });
    res.json(zeilen.map((l) => linkZuObjekt(l, req.benutzer)));
  });

  router.post('/katalog/:id/links', (req, res) => {
    const e = katalog.holeSichtbar(req.params.id, req.benutzer);
    if (!e) return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    const daten = pruefeLink(req.body ?? {}, konfiguration.linkDomains);
    // privat = persönliches Lesezeichen · eingereicht = für alle vorschlagen · Moderatoren dürfen direkt freigeben
    let status = req.body?.sichtbarkeit === 'privat' ? 'privat' : 'eingereicht';
    if (req.body?.sichtbarkeit === 'freigegeben' && istModerator(req.benutzer)) status = 'freigegeben';
    if (status !== 'privat' && e.status !== 'freigegeben') status = 'privat'; // private Einträge: nur private Links
    const doppelt = db.prepare("SELECT 1 FROM externe_links WHERE katalog_id = ? AND url = ? AND status != 'abgelehnt'").get(e.id, daten.url);
    if (doppelt) throw new ValidierungsFehler({ url: 'Dieser Link ist bereits eingetragen.' });
    const zeile = db.prepare(`INSERT INTO externe_links (katalog_id, benutzer_id, art, titel, url, domain, status)
      VALUES (@katalog_id, @benutzer_id, @art, @titel, @url, @domain, @status) RETURNING *`)
      .get({ ...daten, katalog_id: e.id, benutzer_id: req.benutzer.id, status });
    res.status(201).json(linkZuObjekt(zeile, req.benutzer));
  });

  router.delete('/links/:id', (req, res) => {
    const l = db.prepare('SELECT * FROM externe_links WHERE id = ?').get(Number(req.params.id));
    if (!l || !linkZuObjekt(l, req.benutzer).darf_loeschen) return res.status(404).json({ fehler: 'Link nicht gefunden.' });
    db.prepare('DELETE FROM externe_links WHERE id = ?').run(l.id);
    res.status(204).end();
  });

  return router;
}
