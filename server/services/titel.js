// Hilfsfunktionen, um Produktnamen aus Barcode-Datenbanken in brauchbare
// Suchbegriffe für IGDB umzuwandeln. Händlertitel sehen oft so aus:
// "Super Mario Odyssey - [Nintendo Switch] USK 6" → "Super Mario Odyssey"

const PLATTFORM_BEGRIFFE = [
  'nintendo switch 2', 'nintendo switch', 'switch 2', 'switch',
  'playstation 5', 'playstation 4', 'playstation 3', 'playstation 2', 'playstation vita', 'playstation portable', 'playstation',
  'ps5', 'ps4', 'ps3', 'ps2', 'ps1', 'psx', 'psp', 'ps vita', 'psvita',
  'xbox series x', 'xbox series s', 'xbox series x\\|s', 'xbox one', 'xbox 360', 'xbox',
  'nintendo 3ds', 'new 3ds', '3ds', 'nintendo ds', 'nds',
  'wii u', 'wiiu', 'wii', 'gamecube', 'game cube', 'ngc',
  'nintendo 64', 'n64', 'super nintendo', 'snes', 'nes',
  'game boy advance', 'gameboy advance', 'gba', 'game boy color', 'gameboy color', 'gbc', 'game boy', 'gameboy',
  'sega mega drive', 'mega drive', 'megadrive', 'sega saturn', 'saturn', 'dreamcast', 'master system', 'game gear',
  'pc dvd-rom', 'pc dvd', 'pc cd-rom', 'pc',
];

const FUELLWOERTER = [
  'usk\\s*(ab\\s*)?\\d+', 'pegi\\s*\\d+', 'fsk\\s*\\d+', 'ab \\d+ jahren?',
  'standard edition', 'standard', 'deutsche version', 'dt\\. version', 'uncut', 'at-pegi',
  'pal', 'ntsc', 'ntsc-u', 'ntsc-j', 'videospiel', 'computerspiel', 'spiel', 'game', 'software', 'neu', 'ovp', 'new', 'sealed',
];

const plattformRegex = new RegExp(`\\b(${PLATTFORM_BEGRIFFE.map((b) => b.replace(/ /g, '\\s*')).join('|')})\\b`, 'gi');
const fuellRegex = new RegExp(`\\b(${FUELLWOERTER.join('|')})\\b`, 'gi');

export function bereinigeProduktname(name) {
  if (!name) return '';
  let t = String(name)
    .replace(/\[[^\]]*\]/g, ' ') // [PlayStation 4]
    .replace(/\([^)]*\)/g, ' ') // (PEGI)
    .replace(plattformRegex, ' ')
    .replace(fuellRegex, ' ')
    .replace(/[|/®™©]+/g, ' ')
    .replace(/\s+[-–:]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Übrig gebliebene Trenner am Anfang/Ende entfernen.
  t = t.replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, '').trim();
  return t || String(name).trim();
}

/** Liefert nur Ziffern und prüft die Länge (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function normalisiereBarcode(code) {
  const ziffern = String(code ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(ziffern.length)) return null;
  return ziffern;
}

/** Alle gleichwertigen Schreibweisen eines Codes (UPC-A ↔ EAN-13 mit führender 0). */
export function barcodeVarianten(code) {
  const varianten = new Set([code]);
  if (code.length === 12) varianten.add(`0${code}`);
  if (code.length === 13 && code.startsWith('0')) varianten.add(code.slice(1));
  return [...varianten];
}
