// Automatische Sicherung der Datenbank: täglich (die letzten X Tage) und monatlich (die letzten Y Monate).
// Gesichert wird die SQLite-Datenbank mit der Online-Backup-Funktion von SQLite – konsistent, auch im
// laufenden Betrieb. Hochgeladene Dateien (Fotos, Scans) liegen im Upload-Ordner und werden über die
// Sicherung des gesamten Datenverzeichnisses (z. B. Proxmox-Backup) mitgesichert.
import fs from 'node:fs';
import path from 'node:path';

const heute = (d = new Date()) => d.toISOString().slice(0, 10);
const monat = (d = new Date()) => d.toISOString().slice(0, 7);

export function erstelleSicherungsDienst(db, konfiguration) {
  const datenbankPfad = konfiguration.datenbankPfad;
  const aktivMoeglich = datenbankPfad && datenbankPfad !== ':memory:';
  const basis = () => konfiguration.sicherung?.verzeichnis || path.join(path.dirname(datenbankPfad), 'sicherungen');
  const ordner = (art) => path.join(basis(), art);
  let laeuft = false;
  let letzterFehler = null;

  function liste() {
    if (!aktivMoeglich) return { taeglich: [], monatlich: [] };
    const lesen = (art) => {
      try {
        return fs.readdirSync(ordner(art)).filter((n) => /^zockdb-[\d-]+\.db$/.test(n)).sort().reverse()
          .map((name) => {
            const s = fs.statSync(path.join(ordner(art), name));
            return { name, groesse: s.size, erstellt_am: s.mtime.toISOString() };
          });
      } catch {
        return [];
      }
    };
    return { taeglich: lesen('taeglich'), monatlich: lesen('monatlich') };
  }

  function aufraeumen(art, behalten) {
    const dateien = liste()[art];
    for (const alt of dateien.slice(Math.max(0, behalten))) fs.rmSync(path.join(ordner(art), alt.name), { force: true });
  }

  /** Legt fehlende Sicherungen an und löscht alte. `erzwingen` erstellt die heutige Sicherung neu. */
  async function lauf({ erzwingen = false } = {}) {
    if (!aktivMoeglich || laeuft) return status();
    laeuft = true;
    try {
      const tage = Math.max(1, konfiguration.sicherung?.tage ?? 7);
      const monate = Math.max(0, konfiguration.sicherung?.monate ?? 12);
      fs.mkdirSync(ordner('taeglich'), { recursive: true });
      fs.mkdirSync(ordner('monatlich'), { recursive: true });
      const tagesDatei = path.join(ordner('taeglich'), `zockdb-${heute()}.db`);
      if (erzwingen || !fs.existsSync(tagesDatei)) {
        const temp = `${tagesDatei}.tmp`;
        await db.backup(temp);
        fs.renameSync(temp, tagesDatei);
        fs.chmodSync(tagesDatei, 0o600); // enthält Passwort-Hashes – nur für den Dienst lesbar
      }
      const monatsDatei = path.join(ordner('monatlich'), `zockdb-${monat()}.db`);
      if (monate > 0 && !fs.existsSync(monatsDatei)) {
        fs.copyFileSync(tagesDatei, monatsDatei);
        fs.chmodSync(monatsDatei, 0o600);
      }
      aufraeumen('taeglich', tage);
      aufraeumen('monatlich', monate);
      letzterFehler = null;
    } catch (fehler) {
      letzterFehler = fehler.message;
      console.warn('[sicherung]', fehler.message);
    } finally {
      laeuft = false;
    }
    return status();
  }

  function status() {
    return {
      aktiv: Boolean(aktivMoeglich && konfiguration.sicherung?.aktiv !== false),
      verzeichnis: aktivMoeglich ? basis() : null,
      tage: konfiguration.sicherung?.tage ?? 7,
      monate: konfiguration.sicherung?.monate ?? 12,
      laeuft,
      letzterFehler,
      ...liste(),
    };
  }

  return { lauf, status, liste };
}
