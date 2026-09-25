import { ladeKonfiguration } from './config.js';
import { erstelleApp } from './app.js';

const konfiguration = ladeKonfiguration();
const { app, db, kontext } = erstelleApp(konfiguration);

const server = app.listen(konfiguration.port, konfiguration.host, () => {
  console.log(`🎮 Videospielesammlung läuft auf http://localhost:${konfiguration.port}`);
  console.log(`   Datenbank: ${konfiguration.datenbankPfad}`);
  console.log(`   IGDB: ${kontext.igdb.konfiguriert ? 'aktiv' : 'nicht konfiguriert (nur eigene Einträge)'}`);
  console.log(`   Barcode-Dienste: ${kontext.barcode.aktiveAnbieter.join(', ') || 'keine'}`);
  if (!kontext.konfiguration.auth.benutzer) console.log('   Zugangsschutz: aus (AUTH_USER/AUTH_PASSWORD setzen, um ihn zu aktivieren)');
});

// Abgelaufene Cache-Einträge regelmäßig entfernen.
const aufraeumen = setInterval(() => kontext.cache.raeumeAuf(), 6 * 60 * 60 * 1000);
aufraeumen.unref();

function beenden(signal) {
  console.log(`${signal} empfangen – Server wird beendet …`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', beenden);
process.on('SIGTERM', beenden);
