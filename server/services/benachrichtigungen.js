// Benachrichtigungen in der App (Glocke) und – wenn der Benutzer es einschaltet – per E-Mail.
import { MARKE } from '../../shared/marke.js';
import { APP_START } from '../../shared/seo.js';
import { mailHtml } from './mail.js';

const MAX_JE_BENUTZER = 200;

export function erstelleBenachrichtigungsDienst(db, { mail, konfiguration }) {
  let push = null; // wird nach dem Anlegen gesetzt (Web-Push aufs Handy)
  const q = {
    anlegen: db.prepare('INSERT INTO benachrichtigungen (benutzer_id, art, titel, text, link) VALUES (?, ?, ?, ?, ?) RETURNING id'),
    kuerzen: db.prepare(`DELETE FROM benachrichtigungen WHERE benutzer_id = @b AND id NOT IN
      (SELECT id FROM benachrichtigungen WHERE benutzer_id = @b ORDER BY id DESC LIMIT ${MAX_JE_BENUTZER})`),
    empfaenger: db.prepare('SELECT id, benutzername, anzeigename, email, benachrichtigung_email FROM benutzer WHERE id = ?'),
    liste: db.prepare('SELECT id, art, titel, text, link, gelesen, erstellt_am FROM benachrichtigungen WHERE benutzer_id = ? ORDER BY id DESC LIMIT ?'),
    ungelesen: db.prepare('SELECT COUNT(*) AS n FROM benachrichtigungen WHERE benutzer_id = ? AND gelesen = 0'),
    alleGelesen: db.prepare('UPDATE benachrichtigungen SET gelesen = 1 WHERE benutzer_id = ? AND gelesen = 0'),
    eineGelesen: db.prepare('UPDATE benachrichtigungen SET gelesen = 1 WHERE benutzer_id = ? AND id = ?'),
    loeschen: db.prepare('DELETE FROM benachrichtigungen WHERE benutzer_id = ? AND id = ?'),
  };

  /**
   * Neue Benachrichtigung. `link` ist eine App-Adresse wie „#/katalog/5“.
   * Fehler beim E-Mail-Versand werden nur protokolliert und brechen nichts ab.
   */
  function sende(benutzerId, { art, titel, text = null, link = null }) {
    if (!benutzerId) return null;
    const b = q.empfaenger.get(benutzerId);
    if (!b) return null;
    const { id } = q.anlegen.get(b.id, art, String(titel).slice(0, 200), text ? String(text).slice(0, 1000) : null, link);
    q.kuerzen.run({ b: b.id });
    push?.sende(b.id, { titel, text, link, tag: art }).catch((e) => console.warn('[push]', e.message));
    if (b.benachrichtigung_email && b.email && mail.aktiv && konfiguration.oeffentlicheUrl) {
      const url = `${konfiguration.oeffentlicheUrl}${APP_START}${link ? link.replace(/^\/+/, '') : ''}`;
      const gruss = `Hallo ${b.anzeigename || b.benutzername},`;
      mail.sende({
        an: b.email,
        betreff: `${MARKE.name}: ${titel}`,
        text: `${gruss}\n\n${titel}${text ? `\n${text}` : ''}\n\n${url}\n\nE-Mail-Benachrichtigungen kannst du unter „Konto“ abschalten.`,
        html: mailHtml({
          titel, absaetze: [gruss, text].filter(Boolean), knopf: { text: `In ${MARKE.name} ansehen`, url },
          fuss: 'E-Mail-Benachrichtigungen kannst du in der App unter „Konto“ abschalten.',
        }),
      }).catch((e) => console.warn('[benachrichtigung]', e.message));
    }
    return id;
  }

  return {
    sende,
    setzePush: (dienst) => { push = dienst; },
    liste: (benutzerId, limit = 50) => q.liste.all(benutzerId, Math.min(200, limit)).map((z) => ({ ...z, gelesen: Boolean(z.gelesen) })),
    ungelesen: (benutzerId) => q.ungelesen.get(benutzerId).n,
    markiereGelesen: (benutzerId, id = null) => (id ? q.eineGelesen.run(benutzerId, id) : q.alleGelesen.run(benutzerId)),
    loesche: (benutzerId, id) => q.loeschen.run(benutzerId, id),
  };
}
