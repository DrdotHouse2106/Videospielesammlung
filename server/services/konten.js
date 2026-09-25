// Benutzerkonten, Sitzungen und Zwei-Faktor-Authentifizierung.
import QRCode from 'qrcode';
import {
  hashePasswort, pruefePasswort, vergleicheMitPlatzhalter, zufallsToken, sha256, verschluessele, entschluessele,
  erzeugeTotpGeheimnis, pruefeTotp, erzeugeWiederherstellungscodes, normalisiereWiederherstellungscode,
} from './sicherheit.js';
import { ValidierungsFehler } from './validierung.js';

export const COOKIE_NAME = 'vss_sitzung';
const ZWEI_FAKTOR_FRIST_MS = 5 * 60 * 1000;

export class KontoFehler extends Error {
  constructor(meldung, status = 400, code) {
    super(meldung);
    this.status = status;
    this.code = code;
  }
}

export function oeffentlichesProfil(b) {
  if (!b) return null;
  return {
    id: b.id,
    benutzername: b.benutzername,
    anzeigename: b.anzeigename || b.benutzername,
    rolle: b.rolle,
    totp_aktiv: Boolean(b.totp_aktiv),
    sammlung_oeffentlich: Boolean(b.sammlung_oeffentlich),
    erstellt_am: b.erstellt_am,
    letzte_anmeldung: b.letzte_anmeldung,
  };
}

export function pruefeBenutzername(name) {
  const wert = String(name ?? '').trim();
  if (!/^[A-Za-z0-9ÄÖÜäöüß_.-]{3,32}$/.test(wert)) {
    throw new ValidierungsFehler({ benutzername: '3–32 Zeichen: Buchstaben, Ziffern sowie _ . - (keine Leerzeichen).' });
  }
  return wert;
}

export function pruefeNeuesPasswort(passwort, feld = 'passwort') {
  const wert = String(passwort ?? '');
  if (wert.length < 10) throw new ValidierungsFehler({ [feld]: 'Das Passwort muss mindestens 10 Zeichen lang sein.' });
  if (wert.length > 200) throw new ValidierungsFehler({ [feld]: 'Das Passwort darf höchstens 200 Zeichen lang sein.' });
  return wert;
}

export function erstelleKontenDienst(db, { schluessel, sitzungTage, appName = 'Videospielesammlung' }) {
  const sitzungDauerMs = sitzungTage * 24 * 60 * 60 * 1000;
  const q = {
    anzahlBenutzer: db.prepare('SELECT COUNT(*) AS n FROM benutzer'),
    perId: db.prepare('SELECT * FROM benutzer WHERE id = ?'),
    perName: db.prepare('SELECT * FROM benutzer WHERE benutzername = ?'),
    anlegen: db.prepare(`INSERT INTO benutzer (benutzername, anzeigename, passwort_hash, rolle, bedingungen_akzeptiert_am)
                         VALUES (?, ?, ?, ?, datetime('now')) RETURNING *`),
    sitzungAnlegen: db.prepare('INSERT INTO sitzungen (token_hash, benutzer_id, stufe, laeuft_ab, geraet) VALUES (?, ?, ?, ?, ?)'),
    sitzungLesen: db.prepare('SELECT * FROM sitzungen WHERE token_hash = ?'),
    sitzungVerlaengern: db.prepare('UPDATE sitzungen SET laeuft_ab = ? WHERE token_hash = ?'),
    sitzungLoeschen: db.prepare('DELETE FROM sitzungen WHERE token_hash = ?'),
    alleSitzungenLoeschen: db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ?'),
    andereSitzungenLoeschen: db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ? AND token_hash != ?'),
    abgelaufeneLoeschen: db.prepare('DELETE FROM sitzungen WHERE laeuft_ab < ?'),
    angemeldet: db.prepare("UPDATE benutzer SET letzte_anmeldung = datetime('now') WHERE id = ?"),
  };

  const istErsteinrichtung = () => q.anzahlBenutzer.get().n === 0;

  async function registriere({ benutzername, passwort, anzeigename, bedingungen_akzeptiert: akzeptiert }) {
    const name = pruefeBenutzername(benutzername);
    pruefeNeuesPasswort(passwort);
    if (akzeptiert !== true) {
      throw new ValidierungsFehler({ bedingungen: 'Bitte akzeptiere die Nutzungsbedingungen und bestätige, die Datenschutzerklärung gelesen zu haben.' });
    }
    if (q.perName.get(name)) throw new ValidierungsFehler({ benutzername: 'Dieser Benutzername ist bereits vergeben.' });
    const hash = await hashePasswort(passwort);
    return db.transaction(() => {
      const erster = istErsteinrichtung();
      const benutzer = q.anlegen.get(name, String(anzeigename ?? '').trim().slice(0, 60) || null, hash, erster ? 'admin' : 'nutzer');
      if (erster) {
        // Daten aus einer Installation ohne Benutzerkonten (Version 1) dem ersten Konto zuordnen.
        db.prepare('UPDATE artikel SET benutzer_id = ? WHERE benutzer_id IS NULL').run(benutzer.id);
        db.prepare("UPDATE katalog SET erstellt_von = ? WHERE quelle = 'eigen' AND erstellt_von IS NULL").run(benutzer.id);
      }
      return benutzer;
    })();
  }

  /** Prüft Benutzername + Passwort. Liefert den Benutzer oder null. */
  async function pruefeZugangsdaten(benutzername, passwort) {
    const benutzer = q.perName.get(String(benutzername ?? '').trim());
    if (!benutzer) return vergleicheMitPlatzhalter(String(passwort ?? ''));
    return (await pruefePasswort(String(passwort ?? ''), benutzer.passwort_hash)) ? benutzer : null;
  }

  function erstelleSitzung(benutzerId, { stufe = 'voll', geraet } = {}) {
    const token = zufallsToken();
    const dauer = stufe === 'voll' ? sitzungDauerMs : ZWEI_FAKTOR_FRIST_MS;
    q.sitzungAnlegen.run(sha256(token), benutzerId, stufe, Date.now() + dauer, geraet?.slice(0, 200) ?? null);
    if (stufe === 'voll') q.angemeldet.run(benutzerId);
    return { token, maxAlterMs: dauer };
  }

  /** Liefert { sitzung, benutzer } für ein gültiges Token, sonst null. Verlängert volle Sitzungen gleitend. */
  function leseSitzung(token, erwarteteStufe = 'voll') {
    if (!token) return null;
    const tokenHash = sha256(token);
    const sitzung = q.sitzungLesen.get(tokenHash);
    if (!sitzung || sitzung.stufe !== erwarteteStufe) return null;
    if (sitzung.laeuft_ab < Date.now()) {
      q.sitzungLoeschen.run(tokenHash);
      return null;
    }
    const benutzer = q.perId.get(sitzung.benutzer_id);
    if (!benutzer || benutzer.gesperrt) return null;
    // Höchstens einmal pro Stunde verlängern, um Schreibzugriffe zu sparen.
    if (erwarteteStufe === 'voll' && sitzung.laeuft_ab - Date.now() < sitzungDauerMs - 60 * 60 * 1000) {
      q.sitzungVerlaengern.run(Date.now() + sitzungDauerMs, tokenHash);
    }
    return { sitzung, benutzer, tokenHash };
  }

  const beendeSitzung = (token) => token && q.sitzungLoeschen.run(sha256(token));
  const beendeAlleSitzungen = (benutzerId) => q.alleSitzungenLoeschen.run(benutzerId);
  const beendeAndereSitzungen = (benutzerId, tokenHash) => q.andereSitzungenLoeschen.run(benutzerId, tokenHash);
  const raeumeAuf = () => q.abgelaufeneLoeschen.run(Date.now()).changes;

  // ── Zwei-Faktor-Authentifizierung ─────────────────────────
  function totpGeheimnis(benutzer) {
    return benutzer.totp_geheimnis ? entschluessele(benutzer.totp_geheimnis, schluessel) : null;
  }

  async function starteTotpEinrichtung(benutzer) {
    if (benutzer.totp_aktiv) throw new KontoFehler('Die Zwei-Faktor-Anmeldung ist bereits aktiv.');
    const geheimnis = erzeugeTotpGeheimnis();
    db.prepare('UPDATE benutzer SET totp_geheimnis = ?, totp_letzter_schritt = NULL WHERE id = ?')
      .run(verschluessele(geheimnis, schluessel), benutzer.id);
    const label = `${encodeURIComponent(appName)}:${encodeURIComponent(benutzer.benutzername)}`;
    const otpauthUrl = `otpauth://totp/${label}?secret=${geheimnis}&issuer=${encodeURIComponent(appName)}&algorithm=SHA1&digits=6&period=30`;
    const qrSvg = await QRCode.toString(otpauthUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { geheimnis, otpauthUrl, qrSvg };
  }

  function neueWiederherstellungscodes(benutzerId) {
    const codes = erzeugeWiederherstellungscodes();
    db.prepare('UPDATE benutzer SET wiederherstellungscodes = ? WHERE id = ?')
      .run(JSON.stringify(codes.map((c) => sha256(normalisiereWiederherstellungscode(c)))), benutzerId);
    return codes;
  }

  function bestaetigeTotpEinrichtung(benutzer, code) {
    if (benutzer.totp_aktiv) throw new KontoFehler('Die Zwei-Faktor-Anmeldung ist bereits aktiv.');
    const geheimnis = totpGeheimnis(benutzer);
    if (!geheimnis) throw new KontoFehler('Bitte die Einrichtung zuerst starten.');
    const schritt = pruefeTotp(geheimnis, code);
    if (schritt === null) throw new ValidierungsFehler({ code: 'Der Code ist falsch oder abgelaufen. Bitte den aktuellen Code aus der App eingeben.' });
    db.prepare('UPDATE benutzer SET totp_aktiv = 1, totp_letzter_schritt = ? WHERE id = ?').run(schritt, benutzer.id);
    return neueWiederherstellungscodes(benutzer.id);
  }

  /** Prüft einen TOTP-Code oder einen einmaligen Wiederherstellungscode. */
  function pruefeZweitenFaktor(benutzer, { code, wiederherstellungscode }) {
    if (wiederherstellungscode) {
      const hash = sha256(normalisiereWiederherstellungscode(wiederherstellungscode));
      const liste = JSON.parse(benutzer.wiederherstellungscodes || '[]');
      if (!liste.includes(hash)) return false;
      db.prepare('UPDATE benutzer SET wiederherstellungscodes = ? WHERE id = ?')
        .run(JSON.stringify(liste.filter((h) => h !== hash)), benutzer.id);
      return true;
    }
    const geheimnis = totpGeheimnis(benutzer);
    if (!geheimnis) return false;
    const schritt = pruefeTotp(geheimnis, code, benutzer.totp_letzter_schritt);
    if (schritt === null) return false;
    db.prepare('UPDATE benutzer SET totp_letzter_schritt = ? WHERE id = ?').run(schritt, benutzer.id);
    return true;
  }

  function deaktiviereTotp(benutzerId) {
    db.prepare(`UPDATE benutzer SET totp_aktiv = 0, totp_geheimnis = NULL, totp_letzter_schritt = NULL,
                wiederherstellungscodes = NULL WHERE id = ?`).run(benutzerId);
  }

  const anzahlWiederherstellungscodes = (benutzer) => JSON.parse(benutzer.wiederherstellungscodes || '[]').length;

  async function aenderePasswort(benutzerId, neuesPasswort) {
    pruefeNeuesPasswort(neuesPasswort, 'neuesPasswort');
    db.prepare('UPDATE benutzer SET passwort_hash = ? WHERE id = ?').run(await hashePasswort(neuesPasswort), benutzerId);
  }

  return {
    istErsteinrichtung, registriere, pruefeZugangsdaten, erstelleSitzung, leseSitzung, beendeSitzung,
    beendeAlleSitzungen, beendeAndereSitzungen, raeumeAuf, starteTotpEinrichtung, bestaetigeTotpEinrichtung,
    pruefeZweitenFaktor, deaktiviereTotp, neueWiederherstellungscodes, anzahlWiederherstellungscodes,
    aenderePasswort, holeBenutzer: (id) => q.perId.get(id),
  };
}
