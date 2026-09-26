#!/usr/bin/env node
// Entschlüsselt eine externe ZockDB-Sicherung (*.zdbk) – z. B. die Datenbank für eine Wiederherstellung.
//
//   node scripts/sicherung-entschluesseln.js <datei.zdbk> [ziel]
//   node scripts/sicherung-entschluesseln.js <ordner>            (alle *.zdbk im Ordner, z. B. heruntergeladene Uploads)
//
// Das Passwort wird abgefragt oder aus der Umgebungsvariable BACKUP_REMOTE_PASSWORD gelesen.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { entschluesseleDatei, ENDUNG } from '../server/services/externesicherung.js';

async function fragePasswort() {
  if (process.env.BACKUP_REMOTE_PASSWORD) return process.env.BACKUP_REMOTE_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (text) => { if (!text.includes('Passwort')) return; process.stdout.write(text); };
  const antwort = await new Promise((resolve) => rl.question('Sicherungs-Passwort: ', resolve));
  rl.close();
  process.stdout.write('\n');
  return antwort;
}

const [quelle, zielArg] = process.argv.slice(2);
if (!quelle) {
  console.error('Aufruf: node scripts/sicherung-entschluesseln.js <datei.zdbk|ordner> [ziel]');
  process.exit(1);
}
const passwort = await fragePasswort();
const dateien = fs.statSync(quelle).isDirectory()
  ? fs.readdirSync(quelle).filter((n) => n.endsWith(ENDUNG)).map((n) => path.join(quelle, n))
  : [quelle];
let fehler = 0;
for (const datei of dateien) {
  const ziel = dateien.length === 1 && zielArg ? zielArg : datei.slice(0, -ENDUNG.length);
  try {
    await entschluesseleDatei(datei, ziel, passwort);
    console.log(`✓ ${path.basename(datei)} → ${ziel}`);
  } catch (e) {
    fehler += 1;
    console.error(`✗ ${path.basename(datei)}: ${e.message}`);
  }
}
process.exit(fehler ? 1 : 0);
