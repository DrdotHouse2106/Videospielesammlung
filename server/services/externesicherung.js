// Externe Sicherung: verschlüsselte Kopien der Datenbank (und optional der Uploads) bei einem frei wählbaren Anbieter.
//
// Ziele:
// - S3-kompatibel (AWS, Hetzner Object Storage, Backblaze B2, Wasabi, IONOS, Cloudflare R2, eigener MinIO …)
// - WebDAV (Nextcloud, Hetzner Storage Box, Synology/QNAP-NAS, viele Cloud-Speicher)
// - SFTP (Hetzner Storage Box, NAS, eigener Server)
//
// Verschlüsselung: AES-256-GCM, Schlüssel per scrypt aus dem Sicherungs-Passwort. Der Anbieter sieht nur
// verschlüsselte Dateien. Ohne das Passwort ist keine Wiederherstellung möglich – es gehört an einen sicheren Ort
// außerhalb des Servers (Passwort-Manager). Entschlüsseln: `node scripts/sicherung-entschluesseln.js`.
//
// Aufbewahrung beim Anbieter: tägliche Stände (BACKUP_REMOTE_DAYS) und monatliche Stände (BACKUP_REMOTE_MONTHS,
// 0 = unbegrenzt). Uploads werden einzeln und nur einmal übertragen (neue Dateien).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ── Verschlüsselung ─────────────────────────────────────────────
const MAGIC = Buffer.from('ZDBK');
const VERSION = 1;
const KOPF = MAGIC.length + 1 + 16 + 12; // Magic, Version, Salt, IV
const TAG = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const ENDUNG = '.zdbk';

const schluesselCache = new Map();
function schluessel(passwort, salt) {
  const id = `${salt.toString('hex')}:${crypto.createHash('sha256').update(passwort).digest('hex')}`;
  if (!schluesselCache.has(id)) {
    if (schluesselCache.size > 20) schluesselCache.clear();
    schluesselCache.set(id, crypto.scryptSync(passwort, salt, 32, SCRYPT));
  }
  return schluesselCache.get(id);
}

/** Verschlüsselt eine Datei (Streaming). Liefert die Größe der verschlüsselten Datei. */
export async function verschluesseleDatei(quelle, ziel, passwort, salt = crypto.randomBytes(16)) {
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv('aes-256-gcm', schluessel(passwort, salt), iv);
  const aus = fs.createWriteStream(ziel, { mode: 0o600 });
  aus.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]));
  await pipeline(fs.createReadStream(quelle), chiffre, aus, { end: false });
  await new Promise((resolve, reject) => aus.end(chiffre.getAuthTag(), (e) => (e ? reject(e) : resolve())));
  return fs.statSync(ziel).size;
}

/** Entschlüsselt eine Datei; wirft bei falschem Passwort oder beschädigter Datei. */
export async function entschluesseleDatei(quelle, ziel, passwort) {
  const groesse = fs.statSync(quelle).size;
  if (groesse < KOPF + TAG) throw new Error('Datei ist zu kurz – keine ZockDB-Sicherung.');
  const fd = fs.openSync(quelle, 'r');
  const kopf = Buffer.alloc(KOPF);
  const tag = Buffer.alloc(TAG);
  fs.readSync(fd, kopf, 0, KOPF, 0);
  fs.readSync(fd, tag, 0, TAG, groesse - TAG);
  fs.closeSync(fd);
  if (!kopf.subarray(0, 4).equals(MAGIC) || kopf[4] !== VERSION) throw new Error('Unbekanntes Dateiformat – keine ZockDB-Sicherung.');
  const entschl = crypto.createDecipheriv('aes-256-gcm', schluessel(passwort, kopf.subarray(5, 21)), kopf.subarray(21, KOPF));
  entschl.setAuthTag(tag);
  const temp = `${ziel}.tmp`;
  try {
    await pipeline(fs.createReadStream(quelle, { start: KOPF, end: groesse - TAG - 1 }), entschl, fs.createWriteStream(temp, { mode: 0o600 }));
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw new Error(/auth/i.test(e.message) ? 'Falsches Passwort oder beschädigte Datei.' : e.message);
  }
  fs.renameSync(temp, ziel);
}

// ── S3 (Signatur Version 4) ─────────────────────────────────────
const sha256 = (daten) => crypto.createHash('sha256').update(daten).digest('hex');
const hmac = (schl, daten) => crypto.createHmac('sha256', schl).update(daten).digest();
const kodiere = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signiert eine S3-Anfrage (AWS Signature Version 4). Liefert die zu setzenden Header. */
export function signiereS3({ methode, url, region, zugang, geheimnis, headers = {}, payloadHash = 'UNSIGNED-PAYLOAD', jetzt = new Date() }) {
  const u = new URL(url);
  const amzDatum = jetzt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const tag = amzDatum.slice(0, 8);
  const alle = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host: u.host, 'x-amz-date': amzDatum, 'x-amz-content-sha256': payloadHash };
  const namen = Object.keys(alle).filter((n) => n !== 'content-length').sort();
  const abfrage = [...u.searchParams.entries()].map(([k, v]) => [kodiere(k), kodiere(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const kanonisch = [methode, u.pathname || '/', abfrage, namen.map((n) => `${n}:${alle[n]}\n`).join(''), namen.join(';'), payloadHash].join('\n');
  const bereich = `${tag}/${region}/s3/aws4_request`;
  const zuSignieren = ['AWS4-HMAC-SHA256', amzDatum, bereich, sha256(kanonisch)].join('\n');
  const k = hmac(hmac(hmac(hmac(`AWS4${geheimnis}`, tag), region), 's3'), 'aws4_request');
  const signatur = crypto.createHmac('sha256', k).update(zuSignieren).digest('hex');
  return { ...alle, authorization: `AWS4-HMAC-SHA256 Credential=${zugang}/${bereich}, SignedHeaders=${namen.join(';')}, Signature=${signatur}` };
}

function s3Ziel(z, fetchFn) {
  const basis = z.url.replace(/\/+$/, '');
  const objektUrl = (name) => `${basis}/${kodiere(z.bucket)}/${name.split('/').map(kodiere).join('/')}`;
  const anfrage = async (methode, url, { body, laenge, leer = true } = {}) => {
    const headers = signiereS3({
      methode, url, region: z.region || 'us-east-1', zugang: z.benutzer, geheimnis: z.geheimnis,
      payloadHash: body ? 'UNSIGNED-PAYLOAD' : sha256(''), headers: laenge !== undefined ? { 'content-length': laenge } : {},
    });
    const antwort = await fetchFn(url, { method: methode, headers, body, ...(body ? { duplex: 'half' } : {}) });
    if (!antwort.ok && !(methode === 'DELETE' && antwort.status === 404)) {
      const text = await antwort.text().catch(() => '');
      const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
      throw new Error(`S3 ${methode} ${antwort.status}${code ? ` (${code})` : ''}`);
    }
    return leer ? null : antwort.text();
  };
  return {
    async hochladen(name, datei, groesse) {
      await anfrage('PUT', objektUrl(name), { body: Readable.toWeb(fs.createReadStream(datei)), laenge: groesse });
    },
    async liste(praefix) {
      const namen = [];
      let token = null;
      do {
        const u = new URL(`${basis}/${kodiere(z.bucket)}`);
        u.searchParams.set('list-type', '2');
        u.searchParams.set('prefix', praefix);
        if (token) u.searchParams.set('continuation-token', token);
        const xml = await anfrage('GET', u.toString(), { leer: false });
        for (const [, k] of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) namen.push(k.replace(/&amp;/g, '&'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)</)?.[1] : null;
      } while (token);
      return namen.map((n) => n.slice(praefix.length)).filter((n) => n && !n.includes('/'));
    },
    loeschen: (name) => anfrage('DELETE', objektUrl(name)),
  };
}

// ── WebDAV ──────────────────────────────────────────────────────
function webdavZiel(z, fetchFn) {
  const basis = z.url.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${z.benutzer}:${z.geheimnis}`).toString('base64')}`;
  const url = (name) => `${basis}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const vorhandeneOrdner = new Set();
  async function anfrage(methode, ziel, { headers = {}, body, erlaubt = [] } = {}) {
    const antwort = await fetchFn(ziel, { method: methode, headers: { Authorization: auth, ...headers }, body, ...(body ? { duplex: 'half' } : {}) });
    if (!antwort.ok && !erlaubt.includes(antwort.status)) throw new Error(`WebDAV ${methode} ${antwort.status}`);
    return antwort;
  }
  async function ordner(name) {
    const teile = name.split('/').slice(0, -1);
    for (let i = 1; i <= teile.length; i += 1) {
      const pfad = teile.slice(0, i).join('/');
      if (vorhandeneOrdner.has(pfad)) continue;
      await anfrage('MKCOL', `${url(pfad)}/`, { erlaubt: [405, 301] }); // 405 = existiert bereits
      vorhandeneOrdner.add(pfad);
    }
  }
  return {
    async hochladen(name, datei, groesse) {
      await ordner(name);
      await anfrage('PUT', url(name), { headers: { 'Content-Length': String(groesse) }, body: Readable.toWeb(fs.createReadStream(datei)) });
    },
    async liste(praefix) {
      const antwort = await anfrage('PROPFIND', `${url(praefix.replace(/\/$/, ''))}/`, { headers: { Depth: '1' }, erlaubt: [404] });
      if (antwort.status === 404) return [];
      const xml = await antwort.text();
      return [...xml.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/gi)]
        .map(([, h]) => decodeURIComponent(h.trim()).replace(/\/+$/, '').split('/').pop())
        .filter((n) => n && n.endsWith(ENDUNG));
    },
    loeschen: (name) => anfrage('DELETE', url(name), { erlaubt: [404] }).then(() => {}),
  };
}

// ── SFTP ────────────────────────────────────────────────────────
function sftpZiel(z, { pinneHostschluessel }) {
  const u = new URL(/^sftp:\/\//i.test(z.url) ? z.url : `sftp://${z.url}`);
  const wurzel = decodeURIComponent(u.pathname || '').replace(/\/+$/, '');
  const voll = (name) => (wurzel ? `${wurzel}/${name}` : name);
  async function mitVerbindung(fn) {
    const { Client } = (await import('ssh2')).default;
    const client = new Client();
    let hostFehler = null;
    const sitzung = await new Promise((resolve, reject) => {
      client.on('ready', () => client.sftp((e, sftp) => (e ? reject(e) : resolve(sftp))));
      client.on('error', (e) => reject(hostFehler ?? e));
      client.connect({
        host: u.hostname, port: Number(u.port) || 22, username: z.benutzer || decodeURIComponent(u.username), password: z.geheimnis,
        readyTimeout: 20_000,
        hostVerifier: (schl) => {
          const fingerabdruck = `SHA256:${crypto.createHash('sha256').update(schl).digest('base64').replace(/=+$/, '')}`;
          const ok = pinneHostschluessel(fingerabdruck);
          if (!ok) hostFehler = new Error(`Unerwarteter Host-Schlüssel ${fingerabdruck} – Server geändert oder Angriff? In den Einstellungen prüfen.`);
          return ok;
        },
      });
    });
    const p = (methode, ...args) => new Promise((resolve, reject) => sitzung[methode](...args, (e, r) => (e ? reject(e) : resolve(r))));
    try {
      return await fn(p);
    } finally {
      client.end();
    }
  }
  const ordner = async (p, name) => {
    const teile = voll(name).split('/').slice(0, -1);
    for (let i = 1; i <= teile.length; i += 1) {
      const pfad = teile.slice(0, i).join('/');
      if (!pfad) continue;
      await p('mkdir', pfad).catch(() => {}); // existiert bereits
    }
  };
  return {
    mitVerbindung,
    hochladen: (name, datei) => mitVerbindung(async (p) => { await ordner(p, name); await p('fastPut', datei, voll(name)); }),
    liste: (praefix) => mitVerbindung(async (p) => (await p('readdir', voll(praefix.replace(/\/$/, ''))).catch(() => []))
      .map((e) => e.filename).filter((n) => n.endsWith(ENDUNG))),
    loeschen: (name) => mitVerbindung((p) => p('unlink', voll(name)).catch(() => {})),
  };
}

// ── Dienst ──────────────────────────────────────────────────────
const heute = () => new Date().toISOString().slice(0, 10);

export function erstelleExterneSicherung(db, konfiguration, { sicherung, benachrichtigungen, fetchFn = fetch } = {}) {
  const lies = (s) => db.prepare('SELECT wert FROM system_werte WHERE schluessel = ?').get(s)?.wert ?? null;
  const schreibe = (s, w) => db.prepare('INSERT INTO system_werte (schluessel, wert) VALUES (?, ?) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert').run(s, w);
  const k = () => konfiguration.sicherung?.extern ?? {};
  let laeuft = false;

  const eingerichtet = () => Boolean(k().ziel && k().ziel !== 'aus' && k().url && k().passwort);
  const pruefePasswort = () => {
    if ((k().passwort || '').length < 12) throw new Error('Das Sicherungs-Passwort muss mindestens 12 Zeichen lang sein.');
  };
  const praefix = () => (k().pfad || 'zockdb').replace(/^\/+|\/+$/g, '');

  function pinneHostschluessel(fingerabdruck) {
    const erwartet = (k().hostschluessel || '').trim() || lies('sftp_hostschluessel');
    if (!erwartet) { schreibe('sftp_hostschluessel', fingerabdruck); return true; } // beim ersten Kontakt merken
    return erwartet === fingerabdruck;
  }

  function ziel() {
    const z = k();
    if (z.ziel === 's3') {
      if (!z.bucket) throw new Error('Bitte den Bucket angeben.');
      return s3Ziel(z, fetchFn);
    }
    if (z.ziel === 'webdav') return webdavZiel(z, fetchFn);
    if (z.ziel === 'sftp') return sftpZiel(z, { pinneHostschluessel });
    throw new Error('Kein Ziel für die externe Sicherung eingerichtet.');
  }

  let tempBasis = null;
  const tempOrdner = () => {
    tempBasis ??= konfiguration.datenbankPfad && konfiguration.datenbankPfad !== ':memory:'
      ? path.join(path.dirname(konfiguration.datenbankPfad), 'sicherungen', 'tmp')
      : path.join(konfiguration.uploadVerzeichnis || process.env.TMPDIR || '/tmp', '.sicherung-tmp');
    fs.mkdirSync(tempBasis, { recursive: true });
    return tempBasis;
  };

  async function uebertrage(z, name, quelle, salt) {
    const temp = path.join(tempOrdner(), `${crypto.randomUUID()}${ENDUNG}`);
    try {
      const groesse = await verschluesseleDatei(quelle, temp, k().passwort, salt);
      await z.hochladen(name, temp, groesse);
      return groesse;
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  async function aufraeumen(z, art, behalten) {
    if (!(behalten > 0)) return 0;
    const namen = (await z.liste(`${praefix()}/datenbank/${art}/`)).sort().reverse();
    for (const alt of namen.slice(behalten)) await z.loeschen(`${praefix()}/datenbank/${art}/${alt}`);
    return Math.max(0, namen.length - behalten);
  }

  function meldeFehler(text) {
    if (lies('fehler_gemeldet_am') === heute()) return;
    schreibe('fehler_gemeldet_am', heute());
    for (const { id } of db.prepare("SELECT id FROM benutzer WHERE rolle = 'admin' AND gesperrt = 0").all()) {
      benachrichtigungen?.sende(id, { art: 'system', titel: 'Externe Sicherung fehlgeschlagen', text, link: '#/admin?reiter=sicherungen' });
    }
  }

  /** Überträgt die heutige Datenbank-Sicherung (und neue Uploads). `erzwingen` überträgt die Datenbank auch erneut. */
  async function lauf({ erzwingen = false } = {}) {
    if (!eingerichtet() || laeuft) return status();
    if (!erzwingen && lies('letzter_erfolg')?.slice(0, 10) === heute()) return status();
    laeuft = true;
    schreibe('letzter_versuch', new Date().toISOString());
    const ergebnis = { datenbank: null, uploads: 0, geloescht: 0 };
    let lokal = null;
    let lokalTemp = false;
    try {
      pruefePasswort();
      const z = ziel();
      const salt = crypto.randomBytes(16); // ein Schlüssel je Lauf – spart Rechenzeit bei vielen Uploads
      // Datenbank: vorhandene Tagessicherung nutzen, sonst eine frische Kopie ziehen
      const tagesDatei = sicherung?.liste?.().taeglich?.[0];
      const verzeichnis = sicherung?.status?.().verzeichnis;
      if (!erzwingen && tagesDatei?.name === `zockdb-${heute()}.db` && verzeichnis) {
        lokal = path.join(verzeichnis, 'taeglich', tagesDatei.name);
      } else {
        lokal = path.join(tempOrdner(), `zockdb-${crypto.randomUUID()}.db`);
        lokalTemp = true;
        await db.backup(lokal);
      }
      const name = `${praefix()}/datenbank/taeglich/zockdb-${heute()}.db${ENDUNG}`;
      ergebnis.datenbank = { name, groesse: await uebertrage(z, name, lokal, salt) };
      // Monatlicher Stand (einmal je Monat)
      const monat = heute().slice(0, 7);
      if (lies('letzter_monat') !== monat) {
        await uebertrage(z, `${praefix()}/datenbank/monatlich/zockdb-${monat}.db${ENDUNG}`, lokal, salt);
        schreibe('letzter_monat', monat);
      }
      // Schlüssel für 2FA-Geheimnisse und gespeicherte Zugangsdaten (ohne ihn sind diese nach einer Wiederherstellung unbrauchbar)
      const schluesselDatei = konfiguration.datenbankPfad && konfiguration.datenbankPfad !== ':memory:'
        ? path.join(path.dirname(konfiguration.datenbankPfad), 'geheimnis.key') : null;
      if (schluesselDatei && fs.existsSync(schluesselDatei)) {
        await uebertrage(z, `${praefix()}/schluessel/geheimnis.key${ENDUNG}`, schluesselDatei, salt);
      }
      ergebnis.geloescht += await aufraeumen(z, 'taeglich', k().tage ?? 14);
      ergebnis.geloescht += await aufraeumen(z, 'monatlich', k().monate ?? 0);

      // Uploads: nur neue Dateien übertragen
      if (k().uploads !== false && konfiguration.uploadVerzeichnis && fs.existsSync(konfiguration.uploadVerzeichnis)) {
        const bekannt = db.prepare('SELECT groesse FROM extern_gesichert WHERE datei = ?');
        const merken = db.prepare('INSERT INTO extern_gesichert (datei, groesse) VALUES (?, ?) ON CONFLICT (datei) DO UPDATE SET groesse = excluded.groesse, gesichert_am = datetime(\'now\')');
        for (const datei of fs.readdirSync(konfiguration.uploadVerzeichnis)) {
          if (datei.startsWith('tmp-') || datei.startsWith('.')) continue;
          const voll = path.join(konfiguration.uploadVerzeichnis, datei);
          const st = fs.statSync(voll);
          if (!st.isFile() || bekannt.get(datei)?.groesse === st.size) continue;
          await uebertrage(z, `${praefix()}/uploads/${datei}${ENDUNG}`, voll, salt);
          merken.run(datei, st.size);
          ergebnis.uploads += 1;
        }
      }
      schreibe('letzter_erfolg', new Date().toISOString());
      schreibe('letzter_fehler', '');
      schreibe('letztes_ergebnis', JSON.stringify(ergebnis));
    } catch (fehler) {
      const text = String(fehler.message || fehler).slice(0, 500);
      schreibe('letzter_fehler', text);
      console.warn('[externe sicherung]', text);
      meldeFehler(text);
    } finally {
      if (lokalTemp && lokal) fs.rmSync(lokal, { force: true });
      laeuft = false;
    }
    return status();
  }

  /** Prüft Zugang und Schreibrechte mit einer kleinen Testdatei. */
  async function teste() {
    if (!eingerichtet()) throw new Error('Bitte Ziel, Adresse und Sicherungs-Passwort in den Einstellungen eintragen.');
    pruefePasswort();
    const z = ziel();
    const temp = path.join(tempOrdner(), `test-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(temp, `ZockDB Verbindungstest ${new Date().toISOString()}\n`);
    const name = `${praefix()}/test/verbindungstest${ENDUNG}`;
    try {
      await uebertrage(z, name, temp);
      const liste = await z.liste(`${praefix()}/test/`);
      if (!liste.includes(`verbindungstest${ENDUNG}`)) throw new Error('Testdatei wurde hochgeladen, ist aber in der Liste nicht zu finden.');
      await z.loeschen(name);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return { ok: true };
  }

  function status() {
    const erfolg = lies('letzter_erfolg');
    const stunden = erfolg ? (Date.now() - Date.parse(erfolg)) / 3_600_000 : null;
    let ergebnis = null;
    try { ergebnis = JSON.parse(lies('letztes_ergebnis') || 'null'); } catch { /* leer */ }
    return {
      eingerichtet: eingerichtet(),
      ziel: k().ziel || 'aus',
      pfad: praefix(),
      tage: k().tage ?? 14,
      monate: k().monate ?? 0,
      uploads: k().uploads !== false,
      laeuft,
      letzter_erfolg: erfolg,
      letzter_versuch: lies('letzter_versuch'),
      letzter_fehler: lies('letzter_fehler') || null,
      ergebnis,
      uploads_gesichert: db.prepare('SELECT COUNT(*) AS n FROM extern_gesichert').get().n,
      hostschluessel: k().ziel === 'sftp' ? ((k().hostschluessel || '').trim() || lies('sftp_hostschluessel')) : null,
      // Warnung, wenn eingerichtet, aber seit über 48 Stunden keine erfolgreiche Übertragung
      veraltet: eingerichtet() && (stunden === null || stunden > 48),
    };
  }

  return { lauf, teste, status, eingerichtet };
}
