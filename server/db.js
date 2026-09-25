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
  // 2: Benutzerkonten, Sitzungen, 2FA, Marktwerte, Scans/Dokumente
  `
  CREATE TABLE benutzer (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzername         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    anzeigename          TEXT,
    passwort_hash        TEXT    NOT NULL,
    rolle                TEXT    NOT NULL DEFAULT 'nutzer',   -- 'admin' oder 'nutzer'
    gesperrt             INTEGER NOT NULL DEFAULT 0,
    totp_geheimnis       TEXT,                                -- verschlüsselt
    totp_aktiv           INTEGER NOT NULL DEFAULT 0,
    totp_letzter_schritt INTEGER,
    wiederherstellungscodes TEXT,                             -- JSON-Array mit Hashes
    sammlung_oeffentlich INTEGER NOT NULL DEFAULT 0,
    erstellt_am          TEXT    NOT NULL DEFAULT (datetime('now')),
    letzte_anmeldung     TEXT
  );

  CREATE TABLE sitzungen (
    token_hash   TEXT PRIMARY KEY,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    stufe        TEXT    NOT NULL DEFAULT 'voll',            -- 'voll' oder '2fa' (wartet auf Code)
    laeuft_ab    INTEGER NOT NULL,                           -- Unix-Zeit in ms
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    geraet       TEXT
  );
  CREATE INDEX idx_sitzungen_benutzer ON sitzungen (benutzer_id);

  ALTER TABLE artikel ADD COLUMN benutzer_id INTEGER REFERENCES benutzer (id) ON DELETE CASCADE;
  ALTER TABLE artikel ADD COLUMN marktwert REAL;
  CREATE INDEX idx_artikel_benutzer ON artikel (benutzer_id);

  ALTER TABLE katalog ADD COLUMN erstellt_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL;

  CREATE TABLE medien (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    katalog_id      INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    benutzer_id     INTEGER REFERENCES benutzer (id) ON DELETE CASCADE,
    art             TEXT    NOT NULL,     -- cover_vorne, cover_hinten, cover_komplett, handbuch, label, sonstiges
    titel           TEXT,
    sichtbarkeit    TEXT    NOT NULL DEFAULT 'privat',       -- 'privat' oder 'geteilt'
    datei           TEXT    NOT NULL,     -- Original
    anzeige_datei   TEXT,                 -- browsertaugliche Version (z. B. aus TIFF)
    vorschau_datei  TEXT,                 -- kleines Vorschaubild
    originalname    TEXT,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    breite          INTEGER,
    hoehe           INTEGER,
    dpi             REAL,
    seiten          INTEGER,
    erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_medien_katalog ON medien (katalog_id);

  CREATE TABLE preise (
    katalog_id    INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    preisregion   TEXT    NOT NULL,       -- 'pal', 'ntsc', 'jp'
    daten         TEXT,                   -- JSON (Preise in EUR) oder NULL = nicht gefunden
    abgerufen_am  INTEGER NOT NULL,
    PRIMARY KEY (katalog_id, preisregion)
  );
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
