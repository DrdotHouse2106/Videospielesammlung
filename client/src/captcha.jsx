// Spam-Schutz im Browser: ALTCHA (Rechenaufgabe, ohne Dritte) oder Google reCAPTCHA v3 (nur nach Einwilligung).
import { api } from './api.js';

// SHA-256 als Hex – über Web Crypto, sonst (z. B. http:// im Heimnetz) mit einer kleinen JS-Umsetzung.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function sha256Js(text) {
  const daten = new TextEncoder().encode(text);
  const laenge = daten.length;
  const bloecke = Math.ceil((laenge + 9) / 64);
  const puffer = new Uint8Array(bloecke * 64);
  puffer.set(daten);
  puffer[laenge] = 0x80;
  const bits = laenge * 8;
  new DataView(puffer.buffer).setUint32(puffer.length - 4, bits >>> 0);
  new DataView(puffer.buffer).setUint32(puffer.length - 8, Math.floor(bits / 2 ** 32));
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const dv = new DataView(puffer.buffer);
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let b = 0; b < bloecke; b++) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(b * 64 + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
async function sha256(text) {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Js(text);
}

async function loeseAltcha(a) {
  for (let n = 0; n <= a.maxnumber; n++) {
    if (await sha256(`${a.salt}${n}`) === a.challenge) {
      return btoa(JSON.stringify({ algorithm: a.algorithm, challenge: a.challenge, number: n, salt: a.salt, signature: a.signature }));
    }
    if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0)); // Oberfläche bleibt bedienbar
  }
  throw new Error('Die Spam-Prüfung konnte nicht gelöst werden. Bitte erneut versuchen.');
}

let recaptchaLaedt = null;
function ladeRecaptcha(siteKey) {
  if (window.grecaptcha?.execute) return Promise.resolve();
  recaptchaLaedt ??= new Promise((ok, fehler) => {
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.onload = () => window.grecaptcha.ready(ok);
    s.onerror = () => { recaptchaLaedt = null; fehler(new Error('Google reCAPTCHA konnte nicht geladen werden (Werbeblocker?).')); };
    document.head.appendChild(s);
  });
  return recaptchaLaedt;
}

/** Liefert den Nachweis für die Anfrage oder undefined, wenn kein Spam-Schutz aktiv ist. */
export async function captchaNachweis(info, aktion, { zustimmung = false } = {}) {
  if (!info || info.anbieter === 'aus') return undefined;
  if (info.anbieter === 'altcha') return loeseAltcha(await api.captchaAufgabe());
  if (!zustimmung) throw new Error('Bitte stimme der Spam-Prüfung durch Google reCAPTCHA zu.');
  await ladeRecaptcha(info.siteKey);
  return window.grecaptcha.execute(info.siteKey, { action: aktion });
}

/** Hinweis bzw. Einwilligung unter dem Formular. */
export function CaptchaHinweis({ info, zustimmung, setZustimmung }) {
  if (!info || info.anbieter === 'aus') return null;
  if (info.anbieter === 'altcha') {
    return <p className="text-xs text-leise">Zum Schutz vor Spam löst dein Browser beim Absenden kurz eine Rechenaufgabe – ohne Cookies und ohne Dritte.</p>;
  }
  return (
    <label className="flex items-start gap-2 text-xs text-leise">
      <input type="checkbox" className="mt-0.5 size-4 accent-akzent" checked={zustimmung} onChange={(e) => setZustimmung(e.target.checked)} />
      <span>
        Ich willige ein, dass zum Schutz vor Spam <strong className="text-text">Google reCAPTCHA</strong> geladen wird. Dabei werden Daten
        (u. a. IP-Adresse, Browser- und Nutzungsdaten) an Google, auch in die USA, übertragen und Cookies gesetzt.
        Details in der <a href="#/seite/datenschutz" className="underline" target="_blank">Datenschutzerklärung</a>.
      </span>
    </label>
  );
}
