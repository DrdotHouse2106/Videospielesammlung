import { COOKIE_NAME } from '../services/konten.js';

export function leseCookies(header = '') {
  const cookies = {};
  for (const teil of header.split(';')) {
    const trenner = teil.indexOf('=');
    if (trenner < 0) continue;
    const name = teil.slice(0, trenner).trim();
    try {
      cookies[name] = decodeURIComponent(teil.slice(trenner + 1).trim());
    } catch {
      /* ungültiges Cookie ignorieren */
    }
  }
  return cookies;
}

function istSicher(req, einstellung) {
  if (einstellung === 'true') return true;
  if (einstellung === 'false') return false;
  return req.secure;
}

export function setzeSitzungsCookie(req, res, { token, maxAlterMs }, cookieSicher) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: istSicher(req, cookieSicher),
    maxAge: maxAlterMs,
    path: '/',
  });
}

export function loescheSitzungsCookie(req, res, cookieSicher) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: istSicher(req, cookieSicher), path: '/' });
}

/** Liest das Sitzungs-Cookie und hängt req.benutzer an (falls angemeldet). */
export function ladeSitzung(konten) {
  return (req, _res, next) => {
    req.sitzungsToken = leseCookies(req.headers.cookie)[COOKIE_NAME];
    const ergebnis = konten.leseSitzung(req.sitzungsToken);
    if (ergebnis) {
      req.benutzer = ergebnis.benutzer;
      req.sitzungHash = ergebnis.tokenHash;
    }
    next();
  };
}

/**
 * Schutz vor Cross-Site-Request-Forgery: Ändernde Anfragen müssen von derselben
 * Herkunft stammen (zusätzlich zum SameSite-Cookie).
 */
export function pruefeHerkunft(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const herkunft = req.headers.origin;
  if (!herkunft) return next(); // z. B. curl/Skripte ohne Browser – dort gibt es kein fremdes Cookie
  try {
    if (new URL(herkunft).host === req.headers.host) return next();
  } catch {
    /* ungültige Origin */
  }
  res.status(403).json({ fehler: 'Anfrage von fremder Herkunft abgelehnt.' });
}

/** `optionen.zweiFaktorPflicht` wird bei jeder Anfrage gelesen (live änderbar über Admin → Einstellungen). */
export function erfordereAnmeldung(optionen) {
  return (req, res, next) => {
    if (!req.benutzer) return res.status(401).json({ fehler: 'Bitte melde dich an.', code: 'nicht_angemeldet' });
    if (optionen.zweiFaktorPflicht && !req.benutzer.totp_aktiv) {
      return res.status(403).json({
        fehler: 'Auf diesem Server ist die Zwei-Faktor-Anmeldung Pflicht. Bitte richte sie zuerst ein.',
        code: '2fa_einrichten',
      });
    }
    next();
  };
}

export function erfordereAdmin(req, res, next) {
  if (req.benutzer?.rolle !== 'admin') return res.status(403).json({ fehler: 'Nur für Administratoren.' });
  next();
}
