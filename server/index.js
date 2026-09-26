import { MARKE } from '../shared/marke.js';
import { ladeKonfiguration } from './config.js';
import { erstelleApp } from './app.js';

const konfiguration = ladeKonfiguration();
const { app, db, kontext } = erstelleApp(konfiguration);

const server = app.listen(konfiguration.port, konfiguration.host, () => {
  console.log(`🎮 ${MARKE.name} läuft auf http://localhost:${konfiguration.port}`);
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

// KI-Vorprüfung: liegengebliebene Einreichungen regelmäßig nachholen.
// Der Anbieter kann sich zur Laufzeit ändern (Admin → Einstellungen), daher wird jedes Mal geprüft.
if (kontext.ki.aktiv) console.log(`   KI-Vorprüfung: ${kontext.ki.anbieter} (${kontext.ki.modell})`);
setInterval(() => {
  if (kontext.ki.aktiv) kontext.ki.verarbeiteWarteschlange().catch((e) => console.warn('[ki]', e.message));
}, 5 * 60 * 1000).unref();
setTimeout(() => kontext.ki.anstossen(), 10_000).unref();

// Automatischer Preisimport (eBay-Angebote, Marktpreise) im Hintergrund.
// Intervall und Zugangsdaten sind live änderbar – alle 10 Minuten prüfen, ob ein Lauf fällig ist.
function preisimportFaellig() {
  const stunden = konfiguration.preisimportStunden;
  if (!(stunden > 0) || !kontext.preisimport.aktiv()) return false;
  const status = kontext.preisimport.status();
  if (status.laeuft) return false;
  const letzter = Date.parse(status.letzterLauf ?? '') || 0;
  return Date.now() - letzter >= stunden * 60 * 60 * 1000;
}
setInterval(() => {
  if (!preisimportFaellig()) return;
  kontext.preisimport.lauf({ max: konfiguration.preisimportMax })
    .then((s) => console.log(`[preisimport] ${s.verarbeitet ?? 0} Einträge aktualisiert.`))
    .catch((e) => console.warn('[preisimport]', e.message));
}, 10 * 60 * 1000).unref();
if (konfiguration.preisimportStunden > 0 && kontext.preisimport.aktiv()) {
  console.log(`   Preisimport: alle ${konfiguration.preisimportStunden} Stunden`);
}

// Datenbank-Sicherung: kurz nach dem Start und danach stündlich prüfen, ob die Tagessicherung fehlt
const sichern = () => {
  if (kontext.sicherung.status().aktiv) kontext.sicherung.lauf().catch((e) => console.warn('[sicherung]', e.message));
};
setTimeout(sichern, 60_000).unref();

// Tauschbörse: abgelaufene Angebote stündlich beenden
setInterval(() => {
  try { kontext.boerse.raeumeAuf(); } catch (e) { console.warn('[boerse]', e.message); }
}, 60 * 60 * 1000).unref();

// Rechnungen, die ERPNext noch nicht erreicht haben, regelmäßig nachholen
setInterval(() => {
  kontext.erpnext.nachholen()
    .then(() => kontext.zahlung.pruefeRechnungen())
    .catch((e) => console.warn('[erpnext]', e.message));
}, 15 * 60 * 1000).unref();

// Zusatzpaket API-Anbindung: automatische Shop-/ERP-Anbindungen alle 15 Minuten auf fällige Abgleiche prüfen
let anbindungLaeuft = false;
setInterval(() => {
  if (anbindungLaeuft) return;
  anbindungLaeuft = true;
  kontext.anbindungen.lauf().catch((e) => console.warn('[anbindung]', e.message)).finally(() => { anbindungLaeuft = false; });
}, 15 * 60 * 1000).unref();
setInterval(sichern, 60 * 60 * 1000).unref();

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
