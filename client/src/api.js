// Dünne Hülle um fetch mit deutschen Fehlermeldungen.

export class ApiFehler extends Error {
  constructor(meldung, status, felder, code) {
    super(meldung);
    this.status = status;
    this.felder = felder ?? {};
    this.code = code;
  }
}

// Abgelaufene Sitzung oder 2FA-Pflicht an die App melden (siehe App.jsx).
function meldeSonderfall(status, json) {
  if (status === 401 && json?.code === 'nicht_angemeldet') window.dispatchEvent(new Event('vss:abgemeldet'));
  if (status === 403 && json?.code === '2fa_einrichten') window.dispatchEvent(new Event('vss:2fa-pflicht'));
}

/** Upload mit Fortschrittsanzeige (fetch kennt keinen Upload-Fortschritt). */
function hochladenMitFortschritt(pfad, formular, onFortschritt) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', pfad);
    xhr.upload.onprogress = (e) => e.lengthComputable && onFortschritt?.(e.loaded / e.total);
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* leer */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json);
      else {
        meldeSonderfall(xhr.status, json);
        reject(new ApiFehler(json?.fehler ?? `Hochladen fehlgeschlagen (HTTP ${xhr.status}).`, xhr.status, json?.felder, json?.code));
      }
    };
    xhr.onerror = () => reject(new ApiFehler('Der Server ist nicht erreichbar.', 0));
    xhr.send(formular);
  });
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
    meldeSonderfall(antwort.status, json);
    throw new ApiFehler(json?.fehler ?? `Unerwarteter Fehler (HTTP ${antwort.status}).`, antwort.status, json?.felder, json?.code);
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

  // Anmeldung & Konto
  authStatus: () => anfrage('/api/auth/status'),
  anmelden: (daten) => anfrage('/api/auth/anmelden', { methode: 'POST', daten }),
  zweiterFaktor: (daten) => anfrage('/api/auth/2fa', { methode: 'POST', daten }),
  registrieren: (daten) => anfrage('/api/auth/registrieren', { methode: 'POST', daten }),
  abmelden: () => anfrage('/api/auth/abmelden', { methode: 'POST', daten: {} }),
  konto: () => anfrage('/api/konto'),
  speicher: () => anfrage('/api/konto/speicher'),
  kontoAendern: (daten) => anfrage('/api/konto', { methode: 'PUT', daten }),
  passwortAendern: (daten) => anfrage('/api/konto/passwort', { methode: 'POST', daten }),
  ueberallAbmelden: () => anfrage('/api/konto/abmelden-ueberall', { methode: 'POST', daten: {} }),
  kontoLoeschen: (passwort) => anfrage('/api/konto', { methode: 'DELETE', daten: { passwort } }),
  totpEinrichten: (passwort) => anfrage('/api/konto/2fa/einrichten', { methode: 'POST', daten: { passwort } }),
  totpBestaetigen: (code) => anfrage('/api/konto/2fa/bestaetigen', { methode: 'POST', daten: { code } }),
  totpDeaktivieren: (daten) => anfrage('/api/konto/2fa/deaktivieren', { methode: 'POST', daten }),
  neueWiederherstellungscodes: (passwort) => anfrage('/api/konto/2fa/wiederherstellungscodes', { methode: 'POST', daten: { passwort } }),

  // Werte
  werte: () => anfrage('/api/werte'),
  werteAktualisieren: () => anfrage('/api/werte/aktualisieren', { methode: 'POST', daten: {} }),
  katalogWert: (id, region, plattform) => anfrage(`/api/katalog/${id}/wert${abfrage({ region, plattform })}`),

  // Scans & Dokumente
  medien: (katalogId) => anfrage(`/api/katalog/${katalogId}/medien`),
  medium: (id) => anfrage(`/api/medien/${id}`),
  mediumAendern: (id, daten) => anfrage(`/api/medien/${id}`, { methode: 'PUT', daten }),
  mediumLoeschen: (id) => anfrage(`/api/medien/${id}`, { methode: 'DELETE' }),
  mediumHochladen: (artikelId, felder, datei, onFortschritt) => {
    const formular = new FormData();
    for (const [k, v] of Object.entries(felder)) if (v !== undefined && v !== null && v !== '') formular.append(k, v);
    formular.append('datei', datei);
    return hochladenMitFortschritt(`/api/artikel/${artikelId}/medien`, formular, onFortschritt);
  },

  // Community
  community: () => anfrage('/api/community'),
  communitySammlung: (name, filter = {}) => anfrage(`/api/community/${encodeURIComponent(name)}${abfrage(filter)}`),
  communityArtikel: (name, id) => anfrage(`/api/community/${encodeURIComponent(name)}/artikel/${id}`),

  // Katalog, Plattformen, Varianten, Kommentare, Preis-Historie
  plattformenAlle: () => anfrage('/api/plattformen'),
  katalogListe: (filter = {}) => anfrage(`/api/katalog-liste${abfrage(filter)}`),
  katalogSeite: (id) => anfrage(`/api/katalog-seite/${id}`),
  katalogAendern: (id, daten) => anfrage(`/api/katalog/${id}`, { methode: 'PUT', daten }),
  katalogEinreichen: (id) => anfrage(`/api/katalog/${id}/einreichen`, { methode: 'POST', daten: {} }),
  katalogZurueckziehen: (id) => anfrage(`/api/katalog/${id}/zurueckziehen`, { methode: 'POST', daten: {} }),
  varianten: (katalogId) => anfrage(`/api/katalog/${katalogId}/varianten`),
  varianteAnlegen: (katalogId, daten) => anfrage(`/api/katalog/${katalogId}/varianten`, { methode: 'POST', daten }),
  varianteAendern: (id, daten) => anfrage(`/api/varianten/${id}`, { methode: 'PUT', daten }),
  varianteLoeschen: (id) => anfrage(`/api/varianten/${id}`, { methode: 'DELETE' }),
  kommentare: (katalogId) => anfrage(`/api/katalog/${katalogId}/kommentare`),
  kommentarAnlegen: (katalogId, text) => anfrage(`/api/katalog/${katalogId}/kommentare`, { methode: 'POST', daten: { text } }),
  kommentarAendern: (id, text) => anfrage(`/api/kommentare/${id}`, { methode: 'PUT', daten: { text } }),
  kommentarLoeschen: (id) => anfrage(`/api/kommentare/${id}`, { methode: 'DELETE' }),
  preisMelden: (katalogId, daten) => anfrage(`/api/katalog/${katalogId}/historie`, { methode: 'POST', daten }),
  preisMeldungLoeschen: (id) => anfrage(`/api/historie/${id}`, { methode: 'DELETE' }),

  // Moderation
  warteschlange: () => anfrage('/api/moderation/warteschlange'),
  moderiere: (bereich, id, aktion, daten = {}) => anfrage(`/api/moderation/${bereich}/${id}/${aktion}`, { methode: 'POST', daten }),
  kauflinks: (katalogId) => anfrage(`/api/moderation/katalog/${katalogId}/kauflinks`),
  kauflinkAnlegen: (katalogId, daten) => anfrage(`/api/moderation/katalog/${katalogId}/kauflinks`, { methode: 'POST', daten }),
  kauflinkLoeschen: (id) => anfrage(`/api/moderation/kauflinks/${id}`, { methode: 'DELETE' }),
  plattformAnlegen: (daten) => anfrage('/api/moderation/plattformen', { methode: 'POST', daten }),
  plattformAendern: (id, daten) => anfrage(`/api/moderation/plattformen/${id}`, { methode: 'PUT', daten }),

  // Rechtliches, Meldungen, Admin-Übersicht
  seiten: () => anfrage('/api/seiten'),
  seite: (slug) => anfrage(`/api/seiten/${encodeURIComponent(slug)}`),
  seiteSpeichern: (slug, daten) => anfrage(`/api/admin/seiten/${encodeURIComponent(slug)}`, { methode: 'PUT', daten }),
  melden: (daten) => anfrage('/api/melden', { methode: 'POST', daten }),
  meldungen: (status) => anfrage(`/api/moderation/meldungen${abfrage({ status })}`),
  meldungErledigen: (id, daten) => anfrage(`/api/moderation/meldungen/${id}/erledigen`, { methode: 'POST', daten }),
  adminUebersicht: () => anfrage('/api/admin/uebersicht'),
  menschlichePruefung: (bereich, id) => anfrage(`/api/${bereich === 'katalog' ? 'katalog' : 'varianten'}/${id}/menschliche-pruefung`, { methode: 'POST', daten: {} }),
  kiProtokoll: () => anfrage('/api/moderation/ki-protokoll'),
  externeLinks: (katalogId) => anfrage(`/api/katalog/${katalogId}/links`),
  externenLinkAnlegen: (katalogId, daten) => anfrage(`/api/katalog/${katalogId}/links`, { methode: 'POST', daten }),
  externenLinkLoeschen: (id) => anfrage(`/api/links/${id}`, { methode: 'DELETE' }),
  kiZuruecknehmen: (bereich, id) => anfrage(`/api/moderation/${bereich}/${id}/zuruecknehmen`, { methode: 'POST', daten: {} }),
  preisimportStarten: () => anfrage('/api/admin/preisimport', { methode: 'POST', daten: {} }),

  // Administration
  adminEinstellungen: () => anfrage('/api/admin/einstellungen'),
  adminEinstellungenSpeichern: (daten) => anfrage('/api/admin/einstellungen', { methode: 'PUT', daten }),
  adminSicherungen: () => anfrage('/api/admin/sicherungen'),
  adminSicherungStarten: () => anfrage('/api/admin/sicherungen', { methode: 'POST', daten: {} }),
  adminBenutzer: () => anfrage('/api/admin/benutzer'),
  adminBenutzerAendern: (id, daten) => anfrage(`/api/admin/benutzer/${id}`, { methode: 'PUT', daten }),
  admin2faZuruecksetzen: (id) => anfrage(`/api/admin/benutzer/${id}/2fa-zuruecksetzen`, { methode: 'POST', daten: {} }),
  adminPasswort: (id, neuesPasswort) => anfrage(`/api/admin/benutzer/${id}/passwort`, { methode: 'POST', daten: { neuesPasswort } }),
  adminBenutzerLoeschen: (id) => anfrage(`/api/admin/benutzer/${id}`, { methode: 'DELETE' }),
};

/** Zwischengespeicherte Daten des Service-Workers löschen (z. B. beim Abmelden). */
export async function leereZwischenspeicher() {
  if (!('caches' in window)) return;
  const namen = await caches.keys();
  await Promise.all(namen.filter((n) => !n.startsWith('huelle-')).map((n) => caches.delete(n)));
}
