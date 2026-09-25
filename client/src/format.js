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
