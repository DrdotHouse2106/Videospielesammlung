// Gemeinsame Konstanten für Server und Client.
// Die Schlüssel (value) werden in der Datenbank gespeichert, die Beschriftungen
// (label) werden in der Oberfläche angezeigt. Schlüssel niemals umbenennen,
// sonst passen bestehende Datenbankeinträge nicht mehr.

export const ARTIKELTYPEN = [
  { value: 'spiel', label: 'Spiel', mehrzahl: 'Spiele', icon: '🎮' },
  { value: 'konsole', label: 'Konsole', mehrzahl: 'Konsolen', icon: '🕹️' },
  { value: 'zubehoer', label: 'Zubehör', mehrzahl: 'Zubehör', icon: '🔌' },
];

export const ZUSTAENDE = [
  { value: 'neu_ovp', label: 'Neu/OVP', beschreibung: 'Neu und originalverschweißt, nie benutzt.' },
  { value: 'wie_neu', label: 'Wie neu', beschreibung: 'Kaum benutzt, keine sichtbaren Gebrauchsspuren.' },
  { value: 'sehr_gut', label: 'Sehr gut', beschreibung: 'Minimale Gebrauchsspuren, voll funktionsfähig.' },
  { value: 'gut', label: 'Gut', beschreibung: 'Normale Gebrauchsspuren, voll funktionsfähig.' },
  { value: 'akzeptabel', label: 'Akzeptabel', beschreibung: 'Deutliche Gebrauchsspuren, funktionsfähig.' },
  { value: 'defekt', label: 'Defekt', beschreibung: 'Nicht oder nur eingeschränkt funktionsfähig.' },
];

export const VOLLSTAENDIGKEITEN = [
  { value: 'cib', label: 'CIB (Komplett in OVP)', kurz: 'CIB' },
  { value: 'nur_geraet', label: 'Nur Gerät/Disc/Modul', kurz: 'Lose' },
  { value: 'nur_ovp', label: 'Nur OVP', kurz: 'Nur OVP' },
  { value: 'fehlt_anleitung', label: 'Fehlt Anleitung', kurz: 'o. Anl.' },
];

export const REGIONEN = [
  { value: 'pal_de', label: 'PAL (DE / USK)', kurz: 'PAL-DE' },
  { value: 'pal_eu', label: 'PAL (EU)', kurz: 'PAL-EU' },
  { value: 'ntsc_u', label: 'NTSC-U', kurz: 'NTSC-U' },
  { value: 'ntsc_j', label: 'NTSC-J', kurz: 'NTSC-J' },
];

// Vorschlagsliste für Plattformen (Freitext bleibt erlaubt).
export const PLATTFORMEN = [
  'Nintendo Entertainment System (NES)',
  'Super Nintendo (SNES)',
  'Nintendo 64',
  'Nintendo GameCube',
  'Nintendo Wii',
  'Nintendo Wii U',
  'Nintendo Switch',
  'Nintendo Switch 2',
  'Game Boy',
  'Game Boy Color',
  'Game Boy Advance',
  'Nintendo DS',
  'Nintendo 3DS',
  'Virtual Boy',
  'Sega Master System',
  'Sega Mega Drive',
  'Sega Mega-CD',
  'Sega 32X',
  'Sega Saturn',
  'Sega Dreamcast',
  'Sega Game Gear',
  'PlayStation',
  'PlayStation 2',
  'PlayStation 3',
  'PlayStation 4',
  'PlayStation 5',
  'PlayStation Portable (PSP)',
  'PlayStation Vita',
  'Xbox',
  'Xbox 360',
  'Xbox One',
  'Xbox Series X|S',
  'Atari 2600',
  'Atari 7800',
  'Atari Jaguar',
  'Atari Lynx',
  'Commodore 64',
  'Commodore Amiga',
  'Neo Geo',
  'PC',
  'Sonstige',
];

export const ALLE_WERTE = {
  typ: ARTIKELTYPEN.map((e) => e.value),
  zustand: ZUSTAENDE.map((e) => e.value),
  vollstaendigkeit: VOLLSTAENDIGKEITEN.map((e) => e.value),
  region: REGIONEN.map((e) => e.value),
};

/** Liefert die Beschriftung zu einem gespeicherten Wert (oder den Wert selbst). */
export function beschriftung(liste, wert, feld = 'label') {
  const eintrag = liste.find((e) => e.value === wert);
  return eintrag ? eintrag[feld] ?? eintrag.label : wert ?? '';
}
