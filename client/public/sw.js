// Service-Worker von ZockDB.
// - App-Hülle: Netzwerk zuerst, bei fehlender Verbindung aus dem Cache
// - Gebaute Assets & Coverbilder: Cache zuerst (Dateinamen enthalten Hashes)
// - API-GET-Anfragen: Netzwerk zuerst, offline die zuletzt gesehene Antwort

const VERSION = 'v8';
// Server-gerenderte öffentliche Seiten (Suchmaschinen) nicht durch die App-Hülle ersetzen
const SERVERSEITEN = /^\/(spiel|konsole|zubehoer|plattform|plattformen|suche|sammlung)(\/|$)|^\/(sitemap[^/]*\.xml|robots\.txt)$/;
const HUELLE = `huelle-${VERSION}`;
const DATEN = `daten-${VERSION}`;
const BILDER = `bilder-${VERSION}`;
const MAX_BILDER = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(HUELLE)
      .then((cache) => cache.addAll(['/?app=1', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const aktuell = [HUELLE, DATEN, BILDER];
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => !aktuell.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function netzwerkZuerst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const antwort = await fetch(request);
    if (antwort.ok) cache.put(request, antwort.clone());
    return antwort;
  } catch (fehler) {
    const gespeichert = await cache.match(request);
    if (gespeichert) return gespeichert;
    throw fehler;
  }
}

async function cacheZuerst(request, cacheName, maxEintraege) {
  const cache = await caches.open(cacheName);
  const gespeichert = await cache.match(request);
  if (gespeichert) return gespeichert;
  const antwort = await fetch(request);
  if (antwort.ok || antwort.type === 'opaque') {
    await cache.put(request, antwort.clone());
    if (maxEintraege) {
      const schluessel = await cache.keys();
      for (const alt of schluessel.slice(0, Math.max(0, schluessel.length - maxEintraege))) await cache.delete(alt);
    }
  }
  return antwort;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'images.igdb.com' || (url.origin === self.location.origin && url.pathname.startsWith('/api/dateien/'))) {
    event.respondWith(cacheZuerst(request, BILDER, MAX_BILDER));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (SERVERSEITEN.test(url.pathname)) return;
  // „/“ ohne ?app entscheidet der Server (Startseite für Besucher, App für Angemeldete)
  if (request.mode === 'navigate' && url.pathname === '/' && !url.searchParams.has('app')) return;

  if (url.pathname.startsWith('/api/')) {
    // Anmeldung, Exporte und Online-Suchen nie zwischenspeichern.
    if (['/api/auth/', '/api/konto', '/api/admin', '/api/export', '/api/katalog/suche', '/api/katalog/barcode', '/api/boerse/meine.csv', '/api/boerse/nachrichten/anzahl']
      .some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(netzwerkZuerst(request, DATEN));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheZuerst(request, HUELLE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(netzwerkZuerst(new Request('/?app=1'), HUELLE));
    return;
  }
  event.respondWith(netzwerkZuerst(request, HUELLE));
});
