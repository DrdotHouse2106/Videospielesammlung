// Adressen der öffentlichen, für Suchmaschinen gedachten Seiten (Server und Client).

const PRAEFIX = { spiel: 'spiel', konsole: 'konsole', zubehoer: 'zubehoer' };

/** „Pokémon Gelbe Edition“ → „pokemon-gelbe-edition“ */
export function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' und ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Öffentliche Seite eines Katalogeintrags, z. B. /spiel/42-super-mario-64-n64 */
export function katalogPfad(eintrag, plattformKurz) {
  const praefix = PRAEFIX[eintrag.typ] ?? 'spiel';
  const zusatz = eintrag.typ === 'spiel' && plattformKurz ? ` ${plattformKurz}` : '';
  const teil = slug(`${eintrag.titel}${zusatz}`);
  return `/${praefix}/${eintrag.id}${teil ? `-${teil}` : ''}`;
}

export const plattformPfad = (plattform) => `/plattform/${slug(plattform.kurz || plattform.name)}`;

export const KATALOG_PRAEFIXE = Object.values(PRAEFIX);
