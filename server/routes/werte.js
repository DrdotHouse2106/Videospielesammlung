import { Router } from 'express';
import { preisregion } from '../services/preise.js';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

export function werteRouter({ db, preise, katalog }) {
  const router = Router();
  const meineArtikel = db.prepare(`
    SELECT a.id, a.typ, a.titel, a.plattform, a.region, a.zustand, a.vollstaendigkeit, a.anzahl, a.kaufpreis,
           a.marktwert, a.katalog_id, a.bild_datei, a.cover_url, k.cover_url AS katalog_cover_url
    FROM artikel a LEFT JOIN katalog k ON k.id = a.katalog_id WHERE a.benutzer_id = ?`);

  // Wert der eigenen Sammlung
  router.get('/werte', (req, res) => {
    const artikel = meineArtikel.all(req.benutzer.id);
    const communityCache = new Map();
    let sammlungswert = 0;
    let kaufwert = 0;
    let kaufwertBewertet = 0;
    let bewertet = 0;
    let ohnePreisdaten = 0;
    const liste = artikel.map((a) => {
      if (a.katalog_id && !communityCache.has(a.katalog_id)) communityCache.set(a.katalog_id, preise.community(a.katalog_id));
      const schaetzung = preise.schaetze(a, communityCache.get(a.katalog_id));
      const anzahl = a.anzahl ?? 1;
      if (a.kaufpreis != null) kaufwert += a.kaufpreis * anzahl;
      if (schaetzung) {
        bewertet++;
        sammlungswert += schaetzung.wert * anzahl;
        if (a.kaufpreis != null) kaufwertBewertet += a.kaufpreis * anzahl;
      }
      if (a.katalog_id && !preise.gespeichert(a.katalog_id, preisregion(a.region)).vorhanden) ohnePreisdaten++;
      return {
        id: a.id, typ: a.typ, titel: a.titel, plattform: a.plattform, region: a.region, zustand: a.zustand,
        vollstaendigkeit: a.vollstaendigkeit, anzahl,
        kaufpreis: a.kaufpreis,
        wert: schaetzung?.wert ?? null,
        gesamtwert: schaetzung ? Math.round(schaetzung.wert * anzahl * 100) / 100 : null,
        quelle: schaetzung?.quelle ?? null,
        besitzer: a.katalog_id ? communityCache.get(a.katalog_id).besitzer : 1,
        bild_url: a.bild_datei ? `/api/dateien/${a.bild_datei}` : a.cover_url || a.katalog_cover_url || null,
      };
    });
    liste.sort((x, y) => (y.gesamtwert ?? -1) - (x.gesamtwert ?? -1));
    const runde = (z) => Math.round(z * 100) / 100;
    res.json({
      priceChartingAktiv: preise.aktiv,
      sammlungswert: runde(sammlungswert),
      kaufwert: runde(kaufwert),
      // Gewinn/Verlust nur über Artikel, für die es sowohl Kaufpreis als auch Schätzwert gibt
      differenz: runde(liste.filter((a) => a.gesamtwert != null && a.kaufpreis != null)
        .reduce((s, a) => s + a.gesamtwert, 0) - kaufwertBewertet),
      bewertet,
      gesamt: artikel.length,
      ohnePreisdaten: preise.aktiv ? ohnePreisdaten : 0,
      artikel: liste,
    });
  });

  // Fehlende/veraltete Marktpreise in Etappen abrufen (Rücksicht auf API-Limits).
  router.post('/werte/aktualisieren', async (req, res) => {
    if (!preise.aktiv) return res.status(400).json({ fehler: 'Es ist keine Preisquelle eingerichtet (PRICECHARTING_TOKEN).' });
    const offen = meineArtikel.all(req.benutzer.id)
      .filter((a) => a.katalog_id)
      .filter((a) => {
        const p = preise.gespeichert(a.katalog_id, preisregion(a.region));
        return !p.vorhanden || p.veraltet;
      });
    const eindeutig = [...new Map(offen.map((a) => [`${a.katalog_id}|${preisregion(a.region)}`, a])).values()];
    const stapel = eindeutig.slice(0, 20);
    let aktualisiert = 0;
    try {
      for (const a of stapel) {
        await preise.aktualisiere(a.katalog_id, preisregion(a.region), a.plattform);
        aktualisiert++;
        await warte(250);
      }
    } catch (fehler) {
      return res.status(502).json({ fehler: fehler.message, aktualisiert, offen: eindeutig.length - aktualisiert });
    }
    res.json({ aktualisiert, offen: eindeutig.length - aktualisiert });
  });

  // Wert & Verbreitung eines einzelnen Spiels/Geräts (Katalogeintrag)
  router.get('/katalog/:id/wert', async (req, res) => {
    const katalogId = Number(req.params.id);
    if (!katalog.holeSichtbar(katalogId, req.benutzer)) {
      return res.status(404).json({ fehler: 'Katalogeintrag nicht gefunden.' });
    }
    const region = ['pal', 'ntsc', 'jp'].includes(req.query.region) ? req.query.region : 'pal';
    const marktpreise = await preise.hole(katalogId, region, req.query.plattform);
    const stand = preise.gespeichert(katalogId, region);
    res.json({
      priceChartingAktiv: preise.aktiv,
      region,
      marktpreise,
      abgerufen_am: stand.abgerufen_am ?? null,
      community: preise.community(katalogId),
    });
  });

  return router;
}
