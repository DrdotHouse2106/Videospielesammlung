import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { starteTestServer } from './hilfen.js';
import { verschluesseleDatei, entschluesseleDatei, signiereS3 } from '../server/services/externesicherung.js';

const PASSWORT = 'ein-langes-sicherungs-passwort';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zockdb-extern-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Minimaler S3-Server im Arbeitsspeicher – prüft die Signatur jeder Anfrage. */
function fakeS3({ zugang, geheimnis }) {
  const objekte = new Map();
  const server = http.createServer((req, res) => {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      const url = `http://${req.headers.host}${req.url}`;
      const d = req.headers['x-amz-date'];
      const jetzt = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
      const erwartet = signiereS3({ methode: req.method, url, region: 'eu-test-1', zugang, geheimnis, payloadHash: req.headers['x-amz-content-sha256'], jetzt });
      if (erwartet.authorization !== req.headers.authorization) { res.writeHead(403); res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>'); return; }
      const u = new URL(url);
      const [, bucket, ...rest] = u.pathname.split('/');
      const schl = rest.map(decodeURIComponent).join('/');
      if (req.method === 'PUT') { objekte.set(schl, Buffer.concat(teile)); res.end(); return; }
      if (req.method === 'DELETE') { objekte.delete(schl); res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && !schl && bucket === 'sicherung') {
        const praefix = u.searchParams.get('prefix') || '';
        const keys = [...objekte.keys()].filter((k) => k.startsWith(praefix)).sort();
        res.end(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objekte, url: `http://127.0.0.1:${server.address().port}` })));
}

/** Minimaler WebDAV-Server im Arbeitsspeicher. */
function fakeWebDav({ benutzer, passwort }) {
  const dateien = new Map();
  const ordner = new Set(['']);
  const server = http.createServer((req, res) => {
    const teile = [];
    req.on('data', (c) => teile.push(c));
    req.on('end', () => {
      if (req.headers.authorization !== `Basic ${Buffer.from(`${benutzer}:${passwort}`).toString('base64')}`) { res.writeHead(401); res.end(); return; }
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/dav\/?/, '').replace(/\/$/, '');
      const elternOk = ordner.has(p.split('/').slice(0, -1).join('/'));
      if (req.method === 'MKCOL') { if (ordner.has(p)) { res.writeHead(405); } else if (!elternOk) { res.writeHead(409); } else { ordner.add(p); res.writeHead(201); } res.end(); return; }
      if (req.method === 'PUT') { if (!elternOk) { res.writeHead(409); res.end(); return; } dateien.set(p, Buffer.concat(teile)); res.writeHead(201); res.end(); return; }
      if (req.method === 'DELETE') { dateien.delete(p); res.writeHead(204); res.end(); return; }
      if (req.method === 'PROPFIND') {
        if (!ordner.has(p)) { res.writeHead(404); res.end(); return; }
        const kinder = [...dateien.keys()].filter((k) => k.split('/').slice(0, -1).join('/') === p);
        res.writeHead(207);
        res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/${p}/</d:href></d:response>${
          kinder.map((k) => `<d:response><d:href>/dav/${k.split('/').map(encodeURIComponent).join('/')}</d:href></d:response>`).join('')}</d:multistatus>`);
        return;
      }
      res.writeHead(405); res.end();
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, dateien, url: `http://127.0.0.1:${server.address().port}/dav` })));
}

test('Verschlüsselung: Rundreise, falsches Passwort und Manipulation', async () => {
  const klar = path.join(tmp, 'klar.bin');
  const inhalt = Buffer.concat([Buffer.from('ZockDB '), Buffer.alloc(300_000, 7)]);
  fs.writeFileSync(klar, inhalt);
  const enc = path.join(tmp, 'klar.bin.zdbk');
  await verschluesseleDatei(klar, enc, PASSWORT);
  const roh = fs.readFileSync(enc);
  assert.equal(roh.subarray(0, 4).toString(), 'ZDBK');
  assert.equal(roh.length, inhalt.length + 4 + 1 + 16 + 12 + 16);
  assert.ok(!roh.includes(Buffer.from('ZockDB ')), 'Inhalt ist nicht im Klartext enthalten');

  await entschluesseleDatei(enc, path.join(tmp, 'zurueck.bin'), PASSWORT);
  assert.ok(fs.readFileSync(path.join(tmp, 'zurueck.bin')).equals(inhalt));

  await assert.rejects(entschluesseleDatei(enc, path.join(tmp, 'x.bin'), 'falsches-passwort-123'), /Falsches Passwort/);
  roh[100] ^= 1;
  fs.writeFileSync(enc, roh);
  await assert.rejects(entschluesseleDatei(enc, path.join(tmp, 'x.bin'), PASSWORT), /Falsches Passwort oder beschädigte Datei/);
  assert.ok(!fs.existsSync(path.join(tmp, 'x.bin')), 'bei Fehler bleibt keine halbe Datei liegen');
});

test('S3-Signatur entspricht dem offiziellen AWS-Beispiel', () => {
  // Beispiel „GET Object“ aus der AWS-Dokumentation zu Signature Version 4
  const h = signiereS3({
    methode: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1',
    zugang: 'AKIAIOSFODNN7EXAMPLE', geheimnis: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    headers: { range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    jetzt: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

let s3;
let dav;
before(async () => {
  s3 = await fakeS3({ zugang: 'ZUGANG', geheimnis: 'GEHEIM' });
  dav = await fakeWebDav({ benutzer: 'u123', passwort: 'dav-passwort' });
});
after(() => { s3.server.close(); dav.server.close(); });

test('S3: Datenbank und Uploads verschlüsselt übertragen, Aufbewahrung, Wiederherstellung', async () => {
  const server = await starteTestServer({
    env: {
      BACKUP_REMOTE: 's3', BACKUP_REMOTE_URL: s3.url, BACKUP_REMOTE_BUCKET: 'sicherung', BACKUP_REMOTE_REGION: 'eu-test-1',
      BACKUP_REMOTE_USER: 'ZUGANG', BACKUP_REMOTE_SECRET: 'GEHEIM', BACKUP_REMOTE_PASSWORD: PASSWORT, BACKUP_REMOTE_DAYS: '2',
    },
  });
  try {
    const admin = await server.registriere('admin');
    const ben = await server.registriere('ben');
    assert.equal((await ben.api('/api/admin/sicherungen')).status, 403);
    fs.writeFileSync(path.join(server.kontext.konfiguration.uploadVerzeichnis, 'foto-1.webp'), Buffer.alloc(5000, 3));

    assert.equal((await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' })).status, 200);
    assert.ok(![...s3.objekte.keys()].some((k) => k.includes('/test/')), 'Testdatei wird wieder gelöscht');

    // Alte Tagesstände anlegen, die beim Lauf aufgeräumt werden
    for (const tag of ['2020-01-01', '2020-01-02']) s3.objekte.set(`zockdb/datenbank/taeglich/zockdb-${tag}.db.zdbk`, Buffer.from('alt'));
    const r = await admin.api('/api/admin/sicherungen/extern', { methode: 'POST' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.letzter_fehler, null);
    assert.equal(r.json.veraltet, false);
    assert.equal(r.json.ergebnis.uploads, 1);
    const heute = new Date().toISOString().slice(0, 10);
    const tagesName = `zockdb/datenbank/taeglich/zockdb-${heute}.db.zdbk`;
    assert.ok(s3.objekte.has(tagesName));
    assert.ok(s3.objekte.has(`zockdb/datenbank/monatlich/zockdb-${heute.slice(0, 7)}.db.zdbk`));
    assert.ok(s3.objekte.has('zockdb/uploads/foto-1.webp.zdbk'));
    const taeglich = [...s3.objekte.keys()].filter((k) => k.includes('/taeglich/'));
    assert.deepEqual(taeglich.sort(), [`zockdb/datenbank/taeglich/zockdb-2020-01-02.db.zdbk`, tagesName].sort(), 'nur die letzten 2 Tage bleiben');

    // Zweiter Lauf: Upload wird nicht erneut übertragen
    const zweiter = (await admin.api('/api/admin/sicherungen/extern', { methode: 'POST' })).json;
    assert.equal(zweiter.ergebnis.uploads, 0);

    // Wiederherstellung: entschlüsselte Datei ist eine gültige Datenbank mit den Konten
    const enc = path.join(tmp, 'db.zdbk');
    fs.writeFileSync(enc, s3.objekte.get(tagesName));
    await entschluesseleDatei(enc, path.join(tmp, 'wieder.db'), PASSWORT);
    const wieder = new Database(path.join(tmp, 'wieder.db'), { readonly: true });
    assert.deepEqual(wieder.prepare('SELECT benutzername FROM benutzer ORDER BY id').all().map((b) => b.benutzername), ['admin', 'ben']);
    wieder.close();
    assert.ok(!s3.objekte.get(tagesName).includes(Buffer.from('SQLite format')), 'Anbieter sieht keine Klartext-Datenbank');
  } finally {
    await server.stoppe();
  }
});

test('WebDAV: Ordner werden angelegt, Fehler werden gemeldet', async () => {
  const server = await starteTestServer({
    env: { BACKUP_REMOTE: 'webdav', BACKUP_REMOTE_URL: dav.url, BACKUP_REMOTE_USER: 'u123', BACKUP_REMOTE_SECRET: 'dav-passwort', BACKUP_REMOTE_PASSWORD: PASSWORT, BACKUP_REMOTE_PATH: 'backup/zockdb' },
  });
  try {
    const admin = await server.registriere('admin');
    const r = await admin.api('/api/admin/sicherungen/extern', { methode: 'POST' });
    assert.equal(r.status, 200, r.text);
    const heute = new Date().toISOString().slice(0, 10);
    assert.ok(dav.dateien.has(`backup/zockdb/datenbank/taeglich/zockdb-${heute}.db.zdbk`));
    assert.equal((await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' })).status, 200);

    // Falsches Passwort beim Anbieter → Fehler, Status und Benachrichtigung an Admins
    server.kontext.konfiguration.sicherung.extern.geheimnis = 'falsch';
    const f = await admin.api('/api/admin/sicherungen/extern', { methode: 'POST' });
    assert.equal(f.status, 502);
    assert.match(f.json.fehler, /WebDAV .* 401/);
    const n = (await admin.api('/api/benachrichtigungen')).json.eintraege;
    assert.ok(n.some((b) => b.titel === 'Externe Sicherung fehlgeschlagen'));

    // Zu kurzes Sicherungs-Passwort wird abgelehnt
    server.kontext.konfiguration.sicherung.extern.passwort = 'kurz';
    assert.match((await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' })).json.fehler, /mindestens 12 Zeichen/);
  } finally {
    await server.stoppe();
  }
});

test('Ohne Einrichtung: klare Meldung, kein Lauf', async () => {
  const server = await starteTestServer();
  try {
    const admin = await server.registriere('admin');
    const s = (await admin.api('/api/admin/sicherungen')).json.extern;
    assert.equal(s.eingerichtet, false);
    assert.equal(s.veraltet, false);
    assert.match((await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' })).json.fehler, /Bitte Ziel, Adresse/);
  } finally {
    await server.stoppe();
  }
});

/** Minimaler SFTP-Server (ssh2) mit Dateien im Arbeitsspeicher. */
async function fakeSftp({ benutzer, passwort }) {
  const { Server, utils: { generateKeyPairSync, sftp: { STATUS_CODE, OPEN_MODE } } } = (await import('ssh2')).default;
  const { private: hostKey } = generateKeyPairSync('ed25519');
  const dateien = new Map();
  const ordner = new Set(['', '/']);
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => (ctx.method === 'password' && ctx.username === benutzer && ctx.password === passwort ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => client.on('session', (annehmen) => annehmen().on('sftp', (annehmenSftp) => {
      const sftp = annehmenSftp();
      const handles = new Map();
      let naechstes = 0;
      const handle = (wert) => { const h = Buffer.alloc(4); h.writeUInt32BE(naechstes); handles.set(naechstes, wert); naechstes += 1; return h; };
      const von = (h) => handles.get(h.readUInt32BE(0));
      sftp.on('OPEN', (id, pfad, flags) => {
        if (!(flags & OPEN_MODE.WRITE)) return sftp.status(id, STATUS_CODE.FAILURE);
        dateien.set(pfad, Buffer.alloc(0));
        sftp.handle(id, handle({ pfad }));
      });
      sftp.on('WRITE', (id, h, offset, daten) => {
        const { pfad } = von(h);
        const alt = dateien.get(pfad);
        const neu = Buffer.alloc(Math.max(alt.length, offset + daten.length));
        alt.copy(neu); daten.copy(neu, offset);
        dateien.set(pfad, neu);
        sftp.status(id, STATUS_CODE.OK);
      });
      sftp.on('FSTAT', (id, h) => sftp.attrs(id, { mode: 0o100644, size: dateien.get(von(h).pfad)?.length ?? 0, uid: 0, gid: 0, atime: 0, mtime: 0 }));
      sftp.on('FSETSTAT', (id) => sftp.status(id, STATUS_CODE.OK));
      sftp.on('CLOSE', (id, h) => { handles.delete(h.readUInt32BE(0)); sftp.status(id, STATUS_CODE.OK); });
      sftp.on('MKDIR', (id, pfad) => { if (ordner.has(pfad)) return sftp.status(id, STATUS_CODE.FAILURE); ordner.add(pfad); sftp.status(id, STATUS_CODE.OK); });
      sftp.on('OPENDIR', (id, pfad) => (ordner.has(pfad) ? sftp.handle(id, handle({ dir: pfad, gelesen: false })) : sftp.status(id, STATUS_CODE.NO_SUCH_FILE)));
      sftp.on('READDIR', (id, h) => {
        const d = von(h);
        if (d.gelesen) return sftp.status(id, STATUS_CODE.EOF);
        d.gelesen = true;
        const eintraege = [...dateien.keys()].filter((k) => k.slice(0, k.lastIndexOf('/')) === d.dir)
          .map((k) => ({ filename: k.slice(k.lastIndexOf('/') + 1), longname: k, attrs: { mode: 0o100644, size: 1, uid: 0, gid: 0, atime: 0, mtime: 0 } }));
        sftp.name(id, eintraege);
      });
      sftp.on('REMOVE', (id, pfad) => { dateien.delete(pfad); sftp.status(id, STATUS_CODE.OK); });
    })));
    client.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, dateien, url: `sftp://127.0.0.1:${server.address().port}/sicherungen` };
}

test('SFTP: Übertragung, Host-Schlüssel wird gemerkt und geprüft', async () => {
  const sftp = await fakeSftp({ benutzer: 'nas', passwort: 'nas-passwort' });
  const server = await starteTestServer({
    env: { BACKUP_REMOTE: 'sftp', BACKUP_REMOTE_URL: sftp.url, BACKUP_REMOTE_USER: 'nas', BACKUP_REMOTE_SECRET: 'nas-passwort', BACKUP_REMOTE_PASSWORD: PASSWORT, BACKUP_REMOTE_UPLOADS: 'false' },
  });
  try {
    const admin = await server.registriere('admin');
    assert.equal((await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' })).status, 200);
    const r = await admin.api('/api/admin/sicherungen/extern', { methode: 'POST' });
    assert.equal(r.status, 200, r.text);
    const heute = new Date().toISOString().slice(0, 10);
    const name = `/sicherungen/zockdb/datenbank/taeglich/zockdb-${heute}.db.zdbk`;
    assert.ok(sftp.dateien.has(name), [...sftp.dateien.keys()].join(', '));
    const enc = path.join(tmp, 'sftp.zdbk');
    fs.writeFileSync(enc, sftp.dateien.get(name));
    await entschluesseleDatei(enc, path.join(tmp, 'sftp.db'), PASSWORT);
    assert.match(r.json.hostschluessel, /^SHA256:/);

    // Anderer Host-Schlüssel → Abbruch
    server.kontext.konfiguration.sicherung.extern.hostschluessel = 'SHA256:falsch';
    const f = await admin.api('/api/admin/sicherungen/extern/test', { methode: 'POST' });
    assert.equal(f.status, 502);
    assert.match(f.json.fehler, /Unerwarteter Host-Schlüssel/);
  } finally {
    await server.stoppe();
    sftp.server.close();
  }
});
