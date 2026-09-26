// Web-Push-Benachrichtigungen aufs Handy bzw. an den Desktop-Browser – ohne externe Bibliothek.
//
// - Verschlüsselung der Nachricht nach RFC 8291 (aes128gcm), Absender-Kennung per VAPID (RFC 8292, ES256).
// - Das VAPID-Schlüsselpaar wird beim ersten Start erzeugt und verschlüsselt in der Datenbank abgelegt.
// - Push-Adressen stammen vom Browser des Benutzers; abgerufen wird nur per https und nie im internen Netz (SSRF-Schutz).
// - Abgelaufene Abos (404/410 vom Push-Dienst) werden automatisch entfernt.
// - Auf dem iPhone funktioniert Web-Push nur, wenn ZockDB zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4).
import crypto from 'node:crypto';
import { verschluessele, entschluessele } from './sicherheit.js';
import { geprueftesHttps } from './sichererabruf.js';
import { istInterneAdresse } from './anbindungen.js';

const b64u = (puffer) => Buffer.from(puffer).toString('base64url');
const vonB64u = (text) => Buffer.from(String(text), 'base64url');

/** Verschlüsselt `nutzlast` für ein Push-Abo (RFC 8291). Liefert den Body für den Push-Dienst. */
export function verschluesselePush(nutzlast, { p256dh, auth }, { salt = crypto.randomBytes(16) } = {}) {
  const uaOeffentlich = vonB64u(p256dh);
  const authGeheimnis = vonB64u(auth);
  if (uaOeffentlich.length !== 65 || authGeheimnis.length !== 16) throw new Error('Ungültige Push-Schlüssel.');
  const absender = crypto.createECDH('prime256v1'); // neues Schlüsselpaar je Nachricht
  absender.generateKeys();
  const asOeffentlich = absender.getPublicKey();
  const ecdhGeheimnis = absender.computeSecret(uaOeffentlich);
  const schluesselInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaOeffentlich, asOeffentlich]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhGeheimnis, authGeheimnis, schluesselInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const chiffre = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const klar = Buffer.concat([Buffer.from(nutzlast), Buffer.from([2])]); // 0x02 = letzter Datensatz
  const geheim = Buffer.concat([chiffre.update(klar), chiffre.final(), chiffre.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asOeffentlich.length]), asOeffentlich, geheim]);
}

/** VAPID-Header (RFC 8292) für einen Push-Endpunkt. */
export function vapidHeader(endpunkt, { privat, oeffentlich }, kontakt, jetzt = Date.now()) {
  const kopf = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const inhalt = b64u(JSON.stringify({ aud: new URL(endpunkt).origin, exp: Math.floor(jetzt / 1000) + 12 * 3600, sub: kontakt }));
  const signatur = crypto.sign('sha256', Buffer.from(`${kopf}.${inhalt}`), { key: privat, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${kopf}.${inhalt}.${b64u(signatur)}, k=${oeffentlich}`;
}

export function erstellePushDienst(db, { konfiguration, schluessel }) {
  // In Tests über konfiguration.pushFetchFn ersetzbar – sonst immer der SSRF-geschützte Abruf
  const senden = (url, optionen) => (konfiguration.pushFetchFn ?? ((u, o) => geprueftesHttps(u, o, istInterneAdresse)))(url, optionen);
  const q = {
    lies: db.prepare('SELECT wert FROM system_werte WHERE schluessel = ?'),
    schreibe: db.prepare('INSERT INTO system_werte (schluessel, wert) VALUES (?, ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert'),
    abos: db.prepare('SELECT * FROM push_abos WHERE benutzer_id = ?'),
    loeschen: db.prepare('DELETE FROM push_abos WHERE id = ?'),
  };

  let vapid = null;
  function schluesselpaar() {
    if (vapid) return vapid;
    let jwk = null;
    const gespeichert = q.lies.get('vapid_privat')?.wert;
    if (gespeichert) {
      try { jwk = JSON.parse(entschluessele(gespeichert, schluessel)); } catch { jwk = null; }
    }
    if (!jwk) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      jwk = privateKey.export({ format: 'jwk' });
      q.schreibe.run('vapid_privat', verschluessele(JSON.stringify(jwk), schluessel));
    }
    const privat = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
    const oeffentlich = b64u(Buffer.concat([Buffer.from([4]), vonB64u(jwk.x), vonB64u(jwk.y)]));
    vapid = { privat, oeffentlich };
    return vapid;
  }

  const kontakt = () => (konfiguration.mail?.absender ? `mailto:${String(konfiguration.mail.absender).replace(/^.*<([^>]+)>.*$/, '$1')}`
    : konfiguration.oeffentlicheUrl || 'mailto:admin@localhost');

  function pruefeAbo(abo) {
    const endpunkt = String(abo?.endpoint ?? '');
    if (!/^https:\/\/[^\s]+$/.test(endpunkt) || endpunkt.length > 1000) throw new Error('Ungültige Push-Adresse.');
    const p256dh = String(abo?.keys?.p256dh ?? '');
    const auth = String(abo?.keys?.auth ?? '');
    if (vonB64u(p256dh).length !== 65 || vonB64u(auth).length !== 16) throw new Error('Ungültige Push-Schlüssel.');
    return { endpunkt, p256dh, auth };
  }

  /** Abo eines Geräts speichern (ein Endpunkt gehört immer genau einem Benutzer). */
  function abonniere(benutzerId, abo, geraet = null) {
    const { endpunkt, p256dh, auth } = pruefeAbo(abo);
    db.prepare(`INSERT INTO push_abos (benutzer_id, endpoint, p256dh, auth, geraet) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET benutzer_id = excluded.benutzer_id, p256dh = excluded.p256dh, auth = excluded.auth,
        geraet = excluded.geraet, fehler = 0`).run(benutzerId, endpunkt, p256dh, auth, geraet ? String(geraet).slice(0, 100) : null);
    // Höchstens 10 Geräte je Benutzer – die ältesten fallen weg
    db.prepare(`DELETE FROM push_abos WHERE benutzer_id = ? AND id NOT IN (SELECT id FROM push_abos WHERE benutzer_id = ? ORDER BY id DESC LIMIT 10)`)
      .run(benutzerId, benutzerId);
  }

  const kuendige = (benutzerId, endpunkt) => db.prepare('DELETE FROM push_abos WHERE benutzer_id = ? AND endpoint = ?').run(benutzerId, String(endpunkt ?? '')).changes;
  const geraete = (benutzerId) => q.abos.all(benutzerId).map((a) => ({ id: a.id, geraet: a.geraet, erstellt_am: a.erstellt_am, endpoint: a.endpoint }));

  /** Sendet an alle Geräte eines Benutzers. Fehler werden protokolliert, nie geworfen. */
  async function sende(benutzerId, { titel, text = null, link = null, tag = null }) {
    const abos = q.abos.all(benutzerId);
    if (!abos.length) return 0;
    const { privat, oeffentlich } = schluesselpaar();
    const nutzlast = JSON.stringify({ titel: String(titel).slice(0, 120), text: text ? String(text).slice(0, 300) : null, link, tag });
    let ok = 0;
    await Promise.all(abos.map(async (abo) => {
      try {
        const body = verschluesselePush(nutzlast, abo);
        const antwort = await senden(abo.endpoint, {
          method: 'POST',
          headers: {
            TTL: '86400', Urgency: 'normal', 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm',
            'Content-Length': String(body.length), Authorization: vapidHeader(abo.endpoint, { privat, oeffentlich }, kontakt()),
          },
          body,
        });
        if (antwort.status === 404 || antwort.status === 410) { q.loeschen.run(abo.id); return; } // Abo existiert nicht mehr
        if (!antwort.ok) {
          db.prepare('UPDATE push_abos SET fehler = fehler + 1 WHERE id = ?').run(abo.id);
          db.prepare('DELETE FROM push_abos WHERE id = ? AND fehler >= 20').run(abo.id);
          console.warn('[push]', antwort.status);
          return;
        }
        db.prepare("UPDATE push_abos SET fehler = 0, zuletzt_am = datetime('now') WHERE id = ?").run(abo.id);
        ok += 1;
      } catch (e) {
        console.warn('[push]', e.message);
      }
    }));
    return ok;
  }

  return {
    oeffentlicherSchluessel: () => schluesselpaar().oeffentlich,
    abonniere, kuendige, geraete, sende,
  };
}
