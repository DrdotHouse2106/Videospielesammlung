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

// Stammdaten der Plattformen (werden beim ersten Start in die Datenbank übernommen und
// können danach von Admins/Moderatoren gepflegt werden). „aliase“ dienen der Zuordnung
// von Freitext und IGDB-Namen.
export const PLATTFORM_STAMMDATEN = [
  // Nintendo
  { name: 'Nintendo Entertainment System', kurz: 'NES', hersteller: 'Nintendo', typ: 'konsole', jahr: 1983, aliase: ['NES', 'Famicom', 'Family Computer'] },
  { name: 'Super Nintendo', kurz: 'SNES', hersteller: 'Nintendo', typ: 'konsole', jahr: 1990, aliase: ['SNES', 'Super Nintendo Entertainment System', 'Super Famicom', 'Super Nintendo (SNES)'] },
  { name: 'Nintendo 64', kurz: 'N64', hersteller: 'Nintendo', typ: 'konsole', jahr: 1996, aliase: ['N64'] },
  { name: 'Nintendo GameCube', kurz: 'GC', hersteller: 'Nintendo', typ: 'konsole', jahr: 2001, aliase: ['GameCube', 'NGC', 'GCN'] },
  { name: 'Nintendo Wii', kurz: 'Wii', hersteller: 'Nintendo', typ: 'konsole', jahr: 2006, aliase: ['Wii'] },
  { name: 'Nintendo Wii U', kurz: 'Wii U', hersteller: 'Nintendo', typ: 'konsole', jahr: 2012, aliase: ['Wii U', 'WiiU'] },
  { name: 'Nintendo Switch', kurz: 'Switch', hersteller: 'Nintendo', typ: 'konsole', jahr: 2017, aliase: ['Switch', 'NSW'] },
  { name: 'Nintendo Switch 2', kurz: 'Switch 2', hersteller: 'Nintendo', typ: 'konsole', jahr: 2025, aliase: ['Switch 2'] },
  { name: 'Game Boy', kurz: 'GB', hersteller: 'Nintendo', typ: 'handheld', jahr: 1989, aliase: ['GB', 'Gameboy'] },
  { name: 'Game Boy Color', kurz: 'GBC', hersteller: 'Nintendo', typ: 'handheld', jahr: 1998, aliase: ['GBC', 'Gameboy Color'] },
  { name: 'Game Boy Advance', kurz: 'GBA', hersteller: 'Nintendo', typ: 'handheld', jahr: 2001, aliase: ['GBA', 'Gameboy Advance'] },
  { name: 'Nintendo DS', kurz: 'DS', hersteller: 'Nintendo', typ: 'handheld', jahr: 2004, aliase: ['NDS', 'DS', 'Nintendo DSi'] },
  { name: 'Nintendo 3DS', kurz: '3DS', hersteller: 'Nintendo', typ: 'handheld', jahr: 2011, aliase: ['3DS', 'New Nintendo 3DS', 'New 3DS'] },
  { name: 'Virtual Boy', kurz: 'VB', hersteller: 'Nintendo', typ: 'konsole', jahr: 1995, aliase: [] },
  // Sony
  { name: 'PlayStation', kurz: 'PS1', hersteller: 'Sony', typ: 'konsole', jahr: 1994, aliase: ['PS1', 'PSX', 'PSone', 'PlayStation 1'] },
  { name: 'PlayStation 2', kurz: 'PS2', hersteller: 'Sony', typ: 'konsole', jahr: 2000, aliase: ['PS2'] },
  { name: 'PlayStation 3', kurz: 'PS3', hersteller: 'Sony', typ: 'konsole', jahr: 2006, aliase: ['PS3'] },
  { name: 'PlayStation 4', kurz: 'PS4', hersteller: 'Sony', typ: 'konsole', jahr: 2013, aliase: ['PS4'] },
  { name: 'PlayStation 5', kurz: 'PS5', hersteller: 'Sony', typ: 'konsole', jahr: 2020, aliase: ['PS5'] },
  { name: 'PlayStation Portable', kurz: 'PSP', hersteller: 'Sony', typ: 'handheld', jahr: 2004, aliase: ['PSP', 'PlayStation Portable (PSP)'] },
  { name: 'PlayStation Vita', kurz: 'Vita', hersteller: 'Sony', typ: 'handheld', jahr: 2011, aliase: ['PS Vita', 'PSVita'] },
  // Microsoft
  { name: 'Xbox', kurz: 'Xbox', hersteller: 'Microsoft', typ: 'konsole', jahr: 2001, aliase: ['Xbox Classic'] },
  { name: 'Xbox 360', kurz: 'X360', hersteller: 'Microsoft', typ: 'konsole', jahr: 2005, aliase: ['X360'] },
  { name: 'Xbox One', kurz: 'XOne', hersteller: 'Microsoft', typ: 'konsole', jahr: 2013, aliase: ['XB1'] },
  { name: 'Xbox Series X|S', kurz: 'XSX', hersteller: 'Microsoft', typ: 'konsole', jahr: 2020, aliase: ['Xbox Series X', 'Xbox Series S', 'XSX'] },
  // Sega
  { name: 'Sega Master System', kurz: 'SMS', hersteller: 'Sega', typ: 'konsole', jahr: 1986, aliase: ['Master System', 'Sega Master System/Mark III'] },
  { name: 'Sega Mega Drive', kurz: 'MD', hersteller: 'Sega', typ: 'konsole', jahr: 1988, aliase: ['Mega Drive', 'Genesis', 'Sega Genesis', 'Sega Mega Drive/Genesis'] },
  { name: 'Sega Mega-CD', kurz: 'MCD', hersteller: 'Sega', typ: 'konsole', jahr: 1991, aliase: ['Mega-CD', 'Sega CD'] },
  { name: 'Sega 32X', kurz: '32X', hersteller: 'Sega', typ: 'konsole', jahr: 1994, aliase: ['32X'] },
  { name: 'Sega Saturn', kurz: 'Saturn', hersteller: 'Sega', typ: 'konsole', jahr: 1994, aliase: ['Saturn'] },
  { name: 'Sega Dreamcast', kurz: 'DC', hersteller: 'Sega', typ: 'konsole', jahr: 1998, aliase: ['Dreamcast'] },
  { name: 'Sega Game Gear', kurz: 'GG', hersteller: 'Sega', typ: 'handheld', jahr: 1990, aliase: ['Game Gear'] },
  // Weitere
  { name: 'Atari 2600', kurz: '2600', hersteller: 'Atari', typ: 'konsole', jahr: 1977, aliase: ['Atari VCS'] },
  { name: 'Atari 7800', kurz: '7800', hersteller: 'Atari', typ: 'konsole', jahr: 1986, aliase: [] },
  { name: 'Atari Jaguar', kurz: 'Jaguar', hersteller: 'Atari', typ: 'konsole', jahr: 1993, aliase: ['Jaguar'] },
  { name: 'Atari Lynx', kurz: 'Lynx', hersteller: 'Atari', typ: 'handheld', jahr: 1989, aliase: ['Lynx'] },
  { name: 'Commodore 64', kurz: 'C64', hersteller: 'Commodore', typ: 'computer', jahr: 1982, aliase: ['C64', 'Commodore C64/128/MAX'] },
  { name: 'Commodore Amiga', kurz: 'Amiga', hersteller: 'Commodore', typ: 'computer', jahr: 1985, aliase: ['Amiga'] },
  { name: 'Neo Geo', kurz: 'NeoGeo', hersteller: 'SNK', typ: 'konsole', jahr: 1990, aliase: ['Neo Geo AES', 'Neo Geo MVS', 'Neo Geo CD'] },
  { name: 'PC Engine', kurz: 'PCE', hersteller: 'NEC', typ: 'konsole', jahr: 1987, aliase: ['TurboGrafx-16', 'TurboGrafx-16/PC Engine'] },
  { name: 'PC', kurz: 'PC', hersteller: 'PC', typ: 'computer', jahr: null, aliase: ['PC (Microsoft Windows)', 'Windows', 'DOS', 'PC DVD-ROM', 'PC CD-ROM'] },
  { name: 'Sonstige', kurz: 'Sonst.', hersteller: 'Sonstige', typ: 'sonstige', jahr: null, aliase: [] },
];

// Einfache Namensliste (z. B. für Vorschläge)
export const PLATTFORMEN = PLATTFORM_STAMMDATEN.map((p) => p.name);

export const HERSTELLER_REIHENFOLGE = ['Nintendo', 'Sony', 'Microsoft', 'Sega', 'Atari', 'Commodore', 'SNK', 'NEC', 'PC', 'Sonstige'];

export const ALLE_WERTE = {
  typ: ARTIKELTYPEN.map((e) => e.value),
  zustand: ZUSTAENDE.map((e) => e.value),
  vollstaendigkeit: VOLLSTAENDIGKEITEN.map((e) => e.value),
  region: REGIONEN.map((e) => e.value),
  pruefstatus: ['privat', 'eingereicht', 'freigegeben', 'abgelehnt'],
  rolle: ['nutzer', 'moderator', 'admin'],
  preisart: ['angebot', 'verkauf'],
  preisquelle: ['ebay', 'kleinanzeigen', 'vinted', 'amazon', 'haendler', 'boerse', 'forum', 'sonstiges'],
};

/** Darf diese Rolle moderieren (Katalog freigeben, Scans prüfen, Kauflinks pflegen)? */
export const istModerator = (benutzer) => ['admin', 'moderator'].includes(benutzer?.rolle);

/** Liefert die Beschriftung zu einem gespeicherten Wert (oder den Wert selbst). */
export function beschriftung(liste, wert, feld = 'label') {
  const eintrag = liste.find((e) => e.value === wert);
  return eintrag ? eintrag[feld] ?? eintrag.label : wert ?? '';
}

// Arten von Scans und Dokumenten, die an einen Katalogeintrag (z. B. ein Spiel) angehängt werden können.
export const MEDIENARTEN = [
  { value: 'cover_vorne', label: 'Cover vorne' },
  { value: 'cover_hinten', label: 'Cover hinten' },
  { value: 'cover_komplett', label: 'Cover komplett (Inlay)' },
  { value: 'handbuch', label: 'Handbuch / Anleitung' },
  { value: 'label', label: 'Modul-/Disc-Label' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

// Freigabe-Status für Katalogeinträge, Varianten und Scans (Moderation)
export const PRUEFSTATUS = [
  { value: 'privat', label: 'Privat', beschreibung: 'Nur für dich sichtbar.' },
  { value: 'eingereicht', label: 'Zur Prüfung eingereicht', beschreibung: 'Wartet auf Freigabe durch das Moderationsteam.' },
  { value: 'freigegeben', label: 'Freigegeben', beschreibung: 'Für alle Benutzer sichtbar.' },
  { value: 'abgelehnt', label: 'Abgelehnt', beschreibung: 'Nicht freigegeben – bleibt privat.' },
];

export const ROLLEN = [
  { value: 'nutzer', label: 'Nutzer' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'admin', label: 'Administrator' },
];

// Preis-Historie: wo und wie ein Artikel angeboten/verkauft wurde
export const PREISARTEN = [
  { value: 'angebot', label: 'Angeboten' },
  { value: 'verkauf', label: 'Verkauft' },
];

export const PREISQUELLEN = [
  { value: 'ebay', label: 'eBay' },
  { value: 'kleinanzeigen', label: 'Kleinanzeigen' },
  { value: 'vinted', label: 'Vinted' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'haendler', label: 'Retro-Händler / Shop' },
  { value: 'boerse', label: 'Flohmarkt / Börse' },
  { value: 'forum', label: 'Forum / Community' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

export const MARKTPREIS_STUFEN = [
  { value: 'lose', label: 'Lose' },
  { value: 'cib', label: 'CIB' },
  { value: 'neu', label: 'Neu/OVP' },
];

// ── Tauschbörse (Suche/Biete) ─────────────────────────────────────
export const ANGEBOTSARTEN = [
  { value: 'verkauf', label: 'Verkauf' },
  { value: 'tausch', label: 'Tausch' },
  { value: 'beides', label: 'Verkauf oder Tausch' },
];

export const ANGEBOTSSTATUS = [
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'reserviert', label: 'Reserviert' },
  { value: 'verkauft', label: 'Verkauft/getauscht' },
  { value: 'beendet', label: 'Beendet' },
  { value: 'abgelaufen', label: 'Abgelaufen' },
  { value: 'entfernt', label: 'Vom Moderationsteam entfernt' },
];

export const BEWERTUNGSWERTE = [
  { value: 1, label: 'Positiv', icon: '👍' },
  { value: 0, label: 'Neutral', icon: '😐' },
  { value: -1, label: 'Negativ', icon: '👎' },
];

/** Pflichtangaben gewerblicher Anbieter (Anbieterkennzeichnung) und freiwillige Zusatzangaben. */
export const HAENDLER_FELDER = [
  { feld: 'firma', label: 'Firma bzw. Name', pflicht: true },
  { feld: 'anschrift', label: 'Anschrift (Straße, PLZ, Ort)', pflicht: true, mehrzeilig: true },
  { feld: 'email', label: 'E-Mail-Adresse', pflicht: true },
  { feld: 'telefon', label: 'Telefon' },
  { feld: 'vertreten', label: 'Vertretungsberechtigt' },
  { feld: 'register', label: 'Handelsregister (Gericht und Nummer)' },
  { feld: 'ustid', label: 'USt-IdNr.' },
  { feld: 'shop_url', label: 'Eigener Shop (Adresse)' },
  { feld: 'versandinfo', label: 'Versand und Zahlung', mehrzeilig: true },
  { feld: 'widerruf', label: 'Widerrufsbelehrung/AGB (Text oder Link)', mehrzeilig: true },
];
