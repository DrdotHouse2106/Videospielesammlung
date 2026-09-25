import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Migrationen werden der Reihe nach ausgeführt. Neue Änderungen am Schema
// immer als neuen Eintrag unten anhängen – bestehende nie verändern.
const MIGRATIONEN = [
  `
  CREATE TABLE katalog (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    quelle           TEXT    NOT NULL,              -- 'igdb' oder 'eigen'
    externe_id       TEXT,                          -- z. B. IGDB-ID
    typ              TEXT    NOT NULL DEFAULT 'spiel',
    titel            TEXT    NOT NULL,
    plattformen      TEXT    NOT NULL DEFAULT '[]', -- JSON-Array
    erscheinungsjahr INTEGER,
    hersteller       TEXT,
    cover_url        TEXT,
    beschreibung     TEXT,
    daten            TEXT,                          -- Rohdaten (JSON)
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (quelle, externe_id)
  );
  CREATE INDEX idx_katalog_titel ON katalog (titel COLLATE NOCASE);

  CREATE TABLE barcodes (
    code         TEXT PRIMARY KEY,
    katalog_id   INTEGER REFERENCES katalog (id) ON DELETE SET NULL,
    produktname  TEXT,
    quelle       TEXT,
    abgerufen_am TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE api_cache (
    schluessel   TEXT PRIMARY KEY,
    daten        TEXT    NOT NULL,
    abgerufen_am INTEGER NOT NULL                   -- Unix-Zeit in ms
  );

  CREATE TABLE einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert       TEXT
  );

  CREATE TABLE artikel (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    typ              TEXT    NOT NULL,
    titel            TEXT    NOT NULL,
    plattform        TEXT,
    katalog_id       INTEGER REFERENCES katalog (id) ON DELETE SET NULL,
    barcode          TEXT,
    cover_url        TEXT,
    bild_datei       TEXT,
    zustand          TEXT,
    vollstaendigkeit TEXT,
    region           TEXT,
    farbe            TEXT,
    edition          TEXT,
    modellnummer     TEXT,
    seriennummer     TEXT,
    notizen          TEXT,
    kaufpreis        REAL,
    kaufdatum        TEXT,
    anzahl           INTEGER NOT NULL DEFAULT 1,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_artikel_typ ON artikel (typ);
  CREATE INDEX idx_artikel_titel ON artikel (titel COLLATE NOCASE);
  CREATE INDEX idx_artikel_barcode ON artikel (barcode);
  `,
];

export function oeffneDatenbank(dateipfad) {
  if (dateipfad !== ':memory:') {
    fs.mkdirSync(path.dirname(dateipfad), { recursive: true });
  }
  const db = new Database(dateipfad);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migriere(db);
  return db;
}

function migriere(db) {
  const aktuell = db.pragma('user_version', { simple: true });
  for (let i = aktuell; i < MIGRATIONEN.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONEN[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
