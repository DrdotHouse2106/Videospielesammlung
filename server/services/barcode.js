// Ermittelt zu einer EAN/UPC einen Produktnamen über öffentliche Barcode-Datenbanken.
// IGDB selbst kennt keine Barcodes, daher: Barcode → Produktname → IGDB-Titelsuche.
//
// Unterstützte Anbieter (Reihenfolge über BARCODE_PROVIDERS steuerbar):
//  - opengtindb: deutsche Datenbank (https://opengtindb.org), benötigt OPENGTINDB_QUERYID
//  - upcitemdb:  kostenloser Testzugang (https://www.upcitemdb.com), max. 100 Abfragen/Tag

async function opengtindb(code, { queryId, fetchFn }) {
  if (!queryId) return null;
  const url = `https://opengtindb.org/?${new URLSearchParams({ ean: code, cmd: 'query', queryid: queryId })}`;
  const antwort = await fetchFn(url, { signal: AbortSignal.timeout(8000) });
  if (!antwort.ok) return null;
  // Die Antwort ist ISO-8859-1-kodierter Text im Format "schluessel=wert".
  const text = new TextDecoder('latin1').decode(await antwort.arrayBuffer());
  const felder = Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((zeile) => zeile.split('='))
      .filter((teile) => teile.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join('=').trim()]),
  );
  if (felder.error !== '0') return null;
  const name = [felder.name, felder.detailname].filter(Boolean).join(' ').trim();
  return name ? { produktname: name, quelle: 'opengtindb' } : null;
}

async function upcitemdb(code, { fetchFn }) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;
  const antwort = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!antwort.ok) return null;
  const daten = await antwort.json();
  const artikel = daten.items?.[0];
  if (!artikel?.title) return null;
  return { produktname: artikel.title, quelle: 'upcitemdb', bild_url: artikel.images?.[0] ?? null };
}

const ANBIETER = { opengtindb, upcitemdb };

export function erstelleBarcodeDienst({ anbieter, openGtinDbQueryId }, { fetchFn = globalThis.fetch } = {}) {
  const aktiv = anbieter.filter((name) => ANBIETER[name] && (name !== 'opengtindb' || openGtinDbQueryId));

  async function sucheProduktname(code) {
    for (const name of aktiv) {
      try {
        const treffer = await ANBIETER[name](code, { queryId: openGtinDbQueryId, fetchFn });
        if (treffer) return treffer;
      } catch (fehler) {
        console.warn(`[barcode] Anbieter ${name} nicht erreichbar: ${fehler.message}`);
      }
    }
    return null;
  }

  return { aktiveAnbieter: aktiv, sucheProduktname };
}
