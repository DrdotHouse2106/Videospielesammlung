import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { totpCode, base32Dekodieren } from '../server/services/sicherheit.js';

let server;
before(async () => { server = await starteTestServer(); });
after(async () => { await server.stoppe(); });

const aktuellerCode = (geheimnis, versatz = 0) => totpCode(geheimnis, Math.floor(Date.now() / 30000) + versatz);

test('Ohne Anmeldung gibt es keinen Zugriff auf die Sammlung', async () => {
  const gast = server.client();
  const antwort = await gast.api('/api/artikel');
  assert.equal(antwort.status, 401);
  assert.equal(antwort.json.code, 'nicht_angemeldet');
  const status = await gast.api('/api/auth/status');
  assert.equal(status.json.angemeldet, false);
  assert.equal(status.json.ersteinrichtung, true);
});

test('Erstes Konto wird Admin, Passwortregeln greifen, Anmeldung funktioniert', async () => {
  const gast = server.client();
  const zuKurz = await gast.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: 'anna', passwort: 'kurz' } });
  assert.equal(zuKurz.status, 400);
  assert.match(zuKurz.json.felder.passwort, /mindestens 10 Zeichen/);

  const anna = await server.registriere('anna');
  assert.equal((await anna.api('/api/konto')).json.rolle, 'admin');
  const bernd = await server.registriere('bernd');
  assert.equal((await bernd.api('/api/konto')).json.rolle, 'nutzer');

  const doppelt = await gast.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: 'ANNA', passwort: 'sehr-geheimes-passwort' } });
  assert.match(doppelt.json.felder.benutzername, /vergeben/);

  const falsch = await gast.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'anna', passwort: 'falsch-falsch' } });
  assert.equal(falsch.status, 401);
  const richtig = await gast.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'anna', passwort: 'sehr-geheimes-passwort' } });
  assert.equal(richtig.json.angemeldet, true);
  assert.equal((await gast.api('/api/artikel')).status, 200);

  await gast.api('/api/auth/abmelden', { methode: 'POST' });
  assert.equal((await gast.api('/api/artikel')).status, 401);
});

test('Sammlungen sind strikt getrennt', async () => {
  const carla = await server.registriere('carla');
  const dieter = await server.registriere('dieter');
  const artikel = (await carla.api('/api/artikel', { methode: 'POST', daten: { typ: 'spiel', titel: 'Geheimes Spiel', kaufpreis: 10 } })).json;
  assert.equal((await dieter.api('/api/artikel')).json.length, 0);
  assert.equal((await dieter.api(`/api/artikel/${artikel.id}`)).status, 404);
  assert.equal((await dieter.api(`/api/artikel/${artikel.id}`, { methode: 'DELETE' })).status, 404);
  assert.equal((await dieter.api('/api/statistik')).json.gesamt.eintraege, 0);
  assert.equal((await dieter.api('/api/community/carla')).status, 404, 'private Sammlung ist unsichtbar');
});

test('Öffentliche Sammlung zeigt keine privaten Angaben', async () => {
  const eva = await server.registriere('eva');
  const frank = await server.registriere('frank');
  await eva.api('/api/artikel', {
    methode: 'POST',
    daten: { typ: 'konsole', titel: 'Nintendo 64', farbe: 'Atomic Purple', kaufpreis: '120', seriennummer: 'NE123', notizen: 'privat' },
  });
  await eva.api('/api/konto', { methode: 'PUT', daten: { sammlung_oeffentlich: true } });
  const liste = (await frank.api('/api/community')).json;
  assert.ok(liste.some((s) => s.benutzername === 'eva' && s.eintraege === 1));
  const sammlung = (await frank.api('/api/community/eva')).json;
  const n64 = sammlung.artikel[0];
  assert.equal(n64.farbe, 'Atomic Purple');
  assert.equal(n64.kaufpreis, undefined);
  assert.equal(n64.seriennummer, undefined);
  assert.equal(n64.notizen, undefined);
});

test('Zwei-Faktor-Anmeldung: Einrichtung, Anmeldung, Wiederherstellungscode', async () => {
  const gabi = await server.registriere('gabi');
  const ohnePasswort = await gabi.api('/api/konto/2fa/einrichten', { methode: 'POST', daten: { passwort: 'falsch' } });
  assert.equal(ohnePasswort.status, 400);
  const einrichtung = (await gabi.api('/api/konto/2fa/einrichten', { methode: 'POST', daten: { passwort: 'sehr-geheimes-passwort' } })).json;
  assert.match(einrichtung.otpauthUrl, /^otpauth:\/\/totp\/Videospielesammlung:gabi\?secret=/);
  assert.match(einrichtung.qrSvg, /<svg/);
  assert.equal(base32Dekodieren(einrichtung.geheimnis).length, 20);

  const falscherCode = await gabi.api('/api/konto/2fa/bestaetigen', { methode: 'POST', daten: { code: '000000' } });
  assert.equal(falscherCode.status, 400);
  const bestaetigt = (await gabi.api('/api/konto/2fa/bestaetigen', { methode: 'POST', daten: { code: aktuellerCode(einrichtung.geheimnis) } })).json;
  assert.equal(bestaetigt.wiederherstellungscodes.length, 10);

  // Anmeldung braucht jetzt den zweiten Faktor
  const neu = server.client();
  const schritt1 = (await neu.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'gabi', passwort: 'sehr-geheimes-passwort' } })).json;
  assert.equal(schritt1.zweiFaktor, true);
  assert.equal(neu.cookie(), '', 'vor dem zweiten Faktor gibt es kein Sitzungs-Cookie');
  assert.equal((await neu.api('/api/artikel')).status, 401);
  // Code aus dem Fenster davor wurde bei der Einrichtung schon „verbraucht“ → nächster Schritt
  const schritt2 = await neu.api('/api/auth/2fa', { methode: 'POST', daten: { token: schritt1.token, code: aktuellerCode(einrichtung.geheimnis, 1) } });
  assert.equal(schritt2.status, 200);
  assert.equal((await neu.api('/api/artikel')).status, 200);

  // Anmeldung mit Wiederherstellungscode (nur einmal gültig)
  const drittes = server.client();
  const s1 = (await drittes.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'gabi', passwort: 'sehr-geheimes-passwort' } })).json;
  const code = bestaetigt.wiederherstellungscodes[0];
  assert.equal((await drittes.api('/api/auth/2fa', { methode: 'POST', daten: { token: s1.token, wiederherstellungscode: code.toLowerCase() } })).status, 200);
  const viertes = server.client();
  const s2 = (await viertes.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'gabi', passwort: 'sehr-geheimes-passwort' } })).json;
  assert.equal((await viertes.api('/api/auth/2fa', { methode: 'POST', daten: { token: s2.token, wiederherstellungscode: code } })).status, 401);
});

test('Anmeldung wird nach zu vielen Fehlversuchen gedrosselt', async () => {
  const gast = server.client();
  let letzte;
  for (let i = 0; i < 11; i++) {
    letzte = await gast.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'hanna', passwort: `falsch-${i}-xxxx` } });
  }
  assert.equal(letzte.status, 429);
});

test('Fremde Herkunft (CSRF) wird abgelehnt', async () => {
  const ida = await server.registriere('ida');
  const antwort = await ida.api('/api/artikel', {
    methode: 'POST', daten: { typ: 'spiel', titel: 'X' }, headers: { Origin: 'https://boese.example' },
  });
  assert.equal(antwort.status, 403);
});

test('Admin kann Benutzer sperren, normale Benutzer nicht', async () => {
  const admin = server.client();
  await admin.api('/api/auth/anmelden', { methode: 'POST', daten: { benutzername: 'anna', passwort: 'sehr-geheimes-passwort' } });
  const jonas = await server.registriere('jonas');
  assert.equal((await jonas.api('/api/admin/benutzer')).status, 403);
  const liste = (await admin.api('/api/admin/benutzer')).json;
  const id = liste.find((b) => b.benutzername === 'jonas').id;
  assert.equal((await admin.api(`/api/admin/benutzer/${id}`, { methode: 'PUT', daten: { gesperrt: true } })).status, 200);
  assert.equal((await jonas.api('/api/artikel')).status, 401, 'Sitzung des gesperrten Kontos ist beendet');
});

test('Registrierung kann geschlossen und 2FA zur Pflicht gemacht werden', async () => {
  const s = await starteTestServer({ env: { REGISTRATION_OPEN: 'false', REQUIRE_2FA: 'true' } });
  try {
    const erster = await s.registriere('chefin'); // erstes Konto ist immer erlaubt
    const zweiter = s.client();
    const r = await zweiter.api('/api/auth/registrieren', { methode: 'POST', daten: { benutzername: 'gast', passwort: 'sehr-geheimes-passwort' } });
    assert.equal(r.status, 403);
    const gesperrt = await erster.api('/api/artikel');
    assert.equal(gesperrt.status, 403);
    assert.equal(gesperrt.json.code, '2fa_einrichten');
    assert.equal((await erster.api('/api/konto')).status, 200, 'Kontoseite bleibt erreichbar');
  } finally {
    await s.stoppe();
  }
});
