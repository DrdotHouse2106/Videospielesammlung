import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

const postfach = [];
let server;
let mod;
let nutzer;

before(async () => {
  server = await starteTestServer({ env: { PUBLIC_URL: 'https://zockdb.example', SMTP_FROM: 'x@zockdb.example' }, mailFn: async (m) => { postfach.push(m); } });
  mod = await server.registriere('moderatorin');
  nutzer = await server.registriere('sammler');
});
after(async () => { await server.stoppe(); });

test('Freigabe und Ablehnung erzeugen Benachrichtigungen, optional auch per E-Mail', async () => {
  const eintrag = (await nutzer.api('/api/katalog', { methode: 'POST', daten: { typ: 'konsole', titel: 'Selbstbau-Konsole', plattformen: ['SNES'] } })).json;
  assert.equal((await nutzer.api(`/api/katalog/${eintrag.id}/einreichen`, { methode: 'POST', daten: {} })).status, 200);

  let n = (await nutzer.api('/api/benachrichtigungen/anzahl')).json;
  assert.equal(n.ungelesen, 0);
  assert.equal((await mod.api(`/api/moderation/katalog/${eintrag.id}/ablehnen`, { methode: 'POST', daten: { grund: 'Bitte ein Foto ergänzen.' } })).status, 200);

  const liste = (await nutzer.api('/api/benachrichtigungen')).json;
  assert.equal(liste.ungelesen, 1);
  assert.equal(liste.eintraege[0].titel, '„Selbstbau-Konsole“ wurde abgelehnt');
  assert.equal(liste.eintraege[0].text, 'Bitte ein Foto ergänzen.');
  assert.equal(liste.eintraege[0].link, `#/katalog/${eintrag.id}`);
  assert.equal(postfach.length, 0, 'ohne Zustimmung keine E-Mail');

  // E-Mail-Benachrichtigungen einschalten (Adresse direkt setzen, Bestätigung ist in email.test.js geprüft)
  server.db.prepare("UPDATE benutzer SET email = 'sammler@example.org' WHERE benutzername = 'sammler'").run();
  await nutzer.api('/api/konto', { methode: 'PUT', daten: { benachrichtigung_email: true } });
  await nutzer.api(`/api/katalog/${eintrag.id}/einreichen`, { methode: 'POST', daten: {} });
  await mod.api(`/api/moderation/katalog/${eintrag.id}/freigeben`, { methode: 'POST', daten: {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(postfach.length, 1);
  assert.equal(postfach[0].subject, 'ZockDB: „Selbstbau-Konsole“ wurde freigegeben');
  assert.match(postfach[0].text, /https:\/\/zockdb\.example\/\?app=1#\/katalog\//);

  n = (await nutzer.api('/api/benachrichtigungen/gelesen', { methode: 'POST', daten: {} })).json;
  assert.equal(n.ungelesen, 0);
  // Fremde Benachrichtigungen sind nicht erreichbar
  assert.equal((await mod.api('/api/benachrichtigungen')).json.eintraege.length, 0);
});

test('Rollenwechsel wird mitgeteilt', async () => {
  const id = server.db.prepare("SELECT id FROM benutzer WHERE benutzername = 'sammler'").get().id;
  await mod.api(`/api/admin/benutzer/${id}`, { methode: 'PUT', daten: { rolle: 'moderator' } });
  const liste = (await nutzer.api('/api/benachrichtigungen')).json;
  assert.equal(liste.eintraege[0].titel, 'Deine Rolle: Moderator');
});
