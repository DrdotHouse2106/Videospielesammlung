// Speicherplatz-Kontingent je Benutzer für eigene Uploads (Artikelfotos, Scans, Handbücher).
// Gezählt werden alle Dateien, die (noch) dem Benutzer gehören – also private, eingereichte und
// abgelehnte Scans sowie Artikelfotos. Freigegebene Scans gehören zur Gemeinschaftsdatenbank
// und belasten das Kontingent nicht mehr.
import fs from 'node:fs';
import { KontoFehler } from './konten.js';

const MB = 1024 * 1024;

export function formatiereGroesse(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  if (bytes >= MB) return `${(bytes / MB).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(0, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`;
}

export function erstelleSpeicherDienst(db, { standardMb = 1024, dateien }) {
  const dateiGroesse = (datei) => {
    if (!datei) return 0;
    try {
      return fs.statSync(dateien.pfadVon(datei)).size;
    } catch {
      return 0;
    }
  };

  // Größen für Dateien nachtragen, die vor Einführung des Kontingents hochgeladen wurden
  const alteMedien = db.prepare('SELECT id, datei, anzeige_datei, vorschau_datei FROM medien WHERE groesse_gesamt IS NULL').all();
  const alteBilder = db.prepare('SELECT id, bild_datei FROM artikel WHERE bild_datei IS NOT NULL AND bild_groesse IS NULL').all();
  if (alteMedien.length || alteBilder.length) {
    const setzeMedium = db.prepare('UPDATE medien SET groesse_gesamt = ? WHERE id = ?');
    const setzeBild = db.prepare('UPDATE artikel SET bild_groesse = ? WHERE id = ?');
    db.transaction(() => {
      for (const m of alteMedien) setzeMedium.run(dateiGroesse(m.datei) + dateiGroesse(m.anzeige_datei) + dateiGroesse(m.vorschau_datei), m.id);
      for (const a of alteBilder) setzeBild.run(dateiGroesse(a.bild_datei), a.id);
    })();
  }

  const belegtAbfrage = db.prepare(`
    SELECT (SELECT COALESCE(SUM(groesse_gesamt), 0) FROM medien WHERE benutzer_id = @id AND sichtbarkeit <> 'freigegeben')
         + (SELECT COALESCE(SUM(bild_groesse), 0) FROM artikel WHERE benutzer_id = @id AND bild_datei IS NOT NULL) AS n`);
  const benutzerLimit = db.prepare('SELECT rolle, speicher_limit_mb FROM benutzer WHERE id = ?');

  /** Limit in Byte, null = unbegrenzt. Administratoren sind ohne eigenes Limit unbegrenzt. */
  const standard = () => (typeof standardMb === 'function' ? standardMb() : standardMb);

  function limitBytes(benutzerId) {
    const b = benutzerLimit.get(benutzerId);
    if (!b) return 0;
    const mb = b.speicher_limit_mb ?? (b.rolle === 'admin' ? 0 : standard());
    return mb > 0 ? mb * MB : null;
  }

  const belegt = (benutzerId) => belegtAbfrage.get({ id: benutzerId }).n;

  function info(benutzerId) {
    const b = benutzerLimit.get(benutzerId);
    const limit = limitBytes(benutzerId);
    const genutzt = belegt(benutzerId);
    return {
      belegt: genutzt,
      limit,
      frei: limit === null ? null : Math.max(0, limit - genutzt),
      eigenesLimit: b?.speicher_limit_mb ?? null,
      standardMb: standard(),
    };
  }

  function voll(limit) {
    return new KontoFehler(
      `Dein Speicherplatz ist voll (${formatiereGroesse(limit)}). Lösche nicht mehr benötigte Scans oder Fotos `
      + 'oder verlinke Cover und Handbücher auf externe Seiten.',
      413,
      'speicher_voll',
    );
  }

  /** Wirft einen Fehler, wenn zusätzliche Bytes das Kontingent überschreiten würden. */
  function pruefe(benutzerId, zusaetzlich = 0, { abzueglich = 0 } = {}) {
    const limit = limitBytes(benutzerId);
    if (limit === null) return;
    if (belegt(benutzerId) - abzueglich + zusaetzlich > limit) throw voll(limit);
  }

  /** Middleware vor dem Upload: bei vollem Speicher gar nicht erst die ganze Datei annehmen. */
  function vorabPruefung(req, _res, next) {
    const limit = limitBytes(req.benutzer.id);
    if (limit === null) return next();
    const genutzt = belegt(req.benutzer.id);
    const laenge = Number(req.headers['content-length']) || 0;
    // Bei Content-Length etwas Spielraum für die Formular-Kopfdaten lassen
    if (genutzt >= limit || laenge - 64 * 1024 > limit - genutzt) return next(voll(limit));
    next();
  }

  const summe = (...namen) => namen.reduce((s, n) => s + dateiGroesse(n), 0);

  return { info, pruefe, vorabPruefung, limitBytes, belegt, summe, get standardMb() { return standard(); } };
}
