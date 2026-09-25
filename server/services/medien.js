// Verarbeitung hochgeladener Scans: Metadaten (Auflösung, DPI) auslesen,
// Vorschaubilder erzeugen und nicht browsertaugliche Formate (TIFF) umwandeln.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

export const MEDIEN_TYPEN = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/tiff': '.tif',
  'application/pdf': '.pdf',
};

const BROWSERTAUGLICH = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PIXEL = 600_000_000; // reicht für A3 mit 1200 dpi

async function pdfSeiten(pfad) {
  const text = (await fs.readFile(pfad)).toString('latin1');
  const treffer = text.match(/\/Type\s*\/Page(?!s)/g);
  return treffer ? treffer.length : null;
}

/**
 * Verarbeitet eine hochgeladene Datei im Upload-Verzeichnis.
 * @returns {Promise<object>} Felder für die Tabelle „medien“
 */
export async function verarbeiteMedium({ verzeichnis, datei, mime }) {
  const pfad = path.join(verzeichnis, datei);
  const stat = await fs.stat(pfad);
  const ergebnis = { datei, mime, groesse: stat.size, anzeige_datei: null, vorschau_datei: null, breite: null, hoehe: null, dpi: null, seiten: null };

  if (mime === 'application/pdf') {
    const kopf = Buffer.alloc(5);
    const handle = await fs.open(pfad);
    await handle.read(kopf, 0, 5, 0);
    await handle.close();
    if (kopf.toString() !== '%PDF-') throw new Error('Die Datei ist kein gültiges PDF.');
    ergebnis.seiten = await pdfSeiten(pfad);
    return ergebnis;
  }

  const bild = sharp(pfad, { limitInputPixels: MAX_PIXEL, failOn: 'error' });
  const meta = await bild.metadata();
  ergebnis.breite = meta.width ?? null;
  ergebnis.hoehe = meta.height ?? null;
  // DPI nur übernehmen, wenn sie plausibel ist (72 dpi ist meist nur ein Standardwert).
  ergebnis.dpi = meta.density && meta.density > 72 ? Math.round(meta.density) : null;
  const basis = datei.replace(/\.[^.]+$/, '');

  if (!BROWSERTAUGLICH.has(mime)) {
    ergebnis.anzeige_datei = `${basis}-anzeige.jpg`;
    await sharp(pfad, { limitInputPixels: MAX_PIXEL })
      .rotate()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
      .withMetadata({ density: meta.density || undefined })
      .toFile(path.join(verzeichnis, ergebnis.anzeige_datei));
  }

  ergebnis.vorschau_datei = `${basis}-vorschau.webp`;
  await sharp(pfad, { limitInputPixels: MAX_PIXEL })
    .rotate()
    .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(verzeichnis, ergebnis.vorschau_datei));

  return ergebnis;
}

export const neuerDateiname = (mime) => `m-${crypto.randomUUID()}${MEDIEN_TYPEN[mime]}`;
