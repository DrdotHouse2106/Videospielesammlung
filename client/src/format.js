const waehrung = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const zahl = new Intl.NumberFormat('de-DE');
const datum = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const euro = (wert) => (wert == null ? '–' : waehrung.format(wert));
export const anzahl = (wert) => zahl.format(wert ?? 0);

/** "2024-05-01" → "01.05.2024" (ohne Zeitzonen-Verschiebung). */
export function datumDe(iso) {
  if (!iso) return '–';
  const [j, m, t] = iso.slice(0, 10).split('-').map(Number);
  return datum.format(new Date(j, m - 1, t));
}

/** Preis für ein Eingabefeld im deutschen Format: 49.9 → "49,90". */
export const preisFeld = (wert) => (wert == null ? '' : wert.toFixed(2).replace('.', ','));

/** Dateigröße lesbar: 12345678 → "11,8 MB". */
export function dateigroesse(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${anzahl(Math.round(bytes / 1024))} KB`;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

/** Vorzeichenbehafteter Euro-Betrag: +12,50 € / −3,00 €. */
export const euroMitVorzeichen = (wert) => (wert == null ? '–' : `${wert > 0 ? '+' : wert < 0 ? '−' : '±'}${waehrung.format(Math.abs(wert))}`);

/** Region des Artikels → Preisregion für Marktpreise. */
export const preisregion = (region) => (region === 'ntsc_u' ? 'ntsc' : region === 'ntsc_j' ? 'jp' : 'pal');
