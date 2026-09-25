import crypto from 'node:crypto';

function gleich(a, b) {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Optionaler Zugangsschutz per HTTP-Basic-Auth.
 * Aktiv, sobald AUTH_USER und AUTH_PASSWORD in der .env gesetzt sind.
 */
export function basicAuth({ benutzer, passwort }) {
  if (!benutzer || !passwort) return (_req, _res, next) => next();
  return (req, res, next) => {
    const [schema, kodiert] = (req.headers.authorization ?? '').split(' ');
    if (schema === 'Basic' && kodiert) {
      const text = Buffer.from(kodiert, 'base64').toString('utf8');
      const trenner = text.indexOf(':');
      // Bewusst & statt &&: beide Vergleiche laufen immer (keine Zeitunterschiede).
      if (trenner > -1 && gleich(text.slice(0, trenner), benutzer) & gleich(text.slice(trenner + 1), passwort)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Videospielesammlung", charset="UTF-8"');
    res.status(401).json({ fehler: 'Anmeldung erforderlich.' });
  };
}
