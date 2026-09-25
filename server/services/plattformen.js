// Plattform-Stammdaten: Zuordnung von Freitext/IGDB-Namen zu festen Plattformen.

const normal = (text) => String(text ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9|]+/g, '');

export function plattformZuObjekt(zeile) {
  return zeile ? { ...zeile, aliase: JSON.parse(zeile.aliase || '[]') } : null;
}

/** Baut einen Suchindex Name/Kurzname/Aliase → Plattform. */
export function ladePlattformIndex(db) {
  const index = new Map();
  for (const zeile of db.prepare('SELECT * FROM plattformen').all()) {
    const p = plattformZuObjekt(zeile);
    for (const schluessel of [p.name, p.kurz, ...p.aliase]) {
      const n = normal(schluessel);
      if (n && !index.has(n)) index.set(n, p);
    }
    // Auch der Name ohne Klammerzusatz, z. B. „Super Nintendo (SNES)“
    index.set(normal(p.name), p);
  }
  return index;
}

export function ordnePlattformZu(index, text) {
  if (!text) return null;
  return index.get(normal(text)) ?? null;
}

export function erstellePlattformDienst(db) {
  let index = null;
  const aktuellerIndex = () => (index ??= ladePlattformIndex(db));

  return {
    alle: () => db.prepare('SELECT * FROM plattformen ORDER BY hersteller, erscheinungsjahr, name').all().map(plattformZuObjekt),
    hole: (id) => plattformZuObjekt(db.prepare('SELECT * FROM plattformen WHERE id = ?').get(id)),
    zuordnen: (text) => ordnePlattformZu(aktuellerIndex(), text),
    /** Nach Änderungen an den Stammdaten aufrufen. */
    indexNeuLaden: () => { index = null; },
    /** Verknüpft einen Katalogeintrag mit den Plattformen aus seiner Namensliste. */
    verknuepfeKatalog(katalogId, namen) {
      const einfuegen = db.prepare('INSERT OR IGNORE INTO katalog_plattformen (katalog_id, plattform_id) VALUES (?, ?)');
      for (const name of namen ?? []) {
        const p = ordnePlattformZu(aktuellerIndex(), name);
        if (p) einfuegen.run(katalogId, p.id);
      }
    },
  };
}
