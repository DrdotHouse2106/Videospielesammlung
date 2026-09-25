import { ladeKonfiguration } from './config.js';
import { erstelleApp } from './app.js';

const konfiguration = ladeKonfiguration();
const { app, db, kontext } = erstelleApp(konfiguration);

const server = app.listen(konfiguration.port, konfiguration.host, () => {
  console.log(`🎮 Videospielesammlung läuft auf http://localhost:${konfiguration.port}`);
  console.log(`   Datenbank: ${konfiguration.datenbankPfad}`);
  console.log(`   IGDB: ${kontext.igdb.konfiguriert ? 'aktiv' : 'nicht konfiguriert (nur eigene Einträge)'}`);
  console.log(`   Barcode-Dienste: ${kontext.barcode.aktiveAnbieter.join(', ') || 'keine'}`);
  console.log(`   Marktpreise (PriceCharting): ${kontext.preise.aktiv ? 'aktiv' : 'nicht konfiguriert'}`);
  console.log(`   eBay-Angebote: ${kontext.ebay.konfiguriert ? 'aktiv' : 'nicht konfiguriert'}`);
  console.log(`   Registrierung: ${konfiguration.konten.registrierungOffen ? 'offen' : 'geschlossen'}`
    + ` · 2FA-Pflicht: ${konfiguration.konten.zweiFaktorPflicht ? 'ja' : 'nein'}`);
  if (kontext.konten.istErsteinrichtung()) console.log('   ➜ Noch kein Konto vorhanden: Das erste registrierte Konto wird Administrator.');
});

// Abgelaufene Cache-Einträge und Sitzungen regelmäßig entfernen.
const aufraeumen = setInterval(() => {
  kontext.cache.raeumeAuf();
  kontext.konten.raeumeAuf();
}, 6 * 60 * 60 * 1000);
aufraeumen.unref();

// KI-Vorprüfung: liegengebliebene Einreichungen regelmäßig nachholen
if (kontext.ki.aktiv) {
  console.log(`   KI-Vorprüfung: ${kontext.ki.anbieter} (${kontext.ki.modell})`);
  setInterval(() => kontext.ki.verarbeiteWarteschlange().catch((e) => console.warn('[ki]', e.message)), 5 * 60 * 1000).unref();
  setTimeout(() => kontext.ki.anstossen(), 10_000).unref();
}

// Automatischer Preisimport (eBay-Angebote, Marktpreise) im Hintergrund
if (konfiguration.preisimportStunden > 0 && kontext.preisimport.aktiv()) {
  const importieren = () => kontext.preisimport.lauf({ max: konfiguration.preisimportMax })
    .then((s) => console.log(`[preisimport] ${s.verarbeitet ?? 0} Einträge aktualisiert.`))
    .catch((e) => console.warn('[preisimport]', e.message));
  setTimeout(importieren, 5 * 60 * 1000).unref();
  setInterval(importieren, konfiguration.preisimportStunden * 60 * 60 * 1000).unref();
  console.log(`   Preisimport: alle ${konfiguration.preisimportStunden} Stunden`);
}

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
