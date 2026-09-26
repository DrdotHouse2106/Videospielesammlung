// Verwaltung hochgeladener Dateien (Artikelfotos, Scans, Handbücher) inkl. Zugriffsprüfung.
import fs from 'node:fs';
import path from 'node:path';
import { istModerator } from '../../shared/konstanten.js';

export function erstelleDateiDienst(db, { uploadVerzeichnis }) {
  fs.mkdirSync(uploadVerzeichnis, { recursive: true });

  const artikelBild = db.prepare(`
    SELECT a.benutzer_id, b.sammlung_oeffentlich FROM artikel a JOIN benutzer b ON b.id = a.benutzer_id
    WHERE a.bild_datei = ?`);
  const medium = db.prepare(`
    SELECT id, benutzer_id, sichtbarkeit, mime, originalname, datei, anzeige_datei FROM medien
    WHERE datei = @d OR anzeige_datei = @d OR vorschau_datei = @d`);

  const angebotFoto = db.prepare(`
    SELECT f.benutzer_id, a.status, b.gesperrt FROM angebot_fotos f JOIN angebote a ON a.id = f.angebot_id JOIN benutzer b ON b.id = a.benutzer_id
    WHERE f.datei = @d OR f.vorschau = @d`);

  const pfadVon = (datei) => path.join(uploadVerzeichnis, path.basename(datei));

  /** Darf der Benutzer diese Datei sehen? Liefert Metadaten oder null. */
  function zugriff(benutzer, datei) {
    const name = path.basename(String(datei));
    if (!benutzer || name !== datei) return null;
    const bild = artikelBild.get(name);
    if (bild && (bild.benutzer_id === benutzer.id || bild.sammlung_oeffentlich)) return { pfad: pfadVon(name) };
    // Fotos an Angeboten: für angemeldete Benutzer, solange das Angebot sichtbar ist
    const foto = angebotFoto.get({ d: name });
    if (foto && (foto.benutzer_id === benutzer.id || istModerator(benutzer) || (['aktiv', 'reserviert'].includes(foto.status) && !foto.gesperrt))) {
      return { pfad: pfadVon(name) };
    }
    const m = medium.get({ d: name });
    const darf = m && (m.benutzer_id === benutzer.id || m.sichtbarkeit === 'freigegeben'
      || (istModerator(benutzer) && m.sichtbarkeit === 'eingereicht'));
    if (darf) {
      return { pfad: pfadVon(name), medium: m };
    }
    return null;
  }

  function loesche(...dateien) {
    for (const datei of dateien.flat()) {
      if (datei) fs.rm(pfadVon(datei), { force: true }, () => {});
    }
  }

  /** Löscht ein Benutzerkonto samt aller Artikel, Fotos und Scans. */
  function loescheBenutzerdaten(benutzerId) {
    const bilder = db.prepare('SELECT bild_datei FROM artikel WHERE benutzer_id = ? AND bild_datei IS NOT NULL').all(benutzerId);
    const medien = db.prepare('SELECT datei, anzeige_datei, vorschau_datei FROM medien WHERE benutzer_id = ?').all(benutzerId);
    const fotos = db.prepare('SELECT datei, vorschau FROM angebot_fotos WHERE benutzer_id = ?').all(benutzerId);
    db.prepare('DELETE FROM benutzer WHERE id = ?').run(benutzerId);
    loesche(bilder.map((b) => b.bild_datei), medien.flatMap((m) => [m.datei, m.anzeige_datei, m.vorschau_datei]), fotos.flatMap((f) => [f.datei, f.vorschau]));
  }

  return { zugriff, loesche, pfadVon, loescheBenutzerdaten, verzeichnis: uploadVerzeichnis };
}
