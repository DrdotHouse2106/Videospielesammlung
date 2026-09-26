import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { starteTestServer } from './hilfen.js';

const PASSWORT = 'sehr-geheimes-passwort';
const loese = (a) => {
  for (let n = 0; n <= a.maxnumber; n++) {
    if (crypto.createHash('sha256').update(`${a.salt}${n}`).digest('hex') === a.challenge) {
      return Buffer.from(JSON.stringify({ algorithm: a.algorithm, challenge: a.challenge, number: n, salt: a.salt, signature: a.signature })).toString('base64');
    }
  }
  throw new Error('nicht lösbar');
};
const registrieren = (c, name, captcha) => c.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: name, passwort: PASSWORT, bedingungen_akzeptiert: true, captcha } });

test('ALTCHA: Registrierung nur mit gelöster Aufgabe, jede Aufgabe nur einmal', async () => {
  const server = await starteTestServer({ env: { CAPTCHA_PROVIDER: 'altcha' } });
  try {
    await server.registriere('admin'); // erstes Konto ohne Prüfung
    const gast = server.client();
    assert.deepEqual((await gast.api('/api/auth/status')).json.captcha, { anbieter: 'altcha', siteKey: null });
    assert.equal((await registrieren(gast, 'bot', undefined)).json.code, 'captcha');

    const aufgabe = (await gast.api('/api/auth/captcha')).json;
    const loesung = loese(aufgabe);
    const r = await registrieren(gast, 'mensch', loesung);
    assert.equal(r.status, 201, r.text);
    assert.equal((await registrieren(server.client(), 'mensch2', loesung)).status, 400, 'Wiederverwendung abgelehnt');

    // Manipulierte Zahl
    const falsch = JSON.parse(Buffer.from(loese((await gast.api('/api/auth/captcha')).json), 'base64').toString());
    falsch.number += 1;
    assert.equal((await registrieren(server.client(), 'mensch3', Buffer.from(JSON.stringify(falsch)).toString('base64'))).status, 400);
  } finally {
    await server.stoppe();
  }
});

test('reCAPTCHA v3: Score und Aktion werden serverseitig geprüft, CSP erlaubt Google nur dann', async () => {
  const anfragen = [];
  const fetchFn = async (url, optionen) => {
    if (String(url).startsWith('https://www.google.com/recaptcha/api/siteverify')) {
      const p = new URLSearchParams(optionen.body);
      anfragen.push(p);
      const score = p.get('response') === 'mensch' ? 0.9 : 0.1;
      return Response.json({ success: true, score, action: 'registrieren' });
    }
    return new Response('', { status: 404 });
  };
  const server = await starteTestServer({ env: { CAPTCHA_PROVIDER: 'recaptcha', RECAPTCHA_SITE_KEY: 'seite-123', RECAPTCHA_SECRET: 'geheim-456' }, fetchFn });
  try {
    await server.registriere('admin');
    const gast = server.client();
    assert.deepEqual((await gast.api('/api/auth/status')).json.captcha, { anbieter: 'recaptcha', siteKey: 'seite-123' });
    assert.equal((await registrieren(gast, 'bot', 'bot')).status, 400);
    assert.equal((await registrieren(gast, 'mensch', 'mensch')).status, 201);
    assert.equal(anfragen[0].get('secret'), 'geheim-456');
    const csp = (await fetch(`${server.basis}/api/health`)).headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/www\.google\.com/);
  } finally {
    await server.stoppe();
  }
  const ohne = await starteTestServer();
  try {
    assert.doesNotMatch((await fetch(`${ohne.basis}/api/health`)).headers.get('content-security-policy'), /google/);
  } finally {
    await ohne.stoppe();
  }
});
