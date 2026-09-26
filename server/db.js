import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PLATTFORM_STAMMDATEN } from '../shared/konstanten.js';
import { ordnePlattformZu, ladePlattformIndex } from './services/plattformen.js';
import { RECHTLICHE_VORLAGEN } from './rechtliche-vorlagen.js';

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
  // 3: Moderation, Plattform-Stammdaten, Varianten, Kommentare, Preis-Historie, Kauflinks
  `
  CREATE TABLE plattformen (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    kurz             TEXT    NOT NULL,
    hersteller       TEXT    NOT NULL DEFAULT 'Sonstige',
    typ              TEXT    NOT NULL DEFAULT 'konsole',   -- konsole, handheld, computer, sonstige
    erscheinungsjahr INTEGER,
    aliase           TEXT    NOT NULL DEFAULT '[]'         -- JSON-Array alternativer Namen
  );

  CREATE TABLE katalog_plattformen (
    katalog_id   INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    plattform_id INTEGER NOT NULL REFERENCES plattformen (id) ON DELETE CASCADE,
    PRIMARY KEY (katalog_id, plattform_id)
  );
  CREATE INDEX idx_katalog_plattformen_plattform ON katalog_plattformen (plattform_id);

  ALTER TABLE artikel ADD COLUMN plattform_id INTEGER REFERENCES plattformen (id) ON DELETE SET NULL;
  CREATE INDEX idx_artikel_plattform ON artikel (plattform_id);

  -- Moderation des globalen Katalogs
  ALTER TABLE katalog ADD COLUMN status TEXT NOT NULL DEFAULT 'freigegeben';
  ALTER TABLE katalog ADD COLUMN eingereicht_am TEXT;
  ALTER TABLE katalog ADD COLUMN geprueft_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL;
  ALTER TABLE katalog ADD COLUMN geprueft_am TEXT;
  ALTER TABLE katalog ADD COLUMN pruefung_notiz TEXT;
  UPDATE katalog SET status = CASE
    WHEN quelle = 'igdb' THEN 'freigegeben'
    WHEN erstellt_von IN (SELECT id FROM benutzer WHERE rolle = 'admin') THEN 'freigegeben'
    ELSE 'eingereicht' END,
    eingereicht_am = CASE WHEN quelle = 'eigen' THEN erstellt_am END;
  CREATE INDEX idx_katalog_status ON katalog (status);

  -- Bekannte Varianten/Revisionen eines Katalogeintrags (z. B. SCPH-1002, SCPH-5502 …)
  CREATE TABLE katalog_varianten (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    katalog_id       INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    bezeichnung      TEXT    NOT NULL,
    modellnummer     TEXT,
    farbe            TEXT,
    edition          TEXT,
    region           TEXT,
    erscheinungsjahr INTEGER,
    beschreibung     TEXT,
    status           TEXT    NOT NULL DEFAULT 'privat',
    erstellt_von     INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    geprueft_von     INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    pruefung_notiz   TEXT,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_varianten_katalog ON katalog_varianten (katalog_id);
  ALTER TABLE artikel ADD COLUMN variante_id INTEGER REFERENCES katalog_varianten (id) ON DELETE SET NULL;

  -- Scans: „geteilt“ wird zu „eingereicht“ (muss jetzt freigegeben werden)
  UPDATE medien SET sichtbarkeit = 'eingereicht' WHERE sichtbarkeit = 'geteilt';
  ALTER TABLE medien ADD COLUMN geprueft_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL;
  ALTER TABLE medien ADD COLUMN geprueft_am TEXT;
  ALTER TABLE medien ADD COLUMN pruefung_notiz TEXT;

  -- Barcode-Zuordnungen je Benutzer (private Einträge verraten so nichts an andere)
  CREATE TABLE barcode_zuordnungen (
    code        TEXT    NOT NULL,
    katalog_id  INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (code, katalog_id, benutzer_id)
  );
  INSERT OR IGNORE INTO barcode_zuordnungen (code, katalog_id, benutzer_id)
    SELECT DISTINCT a.barcode, a.katalog_id, a.benutzer_id FROM artikel a
    WHERE a.barcode IS NOT NULL AND a.katalog_id IS NOT NULL AND a.benutzer_id IS NOT NULL;

  -- Private Kommentare/Notizen zu einem Spiel oder Gerät
  CREATE TABLE kommentare (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id     INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    katalog_id      INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    text            TEXT    NOT NULL,
    erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_kommentare ON kommentare (benutzer_id, katalog_id);

  -- Preis-Historie: automatische Marktpreise und gemeldete Angebote/Verkäufe
  CREATE TABLE preis_historie (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    katalog_id       INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    herkunft         TEXT    NOT NULL,       -- 'marktpreis' (automatisch) oder 'meldung' (Nutzer)
    art              TEXT    NOT NULL,       -- marktpreis: lose/cib/neu · meldung: angebot/verkauf
    preis            REAL    NOT NULL,       -- Euro
    datum            TEXT    NOT NULL,       -- YYYY-MM-DD
    quelle           TEXT,                   -- pricecharting, ebay, kleinanzeigen …
    preisregion      TEXT,
    zustand          TEXT,
    vollstaendigkeit TEXT,
    region           TEXT,
    url              TEXT,
    notiz            TEXT,
    benutzer_id      INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_preis_historie ON preis_historie (katalog_id, datum);

  -- Kauflinks (z. B. Affiliate-Links zu konkreten Angeboten), gepflegt vom Moderationsteam
  CREATE TABLE kauflinks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    katalog_id   INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    anbieter     TEXT    NOT NULL,
    titel        TEXT,
    url          TEXT    NOT NULL,
    preis        REAL,
    aktiv        INTEGER NOT NULL DEFAULT 1,
    erstellt_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_kauflinks ON kauflinks (katalog_id);
  `,
  // 4: Plattform-Stammdaten übernehmen und bestehende Freitext-Plattformen zuordnen
  (db) => {
    const einfuegen = db.prepare(`INSERT OR IGNORE INTO plattformen (name, kurz, hersteller, typ, erscheinungsjahr, aliase)
                                  VALUES (?, ?, ?, ?, ?, ?)`);
    for (const p of PLATTFORM_STAMMDATEN) einfuegen.run(p.name, p.kurz, p.hersteller, p.typ, p.jahr, JSON.stringify(p.aliase));
    const index = ladePlattformIndex(db);
    const setzeArtikel = db.prepare('UPDATE artikel SET plattform_id = ?, plattform = ? WHERE id = ?');
    for (const a of db.prepare('SELECT id, plattform FROM artikel WHERE plattform IS NOT NULL').all()) {
      const p = ordnePlattformZu(index, a.plattform);
      if (p) setzeArtikel.run(p.id, p.name, a.id);
    }
    const verknuepfe = db.prepare('INSERT OR IGNORE INTO katalog_plattformen (katalog_id, plattform_id) VALUES (?, ?)');
    for (const k of db.prepare('SELECT id, plattformen FROM katalog').all()) {
      for (const name of JSON.parse(k.plattformen || '[]')) {
        const p = ordnePlattformZu(index, name);
        if (p) verknuepfe.run(k.id, p.id);
      }
    }
  },
  // 5: Rechtliche Seiten, Meldungen von Inhalten, automatische Preisimporte
  `
  CREATE TABLE seiten (
    slug            TEXT PRIMARY KEY,
    titel           TEXT NOT NULL,
    inhalt          TEXT NOT NULL DEFAULT '',
    aktualisiert_am TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL
  );

  -- Meldungen rechtswidriger/fehlerhafter Inhalte (Notice-and-Takedown, Art. 16 DSA)
  CREATE TABLE inhalt_meldungen (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bereich      TEXT    NOT NULL,          -- medien, katalog, preis
    ziel_id      INTEGER NOT NULL,
    grund        TEXT    NOT NULL,          -- urheberrecht, rechtswidrig, falsch, spam, sonstiges
    text         TEXT,
    kontakt      TEXT,                      -- optional bei Meldungen ohne Konto
    benutzer_id  INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    status       TEXT    NOT NULL DEFAULT 'offen',   -- offen, erledigt
    ergebnis     TEXT,
    erledigt_von INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    erledigt_am  TEXT
  );
  CREATE INDEX idx_meldungen_status ON inhalt_meldungen (status);

  -- Von Moderatoren bearbeitete Einträge werden bei IGDB-Aktualisierungen nicht überschrieben
  ALTER TABLE katalog ADD COLUMN manuell_bearbeitet INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE benutzer ADD COLUMN bedingungen_akzeptiert_am TEXT;
  ALTER TABLE preis_historie ADD COLUMN anzahl INTEGER;
  `,
  (db) => {
    const einfuegen = db.prepare('INSERT OR IGNORE INTO seiten (slug, titel, inhalt) VALUES (?, ?, ?)');
    for (const v of RECHTLICHE_VORLAGEN) einfuegen.run(v.slug, v.titel, v.inhalt);
  },
  // 7: KI-Vorprüfung von Einreichungen
  `
  CREATE TABLE ki_pruefungen (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    bereich      TEXT    NOT NULL,          -- katalog, varianten
    ziel_id      INTEGER NOT NULL,
    anbieter     TEXT    NOT NULL,
    modell       TEXT,
    entscheidung TEXT,                      -- Vorschlag der KI: freigeben, ablehnen, unklar
    konfidenz    REAL,
    begruendung  TEXT,
    hinweise     TEXT,                      -- interne Hinweise für das Moderationsteam
    duplikat_von INTEGER,
    ergebnis     TEXT    NOT NULL,          -- tatsächlich angewendet: freigegeben, abgelehnt, moderation, fehler
    fehler       TEXT,
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ki_pruefungen_ziel ON ki_pruefungen (bereich, ziel_id);

  ALTER TABLE katalog ADD COLUMN automatisch_geprueft INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE katalog ADD COLUMN menschliche_pruefung INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE katalog ADD COLUMN ki_hinweis TEXT;
  ALTER TABLE katalog_varianten ADD COLUMN eingereicht_am TEXT;
  ALTER TABLE katalog_varianten ADD COLUMN automatisch_geprueft INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE katalog_varianten ADD COLUMN menschliche_pruefung INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE katalog_varianten ADD COLUMN ki_hinweis TEXT;
  UPDATE katalog_varianten SET eingereicht_am = erstellt_am WHERE status = 'eingereicht';
  `,
  // 8: Links zu externen Seiten, die Cover, Handbücher o. Ä. anbieten
  `
  CREATE TABLE externe_links (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    katalog_id     INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    benutzer_id    INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    art            TEXT    NOT NULL,          -- wie MEDIENARTEN (cover_vorne, handbuch …)
    titel          TEXT,
    url            TEXT    NOT NULL,
    domain         TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'eingereicht',   -- privat, eingereicht, freigegeben, abgelehnt
    geprueft_von   INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    pruefung_notiz TEXT,
    erstellt_am    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_externe_links_katalog ON externe_links (katalog_id);
  CREATE INDEX idx_externe_links_status ON externe_links (status);
  `,
  // 9: Speicherplatz-Kontingent je Benutzer (Größen inkl. abgeleiteter Dateien)
  `
  ALTER TABLE benutzer ADD COLUMN speicher_limit_mb INTEGER;   -- NULL = Standard (STORAGE_QUOTA_MB), 0 = unbegrenzt
  ALTER TABLE medien ADD COLUMN groesse_gesamt INTEGER;        -- Original + Anzeige- und Vorschaudatei in Byte
  ALTER TABLE artikel ADD COLUMN bild_groesse INTEGER;
  `,
  // 10: Server-Einstellungen über die Weboberfläche, Sammlerhinweise und SEO-Angaben am Katalog
  `
  CREATE TABLE server_einstellungen (
    schluessel     TEXT PRIMARY KEY,              -- Name wie in der .env, z. B. REGISTRATION_OPEN
    wert           TEXT,                          -- bei Geheimnissen AES-256-GCM-verschlüsselt
    verschluesselt INTEGER NOT NULL DEFAULT 0,
    geaendert_von  INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    geaendert_am   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE einstellungen_protokoll (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    schluessel  TEXT    NOT NULL,
    aktion      TEXT    NOT NULL,                 -- geaendert, zurueckgesetzt, entfernt
    alt         TEXT,                             -- Geheimnisse nie im Klartext
    neu         TEXT,
    benutzer_id INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE katalog ADD COLUMN sammlerhinweise TEXT;
  ALTER TABLE katalog ADD COLUMN seo_titel TEXT;
  ALTER TABLE katalog ADD COLUMN seo_beschreibung TEXT;
  CREATE INDEX IF NOT EXISTS idx_artikel_katalog ON artikel (katalog_id);
  `,
  // 11: E-Mail-Adresse, Bestätigungs- und Passwort-Links
  `
  ALTER TABLE benutzer ADD COLUMN email TEXT;          -- nur bestätigte Adressen
  CREATE UNIQUE INDEX idx_benutzer_email ON benutzer (email) WHERE email IS NOT NULL;
  CREATE TABLE konto_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    zweck       TEXT    NOT NULL,                     -- email, passwort
    token_hash  TEXT    NOT NULL UNIQUE,              -- SHA-256, der Link selbst wird nie gespeichert
    email       TEXT,                                 -- neue, noch unbestätigte Adresse
    laeuft_ab   INTEGER NOT NULL,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_konto_tokens_benutzer ON konto_tokens (benutzer_id, zweck);
  `,
  // 12: Benachrichtigungen
  `
  CREATE TABLE benachrichtigungen (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    art         TEXT    NOT NULL,       -- freigabe, ablehnung, meldung, rolle, erfolg …
    titel       TEXT    NOT NULL,
    text        TEXT,
    link        TEXT,                   -- App-Adresse, z. B. #/katalog/5
    gelesen     INTEGER NOT NULL DEFAULT 0,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_benachrichtigungen ON benachrichtigungen (benutzer_id, gelesen, id);
  ALTER TABLE benutzer ADD COLUMN benachrichtigung_email INTEGER NOT NULL DEFAULT 0;
  `,
  // 13: Sammlung per geheimem Link teilen (auch ohne Konto)
  `
  ALTER TABLE benutzer ADD COLUMN freigabe_token TEXT;
  ALTER TABLE benutzer ADD COLUMN freigabe_wert INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX idx_benutzer_freigabe ON benutzer (freigabe_token) WHERE freigabe_token IS NOT NULL;
  `,
  // 14: Erfolge (Abzeichen)
  `
  CREATE TABLE erfolge (
    benutzer_id      INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    schluessel       TEXT    NOT NULL,
    freigeschaltet_am TEXT   NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (benutzer_id, schluessel)
  );
  `,
  // 15: Besucherstatistik ohne Cookies (nur Summen je Tag, keine IP-Adressen)
  `
  CREATE TABLE statistik_seiten (tag TEXT NOT NULL, pfad TEXT NOT NULL, aufrufe INTEGER NOT NULL DEFAULT 0, bots INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tag, pfad));
  CREATE TABLE statistik_tage (tag TEXT PRIMARY KEY, besucher INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE statistik_verweise (tag TEXT NOT NULL, domain TEXT NOT NULL, aufrufe INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tag, domain));
  CREATE TABLE statistik_suchen (tag TEXT NOT NULL, begriff TEXT NOT NULL, anzahl INTEGER NOT NULL DEFAULT 0, treffer INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tag, begriff));
  `,
  // 16: Tauschbörse (Suche/Biete), Nachrichten, Bewertungen, gewerbliche Anbieter
  `
  CREATE TABLE angebote (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id      INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    katalog_id       INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    artikel_id       INTEGER REFERENCES artikel (id) ON DELETE SET NULL,   -- Exemplar aus der eigenen Sammlung
    plattform_id     INTEGER REFERENCES plattformen (id) ON DELETE SET NULL,
    variante_id      INTEGER REFERENCES katalog_varianten (id) ON DELETE SET NULL,
    art              TEXT    NOT NULL DEFAULT 'verkauf',   -- verkauf, tausch, beides
    preis            REAL,                                 -- Preisvorstellung in Euro (NULL = Preis auf Anfrage)
    verhandelbar     INTEGER NOT NULL DEFAULT 0,
    zustand          TEXT,
    vollstaendigkeit TEXT,
    region           TEXT,
    beschreibung     TEXT,
    anzahl           INTEGER NOT NULL DEFAULT 1,
    versand          INTEGER NOT NULL DEFAULT 1,
    abholung         INTEGER NOT NULL DEFAULT 0,
    plz_bereich      TEXT,                                 -- nur die ersten zwei Ziffern
    sku              TEXT,                                 -- Artikelnummer gewerblicher Anbieter (Abgleich beim Massen-Upload)
    status           TEXT    NOT NULL DEFAULT 'aktiv',     -- aktiv, reserviert, verkauft, beendet, abgelaufen, entfernt
    laeuft_ab        TEXT    NOT NULL,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now')),
    aktualisiert_am  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_angebote_katalog ON angebote (katalog_id, status);
  CREATE INDEX idx_angebote_benutzer ON angebote (benutzer_id, status);
  CREATE INDEX idx_angebote_status ON angebote (status, laeuft_ab);
  CREATE UNIQUE INDEX idx_angebote_sku ON angebote (benutzer_id, sku) WHERE sku IS NOT NULL;

  CREATE TABLE wunschliste (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    katalog_id   INTEGER NOT NULL REFERENCES katalog (id) ON DELETE CASCADE,
    plattform_id INTEGER REFERENCES plattformen (id) ON DELETE SET NULL,  -- NULL = egal
    region       TEXT,                                                    -- NULL = egal
    min_zustand  TEXT,                                                    -- NULL = egal
    nur_cib      INTEGER NOT NULL DEFAULT 0,
    max_preis    REAL,                                                    -- NULL = egal
    notiz        TEXT,
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (benutzer_id, katalog_id)
  );
  CREATE INDEX idx_wunschliste_katalog ON wunschliste (katalog_id);

  -- Merkt sich, über welche Treffer ein Sammler schon informiert wurde
  CREATE TABLE boerse_treffer (
    wunsch_id   INTEGER NOT NULL REFERENCES wunschliste (id) ON DELETE CASCADE,
    angebot_id  INTEGER NOT NULL REFERENCES angebote (id) ON DELETE CASCADE,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (wunsch_id, angebot_id)
  );

  CREATE TABLE unterhaltungen (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    angebot_id           INTEGER REFERENCES angebote (id) ON DELETE SET NULL,
    titel                TEXT    NOT NULL,
    anfragender_id       INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    anbieter_id          INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    gelesen_anfragender  INTEGER NOT NULL DEFAULT 0,   -- ID der zuletzt gelesenen Nachricht
    gelesen_anbieter     INTEGER NOT NULL DEFAULT 0,
    erstellt_am          TEXT    NOT NULL DEFAULT (datetime('now')),
    letzte_nachricht_am  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX idx_unterhaltungen_angebot ON unterhaltungen (angebot_id, anfragender_id) WHERE angebot_id IS NOT NULL;
  CREATE INDEX idx_unterhaltungen_anfragender ON unterhaltungen (anfragender_id);
  CREATE INDEX idx_unterhaltungen_anbieter ON unterhaltungen (anbieter_id);

  CREATE TABLE nachrichten (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    unterhaltung_id INTEGER NOT NULL REFERENCES unterhaltungen (id) ON DELETE CASCADE,
    absender_id     INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    text            TEXT    NOT NULL,
    erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_nachrichten_unterhaltung ON nachrichten (unterhaltung_id, id);

  CREATE TABLE bewertungen (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    unterhaltung_id INTEGER REFERENCES unterhaltungen (id) ON DELETE SET NULL,
    von_id          INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    fuer_id         INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    wert            INTEGER NOT NULL,             -- 1 positiv, 0 neutral, -1 negativ
    text            TEXT,
    erstellt_am     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (unterhaltung_id, von_id)
  );
  CREATE INDEX idx_bewertungen_fuer ON bewertungen (fuer_id);

  CREATE TABLE blockierungen (
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    blockiert_id INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (benutzer_id, blockiert_id)
  );

  -- Gewerbliche Anbieter: NULL = privat, 'angemeldet' = selbst als gewerblich gekennzeichnet, 'verifiziert' = vom Admin geprüft
  ALTER TABLE benutzer ADD COLUMN haendler_status TEXT;
  ALTER TABLE benutzer ADD COLUMN haendler_daten TEXT;     -- JSON: Anbieterkennzeichnung, Shop-Adresse …
  ALTER TABLE benutzer ADD COLUMN boerse_plz TEXT;         -- Standard-PLZ-Bereich für eigene Angebote
  `,
  // 17: Händler-Pro (kostenpflichtiges Paket) und automatische Shop-/ERP-Anbindungen
  `
  ALTER TABLE benutzer ADD COLUMN haendler_pro_bis TEXT;   -- Datum (JJJJ-MM-TT), bis zu dem das Pro-Paket gilt
  CREATE TABLE haendler_anbindungen (
    benutzer_id       INTEGER PRIMARY KEY REFERENCES benutzer (id) ON DELETE CASCADE,
    typ               TEXT    NOT NULL,                  -- shopware6, csv_url
    zugang            TEXT    NOT NULL,                  -- JSON mit Adresse und Zugangsdaten, AES-256-GCM-verschlüsselt
    intervall_stunden INTEGER NOT NULL DEFAULT 6,
    beende_fehlende   INTEGER NOT NULL DEFAULT 0,
    aktiv             INTEGER NOT NULL DEFAULT 1,
    letzter_lauf      TEXT,
    letztes_ergebnis  TEXT,                              -- JSON
    letzter_fehler    TEXT,
    fehler_in_folge   INTEGER NOT NULL DEFAULT 0,
    geaendert_am      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 18: Händler-Pakete (Anzahl Angebote) und Zusatzpaket API-Anbindung getrennt buchbar
  `
  ALTER TABLE benutzer RENAME COLUMN haendler_pro_bis TO haendler_api_bis;
  ALTER TABLE benutzer ADD COLUMN haendler_paket INTEGER;       -- gebuchte Anzahl aktiver Angebote
  ALTER TABLE benutzer ADD COLUMN haendler_paket_bis TEXT;      -- JJJJ-MM-TT
  `,
  // 19: Kostenloser Testzugang für Händler (Paket + API-Anbindung auf Zeit)
  `
  ALTER TABLE benutzer ADD COLUMN haendler_test_bis TEXT;          -- gesetzt, solange die Buchungen ein Testzugang sind
  ALTER TABLE benutzer ADD COLUMN haendler_test_genutzt_am TEXT;   -- wann zuletzt ein Testzugang begonnen wurde
  ALTER TABLE benutzer ADD COLUMN haendler_test_erinnert INTEGER NOT NULL DEFAULT 0;
  `,
  // 20: Automatische Zahlungsabwicklung (Stripe, PayPal) und Rechnungen in ERPNext
  `
  CREATE TABLE abos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    anbieter     TEXT    NOT NULL,                 -- stripe, paypal
    extern_id    TEXT    NOT NULL,                 -- Abo-ID beim Zahlungsanbieter
    produkt      TEXT    NOT NULL,                 -- paket, api
    angebote     INTEGER,                          -- bei Paketen: Anzahl aktiver Angebote
    netto        REAL    NOT NULL,                 -- Monatspreis netto (inkl. Zahlungsgebühr)
    status       TEXT    NOT NULL DEFAULT 'offen', -- offen, aktiv, gekuendigt, beendet
    laeuft_bis   TEXT,                             -- bezahlt bis (JJJJ-MM-TT)
    erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_am TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (anbieter, extern_id)
  );
  CREATE INDEX idx_abos_benutzer ON abos (benutzer_id, status);

  CREATE TABLE zahlungen (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    abo_id           INTEGER REFERENCES abos (id) ON DELETE SET NULL,
    benutzer_id      INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    anbieter         TEXT    NOT NULL,
    extern_id        TEXT    NOT NULL,              -- Rechnungs-/Transaktions-ID beim Zahlungsanbieter
    produkt          TEXT    NOT NULL,
    beschreibung     TEXT    NOT NULL,
    netto            REAL    NOT NULL,
    steuersatz       REAL    NOT NULL,
    brutto           REAL    NOT NULL,
    zeitraum_bis     TEXT,
    erpnext_rechnung TEXT,                          -- Name der Ausgangsrechnung in ERPNext
    erpnext_zahlung  TEXT,
    erpnext_fehler   TEXT,
    versuche         INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (anbieter, extern_id)
  );
  CREATE INDEX idx_zahlungen_erpnext ON zahlungen (erpnext_rechnung);

  -- Beim Zahlungsanbieter angelegte Produkte/Pläne (PayPal) und Kundennummern
  CREATE TABLE zahlung_schluessel (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL);
  ALTER TABLE benutzer ADD COLUMN stripe_kunde TEXT;
  ALTER TABLE benutzer ADD COLUMN erpnext_kunde TEXT;
  `,
  // 21: Leistungszeitraum auf Rechnungen und Zahlung per Rechnung (Zahlungsziel)
  `
  ALTER TABLE zahlungen ADD COLUMN zeitraum_von TEXT;
  ALTER TABLE zahlungen ADD COLUMN bezahlt_am TEXT;             -- NULL = Rechnung noch offen
  ALTER TABLE zahlungen ADD COLUMN faellig_am TEXT;             -- nur bei Zahlung per Rechnung
  UPDATE zahlungen SET bezahlt_am = erstellt_am;
  `,
  // 22: Verrechnung beim Abowechsel (anteilige Gutschrift des alten Abos, Guthaben des Händlers)
  `
  ALTER TABLE zahlungen ADD COLUMN verrechnet REAL NOT NULL DEFAULT 0;      -- netto verrechnetes Guthaben (netto = voller Preis)
  ALTER TABLE abos ADD COLUMN verrechnung_netto REAL NOT NULL DEFAULT 0;    -- bei der Buchung eingeplante Verrechnung
  ALTER TABLE benutzer ADD COLUMN guthaben REAL NOT NULL DEFAULT 0;         -- netto, aus nicht genutzten Zeiträumen
  `,
  // 23: Fotos an Angeboten (verkleinert, ohne Metadaten wie GPS)
  `
  CREATE TABLE angebot_fotos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    angebot_id  INTEGER NOT NULL REFERENCES angebote (id) ON DELETE CASCADE,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    datei       TEXT    NOT NULL,          -- WebP, höchstens 1600 px
    vorschau    TEXT    NOT NULL,          -- WebP, höchstens 480 px
    groesse     INTEGER NOT NULL,          -- beide Dateien zusammen (Speicherkontingent)
    reihenfolge INTEGER NOT NULL DEFAULT 0,
    erstellt_am TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_angebot_fotos ON angebot_fotos (angebot_id, reihenfolge);
  `,
  // 24: Gutschriften (Erstattungen, Auszahlung von Guthaben) – in ERPNext als Rückbuchung (Gutschrift)
  `
  CREATE TABLE gutschriften (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    zahlung_id       INTEGER REFERENCES zahlungen (id) ON DELETE SET NULL,   -- ursprüngliche Zahlung/Rechnung
    benutzer_id      INTEGER REFERENCES benutzer (id) ON DELETE SET NULL,
    anbieter         TEXT    NOT NULL,                  -- stripe, paypal, rechnung, guthaben
    extern_id        TEXT    NOT NULL UNIQUE,           -- Erstattungs-ID beim Anbieter bzw. eigene ID
    grund            TEXT    NOT NULL,
    netto            REAL    NOT NULL,
    steuersatz       REAL    NOT NULL,
    brutto           REAL    NOT NULL,
    erpnext_gutschrift TEXT,
    erpnext_fehler   TEXT,
    versuche         INTEGER NOT NULL DEFAULT 0,
    erstellt_am      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_gutschriften_zahlung ON gutschriften (zahlung_id);
  `,
  // 25: Anbieter-Statistik der Börse – nur Tageszähler je Angebot, keine Besucherdaten
  `
  CREATE TABLE boerse_statistik (
    angebot_id   INTEGER NOT NULL,                  -- bewusst ohne Fremdschlüssel: Verlauf bleibt nach dem Löschen erhalten
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer (id) ON DELETE CASCADE,
    tag          TEXT    NOT NULL,
    aufrufe      INTEGER NOT NULL DEFAULT 0,
    anfragen     INTEGER NOT NULL DEFAULT 0,
    treffer      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (angebot_id, tag)
  );
  CREATE INDEX idx_boerse_statistik_benutzer ON boerse_statistik (benutzer_id, tag);
  `,  // 26: Anonymes Marktarchiv – jedes Angebot (von Einstellen bis Verkauf/Ende) ohne Bezug zum Anbieter, dazu tägliche
  //     Nachfrage-Werte. Trigger erfassen alle Wege (Bearbeiten, CSV-Import, Ablauf, Moderation, Konto-Löschung).
  `
  CREATE TABLE markt_angebote (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    angebot_id       INTEGER,                  -- nur solange das Angebot existiert; beim Löschen NULL (anonym)
    katalog_id       INTEGER NOT NULL,         -- bewusst ohne Fremdschlüssel: Archiv bleibt vollständig
    plattform_id     INTEGER,
    variante_id      INTEGER,
    art              TEXT    NOT NULL,
    zustand          TEXT,
    vollstaendigkeit TEXT,
    region           TEXT,
    anzahl           INTEGER NOT NULL DEFAULT 1,
    gewerblich       INTEGER NOT NULL DEFAULT 0,
    preis_start      REAL,
    preis_ende       REAL,
    preis_min        REAL,
    preis_max        REAL,
    preisaenderungen INTEGER NOT NULL DEFAULT 0,
    aufrufe          INTEGER NOT NULL DEFAULT 0,
    anfragen         INTEGER NOT NULL DEFAULT 0,
    treffer          INTEGER NOT NULL DEFAULT 0,
    eingestellt_am   TEXT    NOT NULL,         -- nur Datum
    beendet_am       TEXT,                     -- nur Datum; NULL = läuft noch
    ergebnis         TEXT                      -- verkauft, beendet, abgelaufen, entfernt, geloescht
  );
  CREATE INDEX idx_markt_angebote_katalog ON markt_angebote (katalog_id, beendet_am);
  CREATE INDEX idx_markt_angebote_offen ON markt_angebote (angebot_id) WHERE beendet_am IS NULL;

  CREATE TABLE markt_nachfrage (
    tag                 TEXT    NOT NULL,
    katalog_id          INTEGER NOT NULL,
    suchende            INTEGER NOT NULL DEFAULT 0,
    max_preis_schnitt   REAL,
    angebote_aktiv      INTEGER NOT NULL DEFAULT 0,
    preis_min           REAL,
    preis_schnitt       REAL,
    PRIMARY KEY (tag, katalog_id)
  );

  CREATE TRIGGER markt_angebot_neu AFTER INSERT ON angebote WHEN NEW.status IN ('aktiv', 'reserviert') BEGIN
    INSERT INTO markt_angebote (angebot_id, katalog_id, plattform_id, variante_id, art, zustand, vollstaendigkeit, region, anzahl,
      gewerblich, preis_start, preis_ende, preis_min, preis_max, eingestellt_am)
    VALUES (NEW.id, NEW.katalog_id, NEW.plattform_id, NEW.variante_id, NEW.art, NEW.zustand, NEW.vollstaendigkeit, NEW.region, NEW.anzahl,
      COALESCE((SELECT haendler_status IS NOT NULL FROM benutzer WHERE id = NEW.benutzer_id), 0),
      NEW.preis, NEW.preis, NEW.preis, NEW.preis, date('now'));
  END;

  CREATE TRIGGER markt_angebot_aenderung AFTER UPDATE ON angebote BEGIN
    -- Angaben und Preisverlauf der laufenden Anzeige nachführen
    UPDATE markt_angebote SET plattform_id = NEW.plattform_id, variante_id = NEW.variante_id, art = NEW.art, zustand = NEW.zustand,
        vollstaendigkeit = NEW.vollstaendigkeit, region = NEW.region, anzahl = NEW.anzahl, preis_ende = NEW.preis,
        preis_min = CASE WHEN NEW.preis IS NOT NULL AND (preis_min IS NULL OR NEW.preis < preis_min) THEN NEW.preis ELSE preis_min END,
        preis_max = CASE WHEN NEW.preis IS NOT NULL AND (preis_max IS NULL OR NEW.preis > preis_max) THEN NEW.preis ELSE preis_max END,
        preisaenderungen = preisaenderungen + (OLD.preis IS NOT NEW.preis)
      WHERE angebot_id = NEW.id AND beendet_am IS NULL;
    -- Anzeige endet (verkauft, beendet, abgelaufen, entfernt)
    UPDATE markt_angebote SET beendet_am = date('now'), ergebnis = NEW.status
      WHERE angebot_id = NEW.id AND beendet_am IS NULL AND NEW.status NOT IN ('aktiv', 'reserviert');
    -- Wieder eingestellt: neue Anzeige im Archiv
    INSERT INTO markt_angebote (angebot_id, katalog_id, plattform_id, variante_id, art, zustand, vollstaendigkeit, region, anzahl,
      gewerblich, preis_start, preis_ende, preis_min, preis_max, eingestellt_am)
    SELECT NEW.id, NEW.katalog_id, NEW.plattform_id, NEW.variante_id, NEW.art, NEW.zustand, NEW.vollstaendigkeit, NEW.region, NEW.anzahl,
      COALESCE((SELECT haendler_status IS NOT NULL FROM benutzer WHERE id = NEW.benutzer_id), 0),
      NEW.preis, NEW.preis, NEW.preis, NEW.preis, date('now')
    WHERE NEW.status IN ('aktiv', 'reserviert')
      AND NOT EXISTS (SELECT 1 FROM markt_angebote WHERE angebot_id = NEW.id AND beendet_am IS NULL);
  END;

  CREATE TRIGGER markt_angebot_geloescht AFTER DELETE ON angebote BEGIN
    UPDATE markt_angebote SET beendet_am = date('now'), ergebnis = 'geloescht' WHERE angebot_id = OLD.id AND beendet_am IS NULL;
    UPDATE markt_angebote SET angebot_id = NULL WHERE angebot_id = OLD.id;
  END;

  -- Bestehende Angebote übernehmen
  INSERT INTO markt_angebote (angebot_id, katalog_id, plattform_id, variante_id, art, zustand, vollstaendigkeit, region, anzahl,
    gewerblich, preis_start, preis_ende, preis_min, preis_max, aufrufe, anfragen, treffer, eingestellt_am, beendet_am, ergebnis)
  SELECT a.id, a.katalog_id, a.plattform_id, a.variante_id, a.art, a.zustand, a.vollstaendigkeit, a.region, a.anzahl,
    b.haendler_status IS NOT NULL, a.preis, a.preis, a.preis, a.preis,
    COALESCE((SELECT SUM(aufrufe) FROM boerse_statistik s WHERE s.angebot_id = a.id), 0),
    COALESCE((SELECT SUM(anfragen) FROM boerse_statistik s WHERE s.angebot_id = a.id), 0),
    COALESCE((SELECT SUM(treffer) FROM boerse_statistik s WHERE s.angebot_id = a.id), 0),
    date(a.erstellt_am),
    CASE WHEN a.status IN ('aktiv', 'reserviert') THEN NULL ELSE date(a.aktualisiert_am) END,
    CASE WHEN a.status IN ('aktiv', 'reserviert') THEN NULL ELSE a.status END
  FROM angebote a JOIN benutzer b ON b.id = a.benutzer_id;
  `,
  // 27: Externe Sicherung – Zustand und bereits übertragene Uploads
  `
  CREATE TABLE system_werte (schluessel TEXT PRIMARY KEY, wert TEXT);
  CREATE TABLE extern_gesichert (
    datei        TEXT    PRIMARY KEY,
    groesse      INTEGER NOT NULL,
    gesichert_am TEXT    NOT NULL DEFAULT (datetime('now'))
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
      if (typeof MIGRATIONEN[i] === 'function') MIGRATIONEN[i](db);
      else db.exec(MIGRATIONEN[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
