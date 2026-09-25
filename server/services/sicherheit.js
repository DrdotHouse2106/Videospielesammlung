// Kryptografische Hilfsfunktionen: Passwörter, Tokens, Verschlüsselung, TOTP (2FA).
// Alles mit dem eingebauten node:crypto – keine zusätzlichen Abhängigkeiten.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ── Passwörter ────────────────────────────────────────────────
export async function hashePasswort(passwort) {
  const salz = crypto.randomBytes(16);
  const hash = await scrypt(passwort.normalize('NFKC'), salz, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salz.toString('base64')}$${hash.toString('base64')}`;
}

export async function pruefePasswort(passwort, gespeichert) {
  const [verfahren, N, r, p, salz, hash] = String(gespeichert).split('$');
  if (verfahren !== 'scrypt') return false;
  const erwartet = Buffer.from(hash, 'base64');
  const berechnet = await scrypt(passwort.normalize('NFKC'), Buffer.from(salz, 'base64'), erwartet.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(erwartet, berechnet);
}

// Für Anmeldeversuche mit unbekanntem Benutzernamen: gleicher Zeitaufwand wie ein echter Vergleich.
let platzhalterHash;
export async function vergleicheMitPlatzhalter(passwort) {
  platzhalterHash ??= await hashePasswort('platzhalter-passwort');
  await pruefePasswort(passwort, platzhalterHash);
  return false;
}

// ── Tokens ────────────────────────────────────────────────────
export const zufallsToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ── Verschlüsselung (AES-256-GCM) für gespeicherte 2FA-Geheimnisse ─
export function ladeSchluessel(appGeheimnis, datenVerzeichnis) {
  let geheimnis = appGeheimnis;
  if (!geheimnis) {
    const datei = path.join(datenVerzeichnis, 'geheimnis.key');
    if (fs.existsSync(datei)) geheimnis = fs.readFileSync(datei, 'utf8').trim();
    else {
      geheimnis = crypto.randomBytes(32).toString('base64');
      fs.mkdirSync(datenVerzeichnis, { recursive: true });
      fs.writeFileSync(datei, geheimnis, { mode: 0o600 });
    }
  }
  return crypto.createHash('sha256').update(`videospielesammlung:${geheimnis}`).digest();
}

export function verschluessele(text, schluessel) {
  const iv = crypto.randomBytes(12);
  const chiffre = crypto.createCipheriv('aes-256-gcm', schluessel, iv);
  const daten = Buffer.concat([chiffre.update(text, 'utf8'), chiffre.final()]);
  return [iv, chiffre.getAuthTag(), daten].map((b) => b.toString('base64')).join('.');
}

export function entschluessele(paket, schluessel) {
  const [iv, tag, daten] = paket.split('.').map((t) => Buffer.from(t, 'base64'));
  const dechiffre = crypto.createDecipheriv('aes-256-gcm', schluessel, iv);
  dechiffre.setAuthTag(tag);
  return Buffer.concat([dechiffre.update(daten), dechiffre.final()]).toString('utf8');
}

// ── TOTP nach RFC 6238 (kompatibel mit Google Authenticator, Aegis, 2FAS, 1Password …) ─
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Kodieren(puffer) {
  let bits = 0;
  let wert = 0;
  let ausgabe = '';
  for (const byte of puffer) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      ausgabe += BASE32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) ausgabe += BASE32[(wert << (5 - bits)) & 31];
  return ausgabe;
}

export function base32Dekodieren(text) {
  const sauber = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let wert = 0;
  const bytes = [];
  for (const zeichen of sauber) {
    const index = BASE32.indexOf(zeichen);
    if (index === -1) throw new Error('Ungültiges Base32');
    wert = (wert << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const erzeugeTotpGeheimnis = () => base32Kodieren(crypto.randomBytes(20));

export function totpCode(geheimnis, schritt) {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(schritt));
  const hmac = crypto.createHmac('sha1', base32Dekodieren(geheimnis)).update(zaehler).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const zahl = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(zahl).padStart(6, '0');
}

/**
 * Prüft einen 6-stelligen Code (±1 Zeitfenster à 30 s gegen Uhrabweichungen).
 * Liefert den verwendeten Zeitschritt oder null. Bereits benutzte Schritte werden abgelehnt.
 */
export function pruefeTotp(geheimnis, code, letzterSchritt = null, jetzt = Date.now()) {
  const eingabe = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(eingabe)) return null;
  const aktuell = Math.floor(jetzt / 1000 / 30);
  for (const schritt of [aktuell - 1, aktuell, aktuell + 1]) {
    if (letzterSchritt != null && schritt <= letzterSchritt) continue;
    const erwartet = totpCode(geheimnis, schritt);
    if (crypto.timingSafeEqual(Buffer.from(erwartet), Buffer.from(eingabe))) return schritt;
  }
  return null;
}

export function erzeugeWiederherstellungscodes(anzahl = 10) {
  return Array.from({ length: anzahl }, () => {
    const roh = base32Kodieren(crypto.randomBytes(5)).slice(0, 8);
    return `${roh.slice(0, 4)}-${roh.slice(4)}`;
  });
}

export const normalisiereWiederherstellungscode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '');
