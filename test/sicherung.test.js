import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { oeffneDatenbank } from '../server/db.js';
import { erstelleSicherungsDienst } from '../server/services/sicherung.js';

test('Sicherung: tägliche und monatliche Kopie, alte werden gelöscht', async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'zockdb-sicherung-'));
  try {
    const db = oeffneDatenbank(path.join(ordner, 'sammlung.db'));
    db.prepare("INSERT INTO einstellungen (schluessel, wert) VALUES ('test', 'hallo')").run();
    const konfiguration = { datenbankPfad: path.join(ordner, 'sammlung.db'), sicherung: { aktiv: true, tage: 2, monate: 1 } };
    const dienst = erstelleSicherungsDienst(db, konfiguration);

    // Alte Sicherungen vortäuschen
    fs.mkdirSync(path.join(ordner, 'sicherungen', 'taeglich'), { recursive: true });
    fs.mkdirSync(path.join(ordner, 'sicherungen', 'monatlich'), { recursive: true });
    for (const n of ['zockdb-2020-01-01.db', 'zockdb-2020-01-02.db']) fs.writeFileSync(path.join(ordner, 'sicherungen', 'taeglich', n), 'alt');
    fs.writeFileSync(path.join(ordner, 'sicherungen', 'monatlich', 'zockdb-2020-01.db'), 'alt');

    const s = await dienst.lauf();
    assert.equal(s.letzterFehler, null);
    assert.equal(s.taeglich.length, 2, 'nur die letzten 2 Tage');
    assert.equal(s.taeglich[0].name, `zockdb-${new Date().toISOString().slice(0, 10)}.db`);
    assert.equal(s.monatlich.length, 1);
    assert.equal(s.monatlich[0].name, `zockdb-${new Date().toISOString().slice(0, 7)}.db`);

    // Die Sicherung ist eine vollständige, lesbare Datenbank
    const kopie = new Database(path.join(ordner, 'sicherungen', 'taeglich', s.taeglich[0].name), { readonly: true });
    assert.equal(kopie.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'test'").get().wert, 'hallo');
    kopie.close();
    db.close();
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});
