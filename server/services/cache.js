// Einfacher Schlüssel-Wert-Cache in SQLite für Antworten externer Dienste.
// So werden wiederholte Suchen sofort beantwortet und API-Limits geschont.

export function erstelleCache(db, ttlStunden) {
  const ttlMs = ttlStunden * 60 * 60 * 1000;
  const lesen = db.prepare('SELECT daten, abgerufen_am FROM api_cache WHERE schluessel = ?');
  const schreiben = db.prepare(
    `INSERT INTO api_cache (schluessel, daten, abgerufen_am) VALUES (?, ?, ?)
     ON CONFLICT (schluessel) DO UPDATE SET daten = excluded.daten, abgerufen_am = excluded.abgerufen_am`,
  );
  const aufraeumen = db.prepare('DELETE FROM api_cache WHERE abgerufen_am < ?');

  return {
    hole(schluessel) {
      const zeile = lesen.get(schluessel);
      if (!zeile || Date.now() - zeile.abgerufen_am > ttlMs) return undefined;
      return JSON.parse(zeile.daten);
    },
    setze(schluessel, wert) {
      schreiben.run(schluessel, JSON.stringify(wert), Date.now());
    },
    raeumeAuf() {
      return aufraeumen.run(Date.now() - ttlMs).changes;
    },
    async merke(schluessel, erzeuger) {
      const vorhanden = this.hole(schluessel);
      if (vorhanden !== undefined) return vorhanden;
      const wert = await erzeuger();
      this.setze(schluessel, wert);
      return wert;
    },
  };
}
