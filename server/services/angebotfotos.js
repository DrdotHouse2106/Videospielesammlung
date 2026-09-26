// Fotos an Angeboten der Tauschbörse: bis zu sechs je Angebot. Jedes Foto wird gedreht (EXIF), auf höchstens 1600 px
// verkleinert und als WebP gespeichert – dabei entfallen alle Metadaten (z. B. GPS-Koordinaten des Handys).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { KontoFehler } from './konten.js';

export const MAX_FOTOS = 6;
export const FOTO_TYPEN = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export function erstelleAngebotFotoDienst(db, { dateien, speicher }) {
  const q = {
    angebot: db.prepare('SELECT * FROM angebote WHERE id = ?'),
    anzahl: db.prepare('SELECT COUNT(*) AS n FROM angebot_fotos WHERE angebot_id = ?'),
    einfuegen: db.prepare(`INSERT INTO angebot_fotos (angebot_id, benutzer_id, datei, vorschau, groesse, reihenfolge)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(reihenfolge), -1) + 1 FROM angebot_fotos WHERE angebot_id = ?))`),
    foto: db.prepare('SELECT * FROM angebot_fotos WHERE id = ?'),
    alle: db.prepare('SELECT * FROM angebot_fotos WHERE angebot_id = ? ORDER BY reihenfolge, id'),
  };

  function eigenesAngebot(benutzer, angebotId) {
    const a = q.angebot.get(Number(angebotId));
    if (!a || a.benutzer_id !== benutzer.id) throw new KontoFehler('Angebot nicht gefunden.', 404);
    if (a.status === 'entfernt') throw new KontoFehler('Das Angebot wurde entfernt.', 409);
    return a;
  }

  /** Eine Bilddatei (Pfad) verarbeiten und dem Angebot hinzufügen. Die Quelldatei bleibt unberührt. */
  async function fuegeHinzu(benutzer, angebotId, quellPfad) {
    const a = eigenesAngebot(benutzer, angebotId);
    if (q.anzahl.get(a.id).n >= MAX_FOTOS) throw new KontoFehler(`Höchstens ${MAX_FOTOS} Fotos je Angebot.`, 409);
    const basis = `f-${crypto.randomUUID()}`;
    const datei = `${basis}.webp`;
    const vorschau = `${basis}-vorschau.webp`;
    try {
      const eingabe = sharp(quellPfad, { limitInputPixels: 100_000_000, failOn: 'error' }).rotate();
      await eingabe.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 })
        .toFile(dateien.pfadVon(datei));
      await eingabe.clone().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 })
        .toFile(dateien.pfadVon(vorschau));
    } catch {
      dateien.loesche(datei, vorschau);
      throw new KontoFehler('Das Bild konnte nicht gelesen werden. Bitte JPG, PNG oder WebP verwenden.', 400);
    }
    const groesse = (await fs.stat(dateien.pfadVon(datei))).size + (await fs.stat(dateien.pfadVon(vorschau))).size;
    try {
      speicher.pruefe(benutzer.id, groesse);
    } catch (e) {
      dateien.loesche(datei, vorschau);
      throw e;
    }
    q.einfuegen.run(a.id, benutzer.id, datei, vorschau, groesse, a.id);
  }

  function entferne(benutzer, fotoId) {
    const f = q.foto.get(Number(fotoId));
    if (!f || f.benutzer_id !== benutzer.id) throw new KontoFehler('Foto nicht gefunden.', 404);
    db.prepare('DELETE FROM angebot_fotos WHERE id = ?').run(f.id);
    dateien.loesche(f.datei, f.vorschau);
    return f.angebot_id;
  }

  /** Foto an die erste Stelle setzen (Titelbild in Listen). */
  function alsTitelbild(benutzer, fotoId) {
    const f = q.foto.get(Number(fotoId));
    if (!f || f.benutzer_id !== benutzer.id) throw new KontoFehler('Foto nicht gefunden.', 404);
    const reihe = q.alle.all(f.angebot_id).filter((x) => x.id !== f.id);
    db.transaction(() => {
      db.prepare('UPDATE angebot_fotos SET reihenfolge = 0 WHERE id = ?').run(f.id);
      reihe.forEach((x, i) => db.prepare('UPDATE angebot_fotos SET reihenfolge = ? WHERE id = ?').run(i + 1, x.id));
    })();
    return f.angebot_id;
  }

  /** Dateien eines Angebots vor dem Löschen merken und danach entfernen. */
  const dateienVon = (angebotId) => q.alle.all(Number(angebotId)).flatMap((f) => [f.datei, f.vorschau]);

  const liste = (angebotId) => q.alle.all(angebotId).map((f) => ({ id: f.id, url: `/api/dateien/${f.datei}`, vorschau: `/api/dateien/${f.vorschau}` }));

  return { fuegeHinzu, entferne, alsTitelbild, dateienVon, liste, pfadImUpload: (datei) => path.join(dateien.verzeichnis, path.basename(datei)) };
}
