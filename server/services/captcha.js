// Spam-Schutz für Registrierung und „Passwort vergessen“.
//
// Anbieter (CAPTCHA_PROVIDER):
//  - altcha:    Rechenaufgabe im Browser (Proof-of-Work), selbst gehostet – keine Cookies, keine Daten an Dritte.
//  - recaptcha: Google reCAPTCHA v3 (unsichtbar, Score). Überträgt Daten an Google (USA) und setzt Cookies –
//               wird im Browser deshalb erst nach ausdrücklicher Einwilligung geladen.
//  - aus:       kein Spam-Schutz (nur die Begrenzung der Registrierungen je IP).
import crypto from 'node:crypto';
import { KontoFehler } from './konten.js';

const hex = (puffer) => Buffer.from(puffer).toString('hex');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const FEHLER = 'Die Spam-Prüfung ist fehlgeschlagen. Bitte lade die Seite neu und versuche es erneut.';

export function erstelleCaptchaDienst(konfiguration, { schluessel, fetchFn = globalThis.fetch } = {}) {
  const k = konfiguration ?? {};
  const anbieter = k.anbieter === 'recaptcha' && k.recaptchaSiteKey && k.recaptchaSecret ? 'recaptcha'
    : k.anbieter === 'altcha' ? 'altcha' : 'aus';
  const hmacSchluessel = crypto.createHash('sha256').update(`altcha:${hex(schluessel ?? crypto.randomBytes(32))}`).digest();
  const benutzt = new Map(); // verwendete ALTCHA-Aufgaben bis zum Ablauf merken (keine Wiederverwendung)
  const MAX = 60_000;

  /** Neue ALTCHA-Aufgabe (10 Minuten gültig). */
  function aufgabe() {
    const ablauf = Math.floor(Date.now() / 1000) + 600;
    const salt = `${hex(crypto.randomBytes(12))}?expires=${ablauf}`;
    const zahl = crypto.randomInt(0, MAX);
    const challenge = sha256(`${salt}${zahl}`);
    const signature = crypto.createHmac('sha256', hmacSchluessel).update(challenge).digest('hex');
    return { algorithm: 'SHA-256', challenge, maxnumber: MAX, salt, signature };
  }

  function pruefeAltcha(nutzlast) {
    let d;
    try {
      d = JSON.parse(Buffer.from(String(nutzlast ?? ''), 'base64').toString('utf8'));
    } catch {
      return false;
    }
    if (!d || d.algorithm !== 'SHA-256' || typeof d.salt !== 'string' || typeof d.challenge !== 'string') return false;
    const erwartet = crypto.createHmac('sha256', hmacSchluessel).update(d.challenge).digest('hex');
    if (typeof d.signature !== 'string' || d.signature.length !== erwartet.length
      || !crypto.timingSafeEqual(Buffer.from(d.signature), Buffer.from(erwartet))) return false;
    const ablauf = Number(new URLSearchParams(d.salt.split('?')[1] ?? '').get('expires'));
    const jetzt = Math.floor(Date.now() / 1000);
    if (!ablauf || ablauf < jetzt) return false;
    if (sha256(`${d.salt}${Number(d.number)}`) !== d.challenge) return false;
    for (const [c, bis] of benutzt) if (bis < jetzt) benutzt.delete(c);
    if (benutzt.has(d.challenge)) return false;
    benutzt.set(d.challenge, ablauf);
    return true;
  }

  async function pruefeRecaptcha(token, aktion, ip) {
    if (!token) return false;
    try {
      const antwort = await fetchFn('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: k.recaptchaSecret, response: String(token), ...(ip ? { remoteip: ip } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      const d = await antwort.json();
      return Boolean(d.success && (!d.action || d.action === aktion) && (d.score ?? 0) >= (k.mindestScore ?? 0.5));
    } catch (e) {
      console.warn('[captcha] reCAPTCHA nicht erreichbar:', e.message);
      return false;
    }
  }

  /** Wirft einen Fehler, wenn die Prüfung nicht bestanden ist. */
  async function pruefe(nachweis, { aktion, ip } = {}) {
    if (anbieter === 'aus') return;
    const ok = anbieter === 'altcha' ? pruefeAltcha(nachweis) : await pruefeRecaptcha(nachweis, aktion, ip);
    if (!ok) throw new KontoFehler(FEHLER, 400, 'captcha');
  }

  return {
    anbieter,
    aufgabe,
    pruefe,
    /** Für den Browser: welcher Anbieter und (bei reCAPTCHA) der öffentliche Websiteschlüssel. */
    oeffentlich: () => ({ anbieter, siteKey: anbieter === 'recaptcha' ? k.recaptchaSiteKey : null }),
  };
}
