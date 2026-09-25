// Anbindung an die IGDB-API (https://api-docs.igdb.com) über einen Twitch-Account.
// Zugangsdaten: TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET in der .env-Datei.

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const API_URL = 'https://api.igdb.com/v4';
const BILD_URL = 'https://images.igdb.com/igdb/image/upload';

export class IgdbFehler extends Error {}

export function igdbBildUrl(imageId, groesse = 't_cover_big') {
  return imageId ? `${BILD_URL}/${groesse}/${imageId}.jpg` : null;
}

/** Zeichen, die in einem APIcalypse-String Probleme machen, entfernen. */
function suchtext(text) {
  return String(text).replace(/["\\;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function jahr(unixSekunden) {
  return unixSekunden ? new Date(unixSekunden * 1000).getUTCFullYear() : null;
}

export function erstelleIgdbDienst({ clientId, clientSecret }, db, { fetchFn = globalThis.fetch } = {}) {
  const konfiguriert = Boolean(clientId && clientSecret);
  const tokenLesen = db.prepare("SELECT wert FROM einstellungen WHERE schluessel = 'igdb_token'");
  const tokenSchreiben = db.prepare(
    `INSERT INTO einstellungen (schluessel, wert) VALUES ('igdb_token', ?)
     ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert`,
  );

  async function holeToken(erneuern = false) {
    if (!erneuern) {
      const gespeichert = tokenLesen.get();
      if (gespeichert) {
        const { token, laeuftAb } = JSON.parse(gespeichert.wert);
        if (laeuftAb - 60_000 > Date.now()) return token;
      }
    }
    const url = `${TOKEN_URL}?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    })}`;
    const antwort = await fetchFn(url, { method: 'POST' });
    if (!antwort.ok) {
      throw new IgdbFehler(`Twitch-Anmeldung fehlgeschlagen (HTTP ${antwort.status}). Bitte TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET prüfen.`);
    }
    const daten = await antwort.json();
    tokenSchreiben.run(JSON.stringify({ token: daten.access_token, laeuftAb: Date.now() + daten.expires_in * 1000 }));
    return daten.access_token;
  }

  async function abfrage(endpunkt, koerper, erneutVersucht = false) {
    if (!konfiguriert) throw new IgdbFehler('IGDB ist nicht konfiguriert.');
    const token = await holeToken(erneutVersucht);
    const antwort = await fetchFn(`${API_URL}/${endpunkt}`, {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      body: koerper,
      signal: AbortSignal.timeout(10_000),
    });
    if (antwort.status === 401 && !erneutVersucht) return abfrage(endpunkt, koerper, true);
    if (antwort.status === 429) throw new IgdbFehler('IGDB-Anfragelimit erreicht. Bitte kurz warten.');
    if (!antwort.ok) throw new IgdbFehler(`IGDB-Anfrage fehlgeschlagen (HTTP ${antwort.status}).`);
    return antwort.json();
  }

  /** Spiele per Titel suchen. Liefert vereinheitlichte Katalog-Datensätze. */
  async function sucheSpiele(begriff, limit = 20) {
    const ergebnis = await abfrage(
      'games',
      `search "${suchtext(begriff)}";
       fields name, first_release_date, summary, cover.image_id, platforms.name,
              involved_companies.company.name, involved_companies.publisher, involved_companies.developer;
       limit ${limit};`,
    );
    return ergebnis.map((spiel) => {
      const firmen = spiel.involved_companies ?? [];
      const hersteller = (firmen.find((f) => f.publisher) ?? firmen.find((f) => f.developer) ?? firmen[0])?.company?.name ?? null;
      return {
        quelle: 'igdb',
        externe_id: `game:${spiel.id}`,
        typ: 'spiel',
        titel: spiel.name,
        plattformen: (spiel.platforms ?? []).map((p) => p.name),
        erscheinungsjahr: jahr(spiel.first_release_date),
        hersteller,
        cover_url: igdbBildUrl(spiel.cover?.image_id),
        beschreibung: spiel.summary ?? null,
      };
    });
  }

  /** Konsolen/Systeme per Name suchen (IGDB-Endpunkt „platforms“). */
  async function sucheKonsolen(begriff, limit = 20) {
    const ergebnis = await abfrage(
      'platforms',
      `search "${suchtext(begriff)}";
       fields name, abbreviation, alternative_name, generation, summary, platform_logo.image_id,
              versions.name, versions.platform_logo.image_id;
       limit ${limit};`,
    );
    return ergebnis.map((plattform) => ({
      quelle: 'igdb',
      externe_id: `platform:${plattform.id}`,
      typ: 'konsole',
      titel: plattform.name,
      plattformen: [plattform.name],
      erscheinungsjahr: null,
      hersteller: null,
      cover_url: igdbBildUrl(plattform.platform_logo?.image_id, 't_logo_med'),
      beschreibung: plattform.summary ?? null,
    }));
  }

  return { konfiguriert, sucheSpiele, sucheKonsolen };
}
