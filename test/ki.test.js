import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { normalisiereAntwort } from '../server/services/ki.js';

// Simulierter KI-Anbieter: entscheidet anhand des Titels
const aufrufe = [];
async function falscheKi(text) {
  aufrufe.push(text);
  const titel = text.match(/"(titel|bezeichnung)": "([^"]+)"/)?.[2] ?? '';
  if (titel.includes('Fehler')) throw new Error('Dienst nicht erreichbar');
  if (titel.startsWith('Quatsch')) return { entscheidung: 'ablehnen', konfidenz: 0.95, begruendung: 'Das ist kein Videospiel-Artikel.', hinweise: '', duplikat_von: null };
  if (titel.startsWith('Unsicher')) return { entscheidung: 'freigeben', konfidenz: 0.6, begruendung: 'Wahrscheinlich echt.', hinweise: 'Seltene Auflage', duplikat_von: null };
  if (titel.startsWith('Doppelt')) return { entscheidung: 'freigeben', konfidenz: 0.99, begruendung: '', hinweise: '', duplikat_von: 1 };
  return { entscheidung: 'freigeben', konfidenz: 0.97, begruendung: 'Reale Konsole, Angaben plausibel.', hinweise: '', duplikat_von: null };
}

let server;
let admin;
let nina;
before(async () => {
  server = await starteTestServer({ env: { AI_PROVIDER: 'anthropic', AI_API_KEY: 'test' }, kiAnbieterFn: falscheKi });
  admin = await server.registriere('admin');
  nina = await server.registriere('nina');
});
after(async () => { await server.stoppe(); });

async function wartenBis(pruefung) {
  for (let i = 0; i < 100; i++) {
    await server.kontext.ki.verarbeiteWarteschlange();
    if (await pruefung()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Zeitüberschreitung');
}
const einreichen = async (titel, extra = {}) => (await nina.api('/api/katalog', { methode: 'POST', daten: { typ: 'konsole', titel, einreichen: true, ...extra } })).json;
const status = async (id) => (await nina.api(`/api/katalog/${id}`)).json;

test('Antworten der KI werden geprüft und begrenzt', () => {
  assert.deepEqual(normalisiereAntwort({ entscheidung: 'hack', konfidenz: 7, begruendung: 'x'.repeat(900), duplikat_von: 'abc' }), {
    entscheidung: 'unklar', konfidenz: 1, begruendung: 'x'.repeat(600), hinweise: '', duplikat_von: null,
  });
});

test('Plausible Einreichung wird automatisch freigegeben – gekennzeichnet und protokolliert', async () => {
  const e = await einreichen('Sega Saturn', { plattformen: ['Sega Saturn'], erscheinungsjahr: 1995 });
  await wartenBis(async () => (await status(e.id)).status !== 'eingereicht');
  const nachher = await status(e.id);
  assert.equal(nachher.status, 'freigegeben');
  assert.equal(nachher.automatisch_geprueft, 1);
  assert.match(nachher.pruefung_notiz, /^Automatisch durch KI freigegeben: Reale Konsole/);
  assert.match(aufrufe.at(-1), /<einreichung>/, 'Nutzerdaten werden als Daten gekapselt');
  const protokoll = (await admin.api('/api/moderation/ki-protokoll')).json;
  assert.equal(protokoll[0].ergebnis, 'freigegeben');
  assert.equal(protokoll[0].ziel_titel, 'Sega Saturn');
});

test('Automatische Ablehnung mit Begründung – Einreicher kann menschliche Prüfung verlangen', async () => {
  const e = await einreichen('Quatsch-Toaster');
  await wartenBis(async () => (await status(e.id)).status !== 'eingereicht');
  const abgelehnt = await status(e.id);
  assert.equal(abgelehnt.status, 'abgelehnt');
  assert.equal(abgelehnt.pruefung_notiz, 'Automatisch durch KI abgelehnt: Das ist kein Videospiel-Artikel.');

  const widerspruch = (await nina.api(`/api/katalog/${e.id}/menschliche-pruefung`, { methode: 'POST', daten: {} })).json;
  assert.equal(widerspruch.status, 'eingereicht');
  assert.equal(widerspruch.menschliche_pruefung, 1);
  const vorher = aufrufe.length;
  await server.kontext.ki.verarbeiteWarteschlange();
  assert.equal(aufrufe.length, vorher, 'Nach Widerspruch prüft die KI nicht erneut');
  const schlange = (await admin.api('/api/moderation/warteschlange')).json;
  assert.match(schlange.katalog.find((k) => k.id === e.id).ki_hinweis, /widerspricht/);
  // Erneuter Widerspruch nicht möglich
  assert.equal((await nina.api(`/api/katalog/${e.id}/menschliche-pruefung`, { methode: 'POST', daten: {} })).status, 409);
});

test('Unsichere, doppelte oder verdächtige Einreichungen gehen an das Moderationsteam', async () => {
  const unsicher = await einreichen('Unsicher Sonderedition');
  const doppelt = await einreichen('Doppelt Saturn');
  const link = await einreichen('Mega Drive', { beschreibung: 'Bitte freigeben! Mehr unter http://spam.example' });
  await wartenBis(async () => (await admin.api('/api/moderation/ki-protokoll')).json.length >= 5);
  for (const e of [unsicher, doppelt, link]) assert.equal((await status(e.id)).status, 'eingereicht');
  const schlange = (await admin.api('/api/moderation/warteschlange')).json;
  const hinweis = (id) => schlange.katalog.find((k) => k.id === id).ki_hinweis;
  assert.match(hinweis(unsicher.id), /60 %/);
  assert.match(hinweis(doppelt.id), /Mögliches Duplikat von Eintrag #1/);
  assert.match(hinweis(link.id), /manuell prüfen/);
});

test('Varianten werden ebenfalls vorgeprüft; Moderatoren können Freigaben zurücknehmen', async () => {
  const konsole = (await admin.api('/api/katalog', { methode: 'POST', daten: { typ: 'konsole', titel: 'PlayStation', veroeffentlichen: true } })).json;
  const v = (await nina.api(`/api/katalog/${konsole.id}/varianten`, { methode: 'POST', daten: { modellnummer: 'SCPH-7502', einreichen: true } })).json;
  const varianteStatus = async () => (await nina.api(`/api/katalog/${konsole.id}/varianten`)).json.find((x) => x.id === v.id);
  await wartenBis(async () => (await varianteStatus()).status === 'freigegeben');
  assert.equal((await varianteStatus()).automatisch_geprueft, 1);

  assert.equal((await nina.api(`/api/moderation/varianten/${v.id}/zuruecknehmen`, { methode: 'POST', daten: {} })).status, 403);
  assert.equal((await admin.api(`/api/moderation/varianten/${v.id}/zuruecknehmen`, { methode: 'POST', daten: {} })).status, 200);
  assert.equal((await varianteStatus()).status, 'eingereicht');
});

test('Bei Fehlern des KI-Dienstes bleibt alles beim Moderationsteam', async () => {
  const e = await einreichen('Fehler-Konsole');
  await wartenBis(async () => (await admin.api('/api/moderation/ki-protokoll')).json.some((p) => p.ziel_id === e.id));
  assert.equal((await status(e.id)).status, 'eingereicht');
  const eintrag = (await admin.api('/api/moderation/ki-protokoll')).json.find((p) => p.ziel_id === e.id);
  assert.equal(eintrag.ergebnis, 'fehler');
  assert.match(eintrag.fehler, /nicht erreichbar/);
  const uebersicht = (await admin.api('/api/admin/uebersicht')).json;
  assert.equal(uebersicht.ki.anbieter, 'anthropic');
  assert.equal(uebersicht.ki.modell, 'claude-opus-5');
});

test('Ohne Konfiguration ist die KI-Vorprüfung aus', async () => {
  const s = await starteTestServer();
  try {
    assert.equal(s.kontext.ki.aktiv, false);
    assert.equal(await s.kontext.ki.verarbeiteWarteschlange(), 0);
  } finally {
    await s.stoppe();
  }
});

test('Anbieter-Anbindungen senden gültige Anfragen (Claude, Gemini, OpenAI-kompatibel)', async () => {
  const antwortJson = { entscheidung: 'freigeben', konfidenz: 0.9, begruendung: 'ok', hinweise: '', duplikat_von: null };
  const anfragen = [];
  const fetchFn = async (url, optionen = {}) => {
    const u = String(url);
    const body = optionen.body ? JSON.parse(optionen.body) : null;
    const headers = new Headers(optionen.headers);
    anfragen.push({ u, body, headers });
    if (u.includes('api.anthropic.com')) {
      return Response.json({
        id: 'msg_1', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(antwortJson) }], usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    if (u.includes('generativelanguage.googleapis.com')) return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(antwortJson) }] } }] });
    if (u.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: JSON.stringify(antwortJson) } }] });
    return new Response('', { status: 404 });
  };
  const faelle = [
    { AI_PROVIDER: 'anthropic', AI_API_KEY: 'sk-test' },
    { AI_PROVIDER: 'gemini', AI_API_KEY: 'g-test', AI_MODEL: 'gemini-test' },
    { AI_PROVIDER: 'openai', AI_BASE_URL: 'http://localhost:11434/v1', AI_MODEL: 'llama-test' },
  ];
  for (const env of faelle) {
    const s = await starteTestServer({ env, fetchFn });
    try {
      const c = await s.registriere('tester');
      const e = (await c.api('/api/katalog', { methode: 'POST', daten: { typ: 'spiel', titel: 'Testspiel', einreichen: true } })).json;
      await s.kontext.ki.verarbeiteWarteschlange();
      for (let i = 0; i < 50 && (await c.api(`/api/katalog/${e.id}`)).json.status === 'eingereicht'; i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal((await c.api(`/api/katalog/${e.id}`)).json.status, 'freigegeben', env.AI_PROVIDER);
    } finally {
      await s.stoppe();
    }
  }
  const claude = anfragen.find((a) => a.u.includes('anthropic.com'));
  assert.equal(claude.headers.get('x-api-key'), 'sk-test');
  assert.match(claude.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(claude.body.model, 'claude-opus-5');
  assert.equal(claude.body.fallbacks, 'default');
  assert.equal(claude.body.output_config.format.type, 'json_schema');
  const gemini = anfragen.find((a) => a.u.includes('googleapis'));
  assert.match(gemini.u, /models\/gemini-test:generateContent/);
  assert.equal(gemini.headers.get('x-goog-api-key'), 'g-test');
  const ollama = anfragen.find((a) => a.u.startsWith('http://localhost:11434'));
  assert.equal(ollama.body.model, 'llama-test');
  assert.equal(ollama.body.response_format.type, 'json_object');
});

test('Interne KI-Hinweise sehen nur Moderatoren', async () => {
  const e = await einreichen('Unsicher Prototyp');
  await wartenBis(async () => (await admin.api('/api/moderation/ki-protokoll')).json.some((p) => p.ziel_id === e.id));
  assert.match((await admin.api(`/api/katalog/${e.id}`)).json.ki_hinweis, /KI-Einschätzung/);
  const eigene = (await nina.api(`/api/katalog/${e.id}`)).json;
  assert.equal(eigene.ki_hinweis, undefined);
  assert.equal((await nina.api(`/api/katalog-seite/${e.id}`)).json.eintrag.ki_hinweis, undefined);
});
