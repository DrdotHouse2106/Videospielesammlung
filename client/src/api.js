// Dünne Hülle um fetch mit deutschen Fehlermeldungen.

export class ApiFehler extends Error {
  constructor(meldung, status, felder) {
    super(meldung);
    this.status = status;
    this.felder = felder ?? {};
  }
}

async function anfrage(pfad, { methode = 'GET', daten, formular, signal } = {}) {
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      headers: daten !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: formular ?? (daten !== undefined ? JSON.stringify(daten) : undefined),
      signal,
      credentials: 'same-origin',
    });
  } catch (fehler) {
    if (fehler.name === 'AbortError') throw fehler;
    throw new ApiFehler(
      navigator.onLine ? 'Der Server ist nicht erreichbar.' : 'Keine Internetverbindung. Bitte später erneut versuchen.',
      0,
    );
  }
  if (antwort.status === 204) return null;
  const json = await antwort.json().catch(() => null);
  if (!antwort.ok) {
    throw new ApiFehler(json?.fehler ?? `Unerwarteter Fehler (HTTP ${antwort.status}).`, antwort.status, json?.felder);
  }
  return json;
}

const abfrage = (parameter) => {
  const sauber = Object.fromEntries(Object.entries(parameter).filter(([, w]) => w !== undefined && w !== null && w !== ''));
  const text = new URLSearchParams(sauber).toString();
  return text ? `?${text}` : '';
};

export const api = {
  status: () => anfrage('/api/status'),
  artikelListe: (filter = {}, signal) => anfrage(`/api/artikel${abfrage(filter)}`, { signal }),
  plattformen: () => anfrage('/api/artikel/plattformen'),
  artikel: (id) => anfrage(`/api/artikel/${id}`),
  artikelAnlegen: (daten) => anfrage('/api/artikel', { methode: 'POST', daten }),
  artikelAendern: (id, daten) => anfrage(`/api/artikel/${id}`, { methode: 'PUT', daten }),
  artikelLoeschen: (id) => anfrage(`/api/artikel/${id}`, { methode: 'DELETE' }),
  bildHochladen: (id, datei) => {
    const formular = new FormData();
    formular.append('bild', datei);
    return anfrage(`/api/artikel/${id}/bild`, { methode: 'POST', formular });
  },
  bildEntfernen: (id) => anfrage(`/api/artikel/${id}/bild`, { methode: 'DELETE' }),
  katalogSuche: (q, typ, signal) => anfrage(`/api/katalog/suche${abfrage({ q, typ })}`, { signal }),
  katalogBarcode: (code) => anfrage(`/api/katalog/barcode/${encodeURIComponent(code)}`),
  katalogEintrag: (id) => anfrage(`/api/katalog/${id}`),
  katalogAnlegen: (daten) => anfrage('/api/katalog', { methode: 'POST', daten }),
  eigeneKatalogeintraege: () => anfrage('/api/katalog/eigene'),
  katalogLoeschen: (id) => anfrage(`/api/katalog/${id}`, { methode: 'DELETE' }),
  statistik: () => anfrage('/api/statistik'),
  importieren: (daten) => anfrage('/api/import', { methode: 'POST', daten }),
};
