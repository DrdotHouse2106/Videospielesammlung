// E-Mail rund ums Konto: Adresse bestätigen, Passwort vergessen, Sicherheitshinweise.
//
// Sicherheit:
// - Links enthalten einen zufälligen Token; gespeichert wird nur dessen SHA-256-Hash.
// - Links sind kurz gültig (Passwort: 60 Minuten, E-Mail: 24 Stunden) und nur einmal verwendbar.
// - Links werden nur mit PUBLIC_URL gebaut – nie aus dem Host-Header der Anfrage (Schutz vor
//   „Host-Header-Poisoning“, bei dem ein Angreifer Links auf seine eigene Domain umleitet).
// - Antworten verraten nicht, ob ein Benutzername oder eine E-Mail-Adresse existiert.
// - Der Token steht im Fragment (#/…), damit er nicht in Server-Logs oder Referrern landet.
import { MARKE } from '../../shared/marke.js';
import { APP_START } from '../../shared/seo.js';
import { zufallsToken, sha256 } from './sicherheit.js';
import { mailHtml } from './mail.js';
import { ValidierungsFehler } from './validierung.js';
import { KontoFehler } from './konten.js';

const STUNDE = 60 * 60 * 1000;
const GUELTIG = { passwort: STUNDE, email: 24 * STUNDE };

export function normalisiereEmail(wert) {
  const email = String(wert ?? '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email)) {
    throw new ValidierungsFehler({ email: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  }
  return email;
}

export function erstelleKontoMailDienst(db, { mail, konfiguration, konten }) {
  const q = {
    perEmail: db.prepare('SELECT * FROM benutzer WHERE email = ?'),
    perName: db.prepare('SELECT * FROM benutzer WHERE benutzername = ?'),
    tokenAnlegen: db.prepare('INSERT INTO konto_tokens (benutzer_id, zweck, token_hash, email, laeuft_ab) VALUES (?, ?, ?, ?, ?)'),
    tokenLesen: db.prepare('SELECT * FROM konto_tokens WHERE token_hash = ? AND zweck = ?'),
    tokensLoeschen: db.prepare('DELETE FROM konto_tokens WHERE benutzer_id = ? AND zweck = ?'),
    abgelaufeneLoeschen: db.prepare('DELETE FROM konto_tokens WHERE laeuft_ab < ?'),
    ausstehend: db.prepare("SELECT email FROM konto_tokens WHERE benutzer_id = ? AND zweck = 'email' AND laeuft_ab > ? ORDER BY id DESC LIMIT 1"),
    emailSetzen: db.prepare('UPDATE benutzer SET email = ? WHERE id = ?'),
  };

  const basisUrl = () => konfiguration.oeffentlicheUrl;
  /** Kann der Server gerade E-Mails mit Links versenden? */
  const bereit = () => Boolean(mail.aktiv && basisUrl());

  function sicherstellenBereit() {
    if (!mail.aktiv) throw new KontoFehler('Der E-Mail-Versand ist auf diesem Server nicht eingerichtet.', 503, 'email_aus');
    if (!basisUrl()) throw new KontoFehler('Für E-Mails mit Links muss die öffentliche Adresse (PUBLIC_URL) gesetzt sein.', 503, 'email_aus');
  }

  function neuerToken(benutzerId, zweck, email = null) {
    q.abgelaufeneLoeschen.run(Date.now());
    q.tokensLoeschen.run(benutzerId, zweck); // nur der jeweils neueste Link gilt
    const token = zufallsToken();
    q.tokenAnlegen.run(benutzerId, zweck, sha256(token), email, Date.now() + GUELTIG[zweck]);
    return token;
  }

  function loeseToken(token, zweck) {
    const zeile = token ? q.tokenLesen.get(sha256(String(token)), zweck) : null;
    if (!zeile || zeile.laeuft_ab < Date.now()) {
      throw new KontoFehler('Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.', 400, 'link_ungueltig');
    }
    return zeile;
  }

  const gruss = (b) => `Hallo ${b.anzeigename || b.benutzername},`;

  /** Schickt einen Bestätigungslink an eine (neue) Adresse. */
  async function anfordernBestaetigung(benutzer, emailRoh) {
    sicherstellenBereit();
    const email = normalisiereEmail(emailRoh);
    if (!email) throw new ValidierungsFehler({ email: 'Bitte eine E-Mail-Adresse angeben.' });
    const vorhanden = q.perEmail.get(email);
    if (vorhanden && vorhanden.id !== benutzer.id) {
      // Nicht verraten, dass die Adresse vergeben ist – stattdessen den Inhaber informieren.
      await mail.sende({
        an: email,
        betreff: `${MARKE.name}: Deine E-Mail-Adresse wurde erneut angegeben`,
        text: `${gruss(vorhanden)}\n\njemand wollte diese E-Mail-Adresse für ein anderes Konto bei ${MARKE.name} verwenden. `
          + `Sie gehört bereits zu deinem Konto „${vorhanden.benutzername}“ und bleibt dort.\n\n`
          + `Passwort vergessen? ${basisUrl()}${APP_START}#/passwort-vergessen\n\nWarst du das nicht, kannst du diese E-Mail ignorieren.`,
        html: mailHtml({
          titel: 'Deine E-Mail-Adresse wurde erneut angegeben',
          absaetze: [gruss(vorhanden), `Jemand wollte diese Adresse für ein anderes Konto verwenden. Sie gehört bereits zu deinem Konto „${vorhanden.benutzername}“ und bleibt dort.`, 'Warst du das nicht, kannst du diese E-Mail ignorieren.'],
          knopf: { text: 'Passwort vergessen?', url: `${basisUrl()}${APP_START}#/passwort-vergessen` },
        }),
      });
      return;
    }
    const token = neuerToken(benutzer.id, 'email', email);
    const url = `${basisUrl()}${APP_START}#/email-bestaetigen?token=${token}`;
    await mail.sende({
      an: email,
      betreff: `${MARKE.name}: Bitte bestätige deine E-Mail-Adresse`,
      text: `${gruss(benutzer)}\n\nbitte bestätige deine E-Mail-Adresse für ${MARKE.name} über diesen Link (24 Stunden gültig):\n${url}\n\n`
        + 'Mit der bestätigten Adresse kannst du dein Passwort zurücksetzen, falls du es vergisst.\n\n'
        + 'Hast du das nicht angefordert? Dann ignoriere diese E-Mail einfach.',
      html: mailHtml({
        titel: 'Bitte bestätige deine E-Mail-Adresse',
        absaetze: [gruss(benutzer), 'Mit der bestätigten Adresse kannst du dein Passwort zurücksetzen, falls du es vergisst. Der Link ist 24 Stunden gültig.'],
        knopf: { text: 'E-Mail-Adresse bestätigen', url },
        fuss: 'Hast du das nicht angefordert? Dann ignoriere diese E-Mail einfach.',
      }),
    });
  }

  function bestaetige(token) {
    const t = loeseToken(token, 'email');
    const belegt = q.perEmail.get(t.email);
    q.tokensLoeschen.run(t.benutzer_id, 'email');
    if (belegt && belegt.id !== t.benutzer_id) {
      throw new KontoFehler('Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.', 409);
    }
    q.emailSetzen.run(t.email, t.benutzer_id);
    return konten.holeBenutzer(t.benutzer_id);
  }

  /** „Passwort vergessen“: Benutzername oder E-Mail. Verrät nie, ob das Konto existiert. */
  async function anfordernReset(kennung) {
    sicherstellenBereit();
    const text = String(kennung ?? '').trim();
    if (!text) throw new ValidierungsFehler({ kennung: 'Bitte Benutzername oder E-Mail-Adresse angeben.' });
    const b = text.includes('@') ? q.perEmail.get(text.toLowerCase()) : q.perName.get(text);
    if (!b || !b.email || b.gesperrt) return;
    const token = neuerToken(b.id, 'passwort');
    const url = `${basisUrl()}${APP_START}#/passwort-neu?token=${token}`;
    await mail.sende({
      an: b.email,
      betreff: `${MARKE.name}: Passwort zurücksetzen`,
      text: `${gruss(b)}\n\nüber diesen Link kannst du ein neues Passwort für dein Konto „${b.benutzername}“ festlegen (60 Minuten gültig):\n${url}\n\n`
        + 'Hast du das nicht angefordert? Dann ignoriere diese E-Mail – dein Passwort bleibt unverändert.',
      html: mailHtml({
        titel: 'Passwort zurücksetzen',
        absaetze: [gruss(b), `Über den Knopf kannst du ein neues Passwort für dein Konto „${b.benutzername}“ festlegen. Der Link ist 60 Minuten gültig und funktioniert nur einmal.`],
        knopf: { text: 'Neues Passwort festlegen', url },
        fuss: 'Hast du das nicht angefordert? Dann ignoriere diese E-Mail – dein Passwort bleibt unverändert.',
      }),
    });
  }

  async function zuruecksetzen(token, neuesPasswort) {
    const t = loeseToken(token, 'passwort');
    await konten.aenderePasswort(t.benutzer_id, neuesPasswort);
    q.tokensLoeschen.run(t.benutzer_id, 'passwort');
    konten.beendeAlleSitzungen(t.benutzer_id);
    const b = konten.holeBenutzer(t.benutzer_id);
    await sicherheitshinweis(b, 'Dein Passwort wurde zurückgesetzt',
      'Das Passwort deines Kontos wurde gerade über „Passwort vergessen“ neu festgelegt. Alle Geräte wurden abgemeldet.');
    return b;
  }

  /** Kurzer Sicherheitshinweis an die bestätigte Adresse (Fehler beim Versand werden nur protokolliert). */
  async function sicherheitshinweis(b, titel, text) {
    if (!b?.email || !mail.aktiv) return;
    try {
      await mail.sende({
        an: b.email,
        betreff: `${MARKE.name}: ${titel}`,
        text: `${gruss(b)}\n\n${text}\n\nWarst du das nicht? Dann setze sofort dein Passwort zurück und melde dich beim Betreiber.`,
        html: mailHtml({ titel, absaetze: [gruss(b), text, 'Warst du das nicht? Dann setze sofort dein Passwort zurück und melde dich beim Betreiber.'] }),
      });
    } catch (e) {
      console.warn('[mail]', e.message);
    }
  }

  const ausstehendeEmail = (benutzerId) => q.ausstehend.get(benutzerId, Date.now())?.email ?? null;
  const entferneEmail = (benutzerId) => { q.emailSetzen.run(null, benutzerId); q.tokensLoeschen.run(benutzerId, 'email'); };

  return { bereit, anfordernBestaetigung, bestaetige, anfordernReset, zuruecksetzen, sicherheitshinweis, ausstehendeEmail, entferneEmail };
}
